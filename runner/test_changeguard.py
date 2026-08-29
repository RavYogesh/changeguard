import sys
import tempfile
import unittest
from pathlib import Path

import changeguard


class ChangeGuardSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.repo = Path(self.temp.name)
        (self.repo / "tests").mkdir()
        (self.repo / "src").mkdir()
        (self.repo / "src" / "math.py").write_text("def add(a, b): return a + b\n", encoding="utf-8")
        self.config = changeguard.Config(
            test_roots=["tests"],
            source_roots=["src"],
            test_commands=[f'"{sys.executable}" -c "print(123)"'],
            command_timeout_seconds=10,
        )

    def tearDown(self):
        self.temp.cleanup()

    def candidate(self, **overrides):
        values = {
            "path": "tests/test_math.py",
            "target_file": "src/math.py",
            "framework": "pytest",
            "content": "def test_add():\n    assert 1 + 1 == 2\n",
            "rationale": "Checks the boundary",
            "confidence": 0.9,
        }
        values.update(overrides)
        return changeguard.Candidate(**values)

    def test_rejects_path_traversal(self):
        with self.assertRaises(ValueError):
            changeguard.safe_candidate_path(self.repo, self.candidate(path="tests/../../owned.py"), self.config)

    def test_rejects_network_and_process_side_effects(self):
        self.assertTrue(changeguard.has_forbidden_side_effect(self.candidate(content="import subprocess\nassert True")))
        self.assertTrue(changeguard.has_forbidden_side_effect(self.candidate(content="fetch('/admin')\nexpect(1)")))

    def test_existing_file_is_never_deleted(self):
        existing = self.repo / "tests" / "test_math.py"
        existing.write_text("# owned by the user\n", encoding="utf-8")
        candidate = self.candidate()
        accepted, _ = changeguard.validate_candidates(self.repo, [candidate], self.config, {"src/math.py"})
        changeguard.cleanup_candidates(self.repo, [candidate])
        self.assertEqual([], accepted)
        self.assertEqual("# owned by the user\n", existing.read_text(encoding="utf-8"))

    def test_accepts_repeatable_candidate_and_cleans_only_generated_file(self):
        candidate = self.candidate()
        accepted, alerts = changeguard.validate_candidates(self.repo, [candidate], self.config, {"src/math.py"})
        self.assertEqual([candidate], accepted)
        self.assertEqual([], alerts)
        self.assertTrue((self.repo / candidate.path).exists())
        changeguard.cleanup_candidates(self.repo, [candidate])
        self.assertFalse((self.repo / candidate.path).exists())
        self.assertTrue((self.repo / "src" / "math.py").exists())

    def test_redacts_common_secret_assignments(self):
        path = self.repo / "src" / "secret.py"
        path.write_text("api_key = 'sensitive-value'\n", encoding="utf-8")
        context = changeguard.source_context(self.repo, ["src/secret.py"], self.config)
        self.assertIn("[REDACTED]", context[0]["content"])
        self.assertNotIn("sensitive-value", context[0]["content"])


if __name__ == "__main__":
    unittest.main()
