package com.trak.domain.model;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "browser_event", indexes = {
        @Index(name = "idx_browser_event_session_id", columnList = "session_id"),
        @Index(name = "idx_browser_event_timestamp", columnList = "timestamp"),
        @Index(name = "idx_browser_event_tab_id", columnList = "tab_id"),
        @Index(name = "idx_browser_event_processed", columnList = "processed"),
        @Index(name = "idx_browser_event_dedup", columnList = "tab_id, url, timestamp")
})
public class BrowserEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private EventType eventType;

    @Column(length = 2048)
    private String url;

    @Column(length = 1024)
    private String title;

    @Column(name = "tab_id", nullable = false)
    private int tabId;

    @Column(name = "window_id")
    private Integer windowId;

    @Column(name = "transition_type", length = 50)
    private String transitionType;

    @Column(name = "referrer_url", length = 2048)
    private String referrerUrl;

    @Column(name = "opener_tab_id")
    private Integer openerTabId;

    @Column(name = "source_tab_id")
    private Integer sourceTabId;

    @Column(nullable = false)
    private Instant timestamp;

    @Column(name = "session_id")
    private String sessionId;

    @Column(name = "page_visit_id")
    private String pageVisitId;

    @Column(nullable = false)
    private boolean processed = false;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    protected void onCreate() {
        this.createdAt = Instant.now();
    }

    public BrowserEvent() {}

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    
    public EventType getEventType() { return eventType; }
    public void setEventType(EventType eventType) { this.eventType = eventType; }
    
    public String getUrl() { return url; }
    public void setUrl(String url) { this.url = url; }
    
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    
    public int getTabId() { return tabId; }
    public void setTabId(int tabId) { this.tabId = tabId; }
    
    public Integer getWindowId() { return windowId; }
    public void setWindowId(Integer windowId) { this.windowId = windowId; }
    
    public String getTransitionType() { return transitionType; }
    public void setTransitionType(String transitionType) { this.transitionType = transitionType; }
    
    public String getReferrerUrl() { return referrerUrl; }
    public void setReferrerUrl(String referrerUrl) { this.referrerUrl = referrerUrl; }
    
    public Integer getOpenerTabId() { return openerTabId; }
    public void setOpenerTabId(Integer openerTabId) { this.openerTabId = openerTabId; }
    
    public Integer getSourceTabId() { return sourceTabId; }
    public void setSourceTabId(Integer sourceTabId) { this.sourceTabId = sourceTabId; }
    
    public Instant getTimestamp() { return timestamp; }
    public void setTimestamp(Instant timestamp) { this.timestamp = timestamp; }
    
    public String getSessionId() { return sessionId; }
    public void setSessionId(String sessionId) { this.sessionId = sessionId; }
    
    public String getPageVisitId() { return pageVisitId; }
    public void setPageVisitId(String pageVisitId) { this.pageVisitId = pageVisitId; }
    
    public boolean isProcessed() { return processed; }
    public void setProcessed(boolean processed) { this.processed = processed; }
    
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
}
