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
python3 tools/validate.py               # check web/data/exercises.json; run after every data edit
uv run --with pytest pytest            # all tests (pytest.ini sets testpaths=tests, pythonpath=.)
uv run --with pytest pytest tests/test_data.py::test_build_produces_self_contained_html   # single test
```

`.venv/` was created by uv and has no pip, so `pip install` inside it fails; use `uv run --with pytest` for tests. Opening `web/index.html` via `file://` fails because the data is fetched, so always use the server or the built file. There is no linter or formatter configured.

## Architecture

**Data vs. code split.** All exercises live in `web/data/exercises.json` (`equipment`, `exercises`, `extras`, `quantities`). `web/js/app.js` holds all logic in one file and reads the data from `window.WORKOUT_DATA`. Adding an equipment key in the JSON adds a UI button automatically.

**Two loading modes, same app.js.**
- Dev: a `<script>` between `<!-- BUILD:SCRIPTS -->` markers in `index.html` fetches the JSON, sets `window.WORKOUT_DATA`, then injects `js/app.js`.
- Build: `tools/build.py` regex-replaces the `styles.css` `<link>` and the `BUILD:SCRIPTS` block with inlined CSS, data and JS (escaping `</script`). Keep those markers and the exact `<link rel="stylesheet" href="css/styles.css">` tag intact, or the build fails. The only external resource is the Google Fonts stylesheet.

**Field-name mapping.** The JSON uses readable names, and `app.js` remaps them to short keys via `FIELD_MAP` (`name→n`, `pattern→p`, `also_pattern→p2`, `level→l`, `equipment→e`, `reps→r`, `steps→s`, `cue→c`, `avoid→x`, `combo→cb`, `slow_to_fast→ct`, `partner→pt`, `sprint→sp`, `secs→t`, `switch_sides→sw`). A new exercise field must be added in three places: `FIELD_MAP` in `app.js`, `ALLOWED_FIELDS` in `tools/validate.py`, and the README field table.

**Generator flow (`app.js`).** Settings `S` → `generate(s)` builds a workout object `{settings, warm, cool, blocks:[{name, rounds, course?, items:[{id, pat}]}]}`:
- `BLOCKS` maps duration to block count; each block's slots come from `TEMPL` (virtual slots `plyoX` and `squatOrHinge` are resolved randomly in `resolve()`).
- `pick(pattern, s, used, preferCombo, preferPartner, kit)` filters by pattern/`also_pattern`, level, partner and equipment (`ok()`; `"db|kb"` means either), prefers unused ids, then does a weighted random pick. The weights favour the user's level and moves that reuse kit equipment.
- **Equipment kit:** selected equipment is a menu, not a checklist. `generate()` keeps a `kit` (`{have:Set, max:KIT[duration]}`); `pick()` drops candidates that would push the kit past `max` (or, if none fit, keeps those adding the least new gear). `newGear()` lists uncovered requirements; `kitOf()` rebuilds a kit from ids (used by Swap). Course and grip finisher are picked before the blocks so their gear seeds the kit.
- `sprints` setting: `"none"` excludes `sp` moves in `ok()`; `"lots"` turns each block's plyo slot into a sprint slot (or prepends one) and `pick(..., prefSp)` prefers sprint moves there, reusing used ones before giving up.
- The obstacle course is prepended and the grip finisher appended. Warm-up and cool-down ids are **hardcoded lists inside `generate()`** (`pulse`, `flow`, `mob` for the warm-up; `stretch`, `yin`, `calm` for the cool-down, with `YIN` setting the yin-hold count per duration), so a new `warm`/`cool` exercise in the JSON is unused until its id is added there. `validate.py` regex-parses `name=[...]` / `name=shuffle([...])` for the variable names in `LIST_SECTIONS` and checks ids and patterns; keep that syntax and update `LIST_SECTIONS` when renaming or adding a list.
- `sequence(w)` flattens a workout into timed/set/rest steps. It drives the follow-along overlay, the time estimate and the timeline strip. `RESTS` sets rest seconds per level.
- `render()` rebuilds the whole plan as an HTML string. Swap buttons use `data-where="blockIdx-itemIdx"` and re-run `pick()` for that item's `pat`.

**Persistence.** localStorage keys `fbw-settings` and `fbw-workout`. A saved workout is discarded on load if any of its ids no longer exist, so renaming an exercise id silently invalidates saved workouts.

**Validation rules worth knowing (`tools/validate.py`).** Levels are 1–4 (Beginner..Beast); `reps` has 3–4 entries with `""` below the exercise's level. Timed patterns (`warm`, `cool`) skip level/reps. Every core slot (`plyoL squat hinge lunge push pull core`) must keep at least one level-1, bodyweight, non-partner exercise, or workouts can come up empty. `extras`/`quantities` keys must be real exercise ids.

## Conventions

- `app.js` is written in a dense, minified-like style (short names, one-liners, template-string HTML). Match it rather than reformatting.
- Theming uses CSS custom properties on `:root` with a dark override under `prefers-color-scheme`; use the existing tokens (`--strength`, `--jump`, `--soft`, etc.) rather than raw colours.
- `dist/` is build output and git-ignored.
- The README says Python 3.8+, but `pyproject.toml` declares `requires-python >=3.14`; the tools themselves use only the standard library.
