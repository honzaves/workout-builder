"""Run with: pytest"""
import copy
import json

from tools import build, validate


def test_exercise_data_is_valid():
    data = validate.load()
    app_js = validate.APP_FILE.read_text(encoding="utf-8")
    assert validate.validate(data, app_js) == []


def test_validator_catches_duplicate_ids():
    data = copy.deepcopy(validate.load())
    data["exercises"].append(copy.deepcopy(data["exercises"][-1]))
    assert any("duplicate id" in e for e in validate.validate(data))


def test_validator_catches_duplicate_names():
    data = copy.deepcopy(validate.load())
    twin = copy.deepcopy(data["exercises"][-1])
    twin["id"] = "twin-of-last"
    data["exercises"].append(twin)
    assert any("same name as" in e for e in validate.validate(data))


def test_validator_catches_unknown_equipment():
    data = copy.deepcopy(validate.load())
    data["exercises"][-1]["equipment"] = ["jetpack"]
    assert any("unknown equipment 'jetpack'" in e for e in validate.validate(data))


def test_validator_catches_missing_reps_for_own_level():
    data = copy.deepcopy(validate.load())
    ex = next(e for e in data["exercises"] if e.get("level") == 2)
    ex["reps"][1] = ""
    assert any("no reps given for its own level" in e for e in validate.validate(data))


def test_validator_checks_warmup_lists_in_app_js():
    data = validate.load()
    app_js = validate.APP_FILE.read_text(encoding="utf-8")
    assert any("unknown id 'no-such-move'" in e
               for e in validate.validate(data, app_js.replace('"high-knees"', '"no-such-move"')))
    assert any("isn't a 'warm' exercise" in e
               for e in validate.validate(data, app_js.replace('"high-knees"', '"pushup"')))


def test_database_schema_builds():
    import sqlite3
    from pathlib import Path
    con = sqlite3.connect(":memory:")
    con.executescript((Path(__file__).resolve().parent.parent / "db" / "schema.sql").read_text(encoding="utf-8"))
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert {"exercise", "workout", "workout_session", "session_rating", "session_evaluation", "workout_comment"} <= tables
    assert con.execute("SELECT count(*) FROM level").fetchone()[0] == 4


def test_build_produces_self_contained_html():
    out = build.build()
    html = out.read_text(encoding="utf-8")
    assert 'href="css/styles.css"' not in html
    assert 'src="js/app.js"' not in html
    assert "window.WORKOUT_DATA" in html
    # Fully offline: fonts embedded, nothing fetched from other sites.
    assert html.count("data:font/woff2;base64,") == 6
    assert "../fonts/" not in html and "googleapis" not in html
    # The inlined data must round-trip to the same exercise count.
    start = html.index("window.WORKOUT_DATA = ") + len("window.WORKOUT_DATA = ")
    end = html.index(";\n</script>", start)
    inlined = json.loads(html[start:end].replace("<\\/script", "</script"))
    assert len(inlined["exercises"]) == len(validate.load()["exercises"])
