"""Mock Registrar API for the IT312 final project (Python standard library only).

Run:   REGISTRAR_API_KEY=your-own-key python3 registrar_mock_api.py
Then:  GET http://127.0.0.1:8001/api/v1/students?page=1&size=10   (header X-API-Key)
       GET http://127.0.0.1:8001/api/v1/students/2023-59928
       GET http://127.0.0.1:8001/api/v1/health

Deliberate behaviour so your client must handle errors (R5):
  * every 10th request returns 503 Service Unavailable with a Retry-After header
  * a missing or wrong X-API-Key returns 401; an unknown student returns 404
  * size above 20 returns 400
"""
import hmac
import json
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

API_KEY = os.environ.get("REGISTRAR_API_KEY")
if not API_KEY:
    sys.exit("Set REGISTRAR_API_KEY first, e.g.  REGISTRAR_API_KEY=my-dev-key python3 registrar_mock_api.py")

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "registrar_students.json"), encoding="utf-8") as f:
    STUDENTS = json.load(f)["students"]
BY_ID = {s["student_id"]: s for s in STUDENTS}
COUNTER = {"n": 0}


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, body, headers=None):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/api/v1/health":
            return self.send_json(200, {"status": "ok"})

        COUNTER["n"] += 1
        if COUNTER["n"] % 10 == 0:
            return self.send_json(503, {"error": "Registrar system busy, try again"}, {"Retry-After": "2"})
        if not hmac.compare_digest(self.headers.get("X-API-Key", ""), API_KEY):
            return self.send_json(401, {"error": "missing or invalid X-API-Key"})

        if url.path == "/api/v1/students":
            q = parse_qs(url.query)
            try:
                page = int(q.get("page", ["1"])[0])
                size = int(q.get("size", ["10"])[0])
            except ValueError:
                return self.send_json(400, {"error": "page and size must be integers"})
            if page < 1 or not 1 <= size <= 20:
                return self.send_json(400, {"error": "page >= 1 and 1 <= size <= 20"})
            start = (page - 1) * size
            items = STUDENTS[start:start + size]
            return self.send_json(200, {"page": page, "size": size, "total": len(STUDENTS),
                                        "has_next": start + size < len(STUDENTS), "data": items})

        m = re.fullmatch(r"/api/v1/students/(\d{4}-\d{5})", url.path)
        if m:
            s = BY_ID.get(m.group(1))
            return self.send_json(200, s) if s else self.send_json(404, {"error": "student not found"})
        return self.send_json(404, {"error": "unknown endpoint"})

    def log_message(self, fmt, *args):
        sys.stderr.write("[registrar-mock] " + fmt % args + "\n")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8001"))
    print(f"Mock Registrar API on http://127.0.0.1:{port}/api/v1  (Ctrl+C to stop)")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
