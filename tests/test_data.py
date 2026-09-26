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


def test_validator_catches_unknown_equipment():
    data = copy.deepcopy(validate.load())
    data["exercises"][-1]["equipment"] = ["jetpack"]
    assert any("unknown equipment 'jetpack'" in e for e in validate.validate(data))


def test_validator_catches_missing_reps_for_own_level():
    data = copy.deepcopy(validate.load())
    ex = next(e for e in data["exercises"] if e.get("level") == 2)
    ex["reps"][1] = ""
    assert any("no reps given for its own level" in e for e in validate.validate(data))


def test_build_produces_self_contained_html():
    out = build.build()
    html = out.read_text(encoding="utf-8")
    assert 'href="css/styles.css"' not in html
    assert 'src="js/app.js"' not in html
    assert "window.WORKOUT_DATA" in html
    # The inlined data must round-trip to the same exercise count.
    start = html.index("window.WORKOUT_DATA = ") + len("window.WORKOUT_DATA = ")
    end = html.index(";\n</script>", start)
    inlined = json.loads(html[start:end].replace("<\\/script", "</script"))
    assert len(inlined["exercises"]) == len(validate.load()["exercises"])
