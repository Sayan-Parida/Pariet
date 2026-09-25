package com.trak.service;

import com.trak.api.dto.MindMapResponse;
import com.trak.api.dto.ResumePointResponse;
import com.trak.api.dto.TimelineEntryResponse;
import com.trak.domain.model.BrowserEvent;
import com.trak.domain.model.PageVisit;
import com.trak.domain.model.ResearchSession;
import com.trak.domain.model.SearchQuery;
import com.trak.domain.repository.BrowserEventRepository;
import com.trak.domain.repository.PageVisitRepository;
import com.trak.domain.repository.ResearchSessionRepository;
import com.trak.domain.repository.SearchQueryRepository;
import com.trak.exception.ResourceNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class ResearchSessionService {

    private final ResearchSessionRepository sessionRepository;
    private final BrowserEventRepository eventRepository;
    private final PageVisitRepository pageVisitRepository;
    private final SearchQueryRepository searchQueryRepository;
    private final PageVisitService pageVisitService;
    private final ResearchSearchIndexService searchIndexService;

    public ResearchSessionService(ResearchSessionRepository sessionRepository,
                                  BrowserEventRepository eventRepository,
                                  PageVisitRepository pageVisitRepository,
                                  SearchQueryRepository searchQueryRepository,
                                  PageVisitService pageVisitService,
                                  ResearchSearchIndexService searchIndexService) {
        this.sessionRepository = sessionRepository;
        this.eventRepository = eventRepository;
        this.pageVisitRepository = pageVisitRepository;
        this.searchQueryRepository = searchQueryRepository;
        this.pageVisitService = pageVisitService;
        this.searchIndexService = searchIndexService;
    }

    @Transactional
    public ResearchSession createSession(String title) {
        ResearchSession session = new ResearchSession();
        session.setTitle(title);
        session.setStatus("ACTIVE");
        session.setStartTime(Instant.now());
        ResearchSession saved = sessionRepository.save(session);
        searchIndexService.indexSession(saved);
        return saved;
    }

    public ResearchSession getSession(String id) {
        return sessionRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Session not found"));
    }

    public List<ResearchSession> listSessions() {
        return sessionRepository.findByOrderByStartTimeDesc();
    }

    @Transactional
    public ResearchSession updateSession(String id, String title, String status) {
        ResearchSession session = getSession(id);
        if (title != null && !title.isBlank()) {
            session.setTitle(title);
        }
        if (status != null && !status.isBlank()) {
            if ("COMPLETED".equals(status) && !"COMPLETED".equals(session.getStatus())) {
                session.setEndTime(Instant.now());
                pageVisitService.estimateDuration(id, session.getEndTime());
            }
            session.setStatus(status);
        }
        return sessionRepository.save(session);
    }

    @Transactional
    public void deleteSession(String id) {
        ResearchSession session = getSession(id);
        searchIndexService.removeSession(id);
        eventRepository.deleteAll(eventRepository.findBySessionId(id));
        pageVisitRepository.deleteAll(pageVisitRepository.findBySessionId(id));
        searchQueryRepository.deleteAll(searchQueryRepository.findBySessionId(id));
        sessionRepository.delete(session);
    }

    public List<TimelineEntryResponse> getTimeline(String sessionId) {
        if (!sessionRepository.existsById(sessionId)) {
            throw new ResourceNotFoundException("Session not found");
        }

        List<BrowserEvent> events = eventRepository.findBySessionIdOrderByTimestamp(sessionId);
        List<SearchQuery> searches = searchQueryRepository.findBySessionIdOrderByTimestamp(sessionId);

        List<TimelineEntryResponse> timeline = new ArrayList<>();
        
        for (BrowserEvent event : events) {
            timeline.add(new TimelineEntryResponse(
                    event.getId().toString(),
                    "EVENT",
                    event.getTimestamp(),
                    event.getTitle() != null ? event.getTitle() : event.getEventType().name(),
                    event.getUrl(),
                    Map.of("eventType", event.getEventType().name())
            ));
        }
        
        for (SearchQuery search : searches) {
            timeline.add(new TimelineEntryResponse(
                    search.getId(),
                    "SEARCH",
                    search.getTimestamp(),
                    search.getQueryText(),
                    search.getSourceUrl(),
                    Map.of("engine", search.getEngine())
            ));
        }
        
        timeline.sort(Comparator.comparing(TimelineEntryResponse::timestamp));
        return timeline;
    }

    public List<PageVisit> getPages(String sessionId) {
        return getSessionScopedPages(getSession(sessionId));
    }

    private List<PageVisit> getSessionScopedPages(ResearchSession session) {
        if (session.getEndTime() == null) {
            return pageVisitRepository.findBySessionIdAndFirstVisitedGreaterThanEqualOrderByFirstVisited(
                    session.getId(), session.getStartTime());
        }
        return pageVisitRepository.findBySessionIdAndFirstVisitedBetweenOrderByFirstVisited(
                session.getId(), session.getStartTime(), session.getEndTime());
    }

    public List<SearchQuery> getSearches(String sessionId) {
        getSession(sessionId);
        return searchQueryRepository.findBySessionIdOrderByTimestamp(sessionId);
    }

    /**
     * Deterministic stopping point for "Resume Research".
     *
     * <p>Picks the most recently visited meaningful page of the session
     * (research URL, non-blank title &mdash; skipping internal browser pages
     * and empty new-tab screens). The associated search, when present, is the
     * SearchQuery authoritatively linked to that page via
     * {@code pageVisitId} &mdash; the same provenance used for RESULTS_IN
     * edges in the mind map &mdash; choosing the latest one if several exist.
     */
    public ResumePointResponse getResumePoint(String sessionId) {
        ResearchSession session = getSession(sessionId);
        List<PageVisit> pages = getSessionScopedPages(session);

        PageVisit stoppingPage = pages.stream()
                .filter(pv -> PageVisitService.isResearchUrl(pv.getUrl()))
                .filter(pv -> pv.getTitle() != null && !pv.getTitle().isBlank())
                .max(Comparator.comparing(PageVisit::getLastVisited)
                        .thenComparing(PageVisit::getFirstVisited))
                .orElse(null);

        if (stoppingPage == null) {
            return new ResumePointResponse(sessionId, null, null);
        }

        ResumePointResponse.ResumeSearch search = searchQueryRepository.findBySessionId(sessionId).stream()
                .filter(sq -> stoppingPage.getId().equals(sq.getPageVisitId()))
                .max(Comparator.comparing(SearchQuery::getTimestamp))
                .map(sq -> new ResumePointResponse.ResumeSearch(
                        sq.getId(), sq.getQueryText(), sq.getEngine(), sq.getTimestamp()))
                .orElse(null);

        return new ResumePointResponse(
                sessionId,
                new ResumePointResponse.ResumePage(
                        stoppingPage.getId(),
                        stoppingPage.getUrl(),
                        stoppingPage.getDomain(),
                        stoppingPage.getTitle(),
                        stoppingPage.getLastVisited(),
                        stoppingPage.getVisitCount()),
                search);
    }

    @Transactional(readOnly = true)
    public MindMapResponse getMindMap(String sessionId) {
        ResearchSession session = getSession(sessionId);
        List<BrowserEvent> events = eventRepository.findBySessionIdOrderByTimestamp(sessionId);
        List<PageVisit> pages = getSessionScopedPages(session);
        List<SearchQuery> searches = searchQueryRepository.findBySessionId(sessionId);

        List<MindMapResponse.MindMapNode> nodes = new ArrayList<>();
        List<MindMapResponse.MindMapEdge> edges = new ArrayList<>();

        // Session root node
        nodes.add(new MindMapResponse.MindMapNode(
                "session:" + sessionId,
                "SESSION",
                session.getTitle() == null || session.getTitle().isBlank() ? "Research Session" : session.getTitle(),
                null,
                null,
                session.getStartTime(),
                Map.of("status", session.getStatus() == null ? "ACTIVE" : session.getStatus())
        ));

        for (SearchQuery sq : searches) {
            nodes.add(new MindMapResponse.MindMapNode(
                    sq.getId(), "SEARCH", sq.getQueryText(), sq.getSourceUrl(), sq.getEngine(), sq.getTimestamp(), Map.of()
            ));
            edges.add(new MindMapResponse.MindMapEdge(
                    "session:" + sessionId, sq.getId(), "CONTAINS", "Search within this session"
            ));
        }

        for (PageVisit pv : pages) {
            nodes.add(new MindMapResponse.MindMapNode(
                    pv.getId(), "PAGE", pv.getTitle(), pv.getUrl(), pv.getDomain(), pv.getFirstVisited(), Map.of("visits", pv.getVisitCount())
            ));
            edges.add(new MindMapResponse.MindMapEdge(
                    "session:" + sessionId, pv.getId(), "CONTAINS", "Page visited in this session"
            ));
        }

        Map<Integer, List<BrowserEvent>> navigationEventsByTab = events.stream()
                .filter(event -> event.getEventType() == com.trak.domain.model.EventType.NAVIGATION)
                .filter(event -> event.getPageVisitId() != null)
                .collect(Collectors.groupingBy(BrowserEvent::getTabId));
        for (List<BrowserEvent> tabEvents : navigationEventsByTab.values()) {
            for (int index = 1; index < tabEvents.size(); index++) {
                BrowserEvent previous = tabEvents.get(index - 1);
                BrowserEvent current = tabEvents.get(index);
                if (!previous.getPageVisitId().equals(current.getPageVisitId())) {
                    edges.add(new MindMapResponse.MindMapEdge(
                            previous.getPageVisitId(), current.getPageVisitId(), "PAGE_TO_PAGE",
                            "Consecutive navigation events in the same tab"));
                    edges.add(new MindMapResponse.MindMapEdge(
                            previous.getPageVisitId(), current.getPageVisitId(), "NAVIGATED_FROM",
                            "Navigation followed the previous page in the same tab"));
                }
            }
        }

        List<SearchQuery> orderedSearches = searches.stream()
                .sorted(Comparator.comparing(SearchQuery::getTimestamp))
                .toList();
        Map<String, BrowserEvent> eventBySearch = new HashMap<>();
        for (SearchQuery search : orderedSearches) {
            events.stream()
                    .filter(event -> Objects.equals(event.getPageVisitId(), search.getPageVisitId()))
                    .filter(event -> search.getTimestamp().equals(event.getTimestamp()))
                    .findFirst()
                    .ifPresent(event -> eventBySearch.put(search.getId(), event));
        }
        for (int index = 1; index < orderedSearches.size(); index++) {
            SearchQuery previous = orderedSearches.get(index - 1);
            SearchQuery current = orderedSearches.get(index);
            BrowserEvent previousEvent = eventBySearch.get(previous.getId());
            BrowserEvent currentEvent = eventBySearch.get(current.getId());
            if (previousEvent != null && currentEvent != null && previousEvent.getTabId() == currentEvent.getTabId()) {
                edges.add(new MindMapResponse.MindMapEdge(
                        previous.getId(), current.getId(), "SEARCH_TO_SEARCH",
                        "Subsequent search in the same tab"));
            }
        }

        // ── Search → result page provenance ────────────────────────────────────
        //
        // Strategy:
        //   1. Original pageVisitId link: skip search-engine pages (hidden from
        //      visible Research Map), but mark as associated to avoid double-counting.
        //   2. Same-tab link clicks: search results page tab → subsequent "link"
        //      navigations that land on research pages (not search-engine pages).
        //   3. New-tab results: search results page tab opened a new tab
        //      (openerTabId/sourceTabId) with a "link" transition.
        //
        // Search-engine result pages (Google, Bing, etc.) are never visible SOURCE
        // nodes. The provenance chain goes: SEARCH → [hidden search page] → SOURCE.
        // We only create RESULTS_IN edges to non-search-engine research pages.

        // Map: tabId → list of NAVIGATION BrowserEvents in that tab (sorted by timestamp)
        Map<Integer, List<BrowserEvent>> navByTab = events.stream()
                .filter(e -> e.getEventType() == com.trak.domain.model.EventType.NAVIGATION)
                .sorted(Comparator.comparing(BrowserEvent::getTimestamp))
                .collect(Collectors.groupingBy(BrowserEvent::getTabId,
                        LinkedHashMap::new, Collectors.toList()));

        // Map: pageVisitId → PageVisit
        Map<String, PageVisit> pvById = new HashMap<>();
        for (PageVisit pv : pages) pvById.put(pv.getId(), pv);

        // Map: BrowserEvent.pageVisitId → BrowserEvent (for finding which event = which page)
        Map<String, BrowserEvent> eventByPvId = new HashMap<>();
        for (BrowserEvent e : events) {
            if (e.getPageVisitId() != null) {
                eventByPvId.putIfAbsent(e.getPageVisitId(), e);
            }
        }

        // Track which pages are already associated with a search to avoid duplicates
        Set<String> associatedPages = new HashSet<>();

        for (SearchQuery sq : searches) {
            // 1. Mark the search results page as associated but do NOT create a
            //    RESULTS_IN edge to it. Search-engine pages are hidden from the
            //    visible Research Map — the edge would point to a non-existent node.
            if (sq.getPageVisitId() != null) {
                associatedPages.add(sq.getPageVisitId());
            }

            // Find the BrowserEvent for this search's results page
            BrowserEvent searchEvent = eventByPvId.get(sq.getPageVisitId());
            if (searchEvent == null) continue;
            int searchTabId = searchEvent.getTabId();

            // 2. Same-tab link clicks: find subsequent "link" navigations in the same tab
            List<BrowserEvent> tabEvents = navByTab.getOrDefault(searchTabId, List.of());
            boolean pastSearchPage = false;
            for (BrowserEvent nav : tabEvents) {
                if (nav.getTimestamp().compareTo(searchEvent.getTimestamp()) <= 0) {
                    if (nav.getPageVisitId() != null && nav.getPageVisitId().equals(sq.getPageVisitId())) {
                        pastSearchPage = true;
                    }
                    continue;
                }
                if (!pastSearchPage) continue;

                // Only "link" transitions (user clicked a link on the previous page)
                if (!"link".equals(nav.getTransitionType())) break;
                if (nav.getPageVisitId() == null) continue;
                if (associatedPages.contains(nav.getPageVisitId())) continue;

                // Skip search-engine pages — they are hidden from the visible Research Map
                PageVisit targetPv = pvById.get(nav.getPageVisitId());
                if (targetPv != null && isSearchEngineUrl(targetPv.getUrl())) {
                    associatedPages.add(nav.getPageVisitId());
                    continue;
                }

                edges.add(new MindMapResponse.MindMapEdge(
                        sq.getId(), nav.getPageVisitId(), "RESULTS_IN",
                        "Result page opened via link click from search results"));
                associatedPages.add(nav.getPageVisitId());
            }

            // 3. New-tab results: NAVIGATION events where openerTabId/sourceTabId = search tab
            for (BrowserEvent nav : events) {
                if (nav.getEventType() != com.trak.domain.model.EventType.NAVIGATION) continue;
                if (nav.getPageVisitId() == null) continue;
                if (associatedPages.contains(nav.getPageVisitId())) continue;

                Integer sourceTab = nav.getSourceTabId();
                Integer openerTab = nav.getOpenerTabId();
                if (sourceTab == null && openerTab == null) continue;

                int srcTab = sourceTab != null ? sourceTab : openerTab;
                if (srcTab != searchTabId) continue;

                // Must be a "link" transition (opened by clicking a link, not typed)
                if (!"link".equals(nav.getTransitionType())) continue;

                // Skip search-engine pages
                PageVisit targetPv = pvById.get(nav.getPageVisitId());
                if (targetPv != null && isSearchEngineUrl(targetPv.getUrl())) {
                    associatedPages.add(nav.getPageVisitId());
                    continue;
                }

                edges.add(new MindMapResponse.MindMapEdge(
                        sq.getId(), nav.getPageVisitId(), "RESULTS_IN",
                        "Result page opened in new tab from search results"));
                associatedPages.add(nav.getPageVisitId());
            }
        }

        // Domain nodes (group pages by domain)
        Map<String, List<PageVisit>> pagesByDomain = new LinkedHashMap<>();
        for (PageVisit pv : pages) {
            if (pv.getDomain() != null && !pv.getDomain().isBlank()) {
                pagesByDomain.computeIfAbsent(pv.getDomain(), k -> new ArrayList<>()).add(pv);
            }
        }
        for (Map.Entry<String, List<PageVisit>> entry : pagesByDomain.entrySet()) {
            String domainId = "domain:" + entry.getKey();
            nodes.add(new MindMapResponse.MindMapNode(
                    domainId,
                    "DOMAIN",
                    entry.getKey(),
                    null,
                    entry.getKey(),
                    null,
                    Map.of("pageCount", entry.getValue().size())
            ));
            for (PageVisit pv : entry.getValue()) {
                edges.add(new MindMapResponse.MindMapEdge(
                        pv.getId(), domainId, "BELONGS_TO", "Page belongs to this domain"
                ));
            }
        }

        return new MindMapResponse(sessionId, nodes, edges);
    }

    /**
     * Returns true if the URL belongs to a search-engine results page
     * or a search-engine redirect/tracking page.
     * These pages are hidden from the visible Research Map.
     */
    private static boolean isSearchEngineUrl(String url) {
        if (url == null) return false;
        String lower = url.toLowerCase();
        // Google: search results, redirect tracking, link tracking
        if (lower.contains("google.com/search") ||
            lower.contains("google.com/url") ||
            lower.contains("google.com/link")) {
            return true;
        }
        // Other search engines
        return lower.contains("bing.com/search") ||
                lower.contains("duckduckgo.com") ||
                lower.contains("search.brave.com") ||
                lower.contains("youtube.com/results") ||
                lower.contains("github.com/search") ||
                lower.contains("stackoverflow.com/search");
    }
}
