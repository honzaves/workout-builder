"""Sanity-check the exercise catalogue in the database (db/workouts.db).

Checks the catalogue exactly as the app receives it (api.catalog). Catches the mistakes
that are easy to make when editing by hand: duplicate ids,
unknown equipment or patterns, missing reps for an exercise's own level, warm-up and
cool-down lists that point at the wrong moves, and generator slots that would come up empty.

Usage:
    python3 tools/validate.py
    python3 tools/validate.py --db other.db
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import api  # noqa: E402

PATTERNS = {"warm", "cool", "plyoL", "plyoU", "squat", "hinge", "lunge", "push", "pull", "core", "grip", "course"}
TIMED = {"warm", "cool"}
# Slots the generator fills in every block; each needs a bodyweight beginner option.
CORE_SLOTS = ["plyoL", "squat", "hinge", "lunge", "push", "pull", "core"]
# Warm-up / cool-down roles: the pattern their moves must have, and how many gear-free
# moves generate() takes from each (pulse[0] and pulse[1], two mobility drills, ...).
PHASES = {"pulse": ("warm", 2), "flow": ("warm", 1), "mob": ("warm", 2),
          "stretch": ("cool", 2), "yin": ("cool", 3), "calm": ("cool", 1)}
# Movement drawings (figure_pose, exercise_figure): what the drawing code in app.js understands.
POSE_KEYS = {"hip", "t", "hd", "ln", "lf", "an", "af", "hold", "hi", "anchor", "flip", "who", "front"}
LIMB_KEYS = {"to", "bend", "a", "j", "toe", "ft"}
HOLDS = {"bb", "fr", "bbh", "kb", "kb2", "kbr", "kbr2", "zbb", "zsb", "eq", "bbl", "hammer", "jr", "goblet", "db1", "db2", "sb", "med", "pl", "vest", "band", "trx", "rope", "lm"}
ITEM_KINDS = {"fig", "kb", "box", "rack", "plate", "bar", "arrow", "swap", "guide", "label", "pb", "sq", "me",
              "wall", "bench", "bosu", "ball", "sled", "slab", "anchor", "sb", "medb", "tire", "ghd", "line", "bbl", "db", "rower", "bike"}
ITEM_FLAGS = {"ghost", "dash", "faint", "r"}
ALLOWED_FIELDS = {"id", "name", "pattern", "also_pattern", "level", "equipment", "reps", "steps",
                  "cue", "avoid", "combo", "slow_to_fast", "partner", "sprint", "secs", "switch_sides", "retired"}


def load(db_path: Path | str = api.DEFAULT_DB) -> dict:
    """The catalogue as the app receives it."""
    con = api.connect(db_path)
    try:
        return api.catalog(con)
    finally:
        con.close()


def validate(data: dict) -> list[str]:
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

    active = [e for e in exercises if not e.get("retired")]  # only these keep the generator's slots filled
    if not any(e.get("sprint") and e.get("pattern") == "plyoL" and e.get("level") == 1 and not e.get("equipment")
               and not e.get("partner") for e in active):
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
                   and not e.get("partner") for e in active):
            errors.append(f"pattern '{slot}' has no bodyweight beginner exercise; workouts could come up empty")

    by_id = {e.get("id"): e for e in exercises}
    phases = data.get("phases", {})
    for role, (section, needed) in PHASES.items():
        ids = phases.get(role, [])
        for ex_id in ids:
            if ex_id not in by_id:
                errors.append(f"{section}-up list '{role}' uses unknown id '{ex_id}'")
            elif by_id[ex_id].get("pattern") != section:
                errors.append(f"{section}-up list '{role}' uses '{ex_id}', which isn't a '{section}' exercise")
        usable = [i for i in ids if i in by_id and not by_id[i].get("retired") and not by_id[i].get("equipment")
                  and not by_id[i].get("partner") and (by_id[i].get("level") or 1) == 1]
        if len(usable) < needed:
            errors.append(f"{section}-up list '{role}' has {len(usable)} active bodyweight beginner move(s); "
                          f"the generator needs {needed}")
    for role in set(phases) - set(PHASES):
        errors.append(f"phase role '{role}' isn't used by the generator")
    errors += validate_figures(data)
    return errors


def _is_pt(v) -> bool:
    return isinstance(v, list) and len(v) == 2 and all(isinstance(n, (int, float)) for n in v)


def _pose_errors(pose: dict, where: str) -> list[str]:
    """Problems with one pose, or with a scene's overrides of a named pose."""
    errors = [f"{where}: unknown pose key(s) {sorted(set(pose) - POSE_KEYS - {'pose', 'x', 'y'})}"] \
        if set(pose) - POSE_KEYS - {"pose", "x", "y"} else []
    for key in ("hip", "anchor"):
        if key in pose and not _is_pt(pose[key]):
            errors.append(f"{where}: '{key}' must be [x, y]")
    for key in ("ln", "lf", "an", "af"):
        limb = pose.get(key)
        if limb is None:
            continue
        if not isinstance(limb, dict) or set(limb) - LIMB_KEYS or not ({"to", "a"} & set(limb)):
            errors.append(f"{where}: limb '{key}' needs 'to' or 'a' and only {sorted(LIMB_KEYS)}")
        elif any(k in limb and not _is_pt(limb[k]) for k in ("to", "a", "j", "toe")):
            errors.append(f"{where}: limb '{key}' has a point that isn't [x, y]")
        elif limb.get("bend", "f") not in ("f", "b", "u", "d"):
            errors.append(f"{where}: limb '{key}' bend must be f, b, u or d")
    if pose.get("hold") not in (None, *HOLDS):
        errors.append(f"{where}: unknown hold '{pose['hold']}'")
    if pose.get("hold") in ("lm", "trx", "rope") and "anchor" not in pose:
        errors.append(f"{where}: a '{pose['hold']}' hold needs an 'anchor'")
    if set(pose.get("hi", [])) - {"torso", "ln", "lf", "an", "af"}:
        errors.append(f"{where}: 'hi' can only list torso, ln, lf, an, af")
    return errors


def validate_figures(data: dict) -> list[str]:
    """Poses are well formed, every figure uses known poses and items, and each exercise's
    drawings cover its steps in order, each step exactly once."""
    errors: list[str] = []
    poses = data.get("poses", {})
    for code, pose in poses.items():
        errors += _pose_errors(pose, f"pose '{code}'")
        if "hip" not in pose:
            errors.append(f"pose '{code}': missing 'hip'")
    steps = {e["id"]: len(e.get("steps", [])) for e in data.get("exercises", [])}
    for ex_id, figs in data.get("figures", {}).items():
        if ex_id not in steps:
            errors.append(f"figures: '{ex_id}' is not an exercise id")
            continue
        expected = 1
        for n, fig in enumerate(figs, 1):
            where = f"{ex_id} drawing {n}"
            first, last = fig["steps"]
            if first != expected or last > steps[ex_id]:
                errors.append(f"{where}: covers steps {first}-{last}, expected to start at step {expected} "
                              f"and end by step {steps[ex_id]}")
            expected = last + 1
            items = fig["scene"].get("items")
            if not isinstance(items, list) or not items:
                errors.append(f"{where}: scene needs a non-empty 'items' list")
                continue
            for i, item in enumerate(items, 1):
                kinds = set(item) & ITEM_KINDS
                if len(kinds) != 1 or set(item) - ITEM_KINDS - ITEM_FLAGS:
                    errors.append(f"{where} item {i}: needs exactly one of {sorted(ITEM_KINDS)}, got {sorted(item)}")
                    continue
                fig_ref = item.get("fig")
                if isinstance(fig_ref, str):
                    fig_ref = {"pose": fig_ref}
                if isinstance(fig_ref, dict):
                    if "pose" in fig_ref and not isinstance(fig_ref["pose"], str):
                        errors.append(f"{where} item {i}: 'pose' must be a pose name")
                    elif "pose" in fig_ref and fig_ref["pose"] not in poses:
                        errors.append(f"{where} item {i}: unknown pose '{fig_ref['pose']}'")
                    elif "pose" not in fig_ref and "hip" not in fig_ref:
                        errors.append(f"{where} item {i}: a figure needs a 'pose' name or its own 'hip'")
                    errors += _pose_errors(fig_ref, f"{where} item {i}")
                elif "fig" in item:
                    errors.append(f"{where} item {i}: 'fig' must be a pose name or an object")
                if "arrow" in item and (not isinstance(item["arrow"], list) or len(item["arrow"]) < 2
                                        or not all(_is_pt(q) for q in item["arrow"])):
                    errors.append(f"{where} item {i}: an arrow needs 2 or more [x, y] points")
        if expected != steps[ex_id] + 1:
            errors.append(f"{ex_id}: drawings cover steps 1-{expected - 1} of {steps[ex_id]}")
    return errors


def summary(data: dict) -> str:
    ex = data["exercises"]
    by_pattern: dict[str, int] = {}
    for e in ex:
        by_pattern[e["pattern"]] = by_pattern.get(e["pattern"], 0) + 1
    parts = ", ".join(f"{k} {v}" for k, v in sorted(by_pattern.items()))
    return (f"{len(ex)} exercises ({parts}); "
            f"{sum(bool(e.get('combo')) for e in ex)} combos, "
            f"{sum(bool(e.get('partner')) for e in ex)} partner moves; "
            f"{len(data.get('figures', {}))} with drawings")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", default=str(api.DEFAULT_DB))
    data = load(parser.parse_args().db)
    errors = validate(data)
    if errors:
        print(f"{len(errors)} problem(s) found:")
        for e in errors:
            print("  -", e)
        return 1
    print("OK:", summary(data))
    return 0


if __name__ == "__main__":
    sys.exit(main())
