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

    /** Retention: drop raw events older than the cutoff. */
    @Modifying
    @Query("SELECT e.id FROM BrowserEvent e WHERE e.timestamp < :cutoff")
    List<Long> findIdsOlderThan(@Param("cutoff") Instant cutoff);

    @Modifying
    @Query("DELETE FROM BrowserEvent e WHERE e.timestamp < :cutoff")
    int deleteOlderThan(@Param("cutoff") Instant cutoff);

    /** Wipe: drop every event, including unattributed ones. */
    @Modifying
    @Query("DELETE FROM BrowserEvent")
    int deleteAllEvents();
}
