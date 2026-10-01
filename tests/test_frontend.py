"""Front-end tests: tests/frontend/cases.js runs against the built app in headless Chrome.

Skipped when no Chrome or Chromium is found (set CHROME to its path to point at one).
The workout that cases.js converts with toDB() is also saved through api.save_workout
on a copy of the database, so both sides of the save format are checked together.
"""
import html
import json
import os
import re
import shutil
import subprocess
import threading
from pathlib import Path

import pytest

from tools import api, build, serve

ROOT = Path(__file__).resolve().parent.parent
CASES = ROOT / "tests" / "frontend" / "cases.js"
DRAFTS_E2E = ROOT / "tests" / "frontend" / "drafts_e2e.js"
CANDIDATES = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
              "/Applications/Chromium.app/Contents/MacOS/Chromium"]


def find_chrome() -> str | None:
    if os.environ.get("CHROME"):
        return os.environ["CHROME"]
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"):
        if found := shutil.which(name):
            return found
    return next((c for c in CANDIDATES if Path(c).exists()), None)


def with_script(folder: Path, name: str, script_file: Path) -> Path:
    """The built app with a test script appended, written to folder/name."""
    page = build.build().read_text(encoding="utf-8")
    script = "<script>" + script_file.read_text(encoding="utf-8").replace("</script", "<\\/script") + "</script>"
    head, _, tail = page.rpartition("</body>")
    (folder / name).write_text(head + script + "</body>" + tail, encoding="utf-8")
    return folder / name


def dump(chrome: str, url: str, pre_id: str):
    """Load url in headless Chrome and return the JSON the test script wrote into <pre id=pre_id>."""
    dom = subprocess.run(
        # No --user-data-dir: headless Chrome already uses a throwaway profile, and with one it hangs on exit.
        [chrome, "--headless=new", "--disable-gpu", "--virtual-time-budget=20000", "--dump-dom", url],
        capture_output=True, text=True, timeout=120).stdout
    found = re.findall(rf'<pre id="{pre_id}">(.*?)</pre>', dom, re.S)
    assert found, f"no results in <pre id={pre_id}> (a script error in app.js or the test script?)"
    return json.loads(html.unescape(found[-1]))


@pytest.fixture(scope="module")
def chrome():
    found = find_chrome()
    if not found:
        pytest.skip("Chrome or Chromium not found")
    return found


@pytest.fixture(scope="module")
def run(chrome, tmp_path_factory):
    tmp = tmp_path_factory.mktemp("frontend")
    return dump(chrome, with_script(tmp, "page.html", CASES).as_uri(), "fbw-results")


def test_frontend_cases_pass(run):
    results = run["results"]
    assert len(results) >= 10
    failed = [f"{r['name']}: {r['error']}" for r in results if not r["ok"]]
    assert not failed, "\n".join(failed)


def test_frontend_workout_saves_through_the_api(run, tmp_path):
    db = tmp_path / "workouts.db"
    shutil.copy(api.DEFAULT_DB, db)
    con = api.connect(db)
    sent = run["extra"]["toDB"]
    wid = api.save_workout(con, sent)
    got = api.get_workout(con, wid)
    assert got["name"] == "Front-end test"
    assert len(got["blocks"]) == len(sent["blocks"]) - 2  # warm-up and cool-down are returned separately
    assert [x["id"] for x in got["warm"]] == [i["id"] for i in sent["blocks"][0]["items"]]
    assert [x["id"] for x in got["cool"]] == [i["id"] for i in sent["blocks"][-1]["items"]]
    assert (got["v"], got["mode"], got["blocks"][0]["kind"]) == (2, "quick", "course")


def test_frontend_template_saves_with_mode_and_levels(run, tmp_path):
    db = tmp_path / "workouts.db"
    shutil.copy(api.DEFAULT_DB, db)
    con = api.connect(db)
    sent = run["extra"]["toDBTemplate"]
    got = api.get_workout(con, api.save_workout(con, sent))
    assert got["mode"] == "template"
    mains = [b for b in got["blocks"] if b["kind"] == "main"]
    assert mains and all(i.get("lv") == 2 for b in mains for i in b["items"])


def test_frontend_mix_saves_with_levels(run, tmp_path):
    db = tmp_path / "workouts.db"
    shutil.copy(api.DEFAULT_DB, db)
    con = api.connect(db)
    got = api.get_workout(con, api.save_workout(con, run["extra"]["toDBMix"]))
    assert got["mode"] == "mix"
    assert [i["lv"] for i in got["blocks"][0]["items"]] == [1, 2, 3, 4]


def test_template_drafts_end_to_end(chrome, tmp_path):
    """Save a draft, reopen it from Saved workouts, fill it and save it as a workout, against serve.py."""
    shutil.copy(api.DEFAULT_DB, tmp_path / "e2e.db")
    with_script(tmp_path, "e2e.html", DRAFTS_E2E)
    httpd = serve.make_server(tmp_path, 0, str(tmp_path / "e2e.db"))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        out = dump(chrome, f"http://127.0.0.1:{httpd.server_address[1]}/e2e.html", "e2e")
    finally:
        httpd.shutdown()
        httpd.server_close()
    assert "error" not in out, out.get("error")
    assert out["apiOn"] and out["draftId"] and out["listed"] and out["reopened"] and out["dirty"] is True
    assert out["savedId"] and out["draftsLeft"] == 0 and out["savedMode"] == "template"
