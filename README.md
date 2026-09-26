# Full-body workout builder

A no-dependency web app that builds full-body functional workouts: plyometrics, combos, slow-to-fast contrast work, partner moves, obstacle courses and a grip finisher, all matched to the equipment you have. Every move has step-by-step instructions, and a follow-along mode runs the timers.

The app is plain HTML, CSS and JavaScript. Python is only used for small helper scripts: a local server, a data validator and a single-file build. They use only the standard library.

## Run it

From a terminal in this folder:

```bash
python3 tools/serve.py
```

Your browser opens at `http://localhost:8000/index.html`. Edit anything under `web/`, then refresh the page: the server turns off caching, so changes show up straight away. Stop it with `Ctrl+C`.

Options:

```bash
python3 tools/serve.py --port 9000       # use another port
python3 tools/serve.py --no-browser      # don't open a browser tab
python3 tools/serve.py --dist            # serve the built single file (see "Sharing it")
```

The server only listens on your own machine (`127.0.0.1`), so other devices on your network can't reach it.

> Opening `web/index.html` by double-clicking won't work, because browsers block loading the JSON data from `file://`. Use the server, or the built single file below.

## Commands

| Command | What it does |
| --- | --- |
| `python3 tools/serve.py` | Runs the app from `web/` on port 8000 |
| `python3 tools/validate.py` | Checks `web/data/exercises.json` for mistakes; run it after every edit |
| `python3 tools/build.py` | Writes `dist/workout-builder.html` with everything inlined |
| `uv run --with pytest pytest` | Runs the tests |

The helper scripts need Python 3.8 or newer. Running them through uv (`uv run tools/serve.py`) uses the Python version pinned in `pyproject.toml` instead.

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

The tests check the exercise data, check that the validator catches common mistakes, and check that the build produces a working single file.

## Project layout

```
workout-builder/
├── web/                      the app
│   ├── index.html            page structure and settings controls
│   ├── css/styles.css        styling, light and dark themes
│   ├── js/app.js             generator, rendering, follow-along timer
│   └── data/exercises.json   every exercise, equipment names, setup extras
├── tools/
│   ├── serve.py              local dev server (no caching, opens the browser)
│   ├── build.py              bundles web/ into dist/workout-builder.html
│   └── validate.py           checks exercises.json for mistakes
├── tests/test_data.py        pytest checks for the data and the build
├── docs/TODO.md              ideas for future features
└── dist/                     build output (git-ignored)
```

## Adding or editing exercises

Everything lives in `web/data/exercises.json`. Add an object to the `exercises` list, run `python3 tools/validate.py`, then refresh the browser.

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
| `id` | Unique, lowercase with dashes. Used by Swap and saved workouts; renaming one drops any saved workout that uses it. |
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
| `sprint` | Optional `true`. A sprint move: left out when Sprints is "None", and picked for the sprint slot when it's "One per block". |
| `secs` | Optional, warm-up and cool-down moves only. How long to hold it, in seconds. Default: 40 for warm-ups, 45 for cool-downs. Cool-down moves of 120 seconds or more get a "Yin" tag. |
| `switch_sides` | Optional `true`. One-sided move: the follow-along timer beeps halfway and says to switch sides. |

Warm-up and cool-down moves (`warm`, `cool`) are timed, so they don't need `level` or `reps`.

Other sections of the JSON:

- `equipment`: the equipment keys and their display names. Adding one here adds a button in the app automatically.
- `extras`: small items for the "What you'll need" list, like towels, mats or anchor points, keyed by exercise id.
- `quantities`: setup counts shown in that list, like "2 soft boxes of the same height", keyed by exercise id.

The validator also makes sure every main slot (`plyoL`, `squat`, `hinge`, `lunge`, `push`, `pull`, `core`) keeps at least one Beginner bodyweight move, so a workout can always be built with no equipment.

## Changing how workouts are built

The generator is in `web/js/app.js`:

- `TEMPL` sets which patterns go in each block, in order.
- `BLOCKS` maps workout length to the number of blocks.
- `RESTS` sets rest times per level.
- `pick()` chooses exercises. Its weights prefer moves at your level and moves that use equipment already in the workout's kit.
- Selected equipment is a menu, not a checklist: each workout draws a small kit from it and reuses it. `KIT` sets the most equipment types per workout by length (3 for 20 min up to 6 for 60 min). Bodyweight moves never count toward it.
- `generate()` picks the obstacle course and grip finisher first (so blocks can reuse their equipment), then the blocks, and places combos and partner moves.
- The id lists inside `generate()` pick the warm-up and cool-down. The warm-up takes one pulse raiser (`pulse`), one full-body flow (`flow`), two mobility drills (`mob`) and a second pulse raiser. The cool-down takes two short stretches (`stretch`), some yin holds (`yin`; how many depends on workout length, set in `YIN`) and one calm finish (`calm`). To use a new warm-up or cool-down move, add its id to one of these lists. The validator checks the ids in them, so keep the `name=[...]` or `name=shuffle([...])` form. A new list name has to be added to `LIST_SECTIONS` in `tools/validate.py`.

## Sharing it

```bash
python3 tools/build.py
```

`dist/workout-builder.html` has everything inlined, so it opens straight from disk, works offline, and can be sent to a friend or published as a web page. To check it before sharing, run `python3 tools/serve.py --dist`. The only thing it loads from the internet is the Google Fonts stylesheet; without a connection it falls back to system fonts.

Settings and your last workout are saved in the browser's local storage, separately for each address you open it from.
