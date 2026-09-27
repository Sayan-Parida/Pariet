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
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
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

    public SessionController(ResearchSessionService sessionService,
                             ResearchMemoryService researchMemoryService,
                             BrowserEventRepository eventRepository,
                             PageVisitRepository pageVisitRepository,
                             SearchQueryRepository searchQueryRepository,
                             ResearchGraphService researchGraphService) {
        this.sessionService = sessionService;
        this.researchMemoryService = researchMemoryService;
        this.eventRepository = eventRepository;
        this.pageVisitRepository = pageVisitRepository;
        this.searchQueryRepository = searchQueryRepository;
        this.researchGraphService = researchGraphService;
    }

    @PostMapping
    public ResponseEntity<SessionResponse> createSession(@Valid @RequestBody SessionCreateRequest request) {
        ResearchSession session = sessionService.createSession(request.title(), request.windowId());
        return ResponseEntity.status(HttpStatus.CREATED).body(mapToResponse(session));
    }

    @GetMapping
    public ResponseEntity<List<SessionResponse>> listSessions() {
        List<SessionResponse> responses = sessionService.listSessions().stream()
                .map(this::mapToResponse)
                .collect(Collectors.toList());
        return ResponseEntity.ok(responses);
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

    private SessionResponse mapToResponse(ResearchSession session) {
        long eventCount = eventRepository.findBySessionId(session.getId()).size();
        long pageCount = pageVisitRepository.findBySessionId(session.getId()).size();
        long searchCount = searchQueryRepository.findBySessionId(session.getId()).size();
        return DtoMapper.toResponse(session, eventCount, pageCount, searchCount);
    }
}
