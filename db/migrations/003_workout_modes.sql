-- Workout modes (docs/design-workout-modes.md): how a workout was built, a level per move,
-- and drafts for templates that aren't finished yet.
-- Apply to an existing database with: sqlite3 db/workouts.db < db/migrations/003_workout_modes.sql
-- (db/schema.sql already has these for new databases.)

BEGIN;
-- quick: generated; mix: generated with levels 1-4 in each block; template: put together by hand.
ALTER TABLE workout ADD COLUMN mode TEXT NOT NULL DEFAULT 'quick' CHECK (mode IN ('quick', 'mix', 'template'));

-- The level a move was done at when it differs from the workout's (Mix and Template). NULL = the workout's level.
ALTER TABLE workout_item ADD COLUMN level_id INTEGER REFERENCES level (level_id) ON DELETE RESTRICT;

-- A template that's still being put together: the app's workout document as JSON, empty slots included.
-- Not a workout yet, so no evaluations or statistics; saving it as a workout deletes the draft.
CREATE TABLE workout_draft (
    draft_id    INTEGER PRIMARY KEY,
    name        TEXT    NOT NULL CHECK (length(trim(name)) > 0),
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    doc         TEXT    NOT NULL CHECK (json_valid(doc))
) STRICT;
COMMIT;
