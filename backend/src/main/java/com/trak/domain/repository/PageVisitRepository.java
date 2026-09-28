package com.trak.domain.repository;

import com.trak.domain.model.PageVisit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

@Repository
public interface PageVisitRepository extends JpaRepository<PageVisit, String> {
    List<PageVisit> findBySessionIdOrderByFirstVisited(String sessionId);
        List<PageVisit> findBySessionIdAndFirstVisitedGreaterThanEqualOrderByFirstVisited(
            String sessionId, java.time.Instant sessionStart);
        List<PageVisit> findBySessionIdAndFirstVisitedBetweenOrderByFirstVisited(
            String sessionId, java.time.Instant sessionStart, java.time.Instant sessionEnd);
    Optional<PageVisit> findByUrlAndSessionId(String url, String sessionId);
    List<PageVisit> findBySessionId(String sessionId);
    List<PageVisit> findByNormalizedTitleContainingIgnoreCase(String term);
    List<PageVisit> findByTitleContainingIgnoreCase(String term);
    List<PageVisit> findByNormalizedDomainContainingIgnoreCase(String term);
    List<PageVisit> findByDomainContainingIgnoreCase(String term);
    List<PageVisit> findByUrlContainingIgnoreCase(String term);
    List<PageVisit> findByNormalizedTitleIsNullOrNormalizedTitle(String value);
    List<PageVisit> findByNormalizedDomainIsNullOrNormalizedDomain(String value);

    /** Grouped per-session counts, to avoid an N+1 pattern when listing. */
    @Query("SELECT p.sessionId, COUNT(p) FROM PageVisit p WHERE p.sessionId IN :sessionIds GROUP BY p.sessionId")
    List<Object[]> countBySessionIds(@Param("sessionIds") List<String> sessionIds);

    @Modifying
    @Query("DELETE FROM PageVisit")
    int deleteAllVisits();
}
