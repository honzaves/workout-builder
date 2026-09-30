# Design: three ways to build a workout

Status: **draft for review**. Implements the "refactor the way to generate workout" item in `docs/TODO.md`.
Sections marked **Assumption** are decisions I made where the requirements are silent; confirm or change them before implementation starts.

## 1. Goal

The settings screen gets a mode switch with three modes:

| Mode | What it does |
|---|---|
| **Quick** | Today's generator, unchanged. |
| **Mix levels** | Generated like Quick, but each block has four exercises at levels 1 → 2 → 3 → 4, still mixing movement patterns. |
| **Template** | The user builds the workout: empty warm-up, optional obstacle course, empty blocks, extra course or grip blocks anywhere, empty cool-down. Each slot is filled by hand (picker) or automatically. Unfinished templates can be saved as drafts. |

Decisions from the review questions:

1. Mix levels: always 1 → 2 → 3 → 4 in each block; keep the pattern mix.
2. Template: the level is chosen per exercise in the picker; rounds are set per block.
3. Categories: the existing movement patterns and tags, no new category field.
4. A template with empty slots can be saved as a draft (work in progress). Two automatic buttons: fill this slot, fill the rest.
5. Warm-up and cool-down pickers are grouped by phase role (pulse, flow, mob / stretch, yin, calm).
6. Blocks and exercises can be reordered with up/down buttons (no drag and drop).
7. Extra: automated tests for the back end and the front end; back-end support where it's missing.

## 2. Assumptions to confirm

- **A1, Mix: four exercises per block.** The requirement says 1 → 2 → 3 → 4, so a Mix block has four slots: the block's three `TEMPL` patterns plus one extra pattern (rotating through `core`, `plyoL`, `push`, `pull`, skipping ones already in the block). Exercises run in level order, so "plyo moves come first" no longer applies in this mode.
- **A2, Mix: who gets level 4.** Level 4 is thin for some patterns (see §5.2): lunge has 1 exercise at level 4, and none without equipment. Levels are assigned to patterns *after* checking what's available with the user's equipment: level 4 goes to the pattern with the most level-4 candidates, and so on down. If no exercise exists at the exact level, fall back to the nearest level below, then above. The on-screen level chip shows the real level.
- **A3, Mix: the Level control** sets rest times and rounds per block only (it no longer filters exercises). Each exercise shows the reps for its own level.
- **A4, Template: rest times.** Each block has rounds (1–6, default 3) and a rest setting with four presets taken from the `level` table (Beginner 30 s/90 s … Beast 10 s/60 s), default Intermediate. The obstacle course keeps its 60–90 s between runs.
- **A5, Template: auto-fill level.** "Fill this slot" and "Fill the rest" need a level. In Template mode the Level control is relabelled **Auto-fill level** and is used only by the automatic buttons; hand-picked exercises get their level in the picker.
- **A6, Template: slot hints.** New blocks start with slots that carry a *hint pattern* from `TEMPL` (block 1: plyoL, squat, push …; extra slots rotate through the remaining patterns). The hint is shown faintly in the empty slot ("squat") and is what auto-fill uses. Choosing an exercise by hand replaces the hint with that exercise's pattern.
- **A7, Template: when it's finished.** Start (follow-along) and Print skip empty slots, but warn first ("3 empty slots will be skipped"). Saving as a finished workout (with evaluations) needs every slot filled; saving as a draft is always possible.
- **A8, Drafts are separate from saved workouts.** Drafts live in their own table as a JSON document (no evaluations, no statistics). "Save" on a complete template turns it into a normal saved workout; the draft is then deleted. Without a server (the built single file), the current template still survives in `localStorage` like the current workout does today, but named drafts need the server.
- **A9, The picker's level buttons** show only the levels the exercise has reps for (its minimum level and up), and default to the Auto-fill level, or the exercise's minimum level if that's higher.

## 3. Workout object, version 2

All three modes produce the same shape, so render, sequence, estimate, follow-along, print and save work for all of them.

```js
{
  v: 2,
  mode: "quick" | "mix" | "template",
  settings: { blocks, level, plyo, sprints, combos, grip, partner, course, equip },  // as today; level = auto-fill level in template mode
  warm: [ {id, role} | {id:null, role} ],        // role: pulse | flow | mob; id null = empty slot
  cool: [ {id, role} | {id:null, role} ],        // role: stretch | yin | calm
  blocks: [{
    kind: "main" | "course" | "grip",
    name: "Block A",                              // main blocks renumbered A, B, C … after every change
    rounds: 3,
    rest: {ex: 20, round: 75},                    // optional: falls back to RESTS[settings.level] (today's behaviour)
    items: [ {id, pat, lv} | {id:null, pat, lv:null} ]   // lv optional: falls back to settings.level; pat is the hint when id is null
  }]
}
```

- **Upgrade on load:** a version 1 workout (no `v`) is converted when read from `localStorage` or from the API: `course:true` → `kind:"course"`, name "Grip finisher" → `kind:"grip"`, other blocks → `kind:"main"`, warm/cool ids → `{id, role}` (role looked up in `DATA.phases`), `mode:"quick"`.
- **Shared helpers** replace today's scattered reads: `lvOf(it,w)` (item level or settings level), `restOf(b,w)`, `filled(w)` (items with an id). `sequence()`, `estimate()`, the timeline strip, `render()`, `move()` for print and `toDB()` use them. Empty slots are skipped everywhere except the template editor.
- **Swap** keeps working in all modes: same pattern, same item level, kit rules as today.

## 4. User interface

### 4.1 Settings screen

A segmented control at the top: **Quick · Mix levels · Template**. What each mode shows:

| Control | Quick | Mix levels | Template |
|---|---|---|---|
| Exercise blocks (1–6) | yes | yes | yes (starting number of blocks) |
| Level | yes | yes (rest and rounds) | as **Auto-fill level** |
| Plyometrics, Sprints, Combo moves | yes | yes | no |
| Obstacle course | yes | yes | yes (whether the template starts with one) |
| Grip finisher | yes | yes | yes (whether the template starts with one) |
| Who's training, Equipment | yes | yes | yes (filters the picker and auto-fill) |
| Main button | Build workout | Build workout | **Create template** |

### 4.2 Template editor

Uses the same page and styles as the generated plan, with editing controls added. Phone first: every control is a button at least 44 px high.

```
┌──────────────────────────────────────────────┐
│ Template · 2 of 14 slots empty               │
│ [Fill the rest]  [Save draft]  [Start] [Print]│
├──────────────────────────────────────────────┤
│ WARM-UP                          [− 5 +] moves│
│  Pulse  High knees             [Choose] [×]  │
│  Flow   ── empty ──     [Choose] [Auto]      │
│  …                                           │
├──────────────────────────────────────────────┤
│ OBSTACLE COURSE          [↑] [↓] [Remove]    │
│  Box-to-box precision jumps  L3  [Choose]…   │
├──────────────────────────────────────────────┤
│ BLOCK A   Rounds [− 3 +]  Rest [Intermediate▾]│
│                              [↑] [↓] [Remove] │
│  1 Box jump            L3  [Swap][Choose][↑][↓][×]│
│  2 ── squat ──  [Choose] [Auto]      [↑][↓][×]│
│  3 Renegade row        L2  …                 │
│  [+ Exercise]                                │
├──────────────────────────────────────────────┤
│ [+ Block] [+ Obstacle course] [+ Grip block] │  ← between every two blocks and after the last
├──────────────────────────────────────────────┤
│ COOL-DOWN                        [− 5 +] moves│
│  …                                           │
└──────────────────────────────────────────────┘
```

- **Counts:** the warm-up and cool-down steppers add or remove slots at the end (warm-up 1–8, cool-down 1–8). New slots get the next role in today's order (pulse, flow, mob, mob, pulse / stretch, stretch, yin…, calm).
- **Reordering:** ↑/↓ on blocks moves a whole block (warm-up and cool-down stay fixed first and last); ↑/↓ on an exercise moves it within its block. Main blocks are renamed A, B, C … after each move.
- **Fill this slot** (`Auto`): `pick()` for the slot's hint pattern at the Auto-fill level, respecting equipment, who's training and the kit rules; warm/cool slots draw from their role.
- **Fill the rest:** the same for every empty slot, top to bottom, so the kit builds up in order.
- **Remove** asks for confirmation only if the block has filled slots.

### 4.3 Exercise picker

A panel that slides up from the bottom (full screen on phones), used by **Choose** in the template editor and also in Quick and Mix plans (a "Choose" next to Swap: the category-based swap from the TODO list).

```
┌──────────────────────────────────┐
│ Choose an exercise          [×]  │
│ [🔍 Search                    ]  │
│ Section: Main ▸ Category chips:  │
│ [Plyo lower][Plyo upper][Squat]  │
│ [Hinge][Lunge][Push][Pull][Core] │
│ Tags: [Sprint][Combo][Partner]   │
│ Level: [1][2][3][4]              │
├──────────────────────────────────┤
│ [drawing] Lizard crawl           │
│           L3+ · bodyweight       │
│ [drawing] Bear crawl             │
│           L2+ · bodyweight       │
│ …                    (84 moves)  │
└──────────────────────────────────┘
```

- **The section is fixed by where it was opened:** warm-up slot → role chips (Pulse, Flow, Mobility); cool-down → (Stretch, Yin, Calm); course slot → course moves; grip → grip moves; main slot → pattern chips plus tag chips. The chip for the slot's current pattern or role starts selected.
- **Always filtered** by equipment and who's training (`ok()` without its level check). The level chips narrow the list to exercises available at that level; none selected shows all.
- **Search** matches the name, then the steps; it works across all categories of the section.
- **Rows** show the first drawing of the exercise (`FIG.of(id, 64)`), name, minimum level, equipment and tags. Moves already in the workout are marked "in use".
- **Tapping a row** opens a short confirmation inside the panel: the drawing strip, level buttons (A9) with the reps for each, and **Use this**. Tapping outside the panel or × closes it without changes.
- The list is built lazily (first 40 rows, more on scroll) so 1000 drawings are never rendered at once.

## 5. Generator changes

### 5.1 Quick

No change in behaviour. Code moves into `genQuick(s)`, returning the version 2 shape.

### 5.2 Mix levels

`genMix(s)`: for each block, take its `TEMPL` patterns plus the extra pattern (A1), count the candidates per pattern and level with the user's equipment and partner setting, assign levels 1–4 to patterns (A2), pick each with `pick()` using a *target level* (weighting only exact matches, fallback nearest), then sort the items by level.

Level coverage today (active exercises, any equipment / bodyweight solo):

| Pattern | L1 | L2 | L3 | L4 |
|---|---|---|---|---|
| plyoL | 26 / 10 | 65 / 20 | 53 / 14 | 10 / 2 |
| plyoU | 10 / 2 | 27 / 1 | 21 / 2 | 2 / 1 |
| squat | 26 / 3 | 16 / 2 | 26 / 4 | 6 / 1 |
| hinge | 30 / 3 | 41 / 4 | 20 / 1 | 5 / 1 |
| lunge | 18 / 4 | 46 / 3 | 20 / 1 | 1 / 0 |
| push | 31 / 2 | 40 / 6 | 39 / 7 | 14 / 4 |
| pull | 30 / 3 | 24 / 1 | 23 / 1 | 12 / 1 |
| core | 50 / 7 | 99 / 7 | 58 / 4 | 13 / 2 |

`validate.py` gets a warning (not an error) when a pattern used in `TEMPL` has no bodyweight solo exercise at some level, so gaps show up as the catalogue grows.

### 5.3 Template

`genTemplate(s)` builds the empty structure: warm-up 5 slots, the optional course, `s.blocks` main blocks with 3 slots each (hint patterns from `TEMPL`), the optional grip block, cool-down (2 stretch, `YIN[s.blocks]` yin, 1 calm). `autoFill(w, where)` and `fillRest(w)` reuse `pick()`, with the kit rebuilt from the filled slots (`kitOf`).

## 6. Back end

### 6.1 Database (migration `003_workout_modes.sql`, plus `db/schema.sql`)

- `workout`: add `mode TEXT NOT NULL DEFAULT 'quick' CHECK (mode IN ('quick','mix','template'))`. The Quick-only settings (`plyo_mode`, `sprint_mode`, `combo_mode`) become nullable for template workouts; this needs a table rebuild in SQLite (copy, drop, rename, recreate indexes and views), keeping the two saved workouts.
- `workout_item`: add `level_id INTEGER REFERENCES level` (NULL = the workout's level). The prescription snapshot stays as today.
- `workout_block` already allows any number of course and grip blocks in any position and stores rest per block, so it needs no change.
- New table `workout_draft (draft_id, name, created_at, updated_at, doc TEXT NOT NULL CHECK (json_valid(doc)))`, holding the version 2 object as JSON.

### 6.2 API (`tools/api.py`) and routes (`tools/serve.py`)

| Route | Function | Purpose |
|---|---|---|
| `POST /api/workouts` | `save_workout` | also accepts `mode`, item `level`; refuses empty slots |
| `GET /api/workouts/<id>` | `get_workout` | returns the version 2 shape (with `mode`, `kind`, `rest`, item `lv`) |
| `GET /api/drafts` | `list_drafts` | name, updated_at, number of empty slots |
| `POST /api/drafts` | `save_draft` | new draft → `{id}` |
| `GET /api/drafts/<id>` | `get_draft` | the stored document |
| `PUT /api/drafts/<id>` | `update_draft` | overwrite the document and name |
| `DELETE /api/drafts/<id>` | `delete_draft` | |

`save_draft` checks that every filled id exists and that the document is a version 2 object; it does not require complete slots. The Saved workouts section in the app lists drafts above the saved workouts with a "Draft · 2 empty slots" label; opening one loads it into the template editor.

## 7. Tests

### 7.1 Back end (pytest, temporary databases as today)

- Migration 003 applied to a seeded database that contains version 1 workouts: rows kept, `mode = 'quick'`, views still work.
- `save_workout` / `get_workout` round trip for all three modes, including multiple course and grip blocks between main blocks, item levels and per-block rest.
- `save_workout` refuses empty slots; draft CRUD, including unknown ids, invalid JSON and draft → saved workout.
- Route tests for the new endpoints through `serve.py`'s handler on a random port.
- `validate.py`: the new level-coverage warning.

### 7.2 Front end (new, no new dependencies)

`tests/test_frontend.py` builds `dist/workout-builder.html`, adds `tests/frontend/cases.js` to a copy, runs it in headless Chrome (`--dump-dom`) and reads the JSON results the script writes into the page. It is skipped when Chrome isn't installed. To reach the internals, `app.js` exposes them on one object at the end (`window.FBW = {genQuick, genMix, genTemplate, pick, sequence, …}`), which is otherwise unused.

Cases:

- Quick: block count matches the setting, no duplicate ids, equipment and partner filters respected.
- Mix: four items per block, levels strictly ascending where the catalogue allows, patterns mixed, fallback works with bodyweight only.
- Template: add, remove and reorder blocks and slots; renaming A, B, C; auto-fill and fill-the-rest fill only empty slots and respect filters; sequence and estimate skip empty slots.
- Version 1 → 2 upgrade of a stored workout.
- Picker filtering: section by context, role grouping, equipment, level, search.
- `toDB()` shape matches what `api.save_workout` expects (checked against the Python side in the same test run).
- Smoke test: every mode renders without errors at phone width (390 px) and a screenshot is written to `dist/` for review.

## 8. Implementation phases

Each phase ends with passing tests, a rebuilt `dist/workout-builder.html`, updated README/CLAUDE.md and screenshots in `dist/` for review.

1. **Foundation:** front-end test harness; version 2 workout object with upgrade; helpers; Quick moved to `genQuick`. No visible change.
2. **Picker:** bottom panel with sections, chips, search and drawings; "Choose" next to Swap in Quick plans.
3. **Template editor and drafts:** mode switch, editor, auto-fill buttons, reordering; migration 003, draft API and routes.
4. **Mix levels:** `genMix`, validator warning.
5. **Clean-up:** docs (README, CLAUDE.md, `docs/database.md`), TODO items closed (template, category swap, and partly "show catalogue of movements", since the picker can browse).

Not in scope: drag and drop, a separate catalogue page, creating new exercises in the app, language selection.
