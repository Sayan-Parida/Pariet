package com.trak.service;

import com.trak.api.dto.BrowserEventRequest;
import com.trak.domain.model.PageVisit;
import com.trak.domain.model.ResearchSession;
import com.trak.domain.repository.BrowserEventRepository;
import com.trak.domain.repository.PageVisitRepository;
import com.trak.domain.repository.SearchQueryRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pariet's own surfaces must never be recorded as research.
 *
 * <p>Opening the dashboard ({@code localhost:5173}) or hitting the API
 * ({@code localhost:8080}) while a session is running is tool usage, not
 * research, so it must not create page visits, search queries or graph nodes.
 */
@SpringBootTest
@Transactional
class OwnAppExclusionTest {

    @Autowired
    private EventIngestionService eventIngestionService;

    @Autowired
    private ResearchSessionService sessionService;

    @Autowired
    private BrowserEventRepository eventRepository;

    @Autowired
    private PageVisitRepository pageVisitRepository;

    @Autowired
    private SearchQueryRepository searchQueryRepository;

    private BrowserEventRequest nav(String url, String title, int tabId, int windowId, String sessionId) {
        return new BrowserEventRequest("NAVIGATION", url, title, tabId, windowId, "link",
                null, "", null, null, Instant.now().toEpochMilli(), sessionId);
    }

    @Test
    void ownDashboardAndApiAreNotResearchUrls() {
        assertFalse(PageVisitService.isResearchUrl("http://localhost:5173/"));
        assertFalse(PageVisitService.isResearchUrl("http://127.0.0.1:5173/"));
        assertFalse(PageVisitService.isResearchUrl("http://localhost:5173/anything"));
        assertFalse(PageVisitService.isResearchUrl("http://localhost:8080/api/sessions"));
        assertFalse(PageVisitService.isResearchUrl("http://127.0.0.1:8080/api/health"));
        // No port means the default for the scheme, still a loopback app URL.
        assertFalse(PageVisitService.isResearchUrl("http://localhost/"));
    }

    @Test
    void realResearchUrlsAreStillCaptured() {
        assertTrue(PageVisitService.isResearchUrl("https://kafka.apache.org/documentation/"));
        assertTrue(PageVisitService.isResearchUrl("https://www.google.com/search?q=test"));
        assertTrue(PageVisitService.isResearchUrl("http://example.com/paper"));
        // A local dev server on another port is genuine research material.
        assertTrue(PageVisitService.isResearchUrl("http://localhost:3000/paper"));
        // A remote host that merely mentions localhost is not the app.
        assertTrue(PageVisitService.isResearchUrl("https://localhost.example.com/paper"));
    }

    @Test
    void browserInternalUrlsAreNotResearchUrls() {
        assertFalse(PageVisitService.isResearchUrl("chrome://extensions/"));
        assertFalse(PageVisitService.isResearchUrl("chrome-extension://abc/popup.html"));
        assertFalse(PageVisitService.isResearchUrl("about:blank"));
        assertFalse(PageVisitService.isResearchUrl("edge://settings"));
        assertFalse(PageVisitService.isResearchUrl("devtools://devtools/bundled/x.js"));
        assertFalse(PageVisitService.isResearchUrl("view-source:https://example.com"));
        assertFalse(PageVisitService.isResearchUrl("file:///C:/Users/secret.txt"));
        assertFalse(PageVisitService.isResearchUrl("data:text/html,<h1>x</h1>"));
        assertFalse(PageVisitService.isResearchUrl(null));
        assertFalse(PageVisitService.isResearchUrl("  "));
    }

    @Test
    void viewingDashboardMidSessionCreatesNoPageVisit() {
        ResearchSession session = sessionService.createSession("Running", 1);
        String id = session.getId();

        eventIngestionService.ingestEvent(nav("http://localhost:5173/", "Pariet", 31, 1, id));
        eventIngestionService.ingestEvent(nav("http://localhost:8080/api/sessions", "Sessions", 32, 1, id));

        List<PageVisit> pages = pageVisitRepository.findBySessionId(id);
        assertTrue(pages.isEmpty(), "dashboard/API views must not become page visits: " + pages);
        assertTrue(searchQueryRepository.findBySessionId(id).isEmpty());

        // Nothing in the graph is derived from those events either.
        ResearchSession graphSession = sessionService.getSession(id);
        assertTrue(sessionService.getMindMap(graphSession.getId()).nodes().stream()
                .noneMatch(n -> n.url() != null && n.url().contains("localhost")));
    }

    @Test
    void realResearchInSameSessionIsStillCaptured() {
        ResearchSession session = sessionService.createSession("Running", 1);
        String id = session.getId();

        eventIngestionService.ingestEvent(nav("http://localhost:5173/", "Pariet", 41, 1, id));
        eventIngestionService.ingestEvent(
                nav("https://kafka.apache.org/documentation/", "Kafka", 42, 1, id));

        List<PageVisit> pages = pageVisitRepository.findBySessionId(id);
        assertEquals(1, pages.size());
        assertEquals("kafka.apache.org", pages.get(0).getDomain());
    }
}
