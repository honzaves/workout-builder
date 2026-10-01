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
from pathlib import Path

import pytest

from tools import api, build

ROOT = Path(__file__).resolve().parent.parent
CASES = ROOT / "tests" / "frontend" / "cases.js"
CANDIDATES = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
              "/Applications/Chromium.app/Contents/MacOS/Chromium"]


def find_chrome() -> str | None:
    if os.environ.get("CHROME"):
        return os.environ["CHROME"]
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"):
        if found := shutil.which(name):
            return found
    return next((c for c in CANDIDATES if Path(c).exists()), None)


@pytest.fixture(scope="module")
def run(tmp_path_factory):
    chrome = find_chrome()
    if not chrome:
        pytest.skip("Chrome or Chromium not found")
    tmp = tmp_path_factory.mktemp("frontend")
    page = build.build().read_text(encoding="utf-8")
    script = "<script>" + CASES.read_text(encoding="utf-8").replace("</script", "<\\/script") + "</script>"
    head, _, tail = page.rpartition("</body>")
    (tmp / "page.html").write_text(head + script + "</body>" + tail, encoding="utf-8")
    dom = subprocess.run(
        # No --user-data-dir: headless Chrome already uses a throwaway profile, and with one it hangs on exit.
        [chrome, "--headless=new", "--disable-gpu", "--virtual-time-budget=15000", "--dump-dom", (tmp / "page.html").as_uri()],
        capture_output=True, text=True, timeout=120).stdout
    found = re.findall(r'<pre id="fbw-results">(.*?)</pre>', dom, re.S)
    assert found, "cases.js wrote no results (a script error in app.js or cases.js?)"
    return json.loads(html.unescape(found[-1]))


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
    assert got["warm"] == [i["id"] for i in sent["blocks"][0]["items"]]
    assert got["cool"] == [i["id"] for i in sent["blocks"][-1]["items"]]
    assert got["blocks"][0].get("course") is True
