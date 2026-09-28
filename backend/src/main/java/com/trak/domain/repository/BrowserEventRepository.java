package com.trak.domain.repository;

import com.trak.domain.model.BrowserEvent;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

@Repository
public interface BrowserEventRepository extends JpaRepository<BrowserEvent, Long> {
    List<BrowserEvent> findBySessionIdOrderByTimestamp(String sessionId);
    Optional<BrowserEvent> findByTabIdAndUrlAndTimestamp(int tabId, String url, Instant timestamp);
    List<BrowserEvent> findByProcessedFalse();
    List<BrowserEvent> findBySessionId(String sessionId);

    /**
     * Grouped per-session counts for a set of sessions, returned in one query.
     * Used by the session list to avoid an N+1 query pattern: listing N
     * sessions would otherwise issue 3N queries.
     */
    @Query("SELECT e.sessionId, COUNT(e) FROM BrowserEvent e WHERE e.sessionId IN :sessionIds GROUP BY e.sessionId")
    List<Object[]> countBySessionIds(@Param("sessionIds") List<String> sessionIds);

    /** Wipe: drop every event, including unattributed ones. */
    @Modifying
    @Query("DELETE FROM BrowserEvent")
    int deleteAllEvents();
}
