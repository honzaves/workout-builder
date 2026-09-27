"""Sync web/data/exercises.json into the SQLite database (db/workouts.db).

Safe to run any number of times: exercises are matched by their id (slug), so their
database ids stay the same and saved workouts keep pointing at the right exercise.
Exercises that disappear from the JSON are retired (is_active = 0), never deleted.

Usage:
    python tools/db_import.py                 # sync into db/workouts.db
    python tools/db_import.py --db other.db
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "web" / "data" / "exercises.json"
APP_FILE = ROOT / "web" / "js" / "app.js"
SCHEMA_FILE = ROOT / "db" / "schema.sql"
DEFAULT_DB = ROOT / "db" / "workouts.db"

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


def connect(path: Path | str = DEFAULT_DB) -> sqlite3.Connection:
    """Open the database, creating it from db/schema.sql if it doesn't exist yet."""
    if sqlite3.sqlite_version_info < (3, 44):
        raise SystemExit(f"SQLite 3.44 or newer is needed; this Python has {sqlite3.sqlite_version}.")
    path = Path(path) if str(path) != ":memory:" else path
    fresh = path == ":memory:" or not Path(path).exists()
    con = sqlite3.connect(path, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    if fresh:
        con.executescript(SCHEMA_FILE.read_text(encoding="utf-8"))
    return con


def phase_roles(app_js: str) -> dict[str, list[str]]:
    """The warm-up and cool-down id lists in generate(), e.g. {'pulse': ['jacks', ...]}."""
    return {var: re.findall(r'"([a-z0-9-]+)"', body)
            for var, body in re.findall(r"\b(pulse|flow|mob|stretch|yin|calm)=shuffle\(\[(.*?)\]", app_js)}


def sync(con: sqlite3.Connection, data: dict, app_js: str) -> dict[str, int]:
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
        for code, ids in phase_roles(app_js).items():
            con.executemany("INSERT OR IGNORE INTO exercise_phase_role VALUES (?,?)",
                            [(ex_id[i], role[code]) for i in ids if i in ex_id])
    return stats


def export_catalog(con: sqlite3.Connection) -> dict:
    """The catalogue in the same shape as exercises.json, which is what the app reads.

    Retired exercises are included (flagged "retired") so saved workouts that use them
    still display; the generator skips them.
    """
    q = lambda sql, *a: con.execute(sql, a).fetchall()
    equipment = {r["code"]: r["name"] for r in q("SELECT code, name FROM equipment ORDER BY sort_order, equipment_id")}
    patterns = {r["exercise_id"]: {} for r in q("SELECT exercise_id FROM exercise")}
    for r in q("""SELECT ep.exercise_id, p.code, ep.is_primary FROM exercise_pattern ep
                  JOIN movement_pattern p USING (pattern_id)"""):
        patterns[r["exercise_id"]]["pattern" if r["is_primary"] else "also_pattern"] = r["code"]
    steps, reps, reqs, extras = {}, {}, {}, {}
    for r in q("SELECT exercise_id, body FROM exercise_step ORDER BY exercise_id, step_no"):
        steps.setdefault(r["exercise_id"], []).append(r["body"])
    for r in q("SELECT exercise_id, level_id, prescription FROM exercise_prescription ORDER BY exercise_id, level_id"):
        reps.setdefault(r["exercise_id"], {})[r["level_id"]] = r["prescription"]
    for r in q("""SELECT r.exercise_id, r.position, group_concat(e.code, '|' ORDER BY o.preference) AS alts
                  FROM exercise_requirement r JOIN requirement_option o USING (requirement_id)
                  JOIN equipment e USING (equipment_id)
                  GROUP BY r.requirement_id ORDER BY r.exercise_id, r.position"""):
        reqs.setdefault(r["exercise_id"], []).append(r["alts"])
    for r in q("""SELECT x.exercise_id, s.name FROM exercise_setup_item x JOIN setup_item s USING (setup_item_id)
                  ORDER BY x.exercise_id, x.position"""):
        extras.setdefault(r["exercise_id"], []).append(r["name"])

    exercises, extras_out, quantities = [], {}, {}
    for r in q("""SELECT e.*, c.cue, c.avoid, c.setup_note FROM exercise e
                  JOIN exercise_coaching c USING (exercise_id) ORDER BY e.exercise_id"""):
        eid = r["exercise_id"]
        ex = {"id": r["slug"], "name": r["name"], **patterns[eid]}
        if r["min_level_id"]:
            ex["level"] = r["min_level_id"]
        if eid in reqs:
            ex["equipment"] = reqs[eid]
        if eid in reps:
            ex["reps"] = [reps[eid].get(lv, "") for lv in range(1, 5)]
        ex["steps"] = steps[eid]
        ex["cue"] = r["cue"]
        if r["avoid"]:
            ex["avoid"] = r["avoid"]
        for col, key in (("is_combo", "combo"), ("is_slow_to_fast", "slow_to_fast"), ("is_partner", "partner"),
                         ("is_sprint", "sprint"), ("switches_sides", "switch_sides")):
            if r[col]:
                ex[key] = True
        if r["hold_seconds"]:
            ex["secs"] = r["hold_seconds"]
        if not r["is_active"]:
            ex["retired"] = True
        exercises.append(ex)
        if eid in extras:
            extras_out[r["slug"]] = extras[eid]
        if r["setup_note"]:
            quantities[r["slug"]] = r["setup_note"]
    levels = [dict(r) for r in q("""SELECT level_id AS id, name, rest_between_moves_s AS ex,
                                    rest_between_rounds_s AS round, rounds_per_block AS rounds FROM level ORDER BY level_id""")]
    criteria = [dict(r) for r in q("""SELECT code, name, low_label AS low, high_label AS high
                                      FROM evaluation_criterion WHERE is_active = 1 ORDER BY criterion_id""")]
    return {"equipment": equipment, "exercises": exercises, "extras": extras_out, "quantities": quantities,
            "levels": levels, "criteria": criteria}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", default=str(DEFAULT_DB))
    args = parser.parse_args()
    con = connect(args.db)
    stats = sync(con, json.loads(DATA_FILE.read_text(encoding="utf-8")), APP_FILE.read_text(encoding="utf-8"))
    total = con.execute("SELECT count(*) FROM exercise WHERE is_active = 1").fetchone()[0]
    print(f"{args.db}: {total} active exercises "
          f"({stats['added']} added, {stats['updated']} updated, {stats['retired']} retired)")


if __name__ == "__main__":
    main()
