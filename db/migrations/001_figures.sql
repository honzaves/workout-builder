-- Movement drawings: a library of named poses, and the key drawings of each exercise.
-- Apply to an existing database with: sqlite3 db/workouts.db < db/migrations/001_figures.sql
-- (db/schema.sql already contains these tables for new databases.)

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
