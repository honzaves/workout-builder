-- Workout builder: SQLite schema.
--
-- Two halves:
--   1. Catalogue: exercises and everything that describes them (patterns, levels,
--      equipment, instructions, prescriptions, setup items, generator roles).
--   2. Workouts: generated workouts, what was done, and how it felt.
--
-- Requires SQLite 3.37+ (STRICT tables). Foreign keys are OFF by default in
-- SQLite: every connection must run `PRAGMA foreign_keys = ON;`.
-- Timestamps are ISO-8601 UTC text, e.g. '2026-09-27T18:30:00Z'.

PRAGMA foreign_keys = ON;

-- =====================================================================
-- 1. CATALOGUE
-- =====================================================================

-- Difficulty levels. Rest times and rounds belong to the level, so they live here
-- instead of in application code.
CREATE TABLE level (
    level_id               INTEGER PRIMARY KEY CHECK (level_id BETWEEN 1 AND 4),
    code                   TEXT    NOT NULL UNIQUE,          -- 'beginner' .. 'beast'
    name                   TEXT    NOT NULL UNIQUE,
    rest_between_moves_s   INTEGER NOT NULL CHECK (rest_between_moves_s >= 0),
    rest_between_rounds_s  INTEGER NOT NULL CHECK (rest_between_rounds_s >= 0),
    rounds_per_block       INTEGER NOT NULL CHECK (rounds_per_block > 0)
) STRICT;

-- Movement patterns = the slots the generator fills (squat, hinge, plyoL, warm, ...).
CREATE TABLE movement_pattern (
    pattern_id    INTEGER PRIMARY KEY,
    code          TEXT    NOT NULL UNIQUE,                   -- 'squat', 'plyoL', 'warm'
    name          TEXT    NOT NULL UNIQUE,
    is_timed      INTEGER NOT NULL DEFAULT 0 CHECK (is_timed IN (0, 1)),      -- warm-up / cool-down
    is_explosive  INTEGER NOT NULL DEFAULT 0 CHECK (is_explosive IN (0, 1))   -- plyo + course: "Plyo" tag
) STRICT;

CREATE TABLE equipment_category (
    category_id   INTEGER PRIMARY KEY,
    name          TEXT    NOT NULL UNIQUE                    -- 'Free weights', 'Suspension', ...
) STRICT;

CREATE TABLE equipment (
    equipment_id  INTEGER PRIMARY KEY,
    code          TEXT    NOT NULL UNIQUE,                   -- 'db', 'kb', 'jumprope'
    name          TEXT    NOT NULL UNIQUE,                   -- 'Dumbbells'
    category_id   INTEGER REFERENCES equipment_category (category_id) ON DELETE RESTRICT,
    sort_order    INTEGER NOT NULL DEFAULT 0
) STRICT;

-- The core table: only what identifies an exercise and what the generator filters on.
-- Text for people (steps, cue, avoid, setup) lives in the tables below.
CREATE TABLE exercise (
    exercise_id      INTEGER PRIMARY KEY,
    slug             TEXT    NOT NULL UNIQUE,                -- stable id, e.g. 'box-jump'
    name             TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    min_level_id     INTEGER REFERENCES level (level_id) ON DELETE RESTRICT,  -- NULL for timed moves
    hold_seconds     INTEGER CHECK (hold_seconds BETWEEN 10 AND 600),        -- timed moves only
    is_combo         INTEGER NOT NULL DEFAULT 0 CHECK (is_combo IN (0, 1)),
    is_slow_to_fast  INTEGER NOT NULL DEFAULT 0 CHECK (is_slow_to_fast IN (0, 1)),
    is_partner       INTEGER NOT NULL DEFAULT 0 CHECK (is_partner IN (0, 1)),
    is_sprint        INTEGER NOT NULL DEFAULT 0 CHECK (is_sprint IN (0, 1)),
    switches_sides   INTEGER NOT NULL DEFAULT 0 CHECK (switches_sides IN (0, 1)),
    is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),  -- retire, never delete
    created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;

-- Which slots an exercise can fill. Exactly one row per exercise is primary;
-- carries also fill 'grip', for example.
CREATE TABLE exercise_pattern (
    exercise_id  INTEGER NOT NULL REFERENCES exercise (exercise_id) ON DELETE CASCADE,
    pattern_id   INTEGER NOT NULL REFERENCES movement_pattern (pattern_id) ON DELETE RESTRICT,
    is_primary   INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
    PRIMARY KEY (exercise_id, pattern_id)
) STRICT, WITHOUT ROWID;
CREATE UNIQUE INDEX ux_exercise_pattern_one_primary ON exercise_pattern (exercise_id) WHERE is_primary = 1;
CREATE INDEX ix_exercise_pattern_by_pattern ON exercise_pattern (pattern_id, exercise_id);

-- Coaching text, one row per exercise (1:1). Kept out of the core table.
CREATE TABLE exercise_coaching (
    exercise_id  INTEGER PRIMARY KEY REFERENCES exercise (exercise_id) ON DELETE CASCADE,
    cue          TEXT    NOT NULL CHECK (length(cue) > 0),
    avoid        TEXT,                                       -- most common mistake
    setup_note   TEXT                                        -- e.g. '2 soft boxes of the same height'
) STRICT;

CREATE TABLE exercise_step (
    exercise_id  INTEGER NOT NULL REFERENCES exercise (exercise_id) ON DELETE CASCADE,
    step_no      INTEGER NOT NULL CHECK (step_no > 0),
    body         TEXT    NOT NULL CHECK (length(body) > 0),
    PRIMARY KEY (exercise_id, step_no)
) STRICT, WITHOUT ROWID;

-- What to do at each level. The text stays free-form ('3 squats + 5 jumps'), and the
-- parsed hold time drives the follow-along timer without regex in the app.
CREATE TABLE exercise_prescription (
    exercise_id   INTEGER NOT NULL REFERENCES exercise (exercise_id) ON DELETE CASCADE,
    level_id      INTEGER NOT NULL REFERENCES level (level_id) ON DELETE RESTRICT,
    prescription  TEXT    NOT NULL CHECK (length(prescription) > 0),
    hold_seconds  INTEGER CHECK (hold_seconds > 0),          -- set for '45s', '20s each side'
    per_side      INTEGER NOT NULL DEFAULT 0 CHECK (per_side IN (0, 1)),
    PRIMARY KEY (exercise_id, level_id)
) STRICT, WITHOUT ROWID;

-- Equipment requirements as AND-of-ORs: an exercise needs every requirement, and a
-- requirement is met by any one of its options. ['box|bench', 'db'] is two
-- requirements, the first with two options.
CREATE TABLE exercise_requirement (
    requirement_id  INTEGER PRIMARY KEY,
    exercise_id     INTEGER NOT NULL REFERENCES exercise (exercise_id) ON DELETE CASCADE,
    position        INTEGER NOT NULL CHECK (position > 0),
    UNIQUE (exercise_id, position)
) STRICT;

CREATE TABLE requirement_option (
    requirement_id  INTEGER NOT NULL REFERENCES exercise_requirement (requirement_id) ON DELETE CASCADE,
    equipment_id    INTEGER NOT NULL REFERENCES equipment (equipment_id) ON DELETE RESTRICT,
    preference      INTEGER NOT NULL DEFAULT 1 CHECK (preference > 0),  -- 1 = listed first
    PRIMARY KEY (requirement_id, equipment_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX ix_requirement_option_by_equipment ON requirement_option (equipment_id, requirement_id);

-- Small non-equipment items for "What you'll need" ('Clear 15 m lane', 'Mat').
-- Stored once, linked many times.
CREATE TABLE setup_item (
    setup_item_id  INTEGER PRIMARY KEY,
    name           TEXT    NOT NULL UNIQUE COLLATE NOCASE
) STRICT;

CREATE TABLE exercise_setup_item (
    exercise_id    INTEGER NOT NULL REFERENCES exercise (exercise_id) ON DELETE CASCADE,
    setup_item_id  INTEGER NOT NULL REFERENCES setup_item (setup_item_id) ON DELETE RESTRICT,
    position       INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (exercise_id, setup_item_id)
) STRICT, WITHOUT ROWID;

-- Roles in the warm-up and cool-down (pulse raiser, flow, mobility, stretch, yin, calm).
-- Replaces the hardcoded id lists in the generator.
CREATE TABLE phase_role (
    role_id      INTEGER PRIMARY KEY,
    phase        TEXT    NOT NULL CHECK (phase IN ('warmup', 'cooldown')),
    code         TEXT    NOT NULL UNIQUE,                    -- 'pulse', 'flow', 'mob', 'stretch', 'yin', 'calm'
    name         TEXT    NOT NULL,
    sort_order   INTEGER NOT NULL
) STRICT;

CREATE TABLE exercise_phase_role (
    exercise_id  INTEGER NOT NULL REFERENCES exercise (exercise_id) ON DELETE CASCADE,
    role_id      INTEGER NOT NULL REFERENCES phase_role (role_id) ON DELETE RESTRICT,
    PRIMARY KEY (exercise_id, role_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX ix_exercise_phase_role_by_role ON exercise_phase_role (role_id, exercise_id);

-- Named, reusable poses ('stand', 'plank-top', 'squat-bar', ...). The pose is JSON read by the
-- drawing code in app.js: hip position, torso and head angles, targets or angles for each limb,
-- and what is held. Shared by many exercises, so a drawing usually only names a pose.
CREATE TABLE figure_pose (
    pose_id  INTEGER PRIMARY KEY,
    code     TEXT    NOT NULL UNIQUE,
    pose     TEXT    NOT NULL CHECK (json_valid(pose))
) STRICT;

-- The key drawings of an exercise, each illustrating a run of its steps (first_step..last_step).
-- The scene is JSON: figures (by pose name, with overrides), equipment, arrows and labels.
-- tools/validate.py checks that the drawings cover every step once and that the poses exist.
CREATE TABLE exercise_figure (
    exercise_id  INTEGER NOT NULL REFERENCES exercise (exercise_id) ON DELETE CASCADE,
    figure_no    INTEGER NOT NULL CHECK (figure_no > 0),
    first_step   INTEGER NOT NULL CHECK (first_step > 0),
    last_step    INTEGER NOT NULL,
    scene        TEXT    NOT NULL CHECK (json_valid(scene)),
    PRIMARY KEY (exercise_id, figure_no),
    CHECK (last_step >= first_step)
) STRICT, WITHOUT ROWID;

CREATE TRIGGER trg_exercise_touch AFTER UPDATE ON exercise
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE exercise SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE exercise_id = NEW.exercise_id;
END;

-- =====================================================================
-- 2. WORKOUTS
-- =====================================================================

-- A generated workout and the settings it was generated with.
CREATE TABLE workout (
    workout_id         INTEGER PRIMARY KEY,
    created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    name               TEXT    NOT NULL CHECK (length(trim(name)) > 0),  -- given by the user when saving
    level_id           INTEGER NOT NULL REFERENCES level (level_id) ON DELETE RESTRICT,
    block_count        INTEGER NOT NULL CHECK (block_count BETWEEN 1 AND 6),  -- exercise blocks chosen
    plyo_mode          TEXT    NOT NULL CHECK (plyo_mode   IN ('some', 'lots')),
    sprint_mode        TEXT    NOT NULL CHECK (sprint_mode IN ('none', 'some', 'lots')),
    combo_mode         TEXT    NOT NULL CHECK (combo_mode  IN ('none', 'some', 'lots', 'max')),
    course_mode        TEXT    NOT NULL CHECK (course_mode IN ('off', 'one', 'two')),
    grip_finisher      INTEGER NOT NULL CHECK (grip_finisher IN (0, 1)),
    with_partner       INTEGER NOT NULL CHECK (with_partner IN (0, 1)),
    estimated_seconds  INTEGER NOT NULL CHECK (estimated_seconds > 0),  -- snapshot at generation
    generator_version  TEXT    NOT NULL,
    is_favorite        INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
    mode               TEXT    NOT NULL DEFAULT 'quick' CHECK (mode IN ('quick', 'mix', 'template'))  -- how it was built
) STRICT;
CREATE INDEX ix_workout_created ON workout (created_at);

-- The equipment offered to the generator: the menu, not what was used.
CREATE TABLE workout_offered_equipment (
    workout_id    INTEGER NOT NULL REFERENCES workout (workout_id) ON DELETE CASCADE,
    equipment_id  INTEGER NOT NULL REFERENCES equipment (equipment_id) ON DELETE RESTRICT,
    PRIMARY KEY (workout_id, equipment_id)
) STRICT, WITHOUT ROWID;

-- Sections in order: warm-up, obstacle course, blocks A-F, grip finisher, cool-down.
CREATE TABLE workout_block (
    block_id               INTEGER PRIMARY KEY,
    workout_id             INTEGER NOT NULL REFERENCES workout (workout_id) ON DELETE CASCADE,
    position               INTEGER NOT NULL CHECK (position > 0),
    kind                   TEXT    NOT NULL CHECK (kind IN ('warmup', 'course', 'main', 'grip', 'cooldown')),
    name                   TEXT    NOT NULL,
    rounds                 INTEGER NOT NULL CHECK (rounds > 0),
    rest_between_moves_s   INTEGER NOT NULL DEFAULT 0 CHECK (rest_between_moves_s >= 0),
    rest_between_rounds_s  INTEGER NOT NULL DEFAULT 0 CHECK (rest_between_rounds_s >= 0),
    UNIQUE (workout_id, position)
) STRICT;

-- One exercise in a block. The prescription is copied at generation time on purpose:
-- editing the catalogue later must not rewrite history.
CREATE TABLE workout_item (
    item_id            INTEGER PRIMARY KEY,
    block_id           INTEGER NOT NULL REFERENCES workout_block (block_id) ON DELETE CASCADE,
    position           INTEGER NOT NULL CHECK (position > 0),
    exercise_id        INTEGER NOT NULL REFERENCES exercise (exercise_id) ON DELETE RESTRICT,
    slot_pattern_id    INTEGER NOT NULL REFERENCES movement_pattern (pattern_id) ON DELETE RESTRICT,
    prescription       TEXT    NOT NULL,                     -- snapshot: '8 each side', '45s'
    hold_seconds       INTEGER CHECK (hold_seconds > 0),     -- snapshot, for the timer
    estimated_seconds  INTEGER NOT NULL CHECK (estimated_seconds > 0),  -- one round, excluding rest
    level_id           INTEGER REFERENCES level (level_id) ON DELETE RESTRICT,  -- NULL = the workout's level
    UNIQUE (block_id, position)
) STRICT;
CREATE INDEX ix_workout_item_exercise ON workout_item (exercise_id);

-- Which option was chosen for each requirement ('box' rather than 'bench'). The
-- workout's kit ("What you'll need") is derived from this: see v_workout_kit.
CREATE TABLE workout_item_equipment (
    item_id       INTEGER NOT NULL REFERENCES workout_item (item_id) ON DELETE CASCADE,
    equipment_id  INTEGER NOT NULL REFERENCES equipment (equipment_id) ON DELETE RESTRICT,
    PRIMARY KEY (item_id, equipment_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX ix_workout_item_equipment_by_equipment ON workout_item_equipment (equipment_id);

-- A template that's still being put together (Template mode): the app's workout document as JSON,
-- empty slots included. Not a workout yet, so no evaluations; saving it as a workout deletes the draft.
CREATE TABLE workout_draft (
    draft_id    INTEGER PRIMARY KEY,
    name        TEXT    NOT NULL CHECK (length(trim(name)) > 0),
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    doc         TEXT    NOT NULL CHECK (json_valid(doc))
) STRICT;

-- One attempt at a workout. A workout can be done many times.
CREATE TABLE workout_session (
    session_id      INTEGER PRIMARY KEY,
    workout_id      INTEGER NOT NULL REFERENCES workout (workout_id) ON DELETE CASCADE,
    started_at      TEXT    NOT NULL,
    finished_at     TEXT,
    active_seconds  INTEGER CHECK (active_seconds >= 0),     -- wall time minus pauses
    completed       INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
    time_feel       TEXT    CHECK (time_feel IN ('too_short', 'about_right', 'too_long')),
    CHECK (finished_at IS NULL OR finished_at >= started_at)
) STRICT;
CREATE INDEX ix_workout_session_workout ON workout_session (workout_id, started_at);

-- Actual time per block, recorded by the follow-along timer.
CREATE TABLE session_block_time (
    session_id      INTEGER NOT NULL REFERENCES workout_session (session_id) ON DELETE CASCADE,
    block_id        INTEGER NOT NULL REFERENCES workout_block (block_id) ON DELETE CASCADE,
    active_seconds  INTEGER NOT NULL CHECK (active_seconds >= 0),
    PRIMARY KEY (session_id, block_id)
) STRICT, WITHOUT ROWID;

-- What happened to each item in a session. No row means done as prescribed.
CREATE TABLE session_item_log (
    session_id  INTEGER NOT NULL REFERENCES workout_session (session_id) ON DELETE CASCADE,
    item_id     INTEGER NOT NULL REFERENCES workout_item (item_id) ON DELETE CASCADE,
    status      TEXT    NOT NULL CHECK (status IN ('done', 'skipped', 'modified')),
    note        TEXT,
    PRIMARY KEY (session_id, item_id)
) STRICT, WITHOUT ROWID;

-- Overall rating: 1-5 stars, one per session.
CREATE TABLE session_rating (
    session_id  INTEGER PRIMARY KEY REFERENCES workout_session (session_id) ON DELETE CASCADE,
    stars       INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
    rated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;

-- Evaluation: a 1-5 score per criterion (difficulty, enjoyment, variety, ...).
-- New criteria are rows, not columns.
CREATE TABLE evaluation_criterion (
    criterion_id  INTEGER PRIMARY KEY,
    code          TEXT    NOT NULL UNIQUE,
    name          TEXT    NOT NULL UNIQUE,
    low_label     TEXT    NOT NULL,                          -- what 1 means
    high_label    TEXT    NOT NULL,                          -- what 5 means
    is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
) STRICT;

CREATE TABLE session_evaluation (
    session_id    INTEGER NOT NULL REFERENCES workout_session (session_id) ON DELETE CASCADE,
    criterion_id  INTEGER NOT NULL REFERENCES evaluation_criterion (criterion_id) ON DELETE RESTRICT,
    score         INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
    PRIMARY KEY (session_id, criterion_id)
) STRICT, WITHOUT ROWID;

-- Free-text comments on a workout, optionally about one session and/or one item.
CREATE TABLE workout_comment (
    comment_id  INTEGER PRIMARY KEY,
    workout_id  INTEGER NOT NULL REFERENCES workout (workout_id) ON DELETE CASCADE,
    session_id  INTEGER REFERENCES workout_session (session_id) ON DELETE CASCADE,
    item_id     INTEGER REFERENCES workout_item (item_id) ON DELETE CASCADE,
    body        TEXT    NOT NULL CHECK (length(trim(body)) > 0),
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    edited_at   TEXT
) STRICT;
CREATE INDEX ix_workout_comment_workout ON workout_comment (workout_id, created_at);

-- Cross-table consistency that foreign keys alone can't express: the session, item
-- and block a row points at must all belong to the same workout.
CREATE TRIGGER trg_comment_same_workout BEFORE INSERT ON workout_comment
WHEN (NEW.session_id IS NOT NULL AND
        (SELECT workout_id FROM workout_session WHERE session_id = NEW.session_id) IS NOT NEW.workout_id)
  OR (NEW.item_id IS NOT NULL AND
        (SELECT b.workout_id FROM workout_item i JOIN workout_block b USING (block_id)
          WHERE i.item_id = NEW.item_id) IS NOT NEW.workout_id)
BEGIN
    SELECT RAISE(ABORT, 'comment: session or item belongs to a different workout');
END;

CREATE TRIGGER trg_block_time_same_workout BEFORE INSERT ON session_block_time
WHEN (SELECT workout_id FROM workout_block WHERE block_id = NEW.block_id)
     IS NOT (SELECT workout_id FROM workout_session WHERE session_id = NEW.session_id)
BEGIN
    SELECT RAISE(ABORT, 'session_block_time: block belongs to a different workout');
END;

CREATE TRIGGER trg_item_log_same_workout BEFORE INSERT ON session_item_log
WHEN (SELECT b.workout_id FROM workout_item i JOIN workout_block b USING (block_id) WHERE i.item_id = NEW.item_id)
     IS NOT (SELECT workout_id FROM workout_session WHERE session_id = NEW.session_id)
BEGIN
    SELECT RAISE(ABORT, 'session_item_log: item belongs to a different workout');
END;

-- The chosen equipment must be one of the exercise's options.
CREATE TRIGGER trg_item_equipment_is_option BEFORE INSERT ON workout_item_equipment
WHEN NOT EXISTS (
    SELECT 1 FROM workout_item i
    JOIN exercise_requirement r ON r.exercise_id = i.exercise_id
    JOIN requirement_option o  ON o.requirement_id = r.requirement_id
    WHERE i.item_id = NEW.item_id AND o.equipment_id = NEW.equipment_id)
BEGIN
    SELECT RAISE(ABORT, 'workout_item_equipment: not an option for this exercise');
END;

-- =====================================================================
-- 3. VIEWS
-- =====================================================================

-- Everything the app shows for one exercise, flattened.
CREATE VIEW v_exercise_card AS
SELECT e.exercise_id, e.slug, e.name, e.min_level_id,
       p.code AS primary_pattern, c.cue, c.avoid, c.setup_note,
       e.is_combo, e.is_slow_to_fast, e.is_partner, e.is_sprint, e.switches_sides
FROM exercise e
JOIN exercise_pattern ep ON ep.exercise_id = e.exercise_id AND ep.is_primary = 1
JOIN movement_pattern p  ON p.pattern_id = ep.pattern_id
JOIN exercise_coaching c ON c.exercise_id = e.exercise_id
WHERE e.is_active = 1;

-- "What you'll need" for a workout: equipment actually used.
CREATE VIEW v_workout_kit AS
SELECT b.workout_id, eq.equipment_id, eq.name, count(DISTINCT i.item_id) AS used_by_items
FROM workout_block b
JOIN workout_item i            ON i.block_id = b.block_id
JOIN workout_item_equipment ie ON ie.item_id = i.item_id
JOIN equipment eq              ON eq.equipment_id = ie.equipment_id
GROUP BY b.workout_id, eq.equipment_id;

-- Estimated vs actual time, per session.
CREATE VIEW v_session_time AS
SELECT s.session_id, s.workout_id, w.block_count, w.estimated_seconds, s.active_seconds,
       s.active_seconds - w.estimated_seconds                          AS delta_seconds,
       round(100.0 * (s.active_seconds - w.estimated_seconds) / w.estimated_seconds, 1) AS delta_pct,
       s.time_feel
FROM workout_session s
JOIN workout w ON w.workout_id = s.workout_id
WHERE s.active_seconds IS NOT NULL;

-- Estimated vs actual time, per block: shows which parts run long.
CREATE VIEW v_block_time AS
SELECT t.session_id, b.workout_id, b.block_id, b.kind, b.name,
       sum(i.estimated_seconds) * b.rounds
         + b.rest_between_moves_s  * (count(i.item_id) - 1) * b.rounds
         + b.rest_between_rounds_s * (b.rounds - 1)                     AS estimated_seconds,
       t.active_seconds                                                AS actual_seconds
FROM session_block_time t
JOIN workout_block b ON b.block_id = t.block_id
JOIN workout_item i  ON i.block_id = b.block_id
GROUP BY t.session_id, b.block_id;

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

-- How each exercise performs across workouts: picked, skipped, liked.
CREATE VIEW v_exercise_stats AS
SELECT e.exercise_id, e.slug, e.name,
       count(DISTINCT i.item_id)                                        AS times_generated,
       count(DISTINCT CASE WHEN l.status = 'skipped' THEN l.item_id END) AS times_skipped,
       round(avg(r.stars), 2)                                          AS avg_stars_of_workouts
FROM exercise e
LEFT JOIN workout_item i     ON i.exercise_id = e.exercise_id
LEFT JOIN workout_block b    ON b.block_id = i.block_id
LEFT JOIN workout_session s  ON s.workout_id = b.workout_id
LEFT JOIN session_item_log l ON l.item_id = i.item_id AND l.session_id = s.session_id
LEFT JOIN session_rating r   ON r.session_id = s.session_id
GROUP BY e.exercise_id;

-- =====================================================================
-- 4. REFERENCE DATA
-- =====================================================================

INSERT INTO level (level_id, code, name, rest_between_moves_s, rest_between_rounds_s, rounds_per_block) VALUES
    (1, 'beginner',     'Beginner',     30, 90, 3),
    (2, 'intermediate', 'Intermediate', 20, 75, 3),
    (3, 'advanced',     'Advanced',     15, 60, 3),
    (4, 'beast',        'Beast',        10, 60, 4);

INSERT INTO phase_role (role_id, phase, code, name, sort_order) VALUES
    (1, 'warmup',   'pulse',   'Pulse raiser',     1),
    (2, 'warmup',   'flow',    'Full-body flow',   2),
    (3, 'warmup',   'mob',     'Mobility drill',   3),
    (4, 'cooldown', 'stretch', 'Short stretch',    1),
    (5, 'cooldown', 'yin',     'Yin hold',         2),
    (6, 'cooldown', 'calm',    'Calm finish',      3);

INSERT INTO evaluation_criterion (criterion_id, code, name, low_label, high_label) VALUES
    (1, 'difficulty', 'Difficulty',      'Far too easy',   'Far too hard'),
    (2, 'enjoyment',  'Enjoyment',       'Hated it',       'Loved it'),
    (3, 'variety',    'Variety',         'Repetitive',     'Fresh throughout'),
    (4, 'flow',       'Flow and setup',  'Lots of faffing','Smooth changeovers'),
    (5, 'fit',        'Fit to my goals', 'Off target',     'Exactly right');
