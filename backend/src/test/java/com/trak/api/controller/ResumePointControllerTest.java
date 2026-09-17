package com.trak.api.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.trak.api.dto.BrowserEventRequest;
import com.trak.domain.model.ResearchSession;
import com.trak.service.EventIngestionService;
import com.trak.service.ResearchSessionService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Regression tests for GET /api/sessions/{id}/resume-point (Resume Research).
 *
 * <p>Guard the deterministic rule that the Resume Research stopping page is
 * EXACTLY the page already represented as the latest (STOPPING POINT) node of
 * the session's Research Map, and that the answer always follows the session
 * the request is made for.
 */
@SpringBootTest
@AutoConfigureMockMvc
class ResumePointControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private ResearchSessionService sessionService;

    @Autowired
    private EventIngestionService eventIngestionService;

    private void ingestNav(String sessionId, String url, String title, long timestamp) {
        eventIngestionService.ingestEvent(new BrowserEventRequest(
                "NAVIGATION", url, title, 1, 1, "link", null, "", null, null, timestamp, sessionId));
    }

    @Test
    void resumePointMatchesTheMindMapStoppingPointNode() throws Exception {
        ResearchSession session = sessionService.createSession("Kafka rebalance research");
        long base = Instant.now().toEpochMilli();

        ingestNav(session.getId(),
                "https://www.google.com/search?q=Kafka+rebalance",
                "Kafka rebalance - Google Search", base + 1000);
        ingestNav(session.getId(),
                "https://developer.confluent.io/learn-more/kafka-on-the-go/consumer-groups/",
                "Kafka Consumer Groups Explained | Apache Kafka On The Go", base + 2000);
        ingestNav(session.getId(),
                "https://www.confluent.io/learn/kafka-rebalancing/",
                "Kafka Rebalancing Explained: How It Works & Why It Matters", base + 3000);

        MvcResult resumeResult = mockMvc.perform(
                        get("/api/sessions/" + session.getId() + "/resume-point"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sessionId").value(session.getId()))
                .andExpect(jsonPath("$.page.url").value("https://www.confluent.io/learn/kafka-rebalancing/"))
                .andExpect(jsonPath("$.page.title").value("Kafka Rebalancing Explained: How It Works & Why It Matters"))
                .andExpect(jsonPath("$.page.domain").value("www.confluent.io"))
                .andReturn();
        JsonNode resume = objectMapper.readTree(resumeResult.getResponse().getContentAsString());
        String resumePageId = resume.path("page").path("id").asText();

        MvcResult mapResult = mockMvc.perform(get("/api/sessions/" + session.getId() + "/mindmap"))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode nodes = objectMapper.readTree(mapResult.getResponse().getContentAsString()).path("nodes");

        JsonNode latest = null;
        for (JsonNode node : nodes) {
            String type = node.path("type").asText();
            if ("SESSION".equals(type) || "DOMAIN".equals(type)) {
                continue;
            }
            if (latest == null
                    || Instant.parse(node.path("timestamp").asText())
                    .isAfter(Instant.parse(latest.path("timestamp").asText()))) {
                latest = node;
            }
        }

        assertNotNull(latest, "The map must have a stopping point node");
        assertEquals("PAGE", latest.path("type").asText());
        assertEquals("https://www.confluent.io/learn/kafka-rebalancing/", latest.path("url").asText());
        assertEquals(resumePageId, latest.path("id").asText(),
                "Resume page id must equal the map STOPPING POINT node id");
    }

    @Test
    void resumePointFollowsTheSelectedSession() throws Exception {
        ResearchSession sessionA = sessionService.createSession("Session A");
        ResearchSession sessionB = sessionService.createSession("Session B");
        long base = Instant.now().toEpochMilli();

        ingestNav(sessionA.getId(), "https://a.example.com/page-a", "Page A", base + 1000);
        ingestNav(sessionB.getId(), "https://b.example.com/page-b", "Page B", base + 2000);

        mockMvc.perform(get("/api/sessions/" + sessionA.getId() + "/resume-point"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page.url").value("https://a.example.com/page-a"));

        mockMvc.perform(get("/api/sessions/" + sessionB.getId() + "/resume-point"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page.url").value("https://b.example.com/page-b"));

        mockMvc.perform(get("/api/sessions/" + sessionA.getId() + "/resume-point"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page.url").value("https://a.example.com/page-a"));
    }

    @Test
    void resumePointIsNullForSessionWithoutResearchActivity() throws Exception {
        ResearchSession session = sessionService.createSession("Empty Session");

        mockMvc.perform(get("/api/sessions/" + session.getId() + "/resume-point"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sessionId").value(session.getId()))
                .andExpect(jsonPath("$.page.url").doesNotExist())
                .andExpect(jsonPath("$.page.id").doesNotExist())
                .andExpect(jsonPath("$.search.id").doesNotExist());
    }
}