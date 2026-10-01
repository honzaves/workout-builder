"""Build the UI redesign package: dist/redesign/ and dist/redesign-package.zip.

Everything a designer (or Claude Design) needs to redesign the app without access to this repo:
the brief (docs/redesign/SPEC.md), screenshots of every screen and state at laptop and phone
size in light and dark, real content (sample exercises and workouts, catalogue numbers),
the movement drawings as standalone SVGs, the current tokens, fonts and source files, and a
working copy of the app.

The screenshots come from the built app, served with a temporary copy of the database
(seeded with a few saved workouts, evaluations and a draft), with Math.random fixed so
every run produces the same workouts. db/workouts.db is never written.

Needs Playwright and an installed Google Chrome (not part of the app's dependencies):
    uv run --with playwright python tools/redesign_package.py
"""
from __future__ import annotations

import json
import re
import shutil
import statistics
import sys
import tempfile
import threading
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import api  # noqa: E402
import build  # noqa: E402
import serve  # noqa: E402

OUT = ROOT / "dist" / "redesign"
ZIP = ROOT / "dist" / "redesign-package.zip"
SPEC = ROOT / "docs" / "redesign" / "SPEC.md"

VIEWPORTS = {
    "laptop": dict(viewport={"width": 1440, "height": 900}, device_scale_factor=2),
    "phone": dict(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True),
}
THEMES = ("light", "dark")
EQUIP = ["db", "kb", "box", "band", "bar", "med", "bench", "trx", "rings"]
SETTINGS = {"mode": "quick", "blocks": 3, "level": 3, "plyo": "some", "sprints": "some", "combos": "some",
            "grip": "on", "partner": "off", "course": "one", "equip": EQUIP}

# Runs before the app on every page: fixed random numbers, no blocking dialogs, no smooth scrolling.
INIT = """(()=>{let s=20261001;Math.random=()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);
window.confirm=()=>true; window.alert=()=>{}; Element.prototype.scrollIntoView=function(){};
if(!sessionStorage.getItem('init')){localStorage.clear();localStorage.setItem('fbw-settings',JSON.stringify(%s));sessionStorage.setItem('init','1')}
})()""" % json.dumps(SETTINGS)

# Helpers available to the state scripts as R.*
HELPERS = """window.R={
  q:s=>document.querySelector(s),
  qa:s=>[...document.querySelectorAll(s)],
  sec:t=>[...document.querySelectorAll('#plan section')].find(x=>x.querySelector('h2')?.textContent===t),
  top:e=>{e=typeof e==='string'?document.querySelector(e):e; scrollTo(0,e.getBoundingClientRect().top+scrollY-12)},
  click:s=>document.querySelector(s).click(),
  mode:m=>document.querySelector(`[data-key="mode"] [data-v="${m}"]`).click(),
  blur:()=>document.activeElement&&document.activeElement.blur(),
  mainAt:()=>FBW.W.blocks.findIndex(b=>b.kind==='main'),
  skipUntil:f=>{for(let k=0;k<400&&!f();k++) document.getElementById('fskip').click(); return f()},
};"""

# (file name, description, script). Scripts run in order in one page; they may return False to skip the shot.
STATES = [
    ("01-settings-generate", "Start screen, mode 'Generate it': all settings, nothing built yet.",
     "R.mode('quick'); scrollTo(0,0)"),
    ("02-settings-levels", "Mode 'Generate, levels 1 to 4': same settings, Level relabelled.",
     "R.mode('mix'); scrollTo(0,0)"),
    ("03-settings-template", "Mode 'Put it together myself': generator-only settings hidden, labels changed, 'Create template'.",
     "R.mode('template'); scrollTo(0,0)"),
    ("04-plan-top", "A generated workout: time estimate, timeline strip, actions, save form, equipment checklist.",
     "R.mode('quick'); R.click('#build'); R.top('#plan')"),
    ("05-plan-warmup-course", "Warm-up list and obstacle course block (rows with Swap / Choose).",
     "R.top(R.sec('Warm-up'))"),
    ("06-plan-block", "A main block: note with rounds and rest, rows with tags (Plyo, Combo, Partner …).",
     "R.top(R.sec('Block A'))"),
    ("07-plan-move-open", "A move expanded: drawings strip (2-4 drawings, captioned with steps), numbered steps, cue, avoid.",
     "const d=R.sec('Block A').querySelector('details'); d.open=true; R.top(d)"),
    ("08-plan-cooldown", "Grip finisher and cool-down (yin holds), footer safety note.",
     "R.top(R.sec('Grip finisher')||R.sec('Cool-down'))"),
    ("09-plan-levels", "'Generate, levels 1 to 4': each block runs Beginner → Beast, level shown per move.",
     "R.mode('mix'); R.click('#build'); R.top(R.sec('Block A'))"),
    ("10-template-top", "A new template: every slot empty, status line, Fill the rest, draft save form.",
     "R.mode('template'); R.click('#build'); R.top('#plan')"),
    ("11-template-warmup", "Template warm-up: move counter, empty slots with Choose / Auto, insert bar.",
     "R.top(R.sec('Warm-up'))"),
    ("12-template-block", "Template block: rounds stepper, rest select, move/remove block, slots with ↑ ↓ ×, + Exercise.",
     "const at=R.mainAt(); ['w-0','w-1','w-2',`${at}-0`,`${at}-2`].forEach(w=>R.click(`#plan [data-act=\"auto\"][data-where=\"${w}\"]`)); R.blur(); R.top(R.sec('Block A'))"),
    ("13-template-draft", "Template after Save draft: draft label, partially filled.",
     "R.q('#wname').value='Thursday plan'; R.click('#saveDraft'); return 'wait:FBW.W&&FBW.W.draftId&&!FBW.W.dirty'"),
    ("13-template-draft", None, "R.blur(); R.top('#plan')"),
    ("14-picker-list", "Exercise picker (Choose): search, category / tag / level chips, list with drawing thumbnails.",
     "R.click(`.choose[data-choose=\"${R.mainAt()}-1\"]`)"),
    ("15-picker-detail", "Picker detail: drawings, cue, level buttons with reps per level, Use this.",
     "R.qa('.prow')[2].click()"),
    ("16-picker-empty", "Picker with a search that finds nothing.",
     "R.click('#pBack'); const q=R.q('#pQ'); q.value='zzzz'; q.dispatchEvent(new Event('input'))"),
    ("17-follow-warmup", "Follow-along overlay: a timed warm-up move with the countdown.",
     "R.click('#pClose'); R.mode('quick'); R.click('#build'); R.click('#start')"),
    ("18-follow-set", "Follow-along: a set with reps ('Set done'), section and round label.",
     "return R.skipUntil(()=>R.q('#fprimary').textContent==='Set done')"),
    ("19-follow-rest", "Follow-along: rest between moves with 'Next up'.",
     "return R.skipUntil(()=>R.q('#fprimary').textContent==='Skip rest')"),
    ("20-follow-hold", "Follow-along: a timed hold ('Start 30s timer').",
     "return R.skipUntil(()=>/^Start /.test(R.q('#fprimary').textContent))"),
    ("21-follow-finished", "Follow-along finished.",
     "return R.skipUntil(()=>R.q('#fpos').textContent==='Done')"),
    ("22-saved-list", "Saved workouts: drafts first, then saved workouts with evaluations and stars.",
     "R.click('#fclose'); scrollTo(0,0); return 'wait:document.getElementById(\"savedBox\")'"),
    ("22-saved-list", None, "R.q('#savedBox').open=true; R.top('#saved')"),
    ("23-saved-open", "A saved workout opened: 'Saved as … Evaluate it'.",
     "R.qa('#savedBox li').find(l=>l.textContent.includes('Tuesday strength')).querySelector('[data-open]').click(); return 'wait:FBW.W&&FBW.W.savedId&&FBW.W.sessions'"),
    ("23-saved-open", None, "R.top('#plan')"),
    ("24-saved-evaluations", "Evaluations of a saved workout: date, stars, time vs estimate, scores, comment.",
     "R.top(R.sec('Your evaluations'))"),
    ("25-evaluation-dialog", "Evaluation dialog: date, minutes, finished, length feel, stars, five 1-5 scores, comment.",
     "R.click('#evalBtn')"),
]
FULL_PAGE = {"04-plan-top": "plan-generated", "09-plan-levels": "plan-levels", "13-template-draft": "template-partial"}

SEED = """async()=>{
  const F=FBW, post=async(path,body)=>(await (await fetch('api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json());
  const s={...F.S};
  const a=await post('workouts',F.toDB(F.genQuick({...s,level:3}),'Tuesday strength'));
  const ev=(d,min,stars,feel,scores,comment,done=true)=>post(`workouts/${a.id}/evaluations`,{started_at:d,active_minutes:min,completed:done,time_feel:feel,stars,scores,comment});
  await ev('2026-09-22T17:30:00Z',52,4,'about_right',{difficulty:4,enjoyment:5,variety:4,flow:3,fit:5},'Great flow, the armor complex took longest.');
  await ev('2026-09-29T07:10:00Z',48,5,'too_long',{difficulty:5,enjoyment:4,variety:5,flow:4,fit:5},'Shortened the lizard crawl; still felt strong.');
  const b=await post('workouts',F.toDB(F.genMix({...s,level:2,blocks:2}),'Levels ladder'));
  await post(`workouts/${b.id}/evaluations`,{started_at:'2026-09-30T18:00:00Z',active_minutes:41,completed:false,time_feel:'too_short',stars:3,scores:{difficulty:3},comment:''});
  const t=F.genTemplate({...s,blocks:2}); F.autoFill(t,t.warm[0],'warm'); F.autoFill(t,t.blocks[1].items[0],'main');
  await post('drafts',{name:'Saturday partner session',doc:t});
}"""


def capture(base_url: str, out: Path) -> dict:
    from playwright.sync_api import sync_playwright  # only needed here
    samples, log = {}, []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome")
        seed = browser.new_page()
        seed.add_init_script(INIT)
        seed.goto(base_url)
        seed.evaluate(SEED)
        seed.close()
        for vp, opts in VIEWPORTS.items():
            for theme in THEMES:
                ctx = browser.new_context(color_scheme=theme, **opts)
                ctx.add_init_script(INIT)
                page = ctx.new_page()
                page.goto(base_url)
                page.wait_for_function("window.FBW && !document.getElementById('saved').hidden")
                page.evaluate(HELPERS)
                folder = out / "screens" / f"{vp}-{theme}"
                folder.mkdir(parents=True, exist_ok=True)
                for name, _desc, script in STATES:
                    try:
                        res = page.evaluate(f"(()=>{{{script}}})()")
                    except Exception as e:  # noqa: BLE001 - report and keep going
                        log.append(f"{vp}-{theme} {name}: {e}")
                        continue
                    if isinstance(res, str) and res.startswith("wait:"):
                        page.wait_for_function(res[5:], timeout=10000)
                        continue
                    if res is False:
                        log.append(f"{vp}-{theme} {name}: state not reached, skipped")
                        continue
                    page.wait_for_timeout(150)
                    page.screenshot(path=folder / f"{name}.png", animations="disabled")
                    if name in FULL_PAGE and theme == "light":
                        (out / "screens" / "full-page").mkdir(exist_ok=True)
                        page.screenshot(path=out / "screens" / "full-page" / f"{vp}-{FULL_PAGE[name]}.png",
                                        full_page=True, animations="disabled")
                    if vp == "laptop" and theme == "light" and name in ("04-plan-top", "09-plan-levels", "13-template-draft"):
                        samples[name] = page.evaluate("JSON.parse(JSON.stringify(FBW.W))")
                if vp == "laptop" and theme == "light":
                    # The print sheet: the app builds it on beforeprint and shows it only in print media.
                    page.evaluate("R.click('#again')")
                    page.emulate_media(media="print")
                    page.evaluate("dispatchEvent(new Event('beforeprint'))")
                    page.set_viewport_size({"width": 794, "height": 1123})
                    page.screenshot(path=out / "screens" / "full-page" / "print-sheet-a4.png", full_page=True)
                    page.evaluate("dispatchEvent(new Event('afterprint'))")
                    page.emulate_media(media="screen")
                ctx.close()
        browser.close()
    return {"samples": samples, "log": log}


def export_drawings(base_url: str, out: Path, ids: list[str]) -> None:
    """Each drawing as a standalone SVG with the drawing styles and light-theme tokens inlined."""
    from playwright.sync_api import sync_playwright
    css = (ROOT / "web" / "css" / "styles.css").read_text(encoding="utf-8")
    root = re.search(r":root\{[^}]*\}", css).group(0)
    fg = "\n".join(l for l in css.splitlines() if l.startswith(".fg-"))  # drawing classes, not the in-page .fg sizing
    style = f"<style>{root}\n{fg}</style>"
    folder = out / "assets" / "drawings"
    folder.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome")
        page = browser.new_page()
        page.goto(base_url)
        page.wait_for_function("typeof FIG!==\"undefined\"")
        for ex_id in ids:
            for n, f in enumerate(page.evaluate(f"FIG.of({json.dumps(ex_id)},400)"), 1):
                vb = [float(v) for v in re.search(r'viewBox="([^"]+)"', f["svg"]).group(1).split()]
                size = f' width="{round(vb[2] * 2)}" height="{round(vb[3] * 2)}"'  # 2 px per unit, so it opens at a sensible size
                svg = re.sub(r"(<svg[^>]*>)", lambda m: m.group(1).replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"' + size, 1) + style,
                             f["svg"], count=1)
                (folder / f"{ex_id}-{n}-steps-{f['steps'][0]}-{f['steps'][1]}.svg").write_text(svg, encoding="utf-8")
        browser.close()


def content(out: Path, samples: dict) -> list[str]:
    """Sample exercises, catalogue numbers and reference lists; returns the drawing ids to export."""
    cat = api.catalog(api.connect())
    ex = [e for e in cat["exercises"] if not e.get("retired")]
    by_id = {e["id"]: e for e in ex}
    longest = sorted(ex, key=lambda e: len(e["name"]))[-3:]
    picks = ["goblet", "box-jump", "lizard-crawl", "kb-armor", "pt-resisted-pushup", "band-bar-mu", "oc-box-bar-catch",
             "sb-carry", "high-knees", "yin-dragon", "skater-squat-oh", "human-flag-prog", "pvc-band-rotation",
             "box-stepup-lunge", *[e["id"] for e in longest]]
    picks = [i for i in dict.fromkeys(picks) if i in by_id]
    folder = out / "content"
    folder.mkdir(parents=True, exist_ok=True)
    sample = [{**by_id[i], "drawings": [{"steps": f["steps"]} for f in cat["figures"].get(i, [])]} for i in picks]
    (folder / "exercises-sample.json").write_text(json.dumps(sample, indent=2, ensure_ascii=False), encoding="utf-8")
    (folder / "workouts-sample.json").write_text(json.dumps(samples, indent=2, ensure_ascii=False), encoding="utf-8")
    steps = [s for e in ex for s in e["steps"]]
    stats = {
        "exercises": len(ex),
        "name_length": {"median": statistics.median(len(e["name"]) for e in ex), "max": max(len(e["name"]) for e in ex),
                        "longest": [e["name"] for e in longest]},
        "steps_per_exercise": {"median": statistics.median(len(e["steps"]) for e in ex), "max": max(len(e["steps"]) for e in ex)},
        "step_length_chars": {"median": statistics.median(len(s) for s in steps), "max": max(len(s) for s in steps)},
        "cue_length_chars_max": max(len(e.get("cue") or "") for e in ex),
        "avoid_length_chars_max": max(len(e.get("avoid") or "") for e in ex),
        "prescription_longest": sorted({r for e in ex for r in (e.get("reps") or []) if r}, key=len)[-5:],
        "drawings_per_exercise": {"median": statistics.median(len(v) for v in cat["figures"].values()),
                                  "max": max(len(v) for v in cat["figures"].values())},
        "tags": {"combo": sum(bool(e.get("combo")) for e in ex), "slow_to_fast": sum(bool(e.get("slow_to_fast")) for e in ex),
                 "partner": sum(bool(e.get("partner")) for e in ex), "sprint": sum(bool(e.get("sprint")) for e in ex)},
        "by_pattern": {p: sum(1 for e in ex if e["pattern"] == p) for p in sorted({e["pattern"] for e in ex})},
        "equipment": cat["equipment"],
        "levels": cat["levels"],
        "evaluation_criteria": cat["criteria"],
        "warmup_cooldown_roles": {k: len(v) for k, v in cat["phases"].items()},
        "setup_items_longest": max((s for v in cat["extras"].values() for s in v), key=len),
    }
    (folder / "catalogue-stats.json").write_text(json.dumps(stats, indent=2, ensure_ascii=False), encoding="utf-8")
    return picks


def main() -> int:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    built = build.build()
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        shutil.copy(api.DEFAULT_DB, tmp / "workouts.db")
        shutil.copy(built, tmp / "index.html")
        httpd = serve.make_server(tmp, 0, str(tmp / "workouts.db"))
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{httpd.server_address[1]}/index.html"
        try:
            result = capture(url, OUT)
            export_drawings(url, OUT, content(OUT, result["samples"]))
        finally:
            httpd.shutdown()
            httpd.server_close()
    # The brief, an index of the screenshots, reference sources, fonts and a working copy of the app.
    shutil.copy(SPEC, OUT / "README.md")
    lines = ["# Screens", "", "Every state at `laptop` (1440x900 CSS px, @2x) and `phone` (390x844 CSS px, @3x), "
             "in `light` and `dark`: `screens/<viewport>-<theme>/<state>.png`. Full-page captures are in `screens/full-page/`.", "",
             "| State | What it shows |", "|---|---|"]
    lines += [f"| `{n}` | {d} |" for n, d, _ in STATES if d]
    (OUT / "screens" / "INDEX.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    ref = OUT / "reference"
    ref.mkdir()
    for src in ("web/index.html", "web/css/styles.css", "web/js/app.js"):
        shutil.copy(ROOT / src, ref / Path(src).name)
    shutil.copytree(ROOT / "web" / "fonts", OUT / "assets" / "fonts")
    shutil.copy(built, ref / "workout-builder.html")
    if result["log"]:
        (OUT / "capture-log.txt").write_text("\n".join(result["log"]) + "\n", encoding="utf-8")
    with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(OUT.rglob("*")):
            if f.is_file():
                z.write(f, f.relative_to(OUT.parent))
    n = len(list((OUT / "screens").rglob("*.png")))
    print(f"Wrote {OUT} ({n} screenshots) and {ZIP} ({ZIP.stat().st_size // 1024} KB)")
    for line in result["log"]:
        print("  note:", line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
