"""Checks the payload against the Plugin Hub publishing contract
(PLUGIN_HUB_CONTRACT.md) and that no credentials ship."""

import json
import os
import re
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
PAYLOADS = [d for d in os.listdir(ROOT) if d.endswith(".crosspoint-plugin")
            and os.path.isdir(os.path.join(ROOT, d))]


class HubContractTests(unittest.TestCase):
    def test_exactly_one_payload_dir(self):
        self.assertEqual(len(PAYLOADS), 1)

    def setUp(self):
        self.dir = os.path.join(ROOT, PAYLOADS[0])
        self.manifest = json.load(open(os.path.join(self.dir, "manifest.json")))

    def test_name_matches_directory_and_is_safe(self):
        name = self.manifest["name"]
        self.assertEqual(PAYLOADS[0], name + ".crosspoint-plugin")
        self.assertRegex(name, r"^[a-z0-9-]+$")

    def test_version_is_three_part(self):
        self.assertRegex(self.manifest["version"], r"^\d+\.\d+\.\d+$")

    def test_files_are_safe_and_exist(self):
        files = self.manifest["files"]
        self.assertIn("manifest.json", files)
        self.assertTrue({"device.json", "plugin.js"} & set(files))
        for f in files:
            self.assertFalse(f.startswith("/") or "\\" in f or ".." in f.split("/"), f)
            self.assertTrue(os.path.isfile(os.path.join(self.dir, f)), f)

    def test_every_payload_file_is_declared(self):
        on_disk = {os.path.relpath(os.path.join(d, f), self.dir)
                   for d, _, fs in os.walk(self.dir) for f in fs}
        self.assertEqual(on_disk, set(self.manifest["files"]))

    def test_no_real_config_or_secrets_shipped(self):
        self.assertNotIn("config.json", self.manifest["files"])
        self.assertFalse(os.path.exists(os.path.join(self.dir, "config.json")))

    def test_settings_page_is_declared_and_mounted(self):
        self.assertIn("plugin.js", self.manifest["files"])
        self.assertEqual(self.manifest.get("mount"), "settings")

    def test_firmware_folder_name_limits(self):
        # event subscriptions need a folder name <= 23 bytes, full path <= 63
        self.assertLessEqual(len(self.manifest["name"].encode()), 23)
        self.assertLessEqual(len(("/.crosspoint/plugins/" + self.manifest["name"]).encode()), 63)

    def test_plugin_version_string_fits_bookorbit_limit(self):
        body = json.load(open(os.path.join(self.dir, "device.json")))["events"]["reader.session"]["request"]["body"]
        version = re.search(r'pluginVersion\\?":\\?"([^"\\]+)', body).group(1)
        self.assertLessEqual(len(version), 20)  # BookOrbit rejects longer
        self.assertTrue(version.endswith(self.manifest["version"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)


class DisclosureTests(unittest.TestCase):
    """The AI-assisted disclosure must stay visible in every place a user reads."""

    def _read(self, *parts):
        with open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), *parts), encoding="utf-8") as f:
            return f.read().lower()

    def test_disclosure_present(self):
        for parts in (("README.md",), ("KNOWN_ISSUES.md",),
                      ("bookorbit-sync.crosspoint-plugin", "README.md"),
                      ("bookorbit-sync.crosspoint-plugin", "plugin.js")):
            text = self._read(*parts)
            self.assertIn("ai", text)
            self.assertIn("may contain errors", text, parts)
