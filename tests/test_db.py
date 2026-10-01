"""Seeding from the historical JSON, the catalogue, workout storage and the HTTP API.

Every test runs on its own temporary database seeded from db/seed/exercises.json, so
the real db/workouts.db is never touched."""
import copy
import json
import re
import sqlite3
import threading
import urllib.request

import pytest

from tools import api, db_import, figures, serve, validate

DATA = json.loads(db_import.DATA_FILE.read_text(encoding="utf-8"))  # the historical snapshot
DATA_BY_ID = {e["id"]: e for e in DATA["exercises"]}


def effective_reps(ex: dict) -> list[str]:
    """Prescription per level 1-4 as the app resolves it ("" below the exercise's level)."""
    reps = ex.get("reps") or []
    out = []
    for lv in range(1, 5):
        if not ex.get("level") or lv < ex["level"]:
            out.append("")
        else:
            out.append(reps[lv - 1] if lv - 1 < len(reps) and reps[lv - 1] else next(r for r in reversed(reps) if r))
    return out


@pytest.fixture()
def con(tmp_path):
    c = api.connect(tmp_path / "test.db", create=True)
    db_import.sync(c, DATA)
    yield c
    c.close()


def sample_workout(con, name="Tuesday legs"):
    """A small valid workout in the shape the app sends."""
    return {
        "name": name, "estimated_seconds": 1800,
        "settings": {"blocks": 2, "level": 2, "plyo": "some", "sprints": "some", "combos": "some",
                     "course": "off", "grip": "off", "partner": "off", "equip": ["db", "box"]},
        "blocks": [
            {"kind": "warmup", "name": "Warm-up", "rounds": 1,
             "items": [{"id": "jacks", "pat": "warm", "prescription": "40s", "hold": 40, "est": 40}]},
            {"kind": "main", "name": "Block A", "rounds": 3, "rest_ex": 20, "rest_round": 75,
             "items": [{"id": "box-jump", "pat": "plyoL", "prescription": "6", "est": 40, "equipment": ["box"]},
                       {"id": "goblet", "pat": "squat", "prescription": "10", "est": 40, "equipment": ["db"]}]},
            {"kind": "cooldown", "name": "Cool-down", "rounds": 1,
             "items": [{"id": "child", "pat": "cool", "prescription": "120s", "hold": 120, "est": 120}]},
        ],
    }


def test_import_loads_every_exercise(con):
    assert con.execute("SELECT count(*) FROM exercise WHERE is_active = 1").fetchone()[0] == len(DATA["exercises"])
    steps = sum(len(e["steps"]) for e in DATA["exercises"])
    assert con.execute("SELECT count(*) FROM exercise_step").fetchone()[0] == steps


def test_catalog_round_trips_to_the_json(con):
    out = {e["id"]: e for e in api.catalog(con)["exercises"]}
    for ex in DATA["exercises"]:
        got = out[ex["id"]]
        for key in ("name", "pattern", "also_pattern", "level", "equipment", "steps", "cue", "avoid",
                    "combo", "slow_to_fast", "partner", "sprint", "secs", "switch_sides"):
            empty = (None, [], "", False)  # an empty list and a missing key mean the same
            assert (got.get(key) if got.get(key) not in empty else None) == \
                   (ex.get(key) if ex.get(key) not in empty else None), (ex["id"], key)
        assert effective_reps(got) == effective_reps(ex), ex["id"]
    exported = api.catalog(con)
    assert exported["equipment"] == DATA["equipment"]
    assert exported["extras"] == {k: v for k, v in DATA["extras"].items() if v}
    assert exported["quantities"] == DATA["quantities"]


def test_reimport_is_idempotent_and_keeps_saved_workouts(con):
    ids_before = dict(con.execute("SELECT slug, exercise_id FROM exercise"))
    wid = api.save_workout(con, sample_workout(con))
    db_import.sync(con, DATA)
    assert dict(con.execute("SELECT slug, exercise_id FROM exercise")) == ids_before
    assert api.get_workout(con, wid)["blocks"][0]["items"][0]["id"] == "box-jump"


def test_removed_exercise_is_retired_not_deleted(con):
    wid = api.save_workout(con, sample_workout(con))
    data = copy.deepcopy(DATA)
    data["exercises"] = [e for e in data["exercises"] if e["id"] != "goblet"]
    stats = db_import.sync(con, data)
    assert stats["retired"] == 1
    assert con.execute("SELECT is_active FROM exercise WHERE slug = 'goblet'").fetchone()[0] == 0
    assert any(i["id"] == "goblet" for b in api.get_workout(con, wid)["blocks"] for i in b["items"])
    retired = next(e for e in api.catalog(con)["exercises"] if e["id"] == "goblet")
    assert retired["retired"] is True


def test_save_open_evaluate_and_delete(con):
    wid = api.save_workout(con, sample_workout(con))
    w = api.get_workout(con, wid)
    assert w["name"] == "Tuesday legs"
    assert w["warm"] == [{"id": "jacks", "role": "pulse"}] and w["cool"] == [{"id": "child", "role": "yin"}]
    assert w["settings"]["equip"] == ["db", "box"]

    api.add_evaluation(con, wid, {"started_at": "2026-09-27T17:00:00Z", "active_minutes": 34, "completed": True,
                                  "time_feel": "too_long", "stars": 4,
                                  "scores": {"difficulty": 4, "enjoyment": 5, "variety": 3, "flow": 4, "fit": 5},
                                  "comment": "Good one"})
    s = api.get_workout(con, wid)["sessions"][0]
    assert s["stars"] == 4 and s["scores"]["enjoyment"] == 5 and s["comments"] == ["Good one"]
    assert s["delta_seconds"] == 34 * 60 - 1800
    listed = api.list_workouts(con)[0]
    assert listed["name"] == "Tuesday legs" and listed["sessions"] == 1 and listed["avg_stars"] == 4

    api.delete_workout(con, wid)
    assert api.list_workouts(con) == []
    assert con.execute("SELECT count(*) FROM workout_session").fetchone()[0] == 0


@pytest.mark.parametrize("change, message", [
    (lambda w: w.update(name="   "), "name"),
    (lambda w: w["blocks"][1]["items"][0].update(id="no-such-move"), "Unknown exercise"),
    (lambda w: w["blocks"][1]["items"][0].update(equipment=["ghd"]), "not an option"),
    (lambda w: w["blocks"][1]["items"][0].update(id=None), "empty slots"),
    (lambda w: w.update(mode="freestyle"), "Unknown mode"),
    (lambda w: w["blocks"][1]["items"][0].update(level=7), "Couldn't save"),
])
def test_save_rejects_bad_workouts(con, change, message):
    w = sample_workout(con)
    change(w)
    with pytest.raises(ValueError, match=message):
        api.save_workout(con, w)
    assert api.list_workouts(con) == []


def test_saved_workout_comes_back_as_version_2(con):
    w = sample_workout(con)
    w["mode"] = "template"
    w["blocks"][1]["items"][1]["level"] = 4
    w["blocks"].insert(1, {"kind": "course", "name": "Obstacle course", "rounds": 1, "rest_ex": 0, "rest_round": 90,
                           "items": [{"id": "box-jump", "pat": "course", "prescription": "4 runs", "est": 40}]})
    got = api.get_workout(con, api.save_workout(con, w))
    assert (got["v"], got["mode"]) == (2, "template")
    assert [b["kind"] for b in got["blocks"]] == ["course", "main"]
    assert "rest" not in got["blocks"][0]
    assert got["blocks"][1]["rest"] == {"ex": 20, "round": 75}
    assert got["blocks"][1]["items"] == [{"id": "box-jump", "pat": "plyoL"}, {"id": "goblet", "pat": "squat", "lv": 4}]
    assert api.list_workouts(con)[0]["mode"] == "template"


def draft_doc(**change):
    doc = {"v": 2, "mode": "template", "settings": {"blocks": 1, "level": 2},
           "warm": [{"id": "jacks", "role": "pulse"}, {"id": None, "role": "mob"}],
           "cool": [{"id": None, "role": "calm"}],
           "blocks": [{"kind": "main", "name": "Block A", "rounds": 3, "rest": {"ex": 20, "round": 75},
                       "items": [{"id": "goblet", "pat": "squat", "lv": 3}, {"id": None, "pat": "push", "lv": None}]}]}
    doc.update(change)
    return doc


def test_drafts_save_list_open_update_delete(con):
    did = api.save_draft(con, {"name": " Thursday plan ", "doc": draft_doc()})
    listed = api.list_drafts(con)
    assert [(d["id"], d["name"], d["slots"], d["empty"]) for d in listed] == [(did, "Thursday plan", 5, 3)]
    assert api.get_draft(con, did)["doc"] == draft_doc()
    full = draft_doc(warm=[{"id": "jacks", "role": "pulse"}], cool=[])
    full["blocks"][0]["items"] = [{"id": "goblet", "pat": "squat", "lv": 3}]
    api.update_draft(con, did, {"name": "Thursday", "doc": full})
    assert (api.list_drafts(con)[0]["name"], api.list_drafts(con)[0]["empty"]) == ("Thursday", 0)
    api.delete_draft(con, did)
    assert api.list_drafts(con) == []
    with pytest.raises(LookupError):
        api.get_draft(con, did)
    with pytest.raises(LookupError):
        api.update_draft(con, did, {"name": "x", "doc": draft_doc()})


@pytest.mark.parametrize("draft, message", [
    ({"name": "", "doc": draft_doc()}, "name"),
    ({"name": "x", "doc": {"warm": []}}, "version 2"),
    ({"name": "x", "doc": draft_doc(v=1)}, "version 2"),
    ({"name": "x", "doc": draft_doc(warm=[{"id": "no-such-move", "role": "pulse"}])}, "Unknown exercise"),
])
def test_bad_drafts_are_rejected(con, draft, message):
    with pytest.raises(ValueError, match=message):
        api.save_draft(con, draft)
    assert api.list_drafts(con) == []


def test_migration_003_keeps_existing_workouts(tmp_path):
    """Rebuild the schema as it was before 003, store a workout the old way, then migrate."""
    old = api.SCHEMA_FILE.read_text(encoding="utf-8")
    old = re.sub(r",\n    mode +TEXT[^\n]*\n", "\n", old, count=1)
    old = re.sub(r"\n    level_id +INTEGER REFERENCES level[^\n]*", "", old, count=1)
    old = re.sub(r"CREATE TABLE workout_draft \(.*?\) STRICT;\n", "", old, count=1, flags=re.S)
    workout_table = old.split("CREATE TABLE workout (")[1].split(") STRICT")[0]
    assert "workout_draft" not in old and "\n    mode " not in workout_table and "level_id           INTEGER REFERENCES" not in old
    db = tmp_path / "old.db"
    raw = sqlite3.connect(db)
    raw.executescript(old)
    raw.close()
    con = api.connect(db)
    db_import.sync(con, DATA)
    with con:
        wid = con.execute("""INSERT INTO workout (name, level_id, block_count, plyo_mode, sprint_mode, combo_mode,
                             course_mode, grip_finisher, with_partner, estimated_seconds, generator_version)
                             VALUES ('Old one', 2, 1, 'some', 'some', 'some', 'off', 0, 0, 600, 'js-1')""").lastrowid
        bid = con.execute("INSERT INTO workout_block (workout_id, position, kind, name, rounds) VALUES (?, 1, 'main', 'Block A', 3)",
                          (wid,)).lastrowid
        con.execute("""INSERT INTO workout_item (block_id, position, exercise_id, slot_pattern_id, prescription, estimated_seconds)
                       SELECT ?, 1, e.exercise_id, p.pattern_id, '10', 40 FROM exercise e, movement_pattern p
                       WHERE e.slug = 'goblet' AND p.code = 'squat'""", (bid,))
    con.executescript((api.ROOT / "db" / "migrations" / "003_workout_modes.sql").read_text(encoding="utf-8"))
    got = api.get_workout(con, wid)
    assert (got["mode"], got["blocks"][0]["items"]) == ("quick", [{"id": "goblet", "pat": "squat"}])
    assert api.save_draft(con, {"name": "after migration", "doc": draft_doc()})
    assert con.execute("PRAGMA foreign_key_check").fetchall() == []


def test_evaluation_rejects_out_of_range_scores(con):
    wid = api.save_workout(con, sample_workout(con))
    with pytest.raises(ValueError):
        api.add_evaluation(con, wid, {"started_at": "2026-09-27T17:00:00Z", "stars": 6})
    with pytest.raises(ValueError):
        api.add_evaluation(con, wid, {"started_at": "2026-09-27T17:00:00Z", "scores": {"enjoyment": 0}})
    assert api.get_workout(con, wid)["sessions"] == []


def test_seeded_catalog_is_valid_and_has_the_phase_lists(con):
    cat = api.catalog(con)
    assert validate.validate(cat) == []
    assert cat["phases"] == {k: sorted(v, key=[e["id"] for e in DATA["exercises"]].index)
                             for k, v in db_import.PHASES.items()}
    assert [lv["name"] for lv in cat["levels"]] == ["Beginner", "Intermediate", "Advanced", "Beast"]


def test_nothing_runs_on_a_missing_or_empty_database(tmp_path):
    with pytest.raises(SystemExit, match="not found"):
        api.connect(tmp_path / "missing.db")
    assert not (tmp_path / "missing.db").exists()
    api.connect(tmp_path / "empty.db", create=True).close()
    with pytest.raises(SystemExit, match="no exercises"):
        serve.make_server(serve.ROOT / "web", 0, str(tmp_path / "empty.db"))


def test_seed_script_refuses_to_overwrite_a_filled_database(con, tmp_path, monkeypatch):
    monkeypatch.setattr("sys.argv", ["db_import.py", "--db", str(tmp_path / "test.db")])
    with pytest.raises(SystemExit, match="already has exercises"):
        db_import.main()


def test_http_api(tmp_path):
    seeded = api.connect(tmp_path / "http.db", create=True)
    db_import.sync(seeded, DATA)
    seeded.close()
    httpd = serve.make_server(serve.ROOT / "web", 0, str(tmp_path / "http.db"))
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    def call(method, path, body=None):
        req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", method=method,
                                     data=json.dumps(body).encode() if body is not None else None,
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    try:
        status, catalog = call("GET", "/api/catalog")
        assert status == 200 and len(catalog["exercises"]) == len(DATA["exercises"])
        assert [c["code"] for c in catalog["criteria"]] == ["difficulty", "enjoyment", "variety", "flow", "fit"]
        status, saved = call("POST", "/api/workouts", sample_workout(None, "HTTP test"))
        assert status == 201
        assert call("GET", "/api/workouts")[1][0]["name"] == "HTTP test"
        assert call("POST", f"/api/workouts/{saved['id']}/evaluations",
                    {"started_at": "2026-09-27T17:00:00Z", "stars": 5})[0] == 201
        assert call("GET", f"/api/workouts/{saved['id']}")[1]["sessions"][0]["stars"] == 5
        assert call("POST", "/api/workouts", {"name": ""})[0] == 400
        assert call("GET", "/api/workouts/999")[0] == 404
        assert call("DELETE", f"/api/workouts/{saved['id']}")[0] == 200
        status, draft = call("POST", "/api/drafts", {"name": "HTTP draft", "doc": draft_doc()})
        assert status == 201
        assert call("GET", "/api/drafts")[1][0]["empty"] == 3
        assert call("PUT", f"/api/drafts/{draft['id']}", {"name": "Renamed", "doc": draft_doc()})[0] == 200
        assert call("GET", f"/api/drafts/{draft['id']}")[1]["name"] == "Renamed"
        assert call("PUT", "/api/drafts/999", {"name": "x", "doc": draft_doc()})[0] == 404
        assert call("POST", "/api/drafts", {"name": "x", "doc": {}})[0] == 400
        assert call("DELETE", f"/api/drafts/{draft['id']}")[0] == 200
        assert call("GET", "/api/drafts")[1] == []
    finally:
        httpd.shutdown()
        httpd.server_close()


SAMPLE_FIGURES = {
    "poses": {"stand": {"hip": [0, 85], "t": 0, "ln": {"to": [0, 0]}},
              "squat": {"hip": [-22, 36], "t": 45, "ln": {"to": [0, 0]}}},
    "figures": {"goblet": [{"steps": [1, 2], "scene": {"items": [{"fig": "stand"}]}},
                           {"steps": [3, 4], "scene": {"items": [{"fig": "stand", "ghost": True},
                                                                 {"fig": {"pose": "squat", "hi": ["torso"]}},
                                                                 {"arrow": [[30, 130], [30, 80]]}]}}]},
}


def test_drawings_round_trip_through_the_catalog(con):
    con.isolation_level = None
    assert len(DATA_BY_ID["goblet"]["steps"]) == 4
    assert figures.put(con, SAMPLE_FIGURES) == []
    cat = api.catalog(con)
    assert cat["poses"]["stand"] == SAMPLE_FIGURES["poses"]["stand"]
    assert cat["figures"]["goblet"] == SAMPLE_FIGURES["figures"]["goblet"]
    assert validate.validate(cat) == []


@pytest.mark.parametrize("change, message", [
    (lambda d: d["figures"]["goblet"][1].update(steps=[3, 3]), "cover steps 1-3 of 4"),
    (lambda d: d["figures"]["goblet"][1].update(steps=[4, 4]), "expected to start at step 3"),
    (lambda d: d["figures"]["goblet"][0]["scene"]["items"].append({"fig": "no-such-pose"}), "unknown pose 'no-such-pose'"),
    (lambda d: d["figures"]["goblet"][0]["scene"]["items"].append({"arrow": [[0, 0]]}), "2 or more"),
    (lambda d: d["poses"]["stand"].update(ln={"to": [0, 0], "bend": "sideways"}), "bend must be"),
    (lambda d: d["figures"]["goblet"][0]["scene"]["items"].append({"fig": "stand", "kb": [0, 0]}), "exactly one of"),
])
def test_bad_drawings_are_rejected_and_nothing_is_written(con, change, message):
    con.isolation_level = None
    data = copy.deepcopy(SAMPLE_FIGURES)
    change(data)
    errors = figures.put(con, data)
    assert any(message in e for e in errors), errors
    assert api.catalog(con)["figures"] == {} and api.catalog(con)["poses"] == {}


def test_review_page_uses_the_drawing_code_from_app_js(con, tmp_path):
    con.isolation_level = None
    figures.put(con, SAMPLE_FIGURES)
    html = figures.review(con, out=tmp_path / "review.html").read_text(encoding="utf-8")
    assert "const FIG=" in html and '"goblet"' in html and "data:font/woff2;base64," in html
