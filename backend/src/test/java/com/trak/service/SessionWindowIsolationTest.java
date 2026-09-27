package com.trak.service;

import com.trak.api.dto.BrowserEventRequest;
import com.trak.domain.model.BrowserEvent;
import com.trak.domain.model.ResearchSession;
import com.trak.domain.repository.BrowserEventRepository;
import com.trak.domain.repository.PageVisitRepository;
import com.trak.domain.repository.SearchQueryRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Per-session Chrome window isolation for event attribution.
 *
 * <p>A Research Session belongs to the window where it was started (see
 * ResearchSession.windowId). Events from any other window must never be
 * attributed to it, while events with an unknown window on either side keep
 * the legacy behavior. Moved-tab rule: attribution follows the event's
 * windowId at event time; a tab moved out of the research window stops being
 * attributed, a tab moved in is evaluated under the normal rules.
 */
@SpringBootTest
@Transactional
class SessionWindowIsolationTest {

    private static final String SEARCH_URL = "https://www.google.com/search?q=window+isolation";
    private static final String PAGE_URL = "https://kafka.apache.org/documentation/";

    @Autowired
    private EventIngestionService eventIngestionService;

    @Autowired
    private ResearchSessionService researchSessionService;

    @Autowired
    private BrowserEventRepository eventRepository;

    @Autowired
    private PageVisitRepository pageVisitRepository;

    @Autowired
    private SearchQueryRepository searchQueryRepository;

    private BrowserEventRequest nav(String url, String title, int tabId, Integer windowId, String sessionId) {
        return navAt(url, title, tabId, windowId, sessionId, Instant.now());
    }

    private BrowserEventRequest navAt(String url, String title, int tabId, Integer windowId, String sessionId, Instant timestamp) {
        return new BrowserEventRequest(
                "NAVIGATION",
                url,
                title,
                tabId,
                windowId,
                "link",
                null,
                "",
                null,
                null,
                timestamp.toEpochMilli(),
                sessionId
        );
    }

    private String createWindowSession(Integer windowId) {
        ResearchSession session = researchSessionService.createSession("Window session", windowId);
        assertEquals(windowId, session.getWindowId());
        return session.getId();
    }

    @Test
    void A_searchInSessionWindowIsIncluded() {
        String sessionId = createWindowSession(1);

        BrowserEvent saved = eventIngestionService.ingestEvent(
                nav(SEARCH_URL, "window isolation - Google Search", 101, 1, sessionId));

        assertEquals(sessionId, saved.getSessionId());
        assertEquals(1, searchQueryRepository.findBySessionId(sessionId).size());
        assertEquals(1, pageVisitRepository.findBySessionId(sessionId).size());
    }

    @Test
    void B_searchInOtherWindowIsExcluded() {
        String sessionId = createWindowSession(1);

        BrowserEvent saved = eventIngestionService.ingestEvent(
                nav(SEARCH_URL, "window isolation - Google Search", 201, 2, sessionId));

        // Event is still stored globally, but carries no session attribution...
        assertNotNull(saved.getId());
        assertNull(saved.getSessionId());
        assertNull(saved.getPageVisitId());
        // ...and nothing from Window 2 reaches session-derived data.
        assertTrue(searchQueryRepository.findBySessionId(sessionId).isEmpty());
        assertTrue(pageVisitRepository.findBySessionId(sessionId).isEmpty());
    }

    @Test
    void C_pageInSessionWindowIsIncluded() {
        String sessionId = createWindowSession(1);

        BrowserEvent saved = eventIngestionService.ingestEvent(
                nav(PAGE_URL, "Kafka documentation", 102, 1, sessionId));

        assertEquals(sessionId, saved.getSessionId());
        assertEquals(1, pageVisitRepository.findBySessionId(sessionId).size());
    }

    @Test
    void D_otherWindowLeavesNoSessionTrace() {
        String sessionId = createWindowSession(1);

        eventIngestionService.ingestEvent(
                nav(PAGE_URL, "Kafka documentation", 202, 2, sessionId));
        eventIngestionService.ingestEvent(
                nav(SEARCH_URL, "window isolation - Google Search", 203, 2, sessionId));

        assertTrue(pageVisitRepository.findBySessionId(sessionId).isEmpty());
        assertTrue(searchQueryRepository.findBySessionId(sessionId).isEmpty());
        assertTrue(eventRepository.findBySessionIdOrderByTimestamp(sessionId).isEmpty());
        assertTrue(researchSessionService.getMindMap(sessionId).nodes().stream()
                .noneMatch(node -> "PAGE".equals(node.type())));
        assertTrue(researchSessionService.getTimeline(sessionId).isEmpty());
    }

    @Test
    void E_legacyNullSessionWindowStillAttributes() {
        String sessionId = researchSessionService.createSession("Legacy session").getId();

        BrowserEvent saved = eventIngestionService.ingestEvent(
                nav(SEARCH_URL, "window isolation - Google Search", 301, 7, sessionId));

        assertEquals(sessionId, saved.getSessionId());
        assertEquals(1, searchQueryRepository.findBySessionId(sessionId).size());
    }

    @Test
    void E_legacyNullEventWindowStillAttributes() {
        String sessionId = createWindowSession(1);

        BrowserEvent saved = eventIngestionService.ingestEvent(
                nav(SEARCH_URL, "window isolation - Google Search", 302, null, sessionId));

        assertEquals(sessionId, saved.getSessionId());
        assertEquals(1, searchQueryRepository.findBySessionId(sessionId).size());
    }

    @Test
    void F_tabMovedOutOfResearchWindowStopsBeingAttributed() {
        String sessionId = createWindowSession(1);
        Instant firstVisit = Instant.now();

        BrowserEvent first = eventIngestionService.ingestEvent(
                navAt(PAGE_URL, "Kafka documentation", 303, 1, sessionId, firstVisit));
        assertEquals(sessionId, first.getSessionId());

        // Same tab, now moved to Window 2: must not be attributed.
        BrowserEvent moved = eventIngestionService.ingestEvent(
                navAt(PAGE_URL, "Kafka documentation", 303, 2, sessionId, firstVisit.plusMillis(5)));
        assertNull(moved.getSessionId());
        assertEquals(1, pageVisitRepository.findBySessionId(sessionId).size());
    }

    @Test
    void F_tabMovedIntoResearchWindowIsEvaluatedNormally() {
        String sessionId = createWindowSession(1);

        // Unknown to the session window: treated like a newly created tab once
        // its events arrive carrying the research window id.
        BrowserEvent moved = eventIngestionService.ingestEvent(
                nav(PAGE_URL, "Kafka documentation", 304, 1, sessionId));
        assertEquals(sessionId, moved.getSessionId());
        assertEquals(1, pageVisitRepository.findBySessionId(sessionId).size());
    }
}
