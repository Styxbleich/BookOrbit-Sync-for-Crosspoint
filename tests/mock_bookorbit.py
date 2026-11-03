"""A mock BookOrbit for the tests.

It mirrors the validation rules in BookOrbit's koreader-plugin.dto.ts, the dedupe
key in koreader-plugin.repository.ts (user, book file, device, page, startTime)
and the session derivation in koreader-stats.util.ts, so a passing test means
the plugin's request would derive the intended reading session.
"""

import hashlib
import json
import os
import re
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

GOOD_HASH = "8b6d0322ee8a869917a374f0ce24b70b"
MISSING_HASH = "0123456789abcdef0123456789abcdef"
DEVICE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,100}$")
DATETIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$")
GAP = 1800


def derive_sessions(events):
    """Port of clusterPageStats + computeClusterMetrics (koreader-stats.util.ts)."""
    events = sorted(events, key=lambda e: (e["startTime"], e["page"]))
    clusters, current, cluster_end = [], [], 0
    for e in events:
        if current and e["startTime"] - cluster_end > GAP:
            clusters.append(current)
            current = []
        current.append(e)
        cluster_end = max(cluster_end, e["startTime"] + e["durationSeconds"])
    if current:
        clusters.append(current)
    out = []
    for c in clusters:
        first, last, end, total = c[0], c[0], c[0]["startTime"], 0
        for e in c:
            total += e["durationSeconds"]
            end = max(end, e["startTime"] + e["durationSeconds"])
            if e["startTime"] >= last["startTime"]:
                last = e
        duration = min(total, end - first["startTime"])
        if duration < 10:
            continue
        out.append({
            "start": first["startTime"], "end": end, "duration": duration,
            "end_progress": round(last["page"] / last["totalPages"] * 100, 2),
            "delta": round((last["page"] - first["page"]) / last["totalPages"] * 100, 2),
        })
    return out


class MockBookOrbit:
    def __init__(self):
        self.user, self.password = "reader", "hunter2"
        self.stored = {}  # (hash, device, page, start) -> event
        self.calls = []
        self.down = False
        self.known = {GOOD_HASH}

    def sessions(self, document):
        events = [e for (h, _d, _p, _s), e in self.stored.items() if h == document]
        return derive_sessions(events)


def make_mock_handler(state):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def reply(self, code, payload):
            raw = json.dumps(payload).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def authed(self):
            key = self.headers.get("x-auth-key", "")
            md5 = hashlib.md5(state.password.encode()).hexdigest()
            return self.headers.get("x-auth-user") == state.user and key in (md5, state.password)

        def do_GET(self):
            if state.down:
                return self.reply(503, {})
            if not self.authed():
                return self.reply(401, {"message": "Invalid credentials"})
            if self.path == "/api/v1/koreader/users/auth":
                return self.reply(200, {"authorized": "OK"})
            self.reply(404, {})

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            state.calls.append((self.path, body))
            if state.down:
                return self.reply(503, {})
            if not self.authed():
                return self.reply(401, {"message": "Invalid credentials"})
            err = self.validate_device(body)
            if err:
                return self.reply(400, {"message": err})
            if self.path == "/api/v1/koreader/plugin/page-stats":
                return self.page_stats(body)
            if self.path == "/api/v1/koreader/plugin/match-check":
                return self.reply(200, {"matches": [{"hash": h, "bookId": 1, "bookFileId": 1}
                                                    for h in body["hashes"] if h in state.known],
                                        "libraryVersion": "v1"})
            if self.path == "/api/v1/koreader/plugin/sweeps":
                for k in ("booksMatched", "pageStatsUploaded", "annotationsUpserted"):
                    if not isinstance(body.get(k), int) or body[k] < 0:
                        return self.reply(400, {"message": k})
                return self.reply(201, {"ok": True})
            self.reply(404, {})

        @staticmethod
        def validate_device(body):
            if not DEVICE_ID_RE.match(str(body.get("deviceId", ""))):
                return "deviceId"
            if not isinstance(body.get("deviceModel"), str) or len(body["deviceModel"]) > 100:
                return "deviceModel"
            if not isinstance(body.get("pluginVersion"), str) or len(body["pluginVersion"]) > 20:
                return "pluginVersion"
            if "deviceTime" in body and not DATETIME_RE.match(body["deviceTime"]):
                return "deviceTime"

        def page_stats(self, body):
            books = body.get("books")
            if not isinstance(books, list) or not 1 <= len(books) <= 50:
                return self.reply(400, {"message": "books"})
            total = sum(len(b.get("events", [])) for b in books)
            if total > 500:
                return self.reply(400, {"message": "Too many page stat events"})
            results, unmatched = [], []
            for b in books:
                if not re.match(r"^[0-9a-f]{32}$", str(b.get("hash", "")), re.I):
                    return self.reply(400, {"message": "hash"})
                evs = b.get("events")
                if not isinstance(evs, list) or not evs:
                    return self.reply(400, {"message": "events"})
                for e in evs:
                    ok = (all(isinstance(e.get(k), int) and not isinstance(e.get(k), bool)
                              for k in ("page", "startTime", "durationSeconds", "totalPages"))
                          and e["page"] >= 0 and e["startTime"] >= 1
                          and 0 <= e["durationSeconds"] <= 86400 and e["totalPages"] >= 1)
                    if not ok:
                        return self.reply(400, {"message": f"bad event {e}"})
                h = b["hash"].lower()
                if h not in state.known:
                    unmatched.append(h)
                    continue
                accepted = 0
                for e in evs:
                    key = (h, body["deviceId"], e["page"], e["startTime"])
                    if key not in state.stored:
                        state.stored[key] = e
                        accepted += 1
                results.append({"hash": h, "accepted": accepted, "duplicates": len(evs) - accepted,
                                "watermark": max(e["startTime"] for e in evs)})
            self.reply(201, {"results": results, "unmatched": unmatched})

    return H

