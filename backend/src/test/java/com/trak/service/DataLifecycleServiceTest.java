package com.trak.service;

import com.trak.domain.model.BrowserEvent;
import com.trak.domain.model.EventType;
import com.trak.domain.model.PageVisit;
import com.trak.domain.model.ResearchSession;
import com.trak.domain.model.SearchQuery;
import com.trak.domain.repository.BrowserEventRepository;
import com.trak.domain.repository.PageVisitRepository;
import com.trak.domain.repository.ResearchSessionRepository;
import com.trak.domain.repository.SearchQueryRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Retention pruning and full erasure of locally stored browsing data.
 */
@SpringBootTest
@Transactional
class DataLifecycleServiceTest {

    private static final String RESEARCH_URL = "https://kafka.apache.org/documentation/";
    private static final String SEARCH_URL = "https://www.google.com/search?q=retention+test";

    @Autowired
    private DataLifecycleService lifecycleService;

    @Autowired
    private DataRetentionJob retentionJob;

    @Autowired
    private ResearchSessionRepository sessionRepository;

    @Autowired
    private BrowserEventRepository eventRepository;

    @Autowired
    private PageVisitRepository pageVisitRepository;

    @Autowired
    private SearchQueryRepository searchQueryRepository;

    @Autowired
    private ResearchSearchIndexService searchIndexService;

    @Autowired
    private ResearchSessionService sessionService;

    private BrowserEvent event(EventType type, String url, String title, int tabId, int windowId,
                              Instant timestamp, String sessionId) {
        BrowserEvent event = new BrowserEvent();
        event.setEventType(type);
        event.setUrl(url);
        event.setTitle(title);
        event.setTabId(tabId);
        event.setWindowId(windowId);
        event.setTimestamp(timestamp);
        event.setSessionId(sessionId);
        return event;
    }

    private ResearchSession completedSessionEndedAt(Instant endTime) {
        ResearchSession session = sessionService.createSession("Prune me", 1);
        session.setStatus("COMPLETED");
        session.setStartTime(endTime.minus(2, ChronoUnit.HOURS));
        session.setEndTime(endTime);
        return sessionRepository.save(session);
    }

    @Test
    void pruneRemovesOldEventsPagesAndSearches() {
        Instant now = Instant.now();
        Instant old = now.minus(200, ChronoUnit.DAYS);

        ResearchSession session = sessionService.createSession("Old activity", 1);
        eventRepository.saveAndFlush(
                event(EventType.NAVIGATION, RESEARCH_URL, "Kafka documentation", 11, 1, old, session.getId()));

        PageVisit page = new PageVisit();
        page.setUrl(RESEARCH_URL);
        page.setDomain("kafka.apache.org");
        page.setTitle("Kafka documentation");
        page.setFirstVisited(old);
        page.setLastVisited(old);
        page.setSessionId(session.getId());
        pageVisitRepository.saveAndFlush(page);

        SearchQuery search = new SearchQuery();
        search.setQueryText("retention test");
        search.setEngine("google");
        search.setSourceUrl(SEARCH_URL);
        search.setTimestamp(old);
        search.setSessionId(session.getId());
        searchQueryRepository.saveAndFlush(search);

        DataLifecycleService.RetentionReport report =
                lifecycleService.pruneExpiredData(Duration.ofDays(90), Duration.ofDays(365), now);

        assertEquals(1, report.pagesRemoved());
        assertEquals(1, report.searchesRemoved());
        assertTrue(report.eventsRemoved() >= 1);
        assertTrue(pageVisitRepository.findBySessionId(session.getId()).isEmpty());
        assertTrue(searchQueryRepository.findBySessionId(session.getId()).isEmpty());
        // The full-text index must not keep serving the pruned URL/query.
        assertTrue(searchIndexService.search("kafka", 10).stream()
                .noneMatch(hit -> page.getId().equals(hit.sourceId())));
    }

    @Test
    void pruneKeepsDataWithinRetentionWindow() {
        Instant now = Instant.now();
        ResearchSession session = sessionService.createSession("Recent activity", 1);

        PageVisit page = new PageVisit();
        page.setUrl("https://example.com/recent");
        page.setDomain("example.com");
        page.setTitle("Recent");
        page.setFirstVisited(now.minus(3, ChronoUnit.DAYS));
        page.setLastVisited(now.minus(3, ChronoUnit.DAYS));
        page.setSessionId(session.getId());
        pageVisitRepository.saveAndFlush(page);

        DataLifecycleService.RetentionReport report =
                lifecycleService.pruneExpiredData(Duration.ofDays(90), Duration.ofDays(365), now);

        assertEquals(0, report.pagesRemoved());
        assertEquals(1, pageVisitRepository.findBySessionId(session.getId()).size());
    }

    @Test
    void pruneRemovesOldFinishedSessionsButNeverActiveOnes() {
        Instant now = Instant.now();
        ResearchSession oldFinished = completedSessionEndedAt(now.minus(500, ChronoUnit.DAYS));
        ResearchSession oldActive = sessionService.createSession("Still running", 1);
        oldActive.setStatus("ACTIVE");
        oldActive.setEndTime(now.minus(500, ChronoUnit.DAYS));
        sessionRepository.saveAndFlush(oldActive);

        DataLifecycleService.RetentionReport report =
                lifecycleService.pruneExpiredData(Duration.ofDays(90), Duration.ofDays(365), now);

        assertEquals(1, report.sessionsRemoved());
        assertFalse(sessionRepository.existsById(oldFinished.getId()));
        // An ACTIVE session is never pruned regardless of age.
        assertTrue(sessionRepository.existsById(oldActive.getId()));
    }

    @Test
    void deleteAllDataErasesEverythingIncludingUnattributedEvents() {
        Instant now = Instant.now();
        ResearchSession session = sessionService.createSession("To erase", 1);

        eventRepository.saveAndFlush(
                event(EventType.NAVIGATION, RESEARCH_URL, "Kafka documentation", 21, 1, now, session.getId()));

        // An event with no session attribution, as captured outside a session.
        eventRepository.saveAndFlush(
                event(EventType.TAB_ACTIVATED, "https://example.org/unattributed", "Unattributed", 22, 2, now, null));

        PageVisit page = new PageVisit();
        page.setUrl(RESEARCH_URL);
        page.setDomain("kafka.apache.org");
        page.setTitle("Kafka documentation");
        page.setFirstVisited(now);
        page.setLastVisited(now);
        page.setSessionId(session.getId());
        pageVisitRepository.saveAndFlush(page);

        assertTrue(eventRepository.count() > 0);

        DataLifecycleService.DeletionReport report = lifecycleService.deleteAllData();

        assertTrue(report.eventsDeleted() >= 2);
        assertEquals(0, eventRepository.count());
        assertEquals(0, pageVisitRepository.count());
        assertEquals(0, searchQueryRepository.count());
        assertEquals(0, sessionRepository.count());
        // The full-text index, which duplicates URLs and queries, is gone too.
        assertEquals(0, searchIndexService.count());
        assertEquals(0, searchIndexService.search("kafka", 10).size());
    }

    @Test
    void retentionJobUsesConfiguredWindows() {
        // Defaults are 90 days for events and 365 for sessions.
        assertEquals(Duration.ofDays(90), retentionJob.getEventRetention());
        assertEquals(Duration.ofDays(365), retentionJob.getSessionRetention());
    }

    @Test
    void retentionJobClampsNonsensicalConfiguration() {
        DataRetentionJob job = new DataRetentionJob(lifecycleService, 0, -5, 99);
        assertEquals(Duration.ofDays(1), job.getEventRetention());
        assertEquals(Duration.ofDays(1), job.getSessionRetention());
    }
}
