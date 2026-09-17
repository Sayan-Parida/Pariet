package com.trak.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.List;

public record BrowserEventRequest(
        @NotBlank String eventType,
        String url,
        String title,
        @NotNull Integer tabId,
        Integer windowId,
        String transitionType,
        List<String> transitionQualifiers,
        String referrerUrl,
        Integer openerTabId,
        Integer sourceTabId,
        @NotNull Long timestamp,
        String sessionId
) {
}
