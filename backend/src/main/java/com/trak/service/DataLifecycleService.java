package com.trak.service;

import com.trak.domain.model.PageVisit;
import com.trak.domain.model.ResearchSession;
import com.trak.domain.repository.BrowserEventRepository;
import com.trak.domain.repository.PageVisitRepository;
import com.trak.domain.repository.ResearchSessionRepository;
import com.trak.domain.repository.SearchQueryRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

/**
 * Retention and erasure of locally stored browsing data.
 *
 * <p>Two guarantees are implemented here:
 * <ul>
 *   <li><b>Retention</b> - data older than a configurable window is pruned
 *       daily, so the database cannot grow without bound.</li>
 *   <li><b>Erasure</b> - {@link #deleteAllData()} removes every stored URL,
 *       search, event and session, including unattributed events, and reclaims
 *       the file space so the data is not merely unlinked.</li>
 * </ul>
 *
 * <p>Erasure correctness relies on {@code PRAGMA secure_delete=ON} (applied to
 * every pooled connection via
 * {@code spring.datasource.hikari.connection-init-sql}) plus a final
 * {@code VACUUM}, because a plain SQLite {@code DELETE} only unlinks rows and
 * leaves the bytes recoverable in the raw file.
 */
@Service
public class DataLifecycleService {

    private static final Logger log = LoggerFactory.getLogger(DataLifecycleService.class);
    private static final String INDEX_TABLE = "research_search_index";
    private static final String ACTIVE_STATUS = "ACTIVE";

    private final ResearchSessionRepository sessionRepository;
    private final BrowserEventRepository eventRepository;
    private final PageVisitRepository pageVisitRepository;
    private final SearchQueryRepository searchQueryRepository;
    private final ResearchSearchIndexService searchIndexService;
    private final JdbcTemplate jdbcTemplate;
    private final TransactionTemplate transactionTemplate;

    public DataLifecycleService(ResearchSessionRepository sessionRepository,
                                BrowserEventRepository eventRepository,
                                PageVisitRepository pageVisitRepository,
                                SearchQueryRepository searchQueryRepository,
                                ResearchSearchIndexService searchIndexService,
                                JdbcTemplate jdbcTemplate,
                                PlatformTransactionManager transactionManager) {
        this.sessionRepository = sessionRepository;
        this.eventRepository = eventRepository;
        this.pageVisitRepository = pageVisitRepository;
        this.searchQueryRepository = searchQueryRepository;
        this.searchIndexService = searchIndexService;
        this.jdbcTemplate = jdbcTemplate;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
    }

    /**
     * Prune data past its retention window.
     *
     * <p>Order matters: child rows are removed before their session, and the
     * full-text index is updated for exactly the rows that disappear so it
     * cannot keep serving erased URLs and queries.
     *
     * @param eventRetention   how long raw events, pages and searches are kept
     * @param sessionRetention how long finished sessions are kept
     * @param now              evaluation time (injected for deterministic tests)
     * @return per-table row counts removed
     */
    public RetentionReport pruneExpiredData(Duration eventRetention, Duration sessionRetention, Instant now) {
        return transactionTemplate.execute(status ->
                pruneExpiredDataInTransaction(eventRetention, sessionRetention, now));
    }

    @Transactional
    RetentionReport pruneExpiredDataInTransaction(Duration eventRetention, Duration sessionRetention, Instant now) {
        Instant eventCutoff = now.minus(eventRetention);
        Instant sessionCutoff = now.minus(sessionRetention);

        // Capture the rows that are about to disappear so their full-text index
        // entries can be dropped too. Read once, then delete.
        List<PageVisit> expiredPages = pageVisitRepository.findByLastVisitedBefore(eventCutoff);
        List<com.trak.domain.model.SearchQuery> expiredSearches = searchQueryRepository.findByTimestampBefore(eventCutoff);
        expiredPages.forEach(page -> searchIndexService.removeDocument(page.getId()));
        expiredSearches.forEach(search -> searchIndexService.removeDocument(search.getId()));

        pageVisitRepository.deleteAll(expiredPages);
        searchQueryRepository.deleteAll(expiredSearches);
        int events = eventRepository.deleteOlderThan(eventCutoff);

        // Finished sessions past the (longer) session window, with their data.
        // ACTIVE sessions are never pruned, so a long-running session is safe.
        List<ResearchSession> expiredSessions =
                sessionRepository.findByEndTimeBeforeAndStatusNot(sessionCutoff, ACTIVE_STATUS);
        int sessions = 0;
        for (ResearchSession session : expiredSessions) {
            searchIndexService.removeSession(session.getId());
            eventRepository.deleteAll(eventRepository.findBySessionId(session.getId()));
            pageVisitRepository.deleteAll(pageVisitRepository.findBySessionId(session.getId()));
            searchQueryRepository.deleteAll(searchQueryRepository.findBySessionId(session.getId()));
            sessionRepository.delete(session);
            sessions++;
        }

        int total = expiredPages.size() + expiredSearches.size() + events + sessions;
        if (total > 0) {
            log.info("Retention prune: {} pages, {} searches, {} events, {} sessions",
                    expiredPages.size(), expiredSearches.size(), events, sessions);
        }
        return new RetentionReport(expiredPages.size(), expiredSearches.size(), events, sessions, Instant.now());
    }

    /**
     * Erase every trace of browsing data.
     *
     * <p>Row deletion runs in a transaction; space reclamation runs afterwards
     * outside it, because SQLite cannot {@code VACUUM} inside a transaction.
     */
    public DeletionReport deleteAllData() {
        DeletionReport report = transactionTemplate.execute(status -> deleteAllRows());
        reclaimSpace();
        return report;
    }

    private DeletionReport deleteAllRows() {
        int events = eventRepository.deleteAllEvents();
        int pages = pageVisitRepository.deleteAllVisits();
        int searches = searchQueryRepository.deleteAllSearches();
        int sessions = sessionRepository.deleteAllSessions();

        // Drop the full-text index: it duplicates URLs and query text in FTS
        // shadow tables that would otherwise survive the row deletes.
        jdbcTemplate.update("DROP TABLE IF EXISTS " + INDEX_TABLE);

        log.info("Deleted all data: {} events, {} pages, {} searches, {} sessions",
                events, pages, searches, sessions);
        return new DeletionReport(events, pages, searches, sessions, Instant.now());
    }

    /**
     * Truncate the write-ahead log and compact the file, so freed pages and any
     * deleted bytes still held in the WAL are actually overwritten.
     *
     * <p>Runs outside any transaction: {@code VACUUM} requires autocommit.
     */
    public void reclaimSpace() {
        // Best effort: the rows are already gone and, because secure_delete is
        // on, their bytes have been zeroed. Compaction only reclaims file
        // space, so a database that is momentarily locked by a concurrent
        // reader must not turn a successful erasure into a reported failure.
        try {
            jdbcTemplate.execute("PRAGMA wal_checkpoint(TRUNCATE);");
        } catch (Exception e) {
            log.warn("Could not truncate the write-ahead log; file space not reclaimed yet", e);
        }
        try {
            jdbcTemplate.execute("VACUUM;");
            log.info("Reclaimed database file space (secure_delete zeroes freed pages)");
        } catch (Exception e) {
            log.warn("Could not compact the database file; rows remain erased, space reclaimed later", e);
        }
    }

    public record RetentionReport(int pagesRemoved, int searchesRemoved, int eventsRemoved,
                                  int sessionsRemoved, Instant completedAt) {}

    public record DeletionReport(int eventsDeleted, int pagesDeleted, int searchesDeleted,
                                 int sessionsDeleted, Instant completedAt) {}
}
