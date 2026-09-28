package com.trak.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.Arrays;
import java.util.List;

/**
 * CORS policy.
 *
 * <p>Previously this allowed {@code chrome-extension://*}, which matched
 * <em>any</em> installed extension rather than just this one - so a malicious
 * or unrelated extension could make credentialed cross-origin calls to the
 * whole API, including the endpoints that read browsing history.
 *
 * <p>The wildcard is removed. Only the local frontend dev server is allowed by
 * default, plus any explicitly configured extension origins. Pariet's own
 * service-worker requests are unaffected by this list: an MV3 background fetch
 * to a host it holds {@code host_permissions} for is not subject to CORS, so
 * restricting the origins here does not break the extension.
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final List<String> allowedOriginPatterns;

    public WebConfig(@Value("${app.cors.allowed-origins:http://localhost:5173,http://127.0.0.1:5173}")
                     String allowedOrigins) {
        this.allowedOriginPatterns = Arrays.stream(allowedOrigins.split(","))
                .map(String::trim)
                .filter(origin -> !origin.isEmpty())
                .toList();
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        if (allowedOriginPatterns.isEmpty()) {
            return;
        }
        registry.addMapping("/**")
                .allowedOriginPatterns(allowedOriginPatterns.toArray(String[]::new))
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .allowCredentials(true);
    }
}
