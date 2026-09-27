package com.trak.processing;

import com.trak.domain.repository.ResearchSessionRepository;
import java.time.Instant;
import org.springframework.stereotype.Component;

@Component
public class SessionDetector {

    private final ResearchSessionRepository sessionRepository;

    public SessionDetector(ResearchSessionRepository sessionRepository) {
        this.sessionRepository = sessionRepository;
    }

    public boolean isValidSession(String sessionId) {
        if (sessionId == null || sessionId.isBlank()) {
            return false;
        }
        return sessionRepository.existsById(sessionId);
    }

    public boolean isValidSessionEvent(String sessionId, Instant timestamp) {
        return isValidSessionEvent(sessionId, timestamp, null);
    }

    /**
     * Per-session window isolation: an event may be attributed to a session
     * only if the session has no recorded window (legacy/unknown), the event
     * carries no window (legacy), or both windows are equal. Events from any
     * other window are never attributed to this session (they may still be
     * stored unattributed and can belong to another session).
     */
    public boolean isValidSessionEvent(String sessionId, Instant timestamp, Integer windowId) {
        if (sessionId == null || sessionId.isBlank() || timestamp == null) {
            return false;
        }
        return sessionRepository.findById(sessionId)
                .filter(session -> session.getWindowId() == null
                        || windowId == null
                        || session.getWindowId().equals(windowId))
                .filter(session -> !timestamp.isBefore(session.getStartTime()))
                .filter(session -> session.getEndTime() == null || !timestamp.isAfter(session.getEndTime()))
                .isPresent();
    }
}
