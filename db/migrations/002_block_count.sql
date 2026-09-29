-- The workout length setting is now a number of exercise blocks (1-6) instead of minutes.
-- Apply to an existing database with: sqlite3 db/workouts.db < db/migrations/002_block_count.sql
-- (db/schema.sql already has block_count for new databases.) Old minutes map to the block
-- counts the generator used for them: 20 -> 2, 30 -> 3, 45 -> 4, 60 -> 5.

BEGIN;
DROP VIEW v_session_time;
DROP VIEW v_workout_summary;

ALTER TABLE workout ADD COLUMN block_count INTEGER NOT NULL DEFAULT 3 CHECK (block_count BETWEEN 1 AND 6);
UPDATE workout SET block_count = CASE duration_min WHEN 20 THEN 2 WHEN 30 THEN 3 WHEN 45 THEN 4 ELSE 5 END;
ALTER TABLE workout DROP COLUMN duration_min;

-- Estimated vs actual time, per session.
CREATE VIEW v_session_time AS
SELECT s.session_id, s.workout_id, w.block_count, w.estimated_seconds, s.active_seconds,
       s.active_seconds - w.estimated_seconds                          AS delta_seconds,
       round(100.0 * (s.active_seconds - w.estimated_seconds) / w.estimated_seconds, 1) AS delta_pct,
       s.time_feel
FROM workout_session s
JOIN workout w ON w.workout_id = s.workout_id
WHERE s.active_seconds IS NOT NULL;

-- One line per workout: how it went, on average.
CREATE VIEW v_workout_summary AS
SELECT w.workout_id, w.name, w.created_at, w.level_id, w.block_count, w.estimated_seconds,
       count(DISTINCT s.session_id)                                    AS sessions,
       round(avg(r.stars), 2)                                          AS avg_stars,
       round(avg(s.active_seconds), 0)                                 AS avg_actual_seconds,
       (SELECT count(*) FROM workout_comment c WHERE c.workout_id = w.workout_id) AS comments
FROM workout w
LEFT JOIN workout_session s ON s.workout_id = w.workout_id
LEFT JOIN session_rating r  ON r.session_id = s.session_id
GROUP BY w.workout_id;
COMMIT;
