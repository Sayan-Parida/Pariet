package com.trak.api.controller;

import com.trak.api.dto.*;
import com.trak.api.mapper.DtoMapper;
import com.trak.domain.model.ResearchSession;
import com.trak.domain.repository.BrowserEventRepository;
import com.trak.domain.repository.PageVisitRepository;
import com.trak.domain.repository.SearchQueryRepository;
import com.trak.service.ResearchMemoryService;
import com.trak.service.ResearchSessionService;
import com.trak.service.ResearchGraphService;
import com.trak.service.DataLifecycleService;
import com.trak.service.DataLifecycleService.DeletionReport;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/sessions")
public class SessionController {

    private final ResearchSessionService sessionService;
    private final ResearchMemoryService researchMemoryService;
    private final BrowserEventRepository eventRepository;
    private final PageVisitRepository pageVisitRepository;
    private final SearchQueryRepository searchQueryRepository;
    private final ResearchGraphService researchGraphService;
    private final DataLifecycleService lifecycleService;

    public SessionController(ResearchSessionService sessionService,
                             ResearchMemoryService researchMemoryService,
                             BrowserEventRepository eventRepository,
                             PageVisitRepository pageVisitRepository,
                             SearchQueryRepository searchQueryRepository,
                             ResearchGraphService researchGraphService,
                             DataLifecycleService lifecycleService) {
        this.sessionService = sessionService;
        this.researchMemoryService = researchMemoryService;
        this.eventRepository = eventRepository;
        this.pageVisitRepository = pageVisitRepository;
        this.searchQueryRepository = searchQueryRepository;
        this.researchGraphService = researchGraphService;
        this.lifecycleService = lifecycleService;
    }

    @PostMapping
    public ResponseEntity<SessionResponse> createSession(@Valid @RequestBody SessionCreateRequest request) {
        ResearchSession session = sessionService.createSession(request.title(), request.windowId());
        return ResponseEntity.status(HttpStatus.CREATED).body(mapToResponse(session));
    }

    @GetMapping
    public ResponseEntity<List<SessionResponse>> listSessions() {
        List<ResearchSession> sessions = sessionService.listSessions();
        if (sessions.isEmpty()) {
            return ResponseEntity.ok(List.of());
        }
        // Per-session counts come from three grouped queries rather than one
        // query per session per table, so the list cost stays flat as the
        // archive grows.
        List<String> ids = sessions.stream().map(ResearchSession::getId).toList();
        Map<String, Long> eventCounts = groupCounts(eventRepository.countBySessionIds(ids));
        Map<String, Long> pageCounts = groupCounts(pageVisitRepository.countBySessionIds(ids));
        Map<String, Long> searchCounts = groupCounts(searchQueryRepository.countBySessionIds(ids));

        List<SessionResponse> responses = sessions.stream()
                .map(session -> DtoMapper.toResponse(session,
                        eventCounts.getOrDefault(session.getId(), 0L),
                        pageCounts.getOrDefault(session.getId(), 0L),
                        searchCounts.getOrDefault(session.getId(), 0L)))
                .collect(Collectors.toList());
        return ResponseEntity.ok(responses);
    }

    private Map<String, Long> groupCounts(List<Object[]> rows) {
        Map<String, Long> counts = new HashMap<>();
        for (Object[] row : rows) {
            if (row[0] != null) {
                counts.put((String) row[0], ((Number) row[1]).longValue());
            }
        }
        return counts;
    }

    @GetMapping("/{id}")
    public ResponseEntity<SessionResponse> getSession(@PathVariable String id) {
        return ResponseEntity.ok(mapToResponse(sessionService.getSession(id)));
    }

    @PutMapping("/{id}")
    public ResponseEntity<SessionResponse> updateSession(@PathVariable String id, @RequestBody SessionUpdateRequest request) {
        ResearchSession session = sessionService.updateSession(id, request.title(), request.status());
        return ResponseEntity.ok(mapToResponse(session));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteSession(@PathVariable String id) {
        sessionService.deleteSession(id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{id}/timeline")
    public ResponseEntity<List<TimelineEntryResponse>> getTimeline(@PathVariable String id) {
        return ResponseEntity.ok(sessionService.getTimeline(id));
    }

    @GetMapping("/{id}/pages")
    public ResponseEntity<List<PageVisitResponse>> getPages(@PathVariable String id) {
        List<PageVisitResponse> responses = sessionService.getPages(id).stream()
                .map(DtoMapper::toResponse)
                .collect(Collectors.toList());
        return ResponseEntity.ok(responses);
    }

    @GetMapping("/{id}/searches")
    public ResponseEntity<List<SearchQueryResponse>> getSearches(@PathVariable String id) {
        List<SearchQueryResponse> responses = sessionService.getSearches(id).stream()
                .map(DtoMapper::toResponse)
                .collect(Collectors.toList());
        return ResponseEntity.ok(responses);
    }

    @GetMapping("/{id}/resume-point")
    public ResponseEntity<ResumePointResponse> getResumePoint(@PathVariable String id) {
        return ResponseEntity.ok(sessionService.getResumePoint(id));
    }

    @GetMapping("/{id}/mindmap")
    public ResponseEntity<MindMapResponse> getMindMap(@PathVariable String id) {
        if (!sessionService.getSession(id).getId().equals(id)) {
            // Check exists
        }
        return ResponseEntity.ok(sessionService.getMindMap(id));
    }

    @GetMapping("/{id}/research-graph")
    public ResponseEntity<ResearchGraphResponse> getResearchGraph(@PathVariable String id) {
        return ResponseEntity.ok(researchGraphService.getGraph(id));
    }

    @GetMapping("/{id}/research-memory")
    public ResponseEntity<ResearchMemoryResponse> getResearchMemory(@PathVariable String id) {
        return ResponseEntity.ok(researchMemoryService.getMemory(id));
    }

    /**
     * Erase every stored browsing record: events, pages, searches, sessions and
     * the full-text index. This is irreversible; the file is compacted
     * afterwards so the data is not merely unlinked.
     */
    @DeleteMapping("/all")
    public ResponseEntity<Map<String, Object>> deleteAllData() {
        DeletionReport report = lifecycleService.deleteAllData();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("success", true);
        body.put("eventsDeleted", report.eventsDeleted());
        body.put("pagesDeleted", report.pagesDeleted());
        body.put("searchesDeleted", report.searchesDeleted());
        body.put("sessionsDeleted", report.sessionsDeleted());
        body.put("completedAt", report.completedAt());
        return ResponseEntity.ok(body);
    }

    private SessionResponse mapToResponse(ResearchSession session) {
        long eventCount = eventRepository.findBySessionId(session.getId()).size();
        long pageCount = pageVisitRepository.findBySessionId(session.getId()).size();
        long searchCount = searchQueryRepository.findBySessionId(session.getId()).size();
        return DtoMapper.toResponse(session, eventCount, pageCount, searchCount);
    }
}
