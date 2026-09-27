"""Sanity-check web/data/exercises.json.

Catches the mistakes that are easy to make when editing by hand: duplicate ids,
unknown equipment or patterns, missing reps for an exercise's own level, and
generator slots that would come up empty.

Usage:
    python tools/validate.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "web" / "data" / "exercises.json"
APP_FILE = ROOT / "web" / "js" / "app.js"

PATTERNS = {"warm", "cool", "plyoL", "plyoU", "squat", "hinge", "lunge", "push", "pull", "core", "grip", "course"}
TIMED = {"warm", "cool"}
# Slots the generator fills in every block; each needs a bodyweight beginner option.
CORE_SLOTS = ["plyoL", "squat", "hinge", "lunge", "push", "pull", "core"]
# Variables in app.js generate() that hold warm-up / cool-down id lists.
LIST_SECTIONS = {"warm": "warm", "pulse": "warm", "flow": "warm", "mob": "warm",
                 "cool": "cool", "stretch": "cool", "yin": "cool", "calm": "cool"}
ALLOWED_FIELDS ={"id", "name", "pattern", "also_pattern", "level", "equipment", "reps", "steps",
                  "cue", "avoid", "combo", "slow_to_fast", "partner", "sprint", "secs", "switch_sides"}


def load(path: Path = DATA_FILE) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def validate(data: dict, app_js: str | None = None) -> list[str]:
    errors: list[str] = []
    equipment = set(data.get("equipment", {}))
    exercises = data.get("exercises", [])
    ids: set[str] = set()

    for i, ex in enumerate(exercises):
        where = f"exercise #{i} ({ex.get('id', '?')})"
        unknown = set(ex) - ALLOWED_FIELDS
        if unknown:
            errors.append(f"{where}: unknown field(s) {sorted(unknown)}")
        for field in ("id", "name", "pattern", "steps", "cue"):
            if not ex.get(field):
                errors.append(f"{where}: missing '{field}'")
        if ex.get("id") in ids:
            errors.append(f"{where}: duplicate id")
        ids.add(ex.get("id"))

        pattern = ex.get("pattern")
        if pattern not in PATTERNS:
            errors.append(f"{where}: unknown pattern '{pattern}'")
        if ex.get("also_pattern") and ex["also_pattern"] not in PATTERNS:
            errors.append(f"{where}: unknown also_pattern '{ex['also_pattern']}'")

        for req in ex.get("equipment", []):
            for alt in req.split("|"):
                if alt not in equipment:
                    errors.append(f"{where}: unknown equipment '{alt}'")

        if not isinstance(ex.get("steps", []), list) or not all(isinstance(s, str) and s for s in ex.get("steps", [])):
            errors.append(f"{where}: 'steps' must be a list of non-empty strings")

        if "secs" in ex and (pattern not in TIMED or not isinstance(ex["secs"], int) or not 10 <= ex["secs"] <= 600):
            errors.append(f"{where}: 'secs' must be a whole number of seconds (10-600), on warm-up or cool-down moves only")
        if "switch_sides" in ex and ex["switch_sides"] is not True:
            errors.append(f"{where}: 'switch_sides' must be true or left out")

        if pattern in TIMED:
            continue
        level = ex.get("level")
        if level not in (1, 2, 3, 4):
            errors.append(f"{where}: level must be 1-4, got {level!r}")
            continue
        reps = ex.get("reps")
        if not isinstance(reps, list) or not 3 <= len(reps) <= 4:
            errors.append(f"{where}: 'reps' must be a list of 3 or 4 strings (Beginner..Beast)")
        elif level - 1 < len(reps) and not reps[level - 1]:
            errors.append(f"{where}: no reps given for its own level ({level})")
        elif level == 4 and len(reps) < 4:
            errors.append(f"{where}: Beast-level exercise needs a 4th reps entry")

    if not any(e.get("sprint") and e.get("pattern") == "plyoL" and e.get("level") == 1 and not e.get("equipment")
               and not e.get("partner") for e in exercises):
        errors.append("no bodyweight beginner plyoL sprint; 'Sprints: One per block' could come up empty")

    seen_names: dict[str, str] = {}
    for ex in exercises:
        name = str(ex.get("name", "")).strip().lower()
        if name in seen_names:
            errors.append(f"exercise '{ex.get('id')}': same name as '{seen_names[name]}' ({ex.get('name')})")
        seen_names.setdefault(name, ex.get("id"))

    for key in ("extras", "quantities"):
        for ex_id in data.get(key, {}):
            if ex_id not in ids:
                errors.append(f"{key}: '{ex_id}' is not an exercise id")

    for slot in CORE_SLOTS:
        if not any(e.get("pattern") == slot and e.get("level") == 1 and not e.get("equipment")
                   and not e.get("partner") for e in exercises):
            errors.append(f"pattern '{slot}' has no bodyweight beginner exercise; workouts could come up empty")

    if app_js:
        by_id = {e.get("id"): e for e in exercises}
        # Id lists in generate(): `name=["id",...]` or `name=shuffle(["id",...])`.
        found = {"warm": 0, "cool": 0}
        for var, body in re.findall(r'\b(\w+)=(?:shuffle\()?\[("[^\]]*)\]', app_js):
            section = LIST_SECTIONS.get(var)
            if not section:
                continue
            for ex_id in re.findall(r'"([a-z0-9-]+)"', body):
                found[section] += 1
                if ex_id not in by_id:
                    errors.append(f"app.js {section}-up list '{var}' uses unknown id '{ex_id}'")
                elif by_id[ex_id].get("pattern") != section:
                    errors.append(f"app.js {section}-up list '{var}' uses '{ex_id}', which isn't a '{section}' exercise")
        for section, n in found.items():
            if not n:
                errors.append(f"app.js: couldn't find the {section}-up id lists in generate()")
    return errors


def summary(data: dict) -> str:
    ex = data["exercises"]
    by_pattern: dict[str, int] = {}
    for e in ex:
        by_pattern[e["pattern"]] = by_pattern.get(e["pattern"], 0) + 1
    parts = ", ".join(f"{k} {v}" for k, v in sorted(by_pattern.items()))
    return (f"{len(ex)} exercises ({parts}); "
            f"{sum(bool(e.get('combo')) for e in ex)} combos, "
            f"{sum(bool(e.get('partner')) for e in ex)} partner moves")


def main() -> int:
    data = load()
    errors = validate(data, APP_FILE.read_text(encoding="utf-8"))
    if errors:
        print(f"{len(errors)} problem(s) found:")
        for e in errors:
            print("  -", e)
        return 1
    print("OK:", summary(data))
    return 0


if __name__ == "__main__":
    sys.exit(main())
