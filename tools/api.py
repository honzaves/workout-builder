"""Workout storage for the app: save, list, open, delete and evaluate workouts.

Every function takes an open connection (see db_import.connect) and plain dicts in the
shapes the app sends and expects. Bad input raises ValueError; the server turns that
into a 400 response. Database constraints are the last line of defence.
"""
from __future__ import annotations

import sqlite3

GENERATOR_VERSION = "js-1"
KINDS = {"warmup", "course", "main", "grip", "cooldown"}


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
