package com.trak.service;

import com.trak.domain.model.BrowserEvent;
import com.trak.domain.model.EventType;
import com.trak.domain.model.PageVisit;
import com.trak.domain.repository.BrowserEventRepository;
import com.trak.domain.repository.PageVisitRepository;
import com.trak.processing.text.ResearchTextNormalizer;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Service
public class PageVisitService {

    private final PageVisitRepository pageVisitRepository;
    private final BrowserEventRepository browserEventRepository;

    public PageVisitService(PageVisitRepository pageVisitRepository,
                            BrowserEventRepository browserEventRepository) {
        this.pageVisitRepository = pageVisitRepository;
        this.browserEventRepository = browserEventRepository;
    }

    /**
     * Creates or updates the PageVisit aggregate for (url, sessionId).
     *
     * <p>Runs inside the caller's transaction. Locking is the caller's
     * responsibility (EventIngestionService acquires KeyedLock before
     * opening the transaction).
     */
    @Transactional
    public PageVisit createOrUpdatePageVisit(String url, String title, String sessionId, Instant timestamp) {
        if (!isResearchUrl(url) || sessionId == null || sessionId.isBlank()) {
            return null;
        }

        Optional<PageVisit> existing = pageVisitRepository.findByUrlAndSessionId(url, sessionId);
        if (existing.isPresent()) {
            PageVisit visit = existing.get();
            visit.setVisitCount(visit.getVisitCount() + 1);
            if (timestamp != null && (visit.getLastVisited() == null || timestamp.isAfter(visit.getLastVisited()))) {
                visit.setLastVisited(timestamp);
            }
            if (title != null && !title.isBlank()) {
                visit.setTitle(title);
                visit.setNormalizedTitle(ResearchTextNormalizer.normalize(title));
            }
            if (visit.getNormalizedDomain() == null && visit.getDomain() != null) {
                visit.setNormalizedDomain(ResearchTextNormalizer.normalize(visit.getDomain()));
            }
            return pageVisitRepository.save(visit);
        } else {
            PageVisit visit = new PageVisit();
            visit.setUrl(url);
            visit.setSessionId(sessionId);
            Instant eventTime = timestamp != null ? timestamp : Instant.now();
            visit.setFirstVisited(eventTime);
            visit.setLastVisited(eventTime);
            visit.setTitle(title);
            String domain = extractDomain(url);
            visit.setDomain(domain);
            if (title != null && !title.isBlank()) {
                visit.setNormalizedTitle(ResearchTextNormalizer.normalize(title));
            }
            if (domain != null) {
                visit.setNormalizedDomain(ResearchTextNormalizer.normalize(domain));
            }
            visit.setVisitCount(1);
            visit.setDurationMs(0);
            return pageVisitRepository.save(visit);
        }
    }

    /**
     * Whether a URL counts as research activity worth recording.
     *
     * <p>Excludes browser-internal pages, and Pariet's own surfaces: the
     * dashboard ({@code localhost:5173}) and the API ({@code localhost:8080}).
     * Those are tool surfaces, not research, so opening the dashboard while a
     * session is running must never add nodes to the graph being recorded.
     *
     * <p>Only loopback hosts on those ports are excluded, so genuinely
     * research-relevant local URLs (for example a dev server on another port)
     * are still captured.
     */
    public static boolean isResearchUrl(String url) {
        if (url == null || url.isBlank()) {
            return false;
        }
        if (url.startsWith("chrome://")
                || url.startsWith("chrome-extension://")
                || url.startsWith("about:")
                || url.startsWith("edge://")
                || url.startsWith("devtools://")
                || url.startsWith("view-source:")
                || url.startsWith("file:")
                || url.startsWith("data:")
                || url.startsWith("javascript:")) {
            return false;
        }
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            return false;
        }
        return !isOwnAppUrl(url);
    }

    /** True for Pariet's own frontend/backend on loopback. */
    static boolean isOwnAppUrl(String url) {
        try {
            URI uri = URI.create(url);
            String host = uri.getHost();
            if (host == null) {
                return false;
            }
            boolean loopback = "localhost".equalsIgnoreCase(host)
                    || "127.0.0.1".equals(host)
                    || "::1".equals(host)
                    || "[::1]".equals(host);
            if (!loopback) {
                return false;
            }
            int port = uri.getPort();
            return port == -1 || port == 5173 || port == 8080;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    @Transactional
    public void estimateDuration(String sessionId) {
        estimateDuration(sessionId, null);
    }

    @Transactional
    public void estimateDuration(String sessionId, Instant endTime) {
        List<BrowserEvent> events = browserEventRepository.findBySessionIdOrderByTimestamp(sessionId);

        Map<Integer, TabTiming> timingByTab = new HashMap<>();
        Integer activeTabId = null;

        for (BrowserEvent event : events) {
            if (event.getEventType() == EventType.TAB_ACTIVATED) {
                if (activeTabId != null) {
                    finalizeTab(activeTabId, event.getTimestamp(), sessionId, timingByTab);
                    timingByTab.remove(activeTabId);
                }
                activeTabId = event.getTabId();
                timingByTab.put(event.getTabId(), new TabTiming(event.getTimestamp(), event.getUrl()));
            } else if (event.getEventType() == EventType.NAVIGATION) {
                if (activeTabId != null && activeTabId == event.getTabId()) {
                    finalizeTab(event.getTabId(), event.getTimestamp(), sessionId, timingByTab);
                    timingByTab.put(event.getTabId(), new TabTiming(event.getTimestamp(), event.getUrl()));
                }
            } else if (event.getEventType() == EventType.TAB_CLOSED) {
                finalizeTab(event.getTabId(), event.getTimestamp(), sessionId, timingByTab);
                timingByTab.remove(event.getTabId());
                if (event.getTabId() == activeTabId) {
                    activeTabId = null;
                }
            }
        }

        if (endTime != null && activeTabId != null) {
            finalizeTab(activeTabId, endTime, sessionId, timingByTab);
        }
    }

    private void finalizeTab(int tabId, Instant timestamp, String sessionId, Map<Integer, TabTiming> timingByTab) {
        TabTiming timing = timingByTab.get(tabId);
        if (timing != null && timing.url() != null) {
            addDuration(timing.url(), sessionId, Duration.between(timing.startedAt(), timestamp).toMillis());
        }
    }

    private record TabTiming(Instant startedAt, String url) {}

    private void addDuration(String url, String sessionId, long ms) {
        if (ms <= 0) return;
        pageVisitRepository.findByUrlAndSessionId(url, sessionId).ifPresent(visit -> {
            visit.setDurationMs(visit.getDurationMs() + ms);
            pageVisitRepository.save(visit);
        });
    }

    private String extractDomain(String urlString) {
        if (urlString == null) return null;
        try {
            URI uri = new URI(urlString);
            return uri.getHost();
        } catch (Exception e) {
            return null;
        }
    }
}
