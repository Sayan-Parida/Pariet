package com.trak.domain.model;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "research_session")
public class ResearchSession {

    @Id
    private String id;

    @Column(length = 500)
    private String title;

    @Column(length = 20, nullable = false)
    private String status = "ACTIVE";

    @Column(name = "start_time", nullable = false)
    private Instant startTime;

    @Column(name = "end_time")
    private Instant endTime;

    @Column(name = "window_id")
    private Integer windowId;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @OneToMany(mappedBy = "sessionId", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    private List<BrowserEvent> events = new ArrayList<>();

    @OneToMany(mappedBy = "sessionId", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    private List<PageVisit> pageVisits = new ArrayList<>();

    @OneToMany(mappedBy = "sessionId", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    private List<SearchQuery> searchQueries = new ArrayList<>();

    public ResearchSession() {
        this.id = UUID.randomUUID().toString();
    }

    @PrePersist
    protected void onCreate() {
        this.createdAt = Instant.now();
        this.updatedAt = Instant.now();
        if (this.startTime == null) {
            this.startTime = Instant.now();
        }
    }

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = Instant.now();
    }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    
    public Instant getStartTime() { return startTime; }
    public void setStartTime(Instant startTime) { this.startTime = startTime; }
    
    public Instant getEndTime() { return endTime; }
    public void setEndTime(Instant endTime) { this.endTime = endTime; }

    public Integer getWindowId() { return windowId; }
    public void setWindowId(Integer windowId) { this.windowId = windowId; }
    
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
    
    public List<BrowserEvent> getEvents() { return events; }
    public void setEvents(List<BrowserEvent> events) { this.events = events; }
    
    public List<PageVisit> getPageVisits() { return pageVisits; }
    public void setPageVisits(List<PageVisit> pageVisits) { this.pageVisits = pageVisits; }
    
    public List<SearchQuery> getSearchQueries() { return searchQueries; }
    public void setSearchQueries(List<SearchQuery> searchQueries) { this.searchQueries = searchQueries; }
}
