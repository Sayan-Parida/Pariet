package com.trak.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import jakarta.annotation.PostConstruct;
import java.io.File;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;

@Configuration
public class DatabaseConfig {

    @Value("${spring.datasource.url}")
    private String dbUrl;

    @PostConstruct
    public void init() {
        try {
            // Create data directory if it doesn't exist
            String path = dbUrl.replace("jdbc:sqlite:", "");
            File dbFile = new File(path);
            if (dbFile.getParentFile() != null && !dbFile.getParentFile().exists()) {
                dbFile.getParentFile().mkdirs();
            }

            // Enable WAL mode
            try (Connection conn = DriverManager.getConnection(dbUrl);
                 Statement stmt = conn.createStatement()) {
                stmt.execute("PRAGMA journal_mode=WAL;");
                stmt.execute("PRAGMA foreign_keys=ON;");
                // Zero out freed pages so deleted URLs/searches are not
                // recoverable from the raw database file.
                stmt.execute("PRAGMA secure_delete=ON;");
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
