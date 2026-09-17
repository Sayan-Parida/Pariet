package com.trak.service;

import com.trak.api.dto.BrowserEventRequest;
import com.trak.domain.model.BrowserEvent;
import com.trak.domain.model.EventType;
import com.trak.domain.model.PageVisit;
import com.trak.domain.model.SearchQuery;
import com.trak.domain.repository.BrowserEventRepository;
import com.trak.domain.repository.SearchQueryRepository;
import com.trak.exception.DuplicateEventException;
import com.trak.processing.SearchDetector;
import com.trak.processing.SessionDetector;
import com.trak.processing.text.ResearchTextNormalizer;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@Service
public class EventIngestionService {

    private final BrowserEventRepository browserEventRepository;
    private final SearchQueryRepository searchQueryRepository;
    private final PageVisitService pageVisitService;
    private final SearchDetector searchDetector;
    private final SessionDetector sessionDetector;
    private final ResearchSearchIndexService searchIndexService;
    private final KeyedLock keyedLock;
    private final TransactionTemplate transactionTemplate;

    public EventIngestionService(BrowserEventRepository browserEventRepository,
                                 SearchQueryRepository searchQueryRepository,
                                 PageVisitService pageVisitService,
                                 SearchDetector searchDetector,
                                 SessionDetector sessionDetector,
                                 ResearchSearchIndexService searchIndexService,
                                 KeyedLock keyedLock,
                                 PlatformTransactionManager transactionManager) {
        this.browserEventRepository = browserEventRepository;
        this.searchQueryRepository = searchQueryRepository;
        this.pageVisitService = pageVisitService;
        this.searchDetector = searchDetector;
        this.sessionDetector = sessionDetector;
        this.searchIndexService = searchIndexService;
        this.keyedLock = keyedLock;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
    }

    /**
     * Ingests a single browser event.
     *
     * <p>Lock ordering: acquire KeyedLock BEFORE opening any database transaction.
     * This ensures a thread waiting for the lock never holds an open SQLite
     * transaction with a stale WAL snapshot.
     */
    public BrowserEvent ingestEvent(BrowserEventRequest request) {
        Instant timestamp = Instant.ofEpochMilli(request.timestamp());
        String sessionId = request.sessionId();
        String url = request.url();

        KeyedLock.SessionUrlKey key = (sessionId != null && url != null)
                ? new KeyedLock.SessionUrlKey(sessionId, url)
                : null;

        keyedLock.lock(key);
        try {
            return transactionTemplate.execute(status -> {
                // Dedup check
                if (browserEventRepository.findByTabIdAndUrlAndTimestamp(
                        request.tabId(), request.url(), timestamp).isPresent()) {
                    throw new DuplicateEventException("Event already exists");
                }

                BrowserEvent event = new BrowserEvent();
                event.setEventType(EventType.valueOf(request.eventType()));
                event.setUrl(request.url());
                event.setTitle(request.title());
                event.setTabId(request.tabId());
                event.setWindowId(request.windowId());
                event.setTransitionType(request.transitionType());
                event.setReferrerUrl(request.referrerUrl());
                event.setOpenerTabId(request.openerTabId());
                event.setSourceTabId(request.sourceTabId());
                event.setTimestamp(timestamp);

                if (sessionId != null && PageVisitService.isResearchUrl(url)
                        && sessionDetector.isValidSessionEvent(sessionId, timestamp)) {
                    event.setSessionId(sessionId);
                }

                // Page visit and search processing
                if (event.getSessionId() != null && event.getUrl() != null) {
                    PageVisit visit = pageVisitService.createOrUpdatePageVisit(
                            event.getUrl(), event.getTitle(), event.getSessionId(), timestamp);
                    if (visit != null) {
                        event.setPageVisitId(visit.getId());
                        searchIndexService.indexPage(visit);
                    }

                    if (event.getEventType() == EventType.NAVIGATION) {
                        searchDetector.detect(event.getUrl()).ifPresent(result -> {
                        SearchQuery query = new SearchQuery();
                        query.setQueryText(result.queryText());
                        query.setNormalizedQuery(ResearchTextNormalizer.normalize(result.queryText()));
                        query.setEngine(result.engine());
                        query.setSourceUrl(event.getUrl());
                        query.setTimestamp(timestamp);
                        query.setSessionId(event.getSessionId());
                        
                        // Dedup: skip if a SearchQuery with the same (sessionId, normalizedQuery, sourceUrl, timestamp) already exists
                        SearchQuery existing = searchQueryRepository.findBySessionIdAndNormalizedQueryAndSourceUrlAndTimestamp(
                                event.getSessionId(), query.getNormalizedQuery(), query.getSourceUrl(), timestamp);
                        if (existing != null) {
                            // Already recorded; skip saving duplicate
                        } else {
                            if (visit != null) {
                                query.setPageVisitId(visit.getId());
                            }
                            searchIndexService.indexSearch(searchQueryRepository.save(query));
                        }
                        });
                    }
                }

                event.setProcessed(true);
                return browserEventRepository.save(event);
            });
        } finally {
            keyedLock.unlock(key);
        }
    }

    /**
     * Ingests a batch of browser events. Each event is processed independently
     * with its own lock and transaction, preserving partial-success semantics
     * (duplicates are silently skipped).
     */
    public List<BrowserEvent> ingestBatch(List<BrowserEventRequest> requests) {
        List<BrowserEvent> saved = new ArrayList<>();
        for (BrowserEventRequest request : requests) {
            try {
                saved.add(ingestEvent(request));
            } catch (DuplicateEventException e) {
                // Ignore duplicates in batch
            }
        }
        return saved;
    }
}
