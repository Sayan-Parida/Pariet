package com.trak.service;

import com.trak.api.dto.MindMapResponse;
import com.trak.domain.model.BrowserEvent;
import com.trak.domain.model.EventType;
import com.trak.domain.model.PageVisit;
import com.trak.domain.model.ResearchSession;
import com.trak.domain.model.SearchQuery;
import com.trak.domain.repository.BrowserEventRepository;
import com.trak.domain.repository.PageVisitRepository;
import com.trak.domain.repository.ResearchSessionRepository;
import com.trak.domain.repository.SearchQueryRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Tests for getMindMap() provenance edge building.
 *
 * Verifies that:
 *   A. Search → Google results → clicked source → SEARCH→SOURCE
 *   B. Search → source opened in new tab → SEARCH→SOURCE
 *   C. Search → manually typed unrelated URL → NO SEARCH→SOURCE
 *   D. Source → source same-tab link navigation → SOURCE→SOURCE
 *   E. Search → source → unrelated typed URL → only authoritative relationships
 *   F. Search-engine result page never becomes a visible SOURCE node
 */
class ResearchSessionServiceMindMapProvenanceTest {

    private static final String SESSION_ID = "session-1";
    private static final Instant START = Instant.parse("2026-01-01T00:00:00Z");

    private ResearchSessionRepository sessionRepository;
    private BrowserEventRepository eventRepository;
    private PageVisitRepository pageVisitRepository;
    private SearchQueryRepository searchQueryRepository;
    private ResearchSessionService sessionService;

    @BeforeEach
    void setUp() {
        sessionRepository = mock(ResearchSessionRepository.class);
        eventRepository = mock(BrowserEventRepository.class);
        pageVisitRepository = mock(PageVisitRepository.class);
        searchQueryRepository = mock(SearchQueryRepository.class);
        PageVisitService pageVisitService = mock(PageVisitService.class);
        ResearchSearchIndexService searchIndexService = mock(ResearchSearchIndexService.class);
        sessionService = new ResearchSessionService(sessionRepository, eventRepository, pageVisitRepository,
                searchQueryRepository, pageVisitService, searchIndexService);

        ResearchSession session = new ResearchSession();
        session.setId(SESSION_ID);
        session.setStartTime(START);
        when(sessionRepository.findById(SESSION_ID)).thenReturn(Optional.of(session));
    }

    // ── Test A: Search → Google results → clicked source → SEARCH→SOURCE ──

    @Test
    void searchToGoogleResultsToClickedSource() {
        BrowserEvent searchEvent = navEvent(10, 1, "google-search", "typed");
        BrowserEvent resultEvent = navEvent(20, 1, "article", "link");

        PageVisit searchPage = pageVisit("google-search", "https://www.google.com/search?q=kafka", "Google Search");
        PageVisit articlePage = pageVisit("article", "https://kafka.apache.org/docs/", "Kafka Docs");

        SearchQuery search = searchQuery("sq-1", "kafka", 10, "google-search");

        stubAll(List.of(searchEvent, resultEvent), List.of(searchPage, articlePage), List.of(search));

        MindMapResponse response = sessionService.getMindMap(SESSION_ID);

        assertTrue(hasEdge(response, "sq-1", "article", "RESULTS_IN"),
                "Should create SEARCH→SOURCE edge for clicked result");
        assertFalse(hasEdge(response, "sq-1", "google-search", "RESULTS_IN"),
                "Should NOT create edge to search-engine page");
    }

    // ── Test B: Search → source opened in new tab → SEARCH→SOURCE ──

    @Test
    void searchToSourceOpenedInNewTabViaSourceTabId() {
        BrowserEvent searchEvent = navEvent(10, 1, "google-search", "typed");
        BrowserEvent newTabEvent = navEvent(20, 2, "article", "link");
        newTabEvent.setSourceTabId(1);

        PageVisit searchPage = pageVisit("google-search", "https://www.google.com/search?q=kafka", "Google Search");
        PageVisit articlePage = pageVisit("article", "https://kafka.apache.org/docs/", "Kafka Docs");

        SearchQuery search = searchQuery("sq-1", "kafka", 10, "google-search");

        stubAll(List.of(searchEvent, newTabEvent), List.of(searchPage, articlePage), List.of(search));

        MindMapResponse response = sessionService.getMindMap(SESSION_ID);

        assertTrue(hasEdge(response, "sq-1", "article", "RESULTS_IN"),
                "Should create SEARCH→SOURCE edge for new-tab result via sourceTabId");
    }

    @Test
    void searchToSourceOpenedInNewTabViaOpenerTabId() {
        BrowserEvent searchEvent = navEvent(10, 1, "google-search", "typed");
        BrowserEvent newTabEvent = navEvent(20, 2, "article", "link");
        newTabEvent.setOpenerTabId(1);

        PageVisit searchPage = pageVisit("google-search", "https://www.google.com/search?q=kafka", "Google Search");
        PageVisit articlePage = pageVisit("article", "https://kafka.apache.org/docs/", "Kafka Docs");

        SearchQuery search = searchQuery("sq-1", "kafka", 10, "google-search");

        stubAll(List.of(searchEvent, newTabEvent), List.of(searchPage, articlePage), List.of(search));

        MindMapResponse response = sessionService.getMindMap(SESSION_ID);

        assertTrue(hasEdge(response, "sq-1", "article", "RESULTS_IN"),
                "Should create SEARCH→SOURCE edge for new-tab result via openerTabId");
    }

    // ── Test C: Search → manually typed unrelated URL → NO SEARCH→SOURCE ──

    @Test
    void searchToTypedUnrelatedUrlProducesNoEdge() {
        BrowserEvent searchEvent = navEvent(10, 1, "google-search", "typed");
        BrowserEvent typedEvent = navEvent(20, 1, "unrelated", "typed");

        PageVisit searchPage = pageVisit("google-search", "https://www.google.com/search?q=kafka", "Google Search");
        PageVisit unrelatedPage = pageVisit("unrelated", "https://example.com/news", "Example News");

        SearchQuery search = searchQuery("sq-1", "kafka", 10, "google-search");

        stubAll(List.of(searchEvent, typedEvent), List.of(searchPage, unrelatedPage), List.of(search));

        MindMapResponse response = sessionService.getMindMap(SESSION_ID);

        assertFalse(hasEdge(response, "sq-1", "unrelated", "RESULTS_IN"),
                "Should NOT create edge for typed (non-link) navigation");
    }

    // ── Test D: Source → source same-tab link navigation → SOURCE→SOURCE ──

    @Test
    void sourceToSourceSameTabLinkNavigation() {
        BrowserEvent eventA = navEvent(10, 1, "article-A", "typed");
        BrowserEvent eventB = navEvent(20, 1, "article-B", "link");

        PageVisit pageA = pageVisit("article-A", "https://kafka.apache.org/docs/", "Kafka Docs");
        PageVisit pageB = pageVisit("article-B", "https://kafka.apache.org/quickstart/", "Kafka Quickstart");

        stubAll(List.of(eventA, eventB), List.of(pageA, pageB), List.of());

        MindMapResponse response = sessionService.getMindMap(SESSION_ID);

        assertTrue(hasEdge(response, "article-A", "article-B", "PAGE_TO_PAGE"),
                "Should create PAGE_TO_PAGE for same-tab consecutive navigation");
        assertTrue(hasEdge(response, "article-A", "article-B", "NAVIGATED_FROM"),
                "Should create NAVIGATED_FROM for same-tab consecutive navigation");
    }

    // ── Test E: Search → source → unrelated typed URL → only authoritative ──

    @Test
    void searchToSourceToTypedUrlOnlyAuthoritative() {
        BrowserEvent searchEvent = navEvent(10, 1, "google-search", "typed");
        BrowserEvent articleEvent = navEvent(20, 1, "article", "link");
        BrowserEvent typedEvent = navEvent(30, 1, "different-page", "typed");

        PageVisit searchPage = pageVisit("google-search", "https://www.google.com/search?q=kafka", "Google Search");
        PageVisit articlePage = pageVisit("article", "https://kafka.apache.org/docs/", "Kafka Docs");
        PageVisit differentPage = pageVisit("different-page", "https://example.com/other", "Other Page");

        SearchQuery search = searchQuery("sq-1", "kafka", 10, "google-search");

        stubAll(List.of(searchEvent, articleEvent, typedEvent),
                List.of(searchPage, articlePage, differentPage), List.of(search));

        MindMapResponse response = sessionService.getMindMap(SESSION_ID);

        assertTrue(hasEdge(response, "sq-1", "article", "RESULTS_IN"),
                "Should create SEARCH→SOURCE for clicked result");
        assertFalse(hasEdge(response, "sq-1", "different-page", "RESULTS_IN"),
                "Should NOT create edge for typed navigation after source");
        assertTrue(hasEdge(response, "article", "different-page", "PAGE_TO_PAGE"),
                "Should create PAGE_TO_PAGE for consecutive navigation");
    }

    // ── Test F: Search-engine result page never becomes visible SOURCE node ──

    @Test
    void searchEnginePageNeverBecomesVisibleSourceNode() {
        BrowserEvent searchEvent = navEvent(10, 1, "google-search", "typed");

        PageVisit searchPage = pageVisit("google-search", "https://www.google.com/search?q=kafka", "Google Search");

        SearchQuery search = searchQuery("sq-1", "kafka", 10, "google-search");

        stubAll(List.of(searchEvent), List.of(searchPage), List.of(search));

        MindMapResponse response = sessionService.getMindMap(SESSION_ID);

        boolean hasSearchPageNode = response.nodes().stream()
                .anyMatch(n -> n.id().equals("google-search") && "PAGE".equals(n.type()));
        assertTrue(hasSearchPageNode, "Backend should include search-engine page as PAGE node");

        assertFalse(hasEdge(response, "sq-1", "google-search", "RESULTS_IN"),
                "Should NOT create RESULTS_IN edge to search-engine page");
    }

    // ── Edge case: search with no searchEvent ──

    @Test
    void searchWithNoMatchingEventProducesNoEdges() {
        SearchQuery search = searchQuery("sq-1", "kafka", 10, "nonexistent-page");

        stubAll(List.of(), List.of(), List.of(search));

        MindMapResponse response = sessionService.getMindMap(SESSION_ID);

        assertTrue(response.edges().stream().noneMatch(e -> "RESULTS_IN".equals(e.relationship())),
                "Should have no RESULTS_IN edges when search event is missing");
    }

    // ── Edge case: link click on search-engine intermediate page ──

    @Test
    void linkClickOnSearchEngineIntermediatePageIsSkipped() {
        BrowserEvent searchEvent = navEvent(10, 1, "google-search", "typed");
        BrowserEvent redirectEvent = navEvent(20, 1, "google-redirect", "link");
        BrowserEvent articleEvent = navEvent(30, 1, "article", "link");

        PageVisit searchPage = pageVisit("google-search", "https://www.google.com/search?q=kafka", "Google Search");
        PageVisit redirectPage = pageVisit("google-redirect", "https://www.google.com/url?q=https://kafka.apache.org", "Google Redirect");
        PageVisit articlePage = pageVisit("article", "https://kafka.apache.org/docs/", "Kafka Docs");

        SearchQuery search = searchQuery("sq-1", "kafka", 10, "google-search");

        stubAll(List.of(searchEvent, redirectEvent, articleEvent),
                List.of(searchPage, redirectPage, articlePage), List.of(search));

        MindMapResponse response = sessionService.getMindMap(SESSION_ID);

        assertFalse(hasEdge(response, "sq-1", "google-redirect", "RESULTS_IN"),
                "Should NOT create edge to search-engine intermediate page");
        assertTrue(hasEdge(response, "sq-1", "article", "RESULTS_IN"),
                "Should create edge to actual research source past search-engine intermediaries");
    }

    // ── Multiple searches with different results ──

    @Test
    void multipleSearchesWithDifferentResults() {
        BrowserEvent s1Event = navEvent(10, 1, "search-1", "typed");
        BrowserEvent a1Event = navEvent(20, 1, "article-A", "link");
        BrowserEvent s2Event = navEvent(40, 1, "search-2", "typed");
        BrowserEvent a2Event = navEvent(50, 1, "article-B", "link");

        PageVisit s1Page = pageVisit("search-1", "https://www.google.com/search?q=kafka", "Google Search");
        PageVisit a1Page = pageVisit("article-A", "https://kafka.apache.org/docs/", "Kafka Docs");
        PageVisit s2Page = pageVisit("search-2", "https://www.google.com/search?q=redis", "Google Search");
        PageVisit a2Page = pageVisit("article-B", "https://redis.io/docs/", "Redis Docs");

        SearchQuery sq1 = searchQuery("sq-1", "kafka", 10, "search-1");
        SearchQuery sq2 = searchQuery("sq-2", "redis", 40, "search-2");

        stubAll(List.of(s1Event, a1Event, s2Event, a2Event),
                List.of(s1Page, a1Page, s2Page, a2Page), List.of(sq1, sq2));

        MindMapResponse response = sessionService.getMindMap(SESSION_ID);

        assertTrue(hasEdge(response, "sq-1", "article-A", "RESULTS_IN"),
                "Search 1 should connect to article A");
        assertTrue(hasEdge(response, "sq-2", "article-B", "RESULTS_IN"),
                "Search 2 should connect to article B");
        assertFalse(hasEdge(response, "sq-1", "article-B", "RESULTS_IN"),
                "Search 1 should NOT connect to article B");
        assertFalse(hasEdge(response, "sq-2", "article-A", "RESULTS_IN"),
                "Search 2 should NOT connect to article A");
    }

    // ── Helpers ──

    private void stubAll(List<BrowserEvent> events, List<PageVisit> pages, List<SearchQuery> searches) {
        when(eventRepository.findBySessionIdOrderByTimestamp(SESSION_ID)).thenReturn(events);
        when(pageVisitRepository.findBySessionIdAndFirstVisitedGreaterThanEqualOrderByFirstVisited(
                eq(SESSION_ID), any(Instant.class))).thenReturn(pages);
        when(searchQueryRepository.findBySessionId(SESSION_ID)).thenReturn(searches);
    }

    private BrowserEvent navEvent(long seconds, int tab, String pageId, String transitionType) {
        BrowserEvent event = new BrowserEvent();
        event.setId(Long.valueOf(Math.abs(pageId.hashCode())));
        event.setSessionId(SESSION_ID);
        event.setTimestamp(START.plusSeconds(seconds));
        event.setTabId(tab);
        event.setPageVisitId(pageId);
        event.setEventType(EventType.NAVIGATION);
        event.setTransitionType(transitionType);
        return event;
    }

    private PageVisit pageVisit(String id, String url, String title) {
        PageVisit pv = new PageVisit();
        pv.setId(id);
        pv.setSessionId(SESSION_ID);
        pv.setUrl(url);
        pv.setTitle(title);
        pv.setDomain(extractDomain(url));
        pv.setFirstVisited(START);
        pv.setLastVisited(START);
        pv.setVisitCount(1);
        return pv;
    }

    private SearchQuery searchQuery(String id, String queryText, long seconds, String pageVisitId) {
        SearchQuery sq = new SearchQuery();
        sq.setId(id);
        sq.setSessionId(SESSION_ID);
        sq.setQueryText(queryText);
        sq.setEngine("Google");
        sq.setSourceUrl("https://www.google.com/search?q=" + queryText);
        sq.setTimestamp(START.plusSeconds(seconds));
        sq.setPageVisitId(pageVisitId);
        return sq;
    }

    private boolean hasEdge(MindMapResponse response, String source, String target, String relationship) {
        return response.edges().stream().anyMatch(e ->
                e.source().equals(source) &&
                e.target().equals(target) &&
                e.relationship().equals(relationship));
    }

    private String extractDomain(String url) {
        try {
            return new java.net.URL(url).getHost();
        } catch (Exception e) {
            return null;
        }
    }
}
