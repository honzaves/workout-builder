# Full-body workout builder

A no-dependency web app that builds full-body functional workouts: plyometrics, combos, slow-to-fast contrast work, partner moves, obstacle courses and a grip finisher, all matched to the equipment you have. Every move has step-by-step instructions, and a follow-along mode runs the timers.

The app is plain HTML, CSS and JavaScript. A small Python server (standard library only) serves it and stores the workouts you save in a SQLite database, where you can also evaluate them after training.

## Run it

From a terminal in this folder:

```bash
python3 tools/serve.py
```

Your browser opens at `http://localhost:8000/index.html`. Edit anything under `web/`, then refresh the page: the server turns off caching, so changes show up straight away. Stop it with `Ctrl+C`.

Everything the app shows comes from the SQLite database `db/workouts.db`: exercises, equipment, levels, the warm-up and cool-down lists, and your saved workouts. The server refuses to start if the database is missing or empty.

### Printing

**Print** (next to Start workout) prints the workout on screen, and **Print** in the Saved workouts list prints that one without opening it. The printout is its own layout: the kit list, then every move with its drawings (where it has them), steps, cue and what to avoid written out, and a box per round to tick off. It always prints in the light theme. Your browser's own print command (Ctrl+P or ⌘P) prints the workout on screen the same way.

### Saving and evaluating workouts

- **Nothing is saved automatically.** When you like a generated workout, type a name under the Start button and press **Save workout**.
- **Saved workouts** (below Build workout) lists everything you've saved, newest first. Each can be opened, printed, evaluated or deleted.
- **Evaluate** records one time you did the workout: the date, how long it really took, whether the length felt right, an overall rating of 1 to 5 stars, a 1-5 score for difficulty, enjoyment, variety, flow and fit to your goals, and a comment. After a follow-along run, the actual time is filled in for you.
- Evaluations show under the workout when you open it, including how the real time compared with the estimate.
- If you swap a move in a saved workout, it becomes a new, unsaved workout; save it under a new name to keep both.

Your saved workouts live in `db/workouts.db`, next to the exercises. The file is tracked by git, so committing it also commits your saved workouts and evaluations; copy it to back them up. The design of the database is described in [`docs/database.md`](docs/database.md).

Options:

```bash
python3 tools/serve.py --port 9000       # use another port
python3 tools/serve.py --no-browser      # don't open a browser tab
python3 tools/serve.py --dist            # serve the built single file (see "Sharing it")
python3 tools/serve.py --db other.db     # use a different database file
```

The server only listens on your own machine (`127.0.0.1`), so other devices on your network can't reach it.

> Opening `web/index.html` by double-clicking won't work, because the exercises come from the server's database. Use the server, or the built single file below.

## Commands

| Command | What it does |
| --- | --- |
| `python3 tools/serve.py` | Runs the app from `web/` on port 8000 |
| `python3 tools/validate.py` | Checks the exercises in the database for mistakes; run it after every edit |
| `python3 tools/db_import.py` | Rebuilds the database from the historical `exercises.json` snapshot. Only for a missing database: on one that already has exercises it refuses unless you add `--force`, which would retire every exercise that isn't in the JSON |
| `python3 tools/build.py` | Writes `dist/workout-builder.html` with everything inlined |
| `python3 tools/figures.py review` | Writes `dist/figures-review.html`, a page with every movement drawing next to its steps (`--ids a,b` or `--pattern squat` to narrow it) |
| `python3 tools/figures.py put file.json` | Adds or replaces poses and drawings; nothing is written if they don't validate |
| `uv run --with pytest pytest` | Runs the tests |

The helper scripts need Python 3.8 or newer with SQLite 3.44 or newer (check with `python3 -c "import sqlite3; print(sqlite3.sqlite_version)"`). Running them through uv (`uv run tools/serve.py`) uses the Python version pinned in `pyproject.toml` instead.

### Tests

With [uv](https://docs.astral.sh/uv/), no setup is needed:

```bash
uv run --with pytest pytest                                                  # all tests
uv run --with pytest pytest tests/test_data.py::test_exercise_data_is_valid  # one test
```

Without uv, install pytest into a virtual environment first:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
pytest
```

The tests check the exercises in the database and the validator, that the build produces a working single file from the database, that seeding from the JSON snapshot loads every exercise, that nothing runs on a missing or empty database, and that saving, listing, evaluating and deleting work through the HTTP API. The database tests run on temporary copies, never on `db/workouts.db`.

## Project layout

```
workout-builder/
├── web/                      the app
│   ├── index.html            page structure and settings controls
│   ├── css/styles.css        styling, light and dark themes
│   ├── fonts/                Barlow and Barlow Condensed (SIL Open Font License, see OFL.txt)
│   └── js/app.js             generator, rendering, follow-along timer, saving and evaluating
├── db/
│   ├── schema.sql            SQLite schema: catalogue, workouts, sessions, ratings, evaluations, comments
│   ├── seed/exercises.json   historical snapshot of the catalogue; only db_import.py reads it
│   └── workouts.db           the database: exercises, equipment, levels and saved workouts (the source you edit)
├── tools/
│   ├── serve.py              local server: static files plus the JSON API
│   ├── api.py                database access: the catalogue for the app; save, list, open, delete and evaluate workouts
│   ├── db_import.py          one-time seed of the database from the exercises.json snapshot
│   ├── figures.py            movement drawings: load them into the database, build review pages
│   ├── build.py              bundles web/ and the catalogue into dist/workout-builder.html
│   └── validate.py           checks the exercises in the database for mistakes
├── tests/                    pytest: data and build (test_data.py), database and API (test_db.py)
├── docs/                     database design (database.md), feature ideas (TODO.md)
└── dist/                     build output (git-ignored)
```

## Adding or editing exercises

Exercises live in the database, `db/workouts.db`. Edit them with the `sqlite3` command-line tool or a GUI such as [DB Browser for SQLite](https://sqlitebrowser.org/), then run `python3 tools/validate.py` and refresh the browser. The server reads the database on every request, so no restart is needed. `db/seed/exercises.json` is only a record of the catalogue from before the switch; editing it changes nothing.

Turn foreign keys on in every session (`PRAGMA foreign_keys = ON;`), or the database won't catch broken links. An exercise is spread over several tables; this adds a level 3 hinge that needs a stability ball and a kettlebell or dumbbell:

```sql
PRAGMA foreign_keys = ON;
BEGIN;
INSERT INTO exercise (slug, name, min_level_id) VALUES ('stab-kb-swing', 'Kettlebell swing, feet on stability ball', 3);
CREATE TEMP VIEW new AS SELECT exercise_id AS id FROM exercise WHERE slug = 'stab-kb-swing';
INSERT INTO exercise_pattern VALUES ((SELECT id FROM new), (SELECT pattern_id FROM movement_pattern WHERE code = 'hinge'), 1);
INSERT INTO exercise_coaching (exercise_id, cue, avoid) VALUES ((SELECT id FROM new), 'The one thing to focus on.', 'The most common mistake.');
INSERT INTO exercise_step VALUES ((SELECT id FROM new), 1, 'First step.'), ((SELECT id FROM new), 2, 'Second step.');
INSERT INTO exercise_prescription (exercise_id, level_id, prescription) VALUES ((SELECT id FROM new), 3, '12'), ((SELECT id FROM new), 4, '15');
-- One requirement per thing it needs; several options in one requirement mean "either one works".
INSERT INTO exercise_requirement (exercise_id, position) VALUES ((SELECT id FROM new), 1);
INSERT INTO requirement_option VALUES (last_insert_rowid(), (SELECT equipment_id FROM equipment WHERE code = 'stab'), 1);
INSERT INTO exercise_requirement (exercise_id, position) VALUES ((SELECT id FROM new), 2);
INSERT INTO requirement_option VALUES (last_insert_rowid(), (SELECT equipment_id FROM equipment WHERE code = 'kb'), 1),
                                      (last_insert_rowid(), (SELECT equipment_id FROM equipment WHERE code = 'db'), 2);
COMMIT;
```

| What | Where | Notes |
| --- | --- | --- |
| id, name | `exercise.slug`, `exercise.name` | The slug is unique, lowercase with dashes, and used by Swap and saved workouts; changing it drops any workout in the browser that uses it. Names are unique too. |
| Slot | `exercise_pattern` | One row with `is_primary = 1`: `squat`, `hinge`, `lunge`, `push`, `pull`, `core`, `plyoL` (lower-body plyo), `plyoU` (upper-body plyo and throws), `grip`, `course` (obstacle course), `warm`, `cool`. An optional second row with `is_primary = 0` lets it fill another slot; carries use `grip` so they can appear in the grip finisher. |
| Level | `exercise.min_level_id` | Lowest level that gets it: 1 Beginner, 2 Intermediate, 3 Advanced, 4 Beast. Higher levels see it too. Leave it `NULL` for warm-up and cool-down moves. |
| Reps | `exercise_prescription` | One row per level from `min_level_id` to 4. For timed sets like `30s` or `20s each side`, also set `hold_seconds` and `per_side`. |
| Equipment | `exercise_requirement` + `requirement_option` | Leave both out for bodyweight. `preference` orders the options; the first is the preferred one. |
| Steps | `exercise_step` | Numbered from 1. |
| Coaching | `exercise_coaching` | `cue` (required), `avoid` (the most common mistake), `setup_note` (a count for "What you'll need", like "2 soft boxes of the same height"). |
| Flags | `exercise.is_combo`, `is_slow_to_fast`, `is_partner`, `is_sprint`, `switches_sides` | 0 or 1. Combo: moves chained into one rep (affects the Combo setting). Slow-to-fast: shows the "Slow + fast" tag. Partner: only with "With a partner". Sprint: left out when Sprints is "None", preferred for the sprint slot on "One per block". Switches sides: the follow-along timer beeps halfway. |
| Hold time | `exercise.hold_seconds` | Warm-up and cool-down moves only, 10-600. Default: 40 for warm-ups, 45 for cool-downs. 120 or more gets a "Yin" tag. |
| Warm-up / cool-down role | `exercise_phase_role` | A new `warm` or `cool` move is only used once it has a role (see below). |
| Small items | `setup_item` + `exercise_setup_item` | Towels, mats, anchor points for "What you'll need". |
| Retire | `exercise.is_active = 0` | Never delete an exercise: saved workouts point at it. Retired ones still display in old workouts but aren't picked. |

A new row in `equipment` adds a button in the app automatically.

The validator also makes sure every main slot (`plyoL`, `squat`, `hinge`, `lunge`, `push`, `pull`, `core`) keeps at least one active Beginner bodyweight move, so a workout can always be built with no equipment, and that each warm-up and cool-down role has enough of them.

## Movement drawings

Exercises can have simple drawings: side-view stick figures with equipment and arrows, or a view from above for obstacle courses. Each drawing illustrates one or more steps, usually 2 to 4 per exercise. They're stored in the database as small JSON descriptions (tables `figure_pose` and `exercise_figure`, see [`docs/database.md`](docs/database.md)) and drawn as SVG by `app.js`, so they cost almost nothing in size and follow the light and dark themes. They appear when you expand an exercise (and in the follow-along mode's instructions), captioned with the steps they show, and as a strip of small drawings on the printout. Every exercise has them, usually 2 to 4 per exercise.

To add or change drawings, write a JSON file and load it:

```json
{"poses":   {"stand": {"hip": [0, 85], "t": 0, "ln": {"to": [0, 0]}}},
 "figures": {"goblet": [{"steps": [1, 2], "scene": {"items": [{"fig": "stand"}]}},
                        {"steps": [3, 4], "scene": {"items": [{"fig": "stand", "ghost": true}, {"fig": "squat-bar"},
                                                              {"arrow": [[30, 130], [30, 80]]}]}}]}}
```

```bash
python3 tools/figures.py put my-drawings.json   # validates first; nothing is written if something's wrong
python3 tools/figures.py review --ids goblet     # then open dist/figures-review.html
python3 tools/figures.py get goblet             # print an exercise's drawings, to copy and edit
```

The pose keys, coordinates and item types are documented at the top of the `FIG` section in `web/js/app.js`.

## Changing how workouts are built

The generator is in `web/js/app.js`:

- `TEMPL` sets which patterns go in each block, in order.
- `BLOCKS` maps workout length to the number of blocks.
- Rest times and rounds per block come from the `level` table (`RESTS` in `app.js`).
- `pick()` chooses exercises. Its weights prefer moves at your level and moves that use equipment already in the workout's kit.
- Selected equipment is a menu, not a checklist: each workout draws a small kit from it and reuses it. `KIT` sets the most equipment types per workout by length (3 for 20 min up to 6 for 60 min). Bodyweight moves never count toward it.
- `generate()` picks the obstacle course and grip finisher first (so blocks can reuse their equipment), then the blocks, and places combos and partner moves.
- The warm-up and cool-down draw from roles in the `exercise_phase_role` table. The warm-up takes one pulse raiser (`pulse`), one full-body flow (`flow`), two mobility drills (`mob`) and a second pulse raiser. The cool-down takes two short stretches (`stretch`), some yin holds (`yin`; how many depends on workout length, set in `YIN`) and one calm finish (`calm`). To use a new warm-up or cool-down move, give it a role: `INSERT INTO exercise_phase_role SELECT e.exercise_id, r.role_id FROM exercise e, phase_role r WHERE e.slug = 'my-move' AND r.code = 'mob';`

## Sharing it

```bash
python3 tools/build.py
```

`dist/workout-builder.html` has everything inlined, including a snapshot of the exercises in the database at build time (rebuild after editing them), so it opens straight from disk, works offline, and can be sent to a friend or published as a web page. To check it before sharing, run `python3 tools/serve.py --dist`. It loads nothing from the internet: even the fonts are embedded. Opened from disk or another web server, the file has no database, so the Save and Saved workouts features stay hidden; served by `tools/serve.py --dist` they work as usual.

Settings and the workout currently on screen are kept in the browser's local storage, separately for each address you open it from, so a page reload doesn't lose them. That's separate from saving a workout to the database.
