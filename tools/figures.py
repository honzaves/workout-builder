"""Movement drawings: load pose and drawing data into the database, and build review pages.

The drawings live in the database (figure_pose, exercise_figure; see docs/database.md) and
are drawn by the FIG section of web/js/app.js. This tool is the way to add or change them.

Usage:
    python3 tools/figures.py put drawings.json          # add/replace poses and drawings, then validate
    python3 tools/figures.py get back-squat             # print one exercise's drawings as JSON
    python3 tools/figures.py review                     # dist/figures-review.html, every exercise with drawings
    python3 tools/figures.py review --ids back-squat,pushup
    python3 tools/figures.py review --pattern squat     # one slot, including exercises still without drawings

A put file looks like this (both keys optional). Drawings listed for an exercise replace all
of its existing ones; poses are added or replaced by code:
    {"poses":   {"stand": {"hip": [0, 85], "t": 0, "ln": {"to": [0, 0]}}},
     "figures": {"back-squat": [{"steps": [1, 1], "scene": {"items": [{"fig": "stand"}]}}, ...]}}
If validation fails, nothing is written.
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import api  # noqa: E402
import build  # noqa: E402
import validate  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
APP_FILE = ROOT / "web" / "js" / "app.js"
CSS_FILE = ROOT / "web" / "css" / "styles.css"
OUT = ROOT / "dist" / "figures-review.html"


def put(con, data: dict) -> list[str]:
    """Write poses and drawings in one transaction; roll back and return the errors if the
    catalogue doesn't validate afterwards."""
    slug_id = {r["slug"]: r["exercise_id"] for r in con.execute("SELECT slug, exercise_id FROM exercise")}
    unknown = [s for s in data.get("figures", {}) if s not in slug_id]
    if unknown:
        return [f"unknown exercise id(s): {', '.join(unknown)}"]
    con.execute("BEGIN")
    try:
        for code, pose in data.get("poses", {}).items():
            con.execute("INSERT INTO figure_pose (code, pose) VALUES (?, ?) ON CONFLICT (code) DO UPDATE SET pose = excluded.pose",
                        (code, json.dumps(pose, separators=(",", ":"))))
        for slug, figs in data.get("figures", {}).items():
            con.execute("DELETE FROM exercise_figure WHERE exercise_id = ?", (slug_id[slug],))
            con.executemany("INSERT INTO exercise_figure VALUES (?, ?, ?, ?, ?)",
                            [(slug_id[slug], n, f["steps"][0], f["steps"][1], json.dumps(f["scene"], separators=(",", ":")))
                             for n, f in enumerate(figs, 1)])
        errors = validate.validate_figures(api.catalog(con))
    except Exception:
        con.execute("ROLLBACK")
        raise
    con.execute("ROLLBACK" if errors else "COMMIT")
    return errors


def engine_js() -> str:
    """The self-contained FIG section of app.js."""
    js = APP_FILE.read_text(encoding="utf-8")
    m = re.search(r"/\* ---------- Figures:.*?/\* ---------- end Figures ---------- \*/", js, re.S)
    if not m:
        raise SystemExit("Couldn't find the Figures section markers in web/js/app.js")
    return m.group(0)


PAGE_CSS = """
.wrap{max-width:1080px;margin:0 auto;padding:28px 18px 64px}
.rv{margin:0 0 36px}
.rv h2{font-size:28px;font-weight:700;margin:0 0 2px;line-height:1.1}
.rv .meta{font-size:14px;color:var(--muted);margin:0 0 10px}
.rv .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;list-style:none;margin:0;padding:0}
@media (max-width:720px){.rv .grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
.rv .grid li{background:var(--surface);border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:8px}
.rv .grid li.wide{grid-column:span 2}
.rv .cap{display:flex;gap:8px;font-size:14px;line-height:1.35;margin:0}
.rv .cap b{font-family:var(--font);font-weight:700;font-size:16px;line-height:1;color:var(--muted);min-width:12px}
.rv .none{font-size:15px;color:var(--muted);margin:0}
"""

PAGE_JS = """
const esc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
document.getElementById("list").innerHTML=DATA.exercises.map(ex=>{
  const figs=FIG.of(ex.id);
  return `<section class="rv" id="${ex.id}"><h2>${esc(ex.name)}</h2><p class="meta">${ex.id} · ${esc(ex.pattern)} · ${figs.length} drawing${figs.length===1?"":"s"}</p>`+
    (figs.length?`<ol class="grid">${figs.map(f=>`<li${f.top?' class="wide"':""}>${f.svg}${ex.steps.slice(f.steps[0]-1,f.steps[1]).map((s,i)=>`<p class="cap"><b>${f.steps[0]+i}</b>${esc(s)}</p>`).join("")}</li>`).join("")}</ol>`
      :`<p class="none">No drawings yet.</p>`)+`</section>`;
}).join("");
"""


def review(con, ids: list[str] | None = None, pattern: str | None = None, out: Path = OUT) -> Path:
    cat = api.catalog(con)
    exercises = [e for e in cat["exercises"] if not e.get("retired")]
    if ids:
        exercises = [e for e in exercises if e["id"] in ids]
    elif pattern:
        exercises = [e for e in exercises if pattern in (e["pattern"], e.get("also_pattern"))]
    else:
        exercises = [e for e in exercises if e["id"] in cat["figures"]]
    keep = {e["id"] for e in exercises}
    data = {"poses": cat["poses"], "figures": {k: v for k, v in cat["figures"].items() if k in keep},
            "exercises": [{k: e[k] for k in ("id", "name", "pattern", "steps")} for e in exercises]}
    css = build._embed_fonts(CSS_FILE.read_text(encoding="utf-8"))
    title = f"Drawings: {pattern}" if pattern else "Drawings review"
    page = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title><style>{css}{PAGE_CSS}</style></head>
<body><div class="wrap"><h1>{html.escape(title)}</h1>
<p class="lede">{len(exercises)} exercises, {sum(len(data["figures"].get(e["id"], [])) for e in exercises)} drawings, drawn by the FIG code in web/js/app.js from the database.</p>
<div id="list"></div></div>
<script>const DATA={build._safe_for_script(json.dumps(data, ensure_ascii=False, separators=(",", ":")))};
{build._safe_for_script(engine_js())}
{PAGE_JS}</script></body></html>"""
    out.parent.mkdir(exist_ok=True)
    out.write_text(page, encoding="utf-8")
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", default=str(api.DEFAULT_DB))
    sub = parser.add_subparsers(dest="cmd", required=True)
    p_put = sub.add_parser("put", help="add or replace poses and drawings from a JSON file")
    p_put.add_argument("file")
    p_get = sub.add_parser("get", help="print one exercise's drawings as JSON")
    p_get.add_argument("id")
    p_rev = sub.add_parser("review", help="build a review page of the drawings")
    p_rev.add_argument("--ids", help="comma-separated exercise ids")
    p_rev.add_argument("--pattern", help="every exercise in one slot, e.g. squat")
    p_rev.add_argument("--out", default=str(OUT))
    args = parser.parse_args()

    con = api.connect(args.db)
    con.isolation_level = None  # put() manages its own transaction
    if args.cmd == "put":
        errors = put(con, json.loads(Path(args.file).read_text(encoding="utf-8")))
        if errors:
            print(f"{len(errors)} problem(s); nothing was written:")
            for e in errors:
                print("  -", e)
            return 1
        cat = api.catalog(con)
        print(f"OK: {len(cat['poses'])} poses, {sum(map(len, cat['figures'].values()))} drawings "
              f"for {len(cat['figures'])} exercises")
    elif args.cmd == "get":
        print(json.dumps(api.catalog(con)["figures"].get(args.id, []), indent=1))
    else:
        path = review(con, args.ids.split(",") if args.ids else None, args.pattern, Path(args.out))
        print(f"Wrote {path.relative_to(ROOT) if path.is_relative_to(ROOT) else path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
