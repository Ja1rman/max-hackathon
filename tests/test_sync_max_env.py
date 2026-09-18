import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "sync-max-env.py"
SPEC = importlib.util.spec_from_file_location("sync_max_env", SCRIPT)
SYNC = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SYNC)


class MaxEnvironmentSyncTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / ".env"
        self.original = "# Keep existing configuration\nDEMO_ENABLED=true\nPUBLIC_URL=https://example.invalid/banquet\nMAX_BOT_TOKEN=OLD_TEST_TOKEN\nMAX_WEBHOOK_SECRET=old_test_secret\n"
        self.path.write_text(self.original)
        self.path.chmod(0o600)

    def invoke(self, payload):
        if not isinstance(payload, bytes):
            payload = json.dumps(payload).encode()
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--path", str(self.path)], input=payload,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
        )

    def test_updates_only_allowlisted_nonempty_values_and_preserves_owner(self):
        before = self.path.stat()
        result = self.invoke({
            "MAX_BOT_TOKEN": "NEW_TEST_TOKEN:123+/=", "MAX_WEBHOOK_SECRET": "",
            "MAX_BOT_USERNAME": "@example_bot", "RESTAURANT_ADMIN_IDS": "123, 456",
        })
        self.assertEqual(result.returncode, 0)
        expected = self.original.replace("OLD_TEST_TOKEN", "NEW_TEST_TOKEN:123+/=")
        expected += "MAX_BOT_USERNAME=@example_bot\nRESTAURANT_ADMIN_IDS=123,456\n"
        self.assertEqual(self.path.read_text(), expected)
        after = self.path.stat()
        self.assertEqual((after.st_uid, after.st_gid), (before.st_uid, before.st_gid))
        self.assertEqual(stat.S_IMODE(after.st_mode), 0o600)
        self.assertNotIn(b"NEW_TEST_TOKEN", result.stdout + result.stderr)

    def test_empty_payload_and_blank_secrets_do_not_clear_existing_values(self):
        before = self.path.stat()
        for payload in ({}, {"MAX_BOT_TOKEN": "", "MAX_WEBHOOK_SECRET": "   "}):
            with self.subTest(payload=payload):
                self.assertEqual(self.invoke(payload).returncode, 0)
                self.assertEqual(self.path.read_text(), self.original)
                self.assertEqual(self.path.stat().st_ino, before.st_ino)

    def test_unsafe_values_and_unknown_fields_do_not_change_file(self):
        cases = [
            {"MAX_BOT_TOKEN": "TEST\nDEMO_ENABLED=false"}, {"MAX_BOT_TOKEN": "TEST\rVALUE"},
            {"MAX_BOT_TOKEN": "TEST\x00VALUE"}, {"MAX_BOT_TOKEN": "TEST\tVALUE"},
            {"MAX_BOT_TOKEN": "$(test)"}, {"MAX_BOT_TOKEN": "TEST'VALUE"},
            {"MAX_BOT_TOKEN": "x" * 4097}, {"MAX_BOT_TOKEN": None},
            {"MAX_BOT_USERNAME": "https://example.invalid"}, {"MAX_BOT_USERNAME": "a" * 65},
            {"MAX_WEBHOOK_SECRET": "x" * 257}, {"MAX_WEBHOOK_SECRET": "test secret"},
            {"MAX_WEBHOOK_SECRET": "abcd"},
            {"RESTAURANT_ADMIN_IDS": "123,-4"}, {"RESTAURANT_ADMIN_IDS": "1,"},
            {"RESTAURANT_ADMIN_IDS": ",".join(["1"] * 101)},
            {"MAX_API_URL": "https://example.invalid"}, {"DEMO_ENABLED": "false"},
            {"MAX_BOT_TOKEN": "VALID_TEST_TOKEN", "UNKNOWN_FIELD": "ignored?"}, [],
        ]
        for payload in cases:
            with self.subTest(payload=payload):
                result = self.invoke(payload)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(self.path.read_text(), self.original)
                self.assertNotIn(b"VALID_TEST_TOKEN", result.stdout + result.stderr)

    def test_invalid_json_duplicate_keys_and_oversized_payload_fail_without_exposure(self):
        for payload in (
            b'{"MAX_BOT_TOKEN":"PRIVATE_TEST_FIXTURE"', b'\xff',
            b'{"MAX_BOT_TOKEN":"one","MAX_BOT_TOKEN":"two"}',
            b" " * (SYNC.MAX_PAYLOAD_BYTES + 1),
        ):
            result = self.invoke(payload)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(self.path.read_text(), self.original)
            self.assertNotIn(b"PRIVATE_TEST_FIXTURE", result.stdout + result.stderr)

    def test_accepts_runtime_username_and_webhook_secret_boundaries(self):
        for size in (5, 256):
            result = self.invoke({"MAX_BOT_USERNAME": "@" + "a" * 64, "MAX_WEBHOOK_SECRET": "a" * size})
            self.assertEqual(result.returncode, 0)

    def test_replaces_duplicate_assignments_and_multiline_target_once(self):
        self.path.write_text("MAX_BOT_TOKEN='old\ncontinued'\nexport MAX_BOT_TOKEN=duplicate\nDEMO_ENABLED=true\n")
        self.assertEqual(self.invoke({"MAX_BOT_TOKEN": "NEW_TEST_TOKEN"}).returncode, 0)
        self.assertEqual(self.path.read_text(), "MAX_BOT_TOKEN=NEW_TEST_TOKEN\nDEMO_ENABLED=true\n")

    def test_preserves_unrelated_multiline_values_and_crlf_bytes(self):
        original = b'OTHER="first\r\nMAX_BOT_TOKEN=inside_quoted_value\r\nlast"\r\nMAX_BOT_TOKEN=old\r\nDEMO_ENABLED=true\r\n'
        self.path.write_bytes(original)
        self.assertEqual(self.invoke({"MAX_BOT_TOKEN": "NEW_TEST_TOKEN"}).returncode, 0)
        self.assertEqual(self.path.read_bytes(), original.replace(b"MAX_BOT_TOKEN=old", b"MAX_BOT_TOKEN=NEW_TEST_TOKEN"))

    def test_appends_key_after_missing_final_newline(self):
        self.path.write_text("DEMO_ENABLED=true")
        self.assertEqual(self.invoke({"MAX_BOT_USERNAME": "example_bot"}).returncode, 0)
        self.assertEqual(self.path.read_text(), "DEMO_ENABLED=true\nMAX_BOT_USERNAME=example_bot\n")

    def test_secures_existing_permissions_without_changing_values(self):
        self.path.chmod(0o644)
        self.assertEqual(self.invoke({}).returncode, 0)
        self.assertEqual(self.path.read_text(), self.original)
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o600)

    def test_rejects_symlink_and_missing_file(self):
        actual = self.path.with_name("actual.env")
        self.path.rename(actual)
        self.path.symlink_to(actual)
        self.assertEqual(self.invoke({"MAX_BOT_TOKEN": "NEW_TEST_TOKEN"}).returncode, 1)
        self.assertEqual(actual.read_text(), self.original)
        self.path.unlink()
        self.assertEqual(self.invoke({"MAX_BOT_TOKEN": "NEW_TEST_TOKEN"}).returncode, 1)
        self.assertFalse(self.path.exists())

    def test_failed_atomic_replace_keeps_original_and_removes_temporary_file(self):
        with patch.object(SYNC.os, "replace", side_effect=OSError("simulated write failure")):
            with self.assertRaises(OSError):
                SYNC.sync_file(self.path, {"MAX_BOT_TOKEN": "NEW_TEST_TOKEN"})
        self.assertEqual(self.path.read_text(), self.original)
        self.assertEqual(list(self.path.parent.glob(".env.max-sync-*")), [])

    def test_ownership_is_applied_to_temp_before_replacement(self):
        real_fstat = os.fstat
        calls = 0

        def other_temp_owner(descriptor):
            nonlocal calls
            calls += 1
            result = real_fstat(descriptor)
            if calls == 2:
                values = list(result)
                values[4] = result.st_uid + 1
                return os.stat_result(values)
            return result

        before = self.path.stat()
        with patch.object(SYNC.os, "fstat", side_effect=other_temp_owner), patch.object(SYNC.os, "fchown") as chown:
            SYNC.sync_file(self.path, {"MAX_BOT_TOKEN": "NEW_TEST_TOKEN"})
        self.assertEqual(chown.call_args.args[1:], (before.st_uid, before.st_gid))


if __name__ == "__main__":
    unittest.main()
