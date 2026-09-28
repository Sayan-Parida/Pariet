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

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Full erasure of locally stored browsing data.
 *
 * <p>There is no automatic retention in this system: nothing is pruned on a
 * schedule. These tests cover only the deliberate, user-triggered erase.
 */
@SpringBootTest
@Transactional
class DataLifecycleServiceTest {

    private static final String RESEARCH_URL = "https://kafka.apache.org/documentation/";
    private static final String OTHER_URL = "https://example.org/unattributed";

    @Autowired
    private DataLifecycleService lifecycleService;

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

    @Test
    void deleteAllDataErasesEverythingIncludingUnattributedEvents() {
        Instant now = Instant.now();
        ResearchSession session = sessionService.createSession("To erase", 1);

        eventRepository.saveAndFlush(
                event(EventType.NAVIGATION, RESEARCH_URL, "Kafka documentation", 21, 1, now, session.getId()));

        // An event with no session attribution, as captured outside a session.
        eventRepository.saveAndFlush(
                event(EventType.TAB_ACTIVATED, OTHER_URL, "Unattributed", 22, 2, now, null));

        PageVisit page = new PageVisit();
        page.setUrl(RESEARCH_URL);
        page.setDomain("kafka.apache.org");
        page.setTitle("Kafka documentation");
        page.setFirstVisited(now);
        page.setLastVisited(now);
        page.setSessionId(session.getId());
        pageVisitRepository.saveAndFlush(page);

        SearchQuery search = new SearchQuery();
        search.setQueryText("erasure test");
        search.setEngine("google");
        search.setSourceUrl("https://www.google.com/search?q=erasure+test");
        search.setTimestamp(now);
        search.setSessionId(session.getId());
        searchQueryRepository.saveAndFlush(search);

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
    void dataIsKeptIndefinitelyUntilExplicitlyErased() {
        // Old data must survive: there is no automatic retention, so a session
        // that ended months ago is still listed.
        Instant longAgo = Instant.now().minus(3650, ChronoUnit.DAYS);
        ResearchSession old = sessionService.createSession("Ancient", 1);
        old.setStatus("COMPLETED");
        old.setStartTime(longAgo);
        old.setEndTime(longAgo);
        sessionRepository.saveAndFlush(old);

        PageVisit page = new PageVisit();
        page.setUrl("https://example.com/ancient");
        page.setDomain("example.com");
        page.setTitle("Ancient page");
        page.setFirstVisited(longAgo);
        page.setLastVisited(longAgo);
        page.setSessionId(old.getId());
        pageVisitRepository.saveAndFlush(page);

        assertEquals(1, sessionRepository.count());
        assertEquals(1, pageVisitRepository.findBySessionId(old.getId()).size());
    }

    @Test
    void deleteAllDataOnEmptyDatabaseIsANoOp() {
        DataLifecycleService.DeletionReport report = lifecycleService.deleteAllData();
        assertEquals(0, report.eventsDeleted());
        assertEquals(0, report.pagesDeleted());
        assertEquals(0, report.searchesDeleted());
        assertEquals(0, report.sessionsDeleted());
    }

    @Test
    void deletingOneSessionLeavesOthersIntact() {
        ResearchSession keep = sessionService.createSession("Keep me", 1);
        ResearchSession drop = sessionService.createSession("Drop me", 1);

        PageVisit page = new PageVisit();
        page.setUrl("https://example.com/keep");
        page.setDomain("example.com");
        page.setTitle("Keep");
        page.setFirstVisited(Instant.now());
        page.setLastVisited(Instant.now());
        page.setSessionId(keep.getId());
        pageVisitRepository.saveAndFlush(page);

        sessionService.deleteSession(drop.getId());

        assertTrue(sessionRepository.existsById(keep.getId()));
        assertTrue(!sessionRepository.existsById(drop.getId()));
        assertEquals(1, pageVisitRepository.findBySessionId(keep.getId()).size());
    }
}
