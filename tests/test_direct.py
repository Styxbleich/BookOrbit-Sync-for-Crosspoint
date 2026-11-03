"""Checks the request the plugin sends.

Simulates the firmware's template substitution on device.json, sends the
resulting request to the mock BookOrbit in mock_bookorbit.py (which mirrors
BookOrbit's validation, dedupe and session derivation), and asserts the session
BookOrbit would derive is the one that was read.
"""

import json
import os
import re
import sys
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mock_bookorbit as t  # noqa: E402

DEVICE = json.load(open(os.path.join(HERE, "..", "bookorbit-sync.crosspoint-plugin", "device.json")))
HANDLER = DEVICE["events"]["reader.session"]["request"]


def render(template, cfg, event):
    def sub(match):
        kind, _, key = match.group(1).partition(".")
        source = {"cfg": cfg, "event": event}.get(kind)
        return str(source[key]) if source and key in source else match.group(0)
    return re.sub(r"\{((?:cfg|event)\.[A-Za-z_]+)\}", sub, template)


class DirectPluginTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bo = t.MockBookOrbit()
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), t.make_mock_handler(cls.bo))
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        import hashlib
        cls.cfg = {
            "server": f"http://127.0.0.1:{cls.srv.server_port}",
            "user": cls.bo.user,
            "key": hashlib.md5(cls.bo.password.encode()).hexdigest(),
            "device_id": "crosspoint",
        }

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def setUp(self):
        self.bo.stored.clear()
        self.bo.calls.clear()

    def deliver(self, source="start", **overrides):
        event = {"id": "b1-1", "book": "/Books/x.epub", "document": t.GOOD_HASH,
                 "start_time": 1793000000, "end_time": 1793000600, "duration_seconds": 600,
                 "start_progress_bp": 1200, "end_progress_bp": 1450, "ts": 1793000700}
        event.update(overrides)
        template = HANDLER["body"]
        if source == "ts":  # the card's "Reader clock when the session is saved" option
            template = (template.replace('"startTime":{event.start_time}', '"startTime":{event.ts}', 1)
                        .replace('"startTime":{event.end_time}', '"startTime":{event.ts}', 1))
        body = render(template, self.cfg, event)
        json.loads(body)  # the rendered template must be valid JSON
        headers = {k: render(v, self.cfg, event) for k, v in HANDLER["headers"].items()}
        req = urllib.request.Request(render(HANDLER["url"], self.cfg, event),
                                     data=body.encode(), method=HANDLER["method"], headers=headers)
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())

    def test_session_derived_exactly(self):
        code, res = self.deliver()
        self.assertEqual(code, 201)
        self.assertEqual(res["unmatched"], [])
        (s,) = self.bo.sessions(t.GOOD_HASH)
        self.assertEqual((s["start"], s["duration"], s["end"]), (1793000000, 600, 1793000600))
        self.assertAlmostEqual(s["end_progress"], 14.5, places=2)
        self.assertAlmostEqual(s["delta"], 2.5, places=2)

    def test_redelivery_is_a_no_op(self):
        self.deliver()
        before = dict(self.bo.stored)
        _, res = self.deliver()
        self.assertEqual(self.bo.stored, before)
        self.assertEqual(res["results"][0]["accepted"], 0)

    def test_edges(self):
        # no progress, minimum length, start of book, end of book
        for kw in ({"start_progress_bp": 5000, "end_progress_bp": 5000},
                   {"duration_seconds": 10, "end_time": 1793000010},
                   {"start_progress_bp": 0, "end_progress_bp": 30},
                   {"start_progress_bp": 9900, "end_progress_bp": 10000}):
            self.bo.stored.clear()
            code, _ = self.deliver(**kw)
            self.assertEqual(code, 201, kw)
            self.assertEqual(len(self.bo.sessions(t.GOOD_HASH)), 1, kw)

    def test_unknown_book_is_acknowledged(self):
        code, res = self.deliver(document=t.MISSING_HASH)
        self.assertEqual(code, 201)  # 2xx, so the firmware drops it from the queue
        self.assertEqual(res["unmatched"], [t.MISSING_HASH])

    def test_back_to_back_sessions_merge_far_apart_split(self):
        self.deliver(id="a")
        self.deliver(id="b", start_time=1793000700, end_time=1793001300)  # 100 s later
        self.assertEqual(len(self.bo.sessions(t.GOOD_HASH)), 1)
        self.deliver(id="c", start_time=1793090000, end_time=1793090600)
        self.assertEqual(len(self.bo.sessions(t.GOOD_HASH)), 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
