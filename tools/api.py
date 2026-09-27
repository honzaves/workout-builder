"""Database access for the app: the exercise catalogue, and saving, listing, opening,
deleting and evaluating workouts. The database (db/workouts.db) is the only source of
data the app uses.

Every function takes an open connection (see connect) and plain dicts in the
shapes the app sends and expects. Bad input raises ValueError; the server turns that
into a 400 response. Database constraints are the last line of defence.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_FILE = ROOT / "db" / "schema.sql"
DEFAULT_DB = ROOT / "db" / "workouts.db"
GENERATOR_VERSION = "js-1"
KINDS = {"warmup", "course", "main", "grip", "cooldown"}


def connect(path: Path | str = DEFAULT_DB, create: bool = False) -> sqlite3.Connection:
    """Open the database. With create=True a missing file is made from db/schema.sql;
    otherwise a missing file is an error, so nothing ever runs on an empty catalogue."""
    if sqlite3.sqlite_version_info < (3, 44):
        raise SystemExit(f"SQLite 3.44 or newer is needed; this Python has {sqlite3.sqlite_version}.")
    fresh = str(path) == ":memory:" or not Path(path).exists()
    if fresh and not create:
        raise SystemExit(f"Database {path} not found. It's kept in git; to rebuild it from the old "
                         "exercises.json snapshot, run: python3 tools/db_import.py")
    con = sqlite3.connect(path, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    if fresh:
        con.executescript(SCHEMA_FILE.read_text(encoding="utf-8"))
    return con


def catalog(con: sqlite3.Connection) -> dict:
    """The exercise catalogue, as the app reads it (GET /api/catalog, and inlined by build.py).

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
    phases = {r["code"]: [] for r in q("SELECT code FROM phase_role ORDER BY role_id")}
    for r in q("""SELECT p.code, e.slug FROM exercise_phase_role x JOIN phase_role p USING (role_id)
                  JOIN exercise e USING (exercise_id) ORDER BY p.role_id, e.exercise_id"""):
        phases[r["code"]].append(r["slug"])
    poses = {r["code"]: json.loads(r["pose"]) for r in q("SELECT code, pose FROM figure_pose ORDER BY pose_id")}
    figures = {}
    for r in q("""SELECT e.slug, f.first_step, f.last_step, f.scene FROM exercise_figure f JOIN exercise e USING (exercise_id)
                  ORDER BY e.exercise_id, f.figure_no"""):
        figures.setdefault(r["slug"], []).append({"steps": [r["first_step"], r["last_step"]], "scene": json.loads(r["scene"])})
    return {"equipment": equipment, "exercises": exercises, "extras": extras_out, "quantities": quantities,
            "levels": levels, "criteria": criteria, "phases": phases, "poses": poses, "figures": figures}


def _ids(con: sqlite3.Connection, table: str, key: str, col: str) -> dict[str, int]:
    return {r[0]: r[1] for r in con.execute(f"SELECT {key}, {col} FROM {table}")}


def save_workout(con: sqlite3.Connection, w: dict) -> int:
    """Store a generated workout under the name the user chose. Returns its id.

    Expected shape:
      {"name": str, "estimated_seconds": int,
       "settings": {"duration", "level", "plyo", "sprints", "combos", "course", "grip", "partner", "equip": [codes]},
       "blocks": [{"kind", "name", "rounds", "rest_ex", "rest_round",
                   "items": [{"id": slug, "pat": pattern code, "prescription", "hold", "est", "equipment": [codes]}]}]}
    """
    name = str(w.get("name") or "").strip()
    if not name:
        raise ValueError("Give the workout a name.")
    s = w["settings"]
    exercise = _ids(con, "exercise", "slug", "exercise_id")
    pattern = _ids(con, "movement_pattern", "code", "pattern_id")
    equipment = _ids(con, "equipment", "code", "equipment_id")
    try:
        with con:
            wid = con.execute(
                """INSERT INTO workout (name, level_id, duration_min, plyo_mode, sprint_mode, combo_mode, course_mode,
                                        grip_finisher, with_partner, estimated_seconds, generator_version)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (name, s["level"], s["duration"], s["plyo"], s.get("sprints", "some"), s["combos"], s["course"],
                 int(s["grip"] == "on"), int(s["partner"] == "on"), int(w["estimated_seconds"]), GENERATOR_VERSION),
            ).lastrowid
            con.executemany("INSERT INTO workout_offered_equipment VALUES (?,?)",
                            [(wid, equipment[c]) for c in s.get("equip", []) if c in equipment])
            for bpos, b in enumerate(w["blocks"], 1):
                if b["kind"] not in KINDS:
                    raise ValueError(f"Unknown block kind {b['kind']!r}.")
                bid = con.execute(
                    """INSERT INTO workout_block (workout_id, position, kind, name, rounds, rest_between_moves_s,
                                                  rest_between_rounds_s) VALUES (?,?,?,?,?,?,?)""",
                    (wid, bpos, b["kind"], b["name"], b["rounds"], b.get("rest_ex", 0), b.get("rest_round", 0)),
                ).lastrowid
                for ipos, it in enumerate(b["items"], 1):
                    if it["id"] not in exercise:
                        raise ValueError(f"Unknown exercise {it['id']!r}.")
                    iid = con.execute(
                        """INSERT INTO workout_item (block_id, position, exercise_id, slot_pattern_id, prescription,
                                                     hold_seconds, estimated_seconds) VALUES (?,?,?,?,?,?,?)""",
                        (bid, ipos, exercise[it["id"]], pattern[it["pat"]], str(it["prescription"]),
                         it.get("hold"), int(it["est"])),
                    ).lastrowid
                    con.executemany("INSERT OR IGNORE INTO workout_item_equipment VALUES (?,?)",
                                    [(iid, equipment[c]) for c in it.get("equipment", [])])
    except (KeyError, sqlite3.IntegrityError) as e:
        raise ValueError(f"Couldn't save the workout: {e}") from e
    return wid


def list_workouts(con: sqlite3.Connection) -> list[dict]:
    rows = con.execute(
        """SELECT w.workout_id AS id, w.name, w.created_at, w.level_id AS level, w.duration_min AS duration,
                  w.estimated_seconds, s.sessions, s.avg_stars,
                  (SELECT max(started_at) FROM workout_session x WHERE x.workout_id = w.workout_id) AS last_done
           FROM workout w JOIN v_workout_summary s USING (workout_id)
           ORDER BY w.created_at DESC, w.workout_id DESC""").fetchall()
    return [dict(r) for r in rows]


def get_workout(con: sqlite3.Connection, workout_id: int) -> dict:
    """A saved workout in the shape the app renders, plus its evaluations."""
    w = con.execute("SELECT * FROM workout WHERE workout_id = ?", (workout_id,)).fetchone()
    if not w:
        raise LookupError(f"No workout {workout_id}.")
    equip = [r[0] for r in con.execute(
        """SELECT e.code FROM workout_offered_equipment o JOIN equipment e USING (equipment_id)
           WHERE o.workout_id = ? ORDER BY e.sort_order""", (workout_id,))]
    out = {"id": w["workout_id"], "name": w["name"], "created_at": w["created_at"],
           "estimated_seconds": w["estimated_seconds"],
           "settings": {"duration": w["duration_min"], "level": w["level_id"], "plyo": w["plyo_mode"],
                        "sprints": w["sprint_mode"], "combos": w["combo_mode"], "course": w["course_mode"],
                        "grip": "on" if w["grip_finisher"] else "off", "partner": "on" if w["with_partner"] else "off",
                        "equip": equip},
           "warm": [], "cool": [], "blocks": []}
    for b in con.execute("SELECT * FROM workout_block WHERE workout_id = ? ORDER BY position", (workout_id,)).fetchall():
        items = [dict(r) for r in con.execute(
            """SELECT e.slug AS id, p.code AS pat FROM workout_item i
               JOIN exercise e USING (exercise_id) JOIN movement_pattern p ON p.pattern_id = i.slot_pattern_id
               WHERE i.block_id = ? ORDER BY i.position""", (b["block_id"],))]
        if b["kind"] == "warmup":
            out["warm"] = [i["id"] for i in items]
        elif b["kind"] == "cooldown":
            out["cool"] = [i["id"] for i in items]
        else:
            block = {"name": b["name"], "rounds": b["rounds"], "items": items}
            if b["kind"] == "course":
                block["course"] = True
            out["blocks"].append(block)
    out["sessions"] = list_sessions(con, workout_id)
    return out


def list_sessions(con: sqlite3.Connection, workout_id: int) -> list[dict]:
    sessions = []
    for s in con.execute(
            """SELECT s.session_id AS id, s.started_at, s.active_seconds, s.completed, s.time_feel, r.stars,
                      t.delta_seconds
               FROM workout_session s LEFT JOIN session_rating r USING (session_id)
               LEFT JOIN v_session_time t USING (session_id)
               WHERE s.workout_id = ? ORDER BY s.started_at DESC, s.session_id DESC""", (workout_id,)).fetchall():
        d = dict(s)
        d["scores"] = {r[0]: r[1] for r in con.execute(
            """SELECT c.code, e.score FROM session_evaluation e JOIN evaluation_criterion c USING (criterion_id)
               WHERE e.session_id = ?""", (s["id"],))}
        d["comments"] = [r[0] for r in con.execute(
            "SELECT body FROM workout_comment WHERE session_id = ? ORDER BY created_at", (s["id"],))]
        sessions.append(d)
    return sessions


def add_evaluation(con: sqlite3.Connection, workout_id: int, ev: dict) -> int:
    """Record one time you did the workout and how it went. Returns the session id.

    Shape: {"started_at": ISO text, "active_minutes": number, "completed": bool,
            "time_feel": "too_short"|"about_right"|"too_long", "stars": 1-5,
            "scores": {criterion code: 1-5}, "comment": str}
    Everything except started_at is optional.
    """
    if not con.execute("SELECT 1 FROM workout WHERE workout_id = ?", (workout_id,)).fetchone():
        raise LookupError(f"No workout {workout_id}.")
    criterion = _ids(con, "evaluation_criterion", "code", "criterion_id")
    minutes = ev.get("active_minutes")
    try:
        with con:
            sid = con.execute(
                """INSERT INTO workout_session (workout_id, started_at, active_seconds, completed, time_feel)
                   VALUES (?,?,?,?,?)""",
                (workout_id, ev["started_at"], None if minutes in (None, "") else round(float(minutes) * 60),
                 int(bool(ev.get("completed", True))), ev.get("time_feel") or None),
            ).lastrowid
            if ev.get("stars"):
                con.execute("INSERT INTO session_rating (session_id, stars) VALUES (?,?)", (sid, int(ev["stars"])))
            for code, score in (ev.get("scores") or {}).items():
                if code not in criterion:
                    raise ValueError(f"Unknown criterion {code!r}.")
                con.execute("INSERT INTO session_evaluation VALUES (?,?,?)", (sid, criterion[code], int(score)))
            comment = str(ev.get("comment") or "").strip()
            if comment:
                con.execute("INSERT INTO workout_comment (workout_id, session_id, body) VALUES (?,?,?)",
                            (workout_id, sid, comment))
    except (KeyError, sqlite3.IntegrityError) as e:
        raise ValueError(f"Couldn't save the evaluation: {e}") from e
    return sid


def delete_workout(con: sqlite3.Connection, workout_id: int) -> None:
    with con:
        if not con.execute("DELETE FROM workout WHERE workout_id = ?", (workout_id,)).rowcount:
            raise LookupError(f"No workout {workout_id}.")
