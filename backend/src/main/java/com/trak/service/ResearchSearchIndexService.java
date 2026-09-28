package com.trak.service;

import com.trak.domain.model.PageVisit;
import com.trak.domain.model.ResearchSession;
import com.trak.domain.model.SearchQuery;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;

@Service
public class ResearchSearchIndexService {
    private static final String INDEX_TABLE = "research_search_index";
    private final JdbcTemplate jdbcTemplate;

    public ResearchSearchIndexService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Transactional
    public void initialize() {
        jdbcTemplate.execute("CREATE VIRTUAL TABLE IF NOT EXISTS " + INDEX_TABLE + " USING fts5(" +
                "document_id UNINDEXED, document_type UNINDEXED, source_id UNINDEXED, session_id UNINDEXED, " +
                "timestamp UNINDEXED, url UNINDEXED, domain UNINDEXED, content, tokenize='unicode61')");
    }

    @Transactional
    public int rebuild(List<SearchQuery> searches, List<PageVisit> pages, List<ResearchSession> sessions) {
        initialize();
        jdbcTemplate.update("DELETE FROM " + INDEX_TABLE);
        searches.forEach(this::indexSearch);
        pages.forEach(this::indexPage);
        sessions.forEach(this::indexSession);
        return searches.size() + pages.size() + sessions.size();
    }

    @Transactional
    public void indexSearch(SearchQuery search) {
        initialize();
        replace(searchKey(search.getId()), "SEARCH", search.getId(), search.getSessionId(), search.getTimestamp(),
                search.getSourceUrl(), null, search.getQueryText());
    }

    @Transactional
    public void indexPage(PageVisit page) {
        initialize();
        replace(searchKey(page.getId()), "PAGE", page.getId(), page.getSessionId(), page.getFirstVisited(),
                page.getUrl(), page.getDomain(), String.join(" ", safe(page.getTitle()), safe(page.getDomain()), safe(page.getUrl())));
    }

    @Transactional
    public void indexSession(ResearchSession session) {
        initialize();
        replace(searchKey(session.getId()), "SESSION", session.getId(), session.getId(), session.getStartTime(),
                null, null, safe(session.getTitle()));
    }

    @Transactional
    public void removeSession(String sessionId) {
        initialize();
        jdbcTemplate.update("DELETE FROM " + INDEX_TABLE + " WHERE session_id = ?", sessionId);
    }

    @Transactional(readOnly = true)
    public List<IndexHit> search(String matchQuery, int limit) {
        initialize();
        return jdbcTemplate.query("SELECT document_id, document_type, source_id, session_id, timestamp, url, domain, bm25(" + INDEX_TABLE + ") AS rank " +
                        "FROM " + INDEX_TABLE + " WHERE " + INDEX_TABLE + " MATCH ? ORDER BY rank, document_type, source_id LIMIT ?",
                (resultSet, rowNumber) -> new IndexHit(resultSet.getString("document_id"), resultSet.getString("document_type"),
                        resultSet.getString("source_id"), resultSet.getString("session_id"), resultSet.getString("timestamp"),
                        resultSet.getString("url"), resultSet.getString("domain"), resultSet.getDouble("rank")), matchQuery, limit);
    }

    @Transactional(readOnly = true)
    public long count() {
        initialize();
        Long count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM " + INDEX_TABLE, Long.class);
        return count == null ? 0 : count;
    }

    private void replace(String documentId, String type, String sourceId, String sessionId, Instant timestamp,
                         String url, String domain, String content) {
        jdbcTemplate.update("DELETE FROM " + INDEX_TABLE + " WHERE document_id = ?", documentId);
        jdbcTemplate.update("INSERT INTO " + INDEX_TABLE + " (document_id, document_type, source_id, session_id, timestamp, url, domain, content) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                documentId, type, sourceId, sessionId, timestamp == null ? null : timestamp.toString(), url, domain, safe(content));
    }

    private String searchKey(String sourceId) {
        return sourceId == null ? "" : sourceId;
    }

    private String safe(String value) {
        return value == null ? "" : value;
    }

    public record IndexHit(String documentId, String documentType, String sourceId, String sessionId,
                           String timestamp, String url, String domain, double bm25Rank) {}
}
