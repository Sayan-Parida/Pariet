package com.trak.service;

import com.trak.service.DataLifecycleService.RetentionReport;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Daily retention sweep.
 *
 * <p>Runs once per day at {@code app.retention.prune-hour} UTC and prunes
 * anything past the configured windows. Two safety properties:
 * <ul>
 *   <li>It runs at most once per calendar day, tracked in-process, so a clock
 *       jump or a restart cannot turn into a repeated destructive sweep.</li>
 *   <li>It is idempotent and bounded to the retention windows, so the worst
 *       case is that old data is removed early - never that new data is lost.</li>
 * </ul>
 */
@Service
public class DataRetentionJob {

    private static final Logger log = LoggerFactory.getLogger(DataRetentionJob.class);

    private final DataLifecycleService lifecycleService;
    private final Duration eventRetention;
    private final Duration sessionRetention;
    private final int pruneHour;
    private final AtomicBoolean ranToday = new AtomicBoolean(false);

    public DataRetentionJob(DataLifecycleService lifecycleService,
                            @Value("${app.retention.event-days:90}") long eventDays,
                            @Value("${app.retention.session-days:365}") long sessionDays,
                            @Value("${app.retention.prune-hour:3}") int pruneHour) {
        this.lifecycleService = lifecycleService;
        this.eventRetention = Duration.ofDays(Math.max(1, eventDays));
        this.sessionRetention = Duration.ofDays(Math.max(1, sessionDays));
        this.pruneHour = Math.min(23, Math.max(0, pruneHour));
    }

    @Scheduled(cron = "0 17 * * * *")
    public void scheduledPrune() {
        LocalDateTime nowUtc = LocalDateTime.now(ZoneOffset.UTC);
        if (nowUtc.getHour() != pruneHour) {
            return;
        }
        if (!ranToday.compareAndSet(false, true)) {
            return;
        }
        try {
            RetentionReport report = lifecycleService.pruneExpiredData(eventRetention, sessionRetention, Instant.now());
            log.info("Scheduled retention sweep complete: {}", report);
        } catch (Exception e) {
            // Never let a failed sweep crash the scheduler thread.
            log.error("Scheduled retention sweep failed", e);
        }
    }

    /** Exposed for tests and for manual invocation. */
    public RetentionReport runNow() {
        return lifecycleService.pruneExpiredData(eventRetention, sessionRetention, Instant.now());
    }

    public Duration getEventRetention() {
        return eventRetention;
    }

    public Duration getSessionRetention() {
        return sessionRetention;
    }

    public LocalTime getPruneTimeUtc() {
        return LocalTime.of(pruneHour, 17);
    }
}
