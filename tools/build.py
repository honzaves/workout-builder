"""Bundle web/ into one self-contained HTML file: dist/workout-builder.html.

The exercise catalogue is read from the database (db/workouts.db) and inlined, so the
file is a snapshot of the catalogue at build time. Saving and evaluating workouts need
the server, so they're switched off in the built file.

The result works offline, can be opened straight from disk, emailed,
or re-published as a Claude artifact.

Usage:
    python tools/build.py
"""
from __future__ import annotations

import base64
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import api  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
DIST = ROOT / "dist"
OUT = DIST / "workout-builder.html"


def _safe_for_script(text: str) -> str:
    """Prevent a literal '</script' inside inlined code/data from closing the tag."""
    return text.replace("</script", "<\\/script")


def _embed_fonts(css: str) -> str:
    """Replace url("../fonts/x.woff2") with a data URI, so the single file needs no font files."""
    def data_uri(m: re.Match) -> str:
        font = (WEB / "fonts" / m.group(1)).read_bytes()
        return f'url("data:font/woff2;base64,{base64.b64encode(font).decode()}")'
    return re.sub(r'url\("\.\./fonts/([^"]+\.woff2)"\)', data_uri, css)


def build(db_path: Path | str = api.DEFAULT_DB) -> Path:
    html = (WEB / "index.html").read_text(encoding="utf-8")
    css = _embed_fonts((WEB / "css" / "styles.css").read_text(encoding="utf-8"))
    js = (WEB / "js" / "app.js").read_text(encoding="utf-8")
    con = api.connect(db_path)
    try:
        data = api.catalog(con)
    finally:
        con.close()

    html, n = re.subn(
        r'<link rel="stylesheet" href="css/styles.css">',
        lambda _: f"<style>\n{css}</style>",
        html,
    )
    if n != 1:
        raise SystemExit("Could not find the styles.css <link> in web/index.html")

    scripts = (
        "<script>\nwindow.WORKOUT_DATA = "
        + _safe_for_script(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
        + ";\n</script>\n<script>\n"
        + _safe_for_script(js)
        + "</script>\n"
    )
    html, n = re.subn(
        r"<!-- BUILD:SCRIPTS -->.*?<!-- /BUILD:SCRIPTS -->",
        lambda _: scripts,
        html,
        flags=re.S,
    )
    if n != 1:
        raise SystemExit("Could not find the BUILD:SCRIPTS markers in web/index.html")
    # Drop the dev-loader comment that precedes the markers.
    html = re.sub(r"<!-- Dev loader:.*?-->\n", "", html, flags=re.S)

    DIST.mkdir(exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    return OUT


if __name__ == "__main__":
    path = build()
    print(f"Built {path.relative_to(ROOT)} ({path.stat().st_size / 1024:.0f} KB)")
