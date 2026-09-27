"""Serve the app locally, with a small JSON API backed by the SQLite database.

On start, web/data/exercises.json is synced into the database (see db_import.py), so
edits to the JSON show up after a restart.

Usage:
    python tools/serve.py              # serves web/ on http://localhost:8000
    python tools/serve.py --dist       # serves the built single-file version in dist/
    python tools/serve.py --port 9000 --no-browser --db other.db

API:
    GET    /api/catalog                        exercises, equipment, levels, criteria
    GET    /api/workouts                       saved workouts, newest first
    POST   /api/workouts                       save a generated workout -> {"id"}
    GET    /api/workouts/<id>                  one workout, with its evaluations
    DELETE /api/workouts/<id>
    POST   /api/workouts/<id>/evaluations      record a session and how it went -> {"id"}
"""
from __future__ import annotations

import argparse
import functools
import http.server
import json
import re
import socketserver
import sys
import threading
import webbrowser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import api  # noqa: E402
import db_import  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
WORKOUT = re.compile(r"^/api/workouts/(\d+)$")
EVALUATIONS = re.compile(r"^/api/workouts/(\d+)/evaluations$")


class Handler(http.server.SimpleHTTPRequestHandler):
    """Static files with caching off, plus /api/* routes."""

    con = None             # set by make_server
    lock = threading.Lock()

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _json(self, status: int, payload) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(length) or b"{}")

    def _api(self, method: str) -> None:
        path = self.path.split("?")[0]
        try:
            with self.lock:
                if method == "GET" and path == "/api/catalog":
                    return self._json(200, db_import.export_catalog(self.con))
                if method == "GET" and path == "/api/workouts":
                    return self._json(200, api.list_workouts(self.con))
                if method == "POST" and path == "/api/workouts":
                    return self._json(201, {"id": api.save_workout(self.con, self._body())})
                if m := WORKOUT.match(path):
                    if method == "GET":
                        return self._json(200, api.get_workout(self.con, int(m.group(1))))
                    if method == "DELETE":
                        api.delete_workout(self.con, int(m.group(1)))
                        return self._json(200, {"deleted": int(m.group(1))})
                if (m := EVALUATIONS.match(path)) and method == "POST":
                    return self._json(201, {"id": api.add_evaluation(self.con, int(m.group(1)), self._body())})
            self._json(404, {"error": f"No route for {method} {path}"})
        except LookupError as e:
            self._json(404, {"error": str(e)})
        except (ValueError, json.JSONDecodeError) as e:
            self._json(400, {"error": str(e)})

    def do_GET(self) -> None:
        if self.path.startswith("/api/"):
            return self._api("GET")
        super().do_GET()

    def do_POST(self) -> None:
        self._api("POST")

    def do_DELETE(self) -> None:
        self._api("DELETE")


def make_server(folder: Path, port: int, db_path: str) -> socketserver.TCPServer:
    con = db_import.connect(db_path)
    db_import.sync(con, json.loads(db_import.DATA_FILE.read_text(encoding="utf-8")),
                   db_import.APP_FILE.read_text(encoding="utf-8"))
    handler = type("BoundHandler", (Handler,), {"con": con})
    socketserver.TCPServer.allow_reuse_address = True
    return socketserver.ThreadingTCPServer(("127.0.0.1", port), functools.partial(handler, directory=str(folder)))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--dist", action="store_true", help="serve dist/ instead of web/")
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--db", default=str(db_import.DEFAULT_DB), help="SQLite database file")
    args = parser.parse_args()

    folder = ROOT / ("dist" if args.dist else "web")
    page = "workout-builder.html" if args.dist else "index.html"
    if not (folder / page).exists():
        raise SystemExit(f"{folder / page} not found. Run: python tools/build.py")

    with make_server(folder, args.port, args.db) as httpd:
        url = f"http://localhost:{args.port}/{page}"
        print(f"Serving {folder} at {url} with database {args.db}  (Ctrl+C to stop)")
        if not args.no_browser:
            webbrowser.open(url)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
