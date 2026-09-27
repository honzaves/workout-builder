"""Seed the SQLite database (db/workouts.db) from the historical db/seed/exercises.json.

The database is the only source the app uses; exercises.json is kept as a snapshot of
the catalogue before the switch and is no longer edited. Run this only to rebuild the
database from that snapshot (a fresh checkout without db/workouts.db, or tests).

On a database that already has exercises it refuses unless --force is given, because
the sync makes the catalogue match the JSON exactly: exercises that aren't in the JSON
(for example ones added to the database later) are retired (is_active = 0). Exercises
are matched by id (slug), so saved workouts keep pointing at the right exercise.

Usage:
    python3 tools/db_import.py                 # seed db/workouts.db (created if missing)
    python3 tools/db_import.py --db other.db
    python3 tools/db_import.py --force         # re-sync a database that already has exercises
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from api import DEFAULT_DB, connect  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "db" / "seed" / "exercises.json"

PATTERNS = {  # code: (name, is_timed, is_explosive)
    "warm": ("Warm-up", 1, 0), "cool": ("Cool-down", 1, 0),
    "plyoL": ("Lower-body plyometrics", 0, 1), "plyoU": ("Upper-body plyometrics and throws", 0, 1),
    "squat": ("Squat", 0, 0), "hinge": ("Hinge", 0, 0), "lunge": ("Lunge", 0, 0), "push": ("Push", 0, 0),
    "pull": ("Pull", 0, 0), "core": ("Core", 0, 0), "grip": ("Grip", 0, 0), "course": ("Obstacle course", 0, 1),
}
CATEGORIES = {
    "Free weights": ["db", "kb", "barbell", "plate", "sandbag", "med", "slam", "vest"],
    "Bodyweight rigs": ["bar", "rings", "trx", "pbars", "rope"],
    "Platforms and balance": ["bench", "box", "bosu", "stab", "ghd"],
    "Strongman and conditioning": ["sled", "landmine", "hammer", "tire", "jumprope", "band"],
}
HOLD = re.compile(r"^(\d+)s( each side)?$")


# The warm-up and cool-down lists as they were in app.js generate() when the JSON was
# retired. In the database they are exercise_phase_role rows.
PHASES = {
    "pulse": ["jacks", "high-knees", "butt-kicks", "lat-shuffle", "seal-jacks", "skip-in-place", "a-skip", "rope-easy"],
    "flow": ["inchworm", "wgs", "dog-cobra", "bear-squat", "spiderman-reach"],
    "mob": ["squat-reach", "leg-swings", "arm-circles", "cat-cow", "bridge-w", "hip-circles", "hip-9090", "knee-hug",
            "open-book", "scap-pushup", "ankle-rocks", "lunge-rotate", "calf-raises", "tib-raises", "band-dislocate",
            "band-pull-apart-w"],
    "stretch": ["hip-flexor", "figure4", "ham-fold", "thread", "chest-wall", "quad-stretch", "calf-wall",
                "shoulder-cross", "seated-twist", "neck-side", "cobra-stretch", "wrist-stretch"],
    "yin": ["child", "yin-butterfly", "yin-caterpillar", "yin-dragon", "yin-swan", "yin-sphinx", "yin-twist",
            "yin-happy-baby", "yin-frog", "yin-shoelace", "yin-banana"],
    "calm": ["savasana", "legs-wall", "box-breath", "croc-breath", "reclined-butterfly"],
}


def sync(con: sqlite3.Connection, data: dict, phases: dict[str, list[str]] = PHASES) -> dict[str, int]:
    """Bring the catalogue tables in line with the JSON. Returns counts of what changed."""
    stats = {"added": 0, "updated": 0, "retired": 0}
    with con:
        for code, (name, timed, explosive) in PATTERNS.items():
            con.execute("""INSERT INTO movement_pattern (code, name, is_timed, is_explosive) VALUES (?,?,?,?)
                           ON CONFLICT (code) DO UPDATE SET name=excluded.name, is_timed=excluded.is_timed,
                           is_explosive=excluded.is_explosive""", (code, name, timed, explosive))
        pattern = {r["code"]: r["pattern_id"] for r in con.execute("SELECT code, pattern_id FROM movement_pattern")}

        for cat in CATEGORIES:
            con.execute("INSERT OR IGNORE INTO equipment_category (name) VALUES (?)", (cat,))
        category = {r["name"]: r["category_id"] for r in con.execute("SELECT name, category_id FROM equipment_category")}
        category_of = {code: category[c] for c, codes in CATEGORIES.items() for code in codes}
        for order, (code, name) in enumerate(data["equipment"].items(), 1):
            con.execute("""INSERT INTO equipment (code, name, category_id, sort_order) VALUES (?,?,?,?)
                           ON CONFLICT (code) DO UPDATE SET name=excluded.name, category_id=excluded.category_id,
                           sort_order=excluded.sort_order""", (code, name, category_of.get(code), order))
        equipment = {r["code"]: r["equipment_id"] for r in con.execute("SELECT code, equipment_id FROM equipment")}

        existing = {r["slug"] for r in con.execute("SELECT slug FROM exercise")}
        for ex in data["exercises"]:
            stats["updated" if ex["id"] in existing else "added"] += 1
            con.execute(
                """INSERT INTO exercise (slug, name, min_level_id, hold_seconds, is_combo, is_slow_to_fast, is_partner,
                                         is_sprint, switches_sides, is_active) VALUES (?,?,?,?,?,?,?,?,?,1)
                   ON CONFLICT (slug) DO UPDATE SET name=excluded.name, min_level_id=excluded.min_level_id,
                     hold_seconds=excluded.hold_seconds, is_combo=excluded.is_combo, is_slow_to_fast=excluded.is_slow_to_fast,
                     is_partner=excluded.is_partner, is_sprint=excluded.is_sprint, switches_sides=excluded.switches_sides,
                     is_active=1""",
                (ex["id"], ex["name"], ex.get("level"), ex.get("secs"), int(bool(ex.get("combo"))),
                 int(bool(ex.get("slow_to_fast"))), int(bool(ex.get("partner"))), int(bool(ex.get("sprint"))),
                 int(bool(ex.get("switch_sides")))))
            eid = con.execute("SELECT exercise_id FROM exercise WHERE slug = ?", (ex["id"],)).fetchone()[0]

            # Child rows are replaced wholesale; workouts reference only the exercise itself.
            for table in ("exercise_pattern", "exercise_step", "exercise_prescription", "exercise_requirement",
                          "exercise_setup_item", "exercise_phase_role"):
                con.execute(f"DELETE FROM {table} WHERE exercise_id = ?", (eid,))
            con.execute("INSERT INTO exercise_pattern VALUES (?,?,1)", (eid, pattern[ex["pattern"]]))
            if ex.get("also_pattern"):
                con.execute("INSERT INTO exercise_pattern VALUES (?,?,0)", (eid, pattern[ex["also_pattern"]]))
            con.execute("""INSERT INTO exercise_coaching VALUES (?,?,?,?) ON CONFLICT (exercise_id) DO UPDATE SET
                           cue=excluded.cue, avoid=excluded.avoid, setup_note=excluded.setup_note""",
                        (eid, ex["cue"], ex.get("avoid"), data.get("quantities", {}).get(ex["id"])))
            con.executemany("INSERT INTO exercise_step VALUES (?,?,?)",
                            [(eid, n, step) for n, step in enumerate(ex["steps"], 1)])
            if ex.get("level"):
                reps = ex["reps"]
                for lv in range(ex["level"], 5):
                    text = reps[lv - 1] if lv - 1 < len(reps) and reps[lv - 1] else next(r for r in reversed(reps) if r)
                    m = HOLD.match(text)
                    con.execute("INSERT INTO exercise_prescription VALUES (?,?,?,?,?)",
                                (eid, lv, text, int(m.group(1)) if m else None, int(bool(m and m.group(2)))))
            for pos, req in enumerate(ex.get("equipment", []), 1):
                rid = con.execute("INSERT INTO exercise_requirement (exercise_id, position) VALUES (?,?)", (eid, pos)).lastrowid
                con.executemany("INSERT INTO requirement_option VALUES (?,?,?)",
                                [(rid, equipment[alt], n) for n, alt in enumerate(req.split("|"), 1)])
            for pos, item in enumerate(data.get("extras", {}).get(ex["id"], []), 1):
                con.execute("INSERT OR IGNORE INTO setup_item (name) VALUES (?)", (item,))
                sid = con.execute("SELECT setup_item_id FROM setup_item WHERE name = ?", (item,)).fetchone()[0]
                con.execute("INSERT INTO exercise_setup_item VALUES (?,?,?)", (eid, sid, pos))

        slugs = [ex["id"] for ex in data["exercises"]]
        stats["retired"] = con.execute(
            f"UPDATE exercise SET is_active = 0 WHERE is_active = 1 AND slug NOT IN ({','.join('?' * len(slugs))})", slugs
        ).rowcount
        con.execute("DELETE FROM setup_item WHERE setup_item_id NOT IN (SELECT setup_item_id FROM exercise_setup_item)")

        role = {r["code"]: r["role_id"] for r in con.execute("SELECT code, role_id FROM phase_role")}
        ex_id = {r["slug"]: r["exercise_id"] for r in con.execute("SELECT slug, exercise_id FROM exercise")}
        for code, ids in phases.items():
            con.executemany("INSERT OR IGNORE INTO exercise_phase_role VALUES (?,?)",
                            [(ex_id[i], role[code]) for i in ids if i in ex_id])
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", default=str(DEFAULT_DB))
    parser.add_argument("--force", action="store_true", help="sync even if the database already has exercises")
    args = parser.parse_args()
    con = connect(args.db, create=True)
    if con.execute("SELECT count(*) FROM exercise").fetchone()[0] and not args.force:
        raise SystemExit(f"{args.db} already has exercises; the database, not exercises.json, is the source now.\n"
                         "Re-syncing would retire every exercise that isn't in the JSON. Use --force if you mean it.")
    stats = sync(con, json.loads(DATA_FILE.read_text(encoding="utf-8")))
    total = con.execute("SELECT count(*) FROM exercise WHERE is_active = 1").fetchone()[0]
    print(f"{args.db}: {total} active exercises "
          f"({stats['added']} added, {stats['updated']} updated, {stats['retired']} retired)")


if __name__ == "__main__":
    main()
