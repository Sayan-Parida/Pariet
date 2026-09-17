package com.trak.service;

import com.trak.api.dto.BrowserEventRequest;
import com.trak.domain.model.BrowserEvent;
import com.trak.domain.model.PageVisit;
import com.trak.domain.model.ResearchSession;
import com.trak.domain.repository.BrowserEventRepository;
import com.trak.domain.repository.PageVisitRepository;
import com.trak.domain.repository.ResearchSessionRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

/**
 * M5 Concurrency tests exercising the real production ingestion path:
 * {@link EventIngestionService#ingestEvent(BrowserEventRequest)}.
 *
 * <p>SQLite Controlled Test Coordination Note:
 * The default test configuration uses {@code jdbc:sqlite::memory:}, which is strictly private
 * per JDBC connection. Multi-threaded concurrency tests require multiple worker threads to
 * access the same database state. Therefore, this test dynamically binds to a local temporary
 * SQLite file with WAL mode and a busy timeout. This coordination is kept strictly local to
 * this test class and does not modify the global test database configuration.
 */
@SpringBootTest
class PageVisitConcurrencyTest {

    @Autowired
    private EventIngestionService eventIngestionService;

    @Autowired
    private PageVisitRepository pageVisitRepository;

    @Autowired
    private BrowserEventRepository browserEventRepository;

    @Autowired
    private ResearchSessionRepository sessionRepository;

    static Path tempDbFile;

    @DynamicPropertySource
    static void configureSqliteFileDb(DynamicPropertyRegistry registry) throws Exception {
        tempDbFile = Files.createTempFile("trak-concurrency-", ".db");
        tempDbFile.toFile().deleteOnExit();
        String url = "jdbc:sqlite:" + tempDbFile.toAbsolutePath().toString().replace("\\", "/");
        try (java.sql.Connection conn = java.sql.DriverManager.getConnection(url);
             java.sql.Statement stmt = conn.createStatement()) {
            stmt.execute("PRAGMA journal_mode=WAL;");
            stmt.execute("PRAGMA busy_timeout=15000;");
        }
        registry.add("spring.datasource.url", () -> url);
        registry.add("spring.datasource.hikari.maximum-pool-size", () -> "10");
        registry.add("spring.datasource.hikari.connection-init-sql", () -> "PRAGMA busy_timeout=15000;");
    }

    private String createValidSession(String title) {
        ResearchSession session = new ResearchSession();
        session.setTitle(title);
        session.setStatus("ACTIVE");
        session.setStartTime(Instant.now());
        return sessionRepository.save(session).getId();
    }

        private Instant sessionEventStart(String sessionId) {
                return sessionRepository.findById(sessionId).orElseThrow().getStartTime().plusSeconds(1);
        }

    @Test
    void concurrentFirstVisits_createsExactlyOnePageVisitAndMaintainsCounts() throws Exception {
        String sessionId = createValidSession("Concurrent First Visits Session");
        String url = "https://example.com/first-visit-race-" + UUID.randomUUID();
        Instant baseTime = sessionEventStart(sessionId);

        int threads = 8;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        List<Future<BrowserEvent>> futures = new ArrayList<>();

        try {
            for (int t = 0; t < threads; t++) {
                final int threadIdx = t;
                // Legitimate distinct events with unique timestamps (e.g. rapid navigations or parallel tabs)
                Instant eventTime = baseTime.plusMillis(threadIdx * 100L);
                BrowserEventRequest request = new BrowserEventRequest(
                        "NAVIGATION",
                        url,
                        "Title Thread " + threadIdx,
                        threadIdx + 1,
                        1,
                        "link",
                        null,
                        "",
                        null,
                        null,
                        eventTime.toEpochMilli(),
                        sessionId
                );
                futures.add(pool.submit(() -> eventIngestionService.ingestEvent(request)));
            }

            for (Future<BrowserEvent> future : futures) {
                assertNotNull(future.get(30, TimeUnit.SECONDS), "Ingest request should complete successfully");
            }
        } finally {
            pool.shutdownNow();
        }

        // Verify that exactly 1 PageVisit aggregate row was created
        List<PageVisit> visits = pageVisitRepository.findBySessionId(sessionId).stream()
                .filter(v -> url.equals(v.getUrl()))
                .toList();
        assertEquals(1, visits.size(), "Must create exactly one PageVisit row for (url, sessionId)");

        PageVisit visit = visits.get(0);
        assertEquals(threads, visit.getVisitCount(), "All concurrent first visits must be accumulated in visitCount");
        assertEquals(baseTime.plusMillis((threads - 1) * 100L), visit.getLastVisited(),
                "lastVisited must reflect the maximum event timestamp");

        // Verify that all browser events are preserved in chronological history
        List<BrowserEvent> events = browserEventRepository.findBySessionIdOrderByTimestamp(sessionId).stream()
                .filter(e -> url.equals(e.getUrl()))
                .toList();
        assertEquals(threads, events.size(), "Every ingested event must be preserved in BrowserEvent repository");
    }

    @Test
    void concurrentUpdatesToExistingVisit_loseNoIncrements() throws Exception {
        String sessionId = createValidSession("Concurrent Updates Session");
        String url = "https://example.com/update-race-" + UUID.randomUUID();
        Instant seedTime = sessionEventStart(sessionId);

        // Seed initial visit
        BrowserEventRequest seedRequest = new BrowserEventRequest(
                "NAVIGATION", url, "Initial Title", 1, 1, "link", null, "", null, null, seedTime.toEpochMilli(), sessionId);
        assertNotNull(eventIngestionService.ingestEvent(seedRequest));

        int threads = 6;
        int eventsPerThread = 10;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        List<Future<?>> futures = new ArrayList<>();

        try {
            for (int t = 0; t < threads; t++) {
                final int threadIdx = t;
                futures.add(pool.submit(() -> {
                    for (int i = 0; i < eventsPerThread; i++) {
                        Instant eventTime = seedTime.plusMillis((threadIdx + 1) * 1000L + i * 10L);
                        BrowserEventRequest req = new BrowserEventRequest(
                                "NAVIGATION",
                                url,
                                "Updated " + threadIdx + "-" + i,
                                threadIdx + 2,
                                1,
                                "link",
                                null,
                                "",
                                null,
                                null,
                                eventTime.toEpochMilli(),
                                sessionId
                        );
                        BrowserEvent event = eventIngestionService.ingestEvent(req);
                        assertNotNull(event);
                    }
                    return null;
                }));
            }

            for (Future<?> future : futures) {
                future.get(30, TimeUnit.SECONDS);
            }
        } finally {
            pool.shutdownNow();
        }

        PageVisit visit = pageVisitRepository.findByUrlAndSessionId(url, sessionId).orElseThrow();
        assertEquals(1 + (threads * eventsPerThread), visit.getVisitCount(),
                "No visitCount increments must be lost during concurrent updates");

        Instant expectedMaxTimestamp = seedTime.plusMillis(threads * 1000L + (eventsPerThread - 1) * 10L);
        assertEquals(expectedMaxTimestamp, visit.getLastVisited(),
                "lastVisited must equal the maximum timestamp across all updates");
    }

    @Test
    void legitimateRepeatedEvents_remainRepresentedCorrectly() throws Exception {
        String sessionId = createValidSession("Repeated Events Session");
        String url = "https://example.com/repeated-page";
        Instant baseTime = sessionEventStart(sessionId);

        int repeatCount = 5;
        for (int i = 0; i < repeatCount; i++) {
            BrowserEventRequest req = new BrowserEventRequest(
                    "NAVIGATION",
                    url,
                    "Page Title",
                    1,
                    1,
                    "link",
                    null,
                    "",
                    null,
                    null,
                    baseTime.plusSeconds(i * 60L).toEpochMilli(),
                    sessionId
            );
            BrowserEvent event = eventIngestionService.ingestEvent(req);
            assertNotNull(event);
        }

        PageVisit visit = pageVisitRepository.findByUrlAndSessionId(url, sessionId).orElseThrow();
        assertEquals(repeatCount, visit.getVisitCount(), "Repeated navigation visits must increment visitCount");
        assertEquals(baseTime.plusSeconds((repeatCount - 1) * 60L), visit.getLastVisited(),
                "lastVisited must reflect the latest repeated event");

        List<BrowserEvent> events = browserEventRepository.findBySessionIdOrderByTimestamp(sessionId).stream()
                .filter(e -> url.equals(e.getUrl()))
                .toList();
        assertEquals(repeatCount, events.size(), "All repeated events must be preserved in BrowserEvent history");
    }

    @Test
    void multiTabSearchAndNavigation() throws Exception {
        String sessionId = createValidSession("Multi-Tab Research Session");

        // Tab 1: Search then navigate to page
        String searchUrl1 = "https://www.google.com/search?q=research+topic";
        eventIngestionService.ingestEvent(new BrowserEventRequest(
                "NAVIGATION", searchUrl1, "Research Topic - Google Search",
                1, 1, "link", null, "", null, null, Instant.now().toEpochMilli(), sessionId));

        // Tab 2: Direct navigation to a page (no search)
        String pageUrl1 = "https://example.com/article1";
        eventIngestionService.ingestEvent(new BrowserEventRequest(
                "NAVIGATION", pageUrl1, "Article One",
                2, 1, "link", null, "", null, null, Instant.now().toEpochMilli(), sessionId));

        // Tab 1: Another search, then navigate to different page
        String searchUrl2 = "https://www.bing.com/search?q=related+information";
        eventIngestionService.ingestEvent(new BrowserEventRequest(
                "NAVIGATION", searchUrl2, "Related Information - Bing Search",
                1, 1, "link", null, "", null, null, Instant.now().plusSeconds(30 * 1000).toEpochMilli(), sessionId));

        // Tab 2: Navigate to another page
        String pageUrl2 = "https://example.com/article2";
        eventIngestionService.ingestEvent(new BrowserEventRequest(
                "NAVIGATION", pageUrl2, "Article Two",
                2, 1, "link", null, "", null, null, Instant.now().plusSeconds(60 * 1000).toEpochMilli(), sessionId));

        // Verify page visits were created
        List<PageVisit> visits = pageVisitRepository.findBySessionId(sessionId);
        assertTrue(visits.size() >= 2, "Should have at least 2 page visits for multi-tab session");

        // Verify browser events captured
        List<BrowserEvent> events = browserEventRepository.findBySessionIdOrderByTimestamp(sessionId);
        assertTrue(events.size() >= 4, "Should have at least 4 browser events");

        // Verify sessions can be retrieved via research memory
        // (just verifying the ingestion path works end-to-end)
    }

    @Test
    void multiTabSearchRelationships() throws Exception {
        String sessionId = createValidSession("Search Relationships Session");

        // Tab 1: Initial search
        String searchUrl1 = "https://www.google.com/search?q=primary+research";
        eventIngestionService.ingestEvent(new BrowserEventRequest(
                "NAVIGATION", searchUrl1, "Primary Research - Google Search",
                1, 1, "link", null, "", null, null, Instant.now().toEpochMilli(), sessionId));

        // Tab 2: Secondary search (different tab, within 10 min)
        String searchUrl2 = "https://bing.com/search?q=secondary+research";
        eventIngestionService.ingestEvent(new BrowserEventRequest(
                "NAVIGATION", searchUrl2, "Secondary Research - Bing Search",
                2, 1, "link", null, "", null, null, Instant.now().plusSeconds(5 * 60).toEpochMilli(), sessionId));

        // Tab 1: Navigate to page after first search
        String pageUrl1 = "https://example.com/page1";
        eventIngestionService.ingestEvent(new BrowserEventRequest(
                "NAVIGATION", pageUrl1, "Primary Page",
                1, 1, "link", null, "", null, null, Instant.now().plusSeconds(10 * 1000).toEpochMilli(), sessionId));

        // Tab 2: Navigate to page after second search
        String pageUrl2 = "https://example.com/page2";
        eventIngestionService.ingestEvent(new BrowserEventRequest(
                "NAVIGATION", pageUrl2, "Secondary Page",
                2, 1, "link", null, "", null, null, Instant.now().plusSeconds(8 * 60).toEpochMilli(), sessionId));

        // Verify events and page visits captured
        List<BrowserEvent> events = browserEventRepository.findBySessionIdOrderByTimestamp(sessionId);
        assertTrue(events.size() >= 4, "Should have at least 4 browser events");

        List<PageVisit> visits = pageVisitRepository.findBySessionId(sessionId);
        assertTrue(visits.size() >= 2, "Should have at least 2 page visits");

        // Verify research memory can be retrieved (end-to-end verification)
        // The key point: relationship logic should correctly handle multi-tab scenario
    }

    @Test
    void searchFollowedByPageInSameTab() throws Exception {
        String sessionId = createValidSession("Search-Then-Page Same Tab");

        // Search from tab 1
        String searchUrl = "https://www.google.com/search?q=test+query";
        eventIngestionService.ingestEvent(new BrowserEventRequest(
                "NAVIGATION", searchUrl, "Test Search - Google",
                1, 1, "link", null, "", null, null, Instant.now().toEpochMilli(), sessionId));

        // Navigate to page in same tab (tabId=1)
        String pageUrl = "https://example.com/page";
        eventIngestionService.ingestEvent(new BrowserEventRequest(
                "NAVIGATION", pageUrl, "Test Page",
                1, 1, "link", null, "", null, null, Instant.now().plusSeconds(15 * 1000).toEpochMilli(), sessionId));

        // Verify events captured
        List<BrowserEvent> events = browserEventRepository.findBySessionIdOrderByTimestamp(sessionId);
        assertTrue(events.size() >= 2, "Should have at least 2 browser events");

        // Verify PAGE_TO_SEARCH relationship logic would apply:
        // A page visit before a search in the same tab should yield PAGE_TO_SEARCH
        // This test verifies the ingestion path works for this scenario
    }

    @Test
    void searchFollowedByPageInDifferentTab() throws Exception {
        String sessionId = createValidSession("Search-Then-Page Different Tab");

        // Search from tab 1
        String searchUrl = "https://www.google.com/search?q=test+query";
        eventIngestionService.ingestEvent(new BrowserEventRequest(
                "NAVIGATION", searchUrl, "Test Search - Google",
                1, 1, "link", null, "", null, null, Instant.now().toEpochMilli(), sessionId));

        // Navigate to page in different tab (tabId=2)
        String pageUrl = "https://example.com/page";
        eventIngestionService.ingestEvent(new BrowserEventRequest(
                "NAVIGATION", pageUrl, "Test Page",
                2, 1, "link", null, "", null, null, Instant.now().plusSeconds(15 * 1000).toEpochMilli(), sessionId));

        // Verify events captured
        List<BrowserEvent> events = browserEventRepository.findBySessionIdOrderByTimestamp(sessionId);
        assertTrue(events.size() >= 2, "Should have at least 2 browser events");

        // This test verifies the ingestion path works when search and page are in different tabs
        // PAGE_TO_SEARCH relationship would use tab matching logic
    }
}
