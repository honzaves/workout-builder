# Full-body workout builder

A no-dependency web app that builds full-body functional workouts: plyometrics, combos, slow-to-fast contrast work, partner moves, obstacle courses and a grip finisher, all matched to the equipment you have. Every move has step-by-step instructions, and a follow-along mode runs the timers.

The app is plain HTML, CSS and JavaScript. Python is only used for small helper tools (a local server, a validator and a single-file build).

## Quick start

1. Open this folder as a project in PyCharm.
2. Pick the **Serve app** run configuration (top-right dropdown) and click Run.
   Your browser opens at `http://localhost:8000/index.html`.
3. Edit anything under `web/`, then refresh the browser.

No PyCharm? From a terminal in this folder:

```bash
python tools/serve.py
```

Python 3.8 or newer. No packages are needed to run the app. `pytest` is only needed for the tests (`pip install -r requirements-dev.txt`).

> Opening `web/index.html` by double-clicking won't work, because browsers block loading the JSON data from `file://`. Use the server, PyCharm's built-in browser preview, or the built single file below.

## Project layout

```
workout-builder/
├── web/                      the app
│   ├── index.html            page structure and settings controls
│   ├── css/styles.css        styling, light and dark themes
│   ├── js/app.js             generator, rendering, follow-along timer
│   └── data/exercises.json   every exercise, equipment names, setup extras
├── tools/
│   ├── serve.py              local dev server (no caching, auto-opens browser)
│   ├── build.py              bundles web/ into dist/workout-builder.html
│   └── validate.py           checks exercises.json for mistakes
├── tests/test_data.py        pytest checks for the data and build
├── dist/                     build output (git-ignored)
└── .idea/runConfigurations/  Serve, Build, Validate and Tests for PyCharm
```

## PyCharm run configurations

| Name | What it does |
| --- | --- |
| Serve app | Runs the dev version from `web/` |
| Build single file | Writes `dist/workout-builder.html` |
| Serve built file | Serves the built file, to check it before sharing |
| Validate exercises | Checks `exercises.json` after you edit it |
| Tests | Runs pytest |

If PyCharm asks for an interpreter the first time, pick any Python 3 on your laptop.

## Adding or editing exercises

Everything lives in `web/data/exercises.json`. Add an object to the `exercises` list, run **Validate exercises**, then refresh the browser.

```json
{
  "id": "bosu-swing",
  "name": "Light kettlebell swing on BOSU",
  "pattern": "hinge",
  "level": 3,
  "equipment": ["bosu", "kb"],
  "reps": ["", "", "12", "15"],
  "steps": ["First step.", "Second step.", "Third step."],
  "cue": "The one thing to focus on.",
  "avoid": "The most common mistake."
}
```

| Field | Meaning |
| --- | --- |
| `id` | Unique, lowercase with dashes. Used by Swap and saved workouts. |
| `name` | Shown in the workout. |
| `pattern` | Which slot it can fill: `squat`, `hinge`, `lunge`, `push`, `pull`, `core`, `plyoL` (lower-body plyo), `plyoU` (upper-body plyo and throws), `grip`, `course` (obstacle course), `warm`, `cool`. |
| `also_pattern` | Optional second slot. Carries use `"grip"` so they can appear in the grip finisher. |
| `level` | Lowest level that gets it: 1 Beginner, 2 Intermediate, 3 Advanced, 4 Beast. Higher levels see it too. |
| `equipment` | Everything needed, as a list of equipment keys. `"db\|kb"` means either one works. Leave it out for bodyweight. |
| `reps` | Prescription per level, Beginner to Beast. Use `""` below the exercise's level. Levels past the end of the list use the last value. |
| `steps` | Instructions, in order. |
| `cue` | One key coaching point. |
| `avoid` | Optional. The most common mistake. |
| `combo` | Optional `true`. Marks two or more moves chained into one rep; affects the Combo setting. |
| `slow_to_fast` | Optional `true`. Slow strength into an explosive finish; shows the "Slow + fast" tag. |
| `partner` | Optional `true`. Only used when "With a partner" is on. |

Warm-up and cool-down moves (`warm`, `cool`) are timed, so they don't need `level` or `reps`.

Other sections of the JSON:

- `equipment`: the equipment keys and their display names. Adding one here adds a button in the app automatically.
- `extras`: small items for the "What you'll need" list, like towels or wall space, keyed by exercise id.
- `quantities`: setup counts shown in that list, like "3 or 4 low boxes" for a course.

## Changing how workouts are built

The generator is in `web/js/app.js`:

- `TEMPL` sets which patterns go in each block, in order.
- `BLOCKS` maps workout length to the number of blocks.
- `RESTS` sets rest times per level.
- `pick()` chooses exercises. Its weights prefer moves at your level and moves that use equipment.
- `generate()` adds the obstacle course and grip finisher, and places combos and partner moves.
- `warm` and `cool` lists inside `generate()` pick the warm-up and cool-down.

## Sharing it

Run **Build single file**. `dist/workout-builder.html` has everything inlined, so it opens straight from disk, works offline, and can be sent to a friend or published as a web page.

Settings and your last workout are saved in the browser's local storage, separately for each address you open it from.
