import contextlib
import importlib.util
import io
from collections import Counter
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("footprint", Path(__file__).with_name("footprint.py"))
footprint = importlib.util.module_from_spec(spec)
spec.loader.exec_module(footprint)


class FootprintTests(unittest.TestCase):
    def report(self, enabled=False, available=True):
        output = io.StringIO()
        args = ["footprint", "12"] + (["--canon"] if enabled else [])
        corpus = {"listing": {"areas": [{"tablas": ["user_requests"], "fuentes": {"legacy-backend": {"App/Service.php": "hash"}}}]}}
        def optional(value):
            def read():
                if not enabled:
                    self.fail("La huella local consultó Canon sin pedirlo")
                return value if available else {}
            return read
        with patch.object(footprint.sys, "argv", args), \
                patch.object(footprint, "tables", return_value=(Counter({"user_requests": 2}), Counter())), \
                patch.object(footprint, "events", return_value=([{"level": "info"}], [])), \
                patch.object(footprint, "spans", return_value=Counter({"Service::run": 1})), \
                patch.object(footprint, "of_ref", return_value=(["legacy-backend/App/Service.php"], None, None)), \
                patch.object(footprint._canon, "maps", side_effect=optional(corpus)), \
                patch.object(footprint._canon, "prose", side_effect=optional({})), \
                patch.object(footprint._canon, "available", side_effect=optional(available)), \
                contextlib.redirect_stdout(output):
            self.assertEqual(footprint.main(), 0)
        return output.getvalue()

    def test_default_keeps_measurements_without_contacting_canon(self):
        text = self.report()
        self.assertIn("`user_requests` | 2 | sin comprobar", text)
        self.assertIn("legacy-backend/App/Service.php", text)
        self.assertIn("Canon no se solicitó", text)
        self.assertNotIn("**ninguno**", text)

    def test_explicit_comparison_preserves_the_corpus_overlay(self):
        text = self.report(enabled=True)
        self.assertIn("`user_requests` | 2 | listing", text)
        self.assertIn("App/Service.php | listing", text)

    def test_unavailable_corpus_does_not_turn_into_missing_coverage(self):
        text = self.report(enabled=True, available=False)
        self.assertIn("Canon no respondió", text)
        self.assertIn("sin comprobar", text)
        self.assertNotIn("**ninguno**", text)
        self.assertNotIn("ningún tema de canon nombra", text)
