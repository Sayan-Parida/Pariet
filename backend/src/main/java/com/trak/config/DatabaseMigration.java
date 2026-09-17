package com.trak.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import jakarta.annotation.PostConstruct;
import java.io.File;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.HashSet;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Configuration
public class DatabaseMigration {

    private static final Logger log = LoggerFactory.getLogger(DatabaseMigration.class);

    @Value("${spring.datasource.url}")
    private String dbUrl;

    @PostConstruct
    public void migrate() {
        try {
            String path = dbUrl.replace("jdbc:sqlite:", "");
            File dbFile = new File(path);
            if (!dbFile.exists()) {
                log.info("Database file does not exist yet, skipping migration (will be created by Hibernate)");
                return;
            }

            try (Connection conn = DriverManager.getConnection(dbUrl);
                 Statement stmt = conn.createStatement()) {

                stmt.execute("PRAGMA journal_mode=WAL;");
                stmt.execute("PRAGMA foreign_keys=ON;");

                // Get existing columns in browser_event table
                Set<String> existingColumns = getTableColumns(conn, "browser_event");
                log.info("Existing browser_event columns: {}", existingColumns);

                // Define required columns with their SQLite types
                // All new columns are nullable to preserve existing data
                var requiredColumns = new RequiredColumns()
                    .add("transition_type", "VARCHAR(50)")
                    .add("referrer_url", "VARCHAR(2048)")
                    .add("opener_tab_id", "INTEGER")
                    .add("source_tab_id", "INTEGER");

                for (RequiredColumns.Column col : requiredColumns.columns) {
                    if (!existingColumns.contains(col.name.toLowerCase())) {
                        String sql = String.format("ALTER TABLE browser_event ADD COLUMN %s %s;", col.name, col.type);
                        log.info("Adding missing column: {} to browser_event", col.name);
                        stmt.execute(sql);
                    } else {
                        log.debug("Column {} already exists, skipping", col.name);
                    }
                }

                // Verify all required columns now exist
                Set<String> finalColumns = getTableColumns(conn, "browser_event");
                for (RequiredColumns.Column col : requiredColumns.columns) {
                    if (!finalColumns.contains(col.name.toLowerCase())) {
                        log.error("Migration failed: column {} still missing after ALTER TABLE", col.name);
                    }
                }
                log.info("Database migration completed. Final browser_event columns: {}", finalColumns);

            }
        } catch (Exception e) {
            log.error("Database migration failed", e);
            throw new RuntimeException("Database migration failed", e);
        }
    }

    private Set<String> getTableColumns(Connection conn, String tableName) throws Exception {
        Set<String> columns = new HashSet<>();
        try (ResultSet rs = conn.getMetaData().getColumns(null, null, tableName, null)) {
            while (rs.next()) {
                columns.add(rs.getString("COLUMN_NAME").toLowerCase());
            }
        }
        return columns;
    }

    private static class RequiredColumns {
        static class Column {
            final String name;
            final String type;
            Column(String name, String type) { this.name = name; this.type = type; }
        }
        final java.util.List<Column> columns = new java.util.ArrayList<>();
        RequiredColumns add(String name, String type) { columns.add(new Column(name, type)); return this; }
    }
}