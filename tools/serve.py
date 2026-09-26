"""Serve the app locally so the browser can load web/data/exercises.json.

Usage:
    python tools/serve.py              # serves web/ on http://localhost:8000
    python tools/serve.py --dist       # serves the built single-file version in dist/
    python tools/serve.py --port 9000 --no-browser
"""
from __future__ import annotations

import argparse
import functools
import http.server
import socketserver
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    """Disable caching so edits to JSON/JS/CSS show up on a normal refresh."""

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--dist", action="store_true", help="serve dist/ instead of web/")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    folder = ROOT / ("dist" if args.dist else "web")
    page = "workout-builder.html" if args.dist else "index.html"
    if not (folder / page).exists():
        raise SystemExit(f"{folder / page} not found. Run: python tools/build.py")

    handler = functools.partial(NoCacheHandler, directory=str(folder))
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", args.port), handler) as httpd:
        url = f"http://localhost:{args.port}/{page}"
        print(f"Serving {folder} at {url}  (Ctrl+C to stop)")
        if not args.no_browser:
            webbrowser.open(url)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
