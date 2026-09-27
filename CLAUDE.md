# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A full-body workout generator. The app itself is plain HTML, CSS and JavaScript with no dependencies, no bundler and no framework. Python is only used for helper tools. The user-facing docs (field reference for exercises, generator knobs) are in `README.md`. Planned features are in `docs/TODO.md`.

## Commands

```bash
python3 tools/serve.py                  # dev server for web/ at http://localhost:8000/index.html (no-cache, opens browser)
python3 tools/serve.py --no-browser --port 9000
python3 tools/build.py                  # bundle into dist/workout-builder.html (single self-contained file)
python3 tools/serve.py --dist           # serve the built file
python3 tools/validate.py               # check the catalogue in db/workouts.db; run after every data edit (--db other.db)
python3 tools/db_import.py              # one-time seed of a missing DB from the historical exercises.json (refuses on a filled DB without --force)
uv run --with pytest pytest            # all tests (pytest.ini sets testpaths=tests, pythonpath=.)
uv run --with pytest pytest tests/test_data.py::test_build_produces_self_contained_html   # single test
```

Needs SQLite 3.44+ (the one bundled with Python). `.venv/` was created by uv and has no pip, so `pip install` inside it fails; use `uv run --with pytest` for tests. Opening `web/index.html` via `file://` fails because the catalogue is fetched from `/api/catalog`, so always use the server or the built file. There is no linter or formatter configured.

## Architecture

**Data vs. code split.** All data lives in the SQLite database `db/workouts.db` (tracked in git): the exercise catalogue, levels, warm-up/cool-down roles and saved workouts. It is the only source the app uses. `db/seed/exercises.json` is a frozen historical snapshot from before the switch; nothing reads it except `tools/db_import.py` (seeding) and the seeding tests, and it must not be edited. `api.catalog()` flattens the catalogue into one document (`equipment`, `exercises`, `extras`, `quantities`, `levels`, `criteria`, `phases`) that `web/js/app.js` reads from `window.WORKOUT_DATA`. The level buttons, equipment buttons, rest times and rounds per block all come from it; a new `equipment` row adds a UI button automatically.

**Two loading modes, same app.js.**
- Dev: a `<script>` between `<!-- BUILD:SCRIPTS -->` markers in `index.html` fetches `api/catalog` (no fallback), sets `window.WORKOUT_DATA`, then injects `js/app.js`.
- Build: `tools/build.py` inlines `api.catalog()` from `db/workouts.db` (a snapshot at build time) and regex-replaces the `styles.css` `<link>` and the `BUILD:SCRIPTS` block with inlined CSS, data and JS (escaping `</script`). Keep those markers and the exact `<link rel="stylesheet" href="css/styles.css">` tag intact, or the build fails. Fonts are bundled in `web/fonts/` (Barlow, Barlow Condensed; OFL) and `build.py` embeds them as base64 data URIs, so neither version fetches anything from other sites. Don't add external resources.

**Field-name mapping.** The catalogue uses readable names, and `app.js` remaps them to short keys via `FIELD_MAP` (`name→n`, `pattern→p`, `also_pattern→p2`, `level→l`, `equipment→e`, `reps→r`, `steps→s`, `cue→c`, `avoid→x`, `combo→cb`, `slow_to_fast→ct`, `partner→pt`, `sprint→sp`, `secs→t`, `switch_sides→sw`, `retired→rt`). A new exercise field must be added in five places: a column/table in `db/schema.sql` (plus a migration of `db/workouts.db`), the export in `api.catalog()`, `FIELD_MAP` in `app.js`, `ALLOWED_FIELDS` in `tools/validate.py`, and the README table.

**Generator flow (`app.js`).** Settings `S` → `generate(s)` builds a workout object `{settings, warm, cool, blocks:[{name, rounds, course?, items:[{id, pat}]}]}`:
- `BLOCKS` maps duration to block count; each block's slots come from `TEMPL` (virtual slots `plyoX` and `squatOrHinge` are resolved randomly in `resolve()`).
- `pick(pattern, s, used, preferCombo, preferPartner, kit)` filters by pattern/`also_pattern`, level, partner and equipment (`ok()`; `"db|kb"` means either), prefers unused ids, then does a weighted random pick. The weights favour the user's level and moves that reuse kit equipment.
- **Equipment kit:** selected equipment is a menu, not a checklist. `generate()` keeps a `kit` (`{have:Set, max:KIT[duration]}`); `pick()` drops candidates that would push the kit past `max` (or, if none fit, keeps those adding the least new gear). `newGear()` lists uncovered requirements; `kitOf()` rebuilds a kit from ids (used by Swap). Course and grip finisher are picked before the blocks so their gear seeds the kit.
- `sprints` setting: `"none"` excludes `sp` moves in `ok()`; `"lots"` turns each block's plyo slot into a sprint slot (or prepends one) and `pick(..., prefSp)` prefers sprint moves there, reusing used ones before giving up.
- The obstacle course is prepended and the grip finisher appended. Warm-up and cool-down draw from `DATA.phases` (`pulse`, `flow`, `mob` for the warm-up; `stretch`, `yin`, `calm` for the cool-down; `exercise_phase_role` in the DB), each filtered through `ok()`; the composition (`pulse[0], flow[0], mob[0], mob[1], pulse[1]`, and `YIN` setting the yin-hold count per duration) stays in `generate()`. A new `warm`/`cool` exercise is unused until it has a phase role. `validate.py` checks that each role's ids exist, have the right pattern, and include enough active bodyweight beginner moves (`PHASES` there).
- `sequence(w)` flattens a workout into timed/set/rest steps. It drives the follow-along overlay, the time estimate and the timeline strip. `RESTS` (rest seconds and rounds per block) is built from `DATA.levels`.
- `render()` rebuilds the whole plan as an HTML string. Swap buttons use `data-where="blockIdx-itemIdx"` and re-run `pick()` for that item's `pat`.

**Persistence.** localStorage keys `fbw-settings` and `fbw-workout`. A saved workout is discarded on load if any of its ids no longer exist, so renaming an exercise id silently invalidates saved workouts.

**Validation rules worth knowing (`tools/validate.py`).** Levels are 1–4 (Beginner..Beast); `reps` has 3–4 entries with `""` below the exercise's level. Timed patterns (`warm`, `cool`) skip level/reps. Every core slot (`plyoL squat hinge lunge push pull core`) must keep at least one level-1, bodyweight, non-partner exercise, or workouts can come up empty. `extras`/`quantities` keys must be real exercise ids. Retired exercises don't count toward slot coverage.

## Database and API

`db/schema.sql` is the SQLite schema (catalogue + saved workouts, sessions, ratings, evaluations, comments); `docs/database.md` explains the design. `tools/api.py` is the single DB entry point: `connect(path, create=False)` refuses a missing file (only `db_import` passes `create=True`), `catalog()` builds the app's catalogue, and the workout functions handle saving and evaluating. `tools/serve.py` never writes the catalogue; it refuses to start on a missing DB or one with no active exercises. `tools/db_import.py` seeds from the JSON snapshot (upsert by slug; exercises not in the JSON get `is_active = 0`, so running it with `--force` on an edited DB retires DB-only exercises); its `PHASES` constant holds the warm-up/cool-down lists that used to be hardcoded in `app.js`. Retired exercises (`is_active = 0`) come back to the app as `retired: true`, which `ok()` skips; never delete an exercise, since `workout_item` references it. Saving and evaluating go through `tools/api.py`; the app switches those features on only if `GET /api/workouts` answers (`API.on`), so the built single file still works without a server. `toDB()` in `app.js` converts the on-screen workout into the shape `api.save_workout` expects. Catalogue mapping: `pattern`/`also_pattern` → `exercise_pattern`, `"a|b"` equipment → `exercise_requirement` + `requirement_option`, `extras` → `setup_item`, `quantities` → `exercise_coaching.setup_note`, `phases` → `exercise_phase_role`. Tests never touch `db/workouts.db` except read-only (`test_data.py` validates it and checks the build); `test_db.py` seeds temporary DBs from the JSON. SQLite needs `PRAGMA foreign_keys = ON` per connection.

## Conventions

- `app.js` is written in a dense, minified-like style (short names, one-liners, template-string HTML). Match it rather than reformatting.
- Theming uses CSS custom properties on `:root` with a dark override under `prefers-color-scheme`; use the existing tokens (`--strength`, `--jump`, `--soft`, etc.) rather than raw colours.
- `dist/` is build output and git-ignored.
- The README says Python 3.8+, but `pyproject.toml` declares `requires-python >=3.14`; the tools themselves use only the standard library.
