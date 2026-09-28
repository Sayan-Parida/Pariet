package com.trak.domain.repository;

import com.trak.domain.model.SearchQuery;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;

@Repository
public interface SearchQueryRepository extends JpaRepository<SearchQuery, String> {
    List<SearchQuery> findBySessionIdOrderByTimestamp(String sessionId);
    List<SearchQuery> findBySessionId(String sessionId);
    List<SearchQuery> findByNormalizedQueryContainingIgnoreCase(String term);
    List<SearchQuery> findByQueryTextContainingIgnoreCase(String term);
    List<SearchQuery> findByNormalizedQueryIsNullOrNormalizedQuery(String value);
    SearchQuery findBySessionIdAndNormalizedQueryAndSourceUrlAndTimestamp(
            String sessionId, String normalizedQuery, String sourceUrl, Instant timestamp);

    /** Grouped per-session counts, to avoid an N+1 pattern when listing. */
    @Query("SELECT s.sessionId, COUNT(s) FROM SearchQuery s WHERE s.sessionId IN :sessionIds GROUP BY s.sessionId")
    List<Object[]> countBySessionIds(@Param("sessionIds") List<String> sessionIds);

    @Modifying
    @Query("DELETE FROM SearchQuery")
    int deleteAllSearches();
}
