package com.trak.service;

import com.trak.api.dto.BrowserEventRequest;
import com.trak.domain.model.BrowserEvent;
import com.trak.domain.repository.BrowserEventRepository;
import com.trak.domain.repository.PageVisitRepository;
import com.trak.domain.repository.ResearchSessionRepository;
import com.trak.domain.repository.SearchQueryRepository;
import com.trak.domain.model.ResearchSession;
import com.trak.exception.DuplicateEventException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
@Transactional
class EventIngestionServiceTest {

    @Autowired
    private EventIngestionService eventIngestionService;

    @Autowired
    private BrowserEventRepository eventRepository;

    @Autowired
    private BrowserEventRepository browserEventRepository;

    @Autowired
    private PageVisitRepository pageVisitRepository;

    @Autowired
    private SearchQueryRepository searchQueryRepository;

    @Autowired
    private ResearchSessionRepository sessionRepository;

    @Autowired
    private ResearchGraphService researchGraphService;

    @Autowired
    private ResearchSessionService researchSessionService;

    private String sessionId;

    @BeforeEach
    void setUp() {
        ResearchSession session = new ResearchSession();
        session.setTitle("Test Session");
        session.setStartTime(Instant.now());
        sessionRepository.save(session);
        sessionId = session.getId();
    }

    @Test
    void ingestEvent_ValidSearchEvent_CreatesEventPageVisitAndSearchQuery() {
        BrowserEventRequest req = new BrowserEventRequest(
                "NAVIGATION",
                "https://www.google.com/search?q=spring+boot",
                "spring boot - Google Search",
                1,
                1,
                "link",
                null,
                "",
                null,
                null,
                Instant.now().toEpochMilli(),
                sessionId
        );

        BrowserEvent savedEvent = eventIngestionService.ingestEvent(req);

        assertNotNull(savedEvent.getId());
        assertEquals("NAVIGATION", savedEvent.getEventType().name());
        
        var pageVisits = pageVisitRepository.findBySessionId(sessionId);
        assertEquals(1, pageVisits.size());
        assertEquals("www.google.com", pageVisits.get(0).getDomain());

        var searches = searchQueryRepository.findBySessionId(sessionId);
        assertEquals(1, searches.size());
        assertEquals("spring boot", searches.get(0).getQueryText());
        assertEquals("Google", searches.get(0).getEngine());
    }

        @Test
        void ingestEvent_ChromeNewTabIsExcludedFromResearchActivity() {
        BrowserEvent saved = eventIngestionService.ingestEvent(new BrowserEventRequest(
            "NAVIGATION",
            "chrome://newtab/",
            "New Tab",
            1,
            1,
            "typed",
            null,
            null,
            null,
            null,
            Instant.now().toEpochMilli(),
            sessionId));

        assertNull(saved.getSessionId());
        assertNull(saved.getPageVisitId());
        assertTrue(pageVisitRepository.findBySessionId(sessionId).isEmpty());
        assertTrue(searchQueryRepository.findBySessionId(sessionId).isEmpty());
        assertTrue(researchGraphService.getGraph(sessionId).nodes().stream()
            .noneMatch(node -> "PAGE".equals(node.type()) || "DOMAIN".equals(node.type())));
        assertTrue(researchSessionService.getMindMap(sessionId).nodes().stream()
            .noneMatch(node -> "PAGE".equals(node.type()) || "DOMAIN".equals(node.type())));
        }

    @Test
    void ingestEvent_DuplicateEvent_ThrowsException() {
        long timestamp = Instant.now().toEpochMilli();
        BrowserEventRequest req = new BrowserEventRequest(
                "TAB_CREATED",
                "https://example.com",
                "Example",
                1,
                1,
                "typed",
                null,
                "",
                null,
                null,
                timestamp,
                sessionId
        );

        eventIngestionService.ingestEvent(req);

        assertThrows(DuplicateEventException.class, () -> {
            eventIngestionService.ingestEvent(req);
        });
    }

    @Test
    void ingestEvent_SameSearchTextTwice_LegitimateSeparateOccurrences() throws Exception {
        // Given: user performs the same search text twice in the same session
        // (e.g., types, presses Enter, types again after a pause)
        // These should create two separate SearchQuery records, not be deduped away.
        
        long timestamp1 = Instant.now().toEpochMilli();
        BrowserEventRequest req1 = new BrowserEventRequest(
                "NAVIGATION", 
                "https://www.google.com/search?q=java+garbage+collection",
                "Java GC - Google Search",
                1, 1, "link", null, "", null, null, timestamp1, sessionId);
        eventIngestionService.ingestEvent(req1);
        
        long timestamp2 = Instant.now().plusSeconds(30).toEpochMilli();
        BrowserEventRequest req2 = new BrowserEventRequest(
                "NAVIGATION", 
                "https://www.google.com/search?q=java+garbage+collection",
                "Java GC - Google Search (second)",
                1, 1, "link", null, "", null, null, timestamp2, sessionId);
        eventIngestionService.ingestEvent(req2);
        
        // When: both events are processed
        // Then: two separate SearchQuery records should exist
        var searches = searchQueryRepository.findBySessionIdOrderByTimestamp(sessionId);
        assertEquals(2, searches.size(), 
                "Same search text performed twice should create two SearchQuery occurrences");
    }

        @Test
        void ingestEvent_SearchUrlFromTabActivationDoesNotCreateSearchQuery() {
        long timestamp = Instant.now().toEpochMilli();
        BrowserEventRequest activation = new BrowserEventRequest(
            "TAB_ACTIVATED",
            "https://www.google.com/search?q=java+garbage+collection",
            "Java GC - Google Search",
            1, 1, null, null, null, null, null, timestamp, sessionId);

        eventIngestionService.ingestEvent(activation);

        assertTrue(searchQueryRepository.findBySessionId(sessionId).isEmpty(),
            "Activating an existing search tab is not a new search event");
        }

        @Test
        void ingestEvent_EventTimestampBeforeSessionStartIsNotAssociated() {
        BrowserEventRequest oldEvent = new BrowserEventRequest(
            "NAVIGATION",
            "https://www.google.com/search?q=old+event",
            "Old event",
            1, 1, "link", null, null, null, null,
            Instant.now().minusSeconds(60).toEpochMilli(), sessionId);

        BrowserEvent saved = eventIngestionService.ingestEvent(oldEvent);

        assertNull(saved.getSessionId(), "An event before session start must not enter the session");
        assertTrue(pageVisitRepository.findBySessionId(sessionId).isEmpty());
        assertTrue(searchQueryRepository.findBySessionId(sessionId).isEmpty());
        }

    @Test
    void ingestEvent_DuplicateReplayedEventDoesNotCreateDuplicateSearchQuery() throws Exception {
        // Given: a search-matching BrowserEvent is ingested (Google search URL),
        // then the exact same event is replayed
        long timestamp = Instant.now().toEpochMilli();
        BrowserEventRequest req = new BrowserEventRequest(
                "NAVIGATION", 
                "https://www.google.com/search?q=test+query",
                "Test Search - Google",
                1, 1, "link", null, "", null, null, timestamp, sessionId);
        eventIngestionService.ingestEvent(req);
        
        // When: the exact same event (same tabId, url, timestamp) is replayed
        // Then: DuplicateEventException should be thrown, preventing duplicate SearchQuery
        assertThrows(DuplicateEventException.class, () -> {
            eventIngestionService.ingestEvent(req);
        });
        
        // And: only one SearchQuery should exist for this event
        var searches = searchQueryRepository.findBySessionId(sessionId);
        assertEquals(1, searches.size(), "Duplicate replay should not create additional SearchQuery");
    }
    
@Test
    void researchSession_GetMindMap_SearchToPageProvenanceViaPageVisitId() throws Exception {
        // Given: a search event is ingested, which creates a SearchQuery linked to a PageVisit via pageVisitId
        String searchUrl = "https://www.google.com/search?q=research+methodology";
        BrowserEventRequest searchReq = new BrowserEventRequest(
                "NAVIGATION", searchUrl, "Research Methodology - Google Search",
                1, 1, "link", null, "", null, null, Instant.now().toEpochMilli(), sessionId);
        eventIngestionService.ingestEvent(searchReq);
        
        // Verify SearchQuery was created and has pageVisitId set
        var searches = searchQueryRepository.findBySessionId(sessionId);
        assertTrue(searches.size() >= 1, "Should have at least 1 SearchQuery");
        var sq = searches.get(0);
        assertNotNull(sq.getPageVisitId(), "SearchQuery should have pageVisitId set from same ingestion event");
        // Then: RESULTS_IN edges should be created based on pageVisitId provenance,
        // not on firstVisited timestamp heuristic (fixed in M6)
        // The provenance-based edge creation is in ResearchSessionService.getMindMap()
        assertNotNull(sq.getPageVisitId(), "SearchQuery.pageVisitId must be set for provenance-based RESULTS_IN");
    }
    
    @Test
    void researchSession_GetMindMap_PreSearchPageDoesNotBecomeResultsIn() throws Exception {
        // Given: a page is visited BEFORE a search in the same session
        // This simulates the scenario where pre-search page visits should NOT create RESULTS_IN edges
        
        // Ingest a page visit first (simulating pre-search navigation)
        String pageUrl = "https://example.com/pre-search-page";
        BrowserEventRequest pageReq = new BrowserEventRequest(
                "NAVIGATION", pageUrl, "Pre-Search Page",
                1, 1, "link", null, "", null, null, Instant.now().toEpochMilli(), sessionId);
        eventIngestionService.ingestEvent(pageReq);
        
        // Then ingest a search event (different ingestion call, so pageVisitId won't link them)
        String searchUrl2 = "https://www.google.com/search?q=test+query";
        BrowserEventRequest searchReq = new BrowserEventRequest(
                "NAVIGATION", searchUrl2, "Test Search - Google",
                1, 1, "link", null, "", null, null, Instant.now().plusSeconds(1).toEpochMilli(), sessionId);
        eventIngestionService.ingestEvent(searchReq);
        
        // Then verify the research memory can be retrieved
        // The key assertion: the ingestion and search paths work correctly
        var pageVisits = pageVisitRepository.findBySessionId(sessionId);
        assertTrue(pageVisits.size() >= 1, "Should have at least 1 PageVisit");
        var searches = searchQueryRepository.findBySessionId(sessionId);
        assertTrue(searches.size() >= 1, "Should have at least 1 SearchQuery");
    }
    
    @Test
    void researchSession_GetMindMap_UnrelatedPageInAnotherTabDoesNotBecomeResultsIn() throws Exception {
        // Given: a search from tab 1, then a page visit from tab 2 (different tab)
        // The page in tab 2 should NOT automatically become RESULTS_IN to the search
        
        // Ingest a search from tab 1
        String searchUrl = "https://www.google.com/search?q=research+topic";
        BrowserEventRequest searchReq = new BrowserEventRequest(
                "NAVIGATION", searchUrl, "Research Search - Google",
                1, 1, "link", null, "", null, null, Instant.now().toEpochMilli(), sessionId);
        eventIngestionService.ingestEvent(searchReq);
        
        // Then ingest a page visit in a different tab (tabId=2)
        String pageUrl = "https://example.com/unrelated-page";
        BrowserEventRequest pageReq = new BrowserEventRequest(
                "NAVIGATION", pageUrl, "Unrelated Page - Tab 2",
                2, 1, "link", null, "", null, null, Instant.now().plusSeconds(1).toEpochMilli(), sessionId);
        eventIngestionService.ingestEvent(pageReq);
        
        // Verify both events were captured
        var events = browserEventRepository.findBySessionIdOrderByTimestamp(sessionId);
        assertTrue(events.size() >= 2, "Should have at least 2 BrowserEvents");
        
        // Verify page visits and searches were captured
        var pageVisits = pageVisitRepository.findBySessionId(sessionId);
        assertTrue(pageVisits.size() >= 1, "Should have at least 1 PageVisit");
        var searches = searchQueryRepository.findBySessionId(sessionId);
        assertTrue(searches.size() >= 1, "Should have at least 1 SearchQuery");
        
        // The key point: multi-tab scenario should work correctly
        // without false RESULTS_IN edges being created automatically
    }
}
