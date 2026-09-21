import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ramas


def run(repo, *args):
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True)


class RamasTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name) / "repo"
        self.repo.mkdir()
        run(self.repo, "init", "-b", "main")
        run(self.repo, "config", "user.email", "test@example.com")
        run(self.repo, "config", "user.name", "Test")
        (self.repo / "base.txt").write_text("base\n")
        run(self.repo, "add", ".")
        run(self.repo, "commit", "-m", "base")

    def tearDown(self):
        self.tmp.cleanup()

    def test_mide_rama_activa_y_cambios_del_checkout(self):
        run(self.repo, "switch", "-c", "feat/context-console")
        (self.repo / "rama.txt").write_text("cambio\n")
        run(self.repo, "add", ".")
        run(self.repo, "commit", "-m", "rama")
        (self.repo / "sin-commit.txt").write_text("pendiente\n")

        snapshot = ramas.construir_snapshot({"repo": str(self.repo)}, "2026-09-19T00:00:00-05:00")
        repo = snapshot["repos"][0]
        feature = next(r for r in repo["ramas"] if r["nombre"] == "feat/context-console")

        self.assertEqual(snapshot["schemaVersion"], "context.ramas.v1")
        self.assertEqual(repo["ramaActual"], "feat/context-console")
        self.assertTrue(feature["actual"])
        self.assertEqual(feature["adelanteMain"], 1)
        self.assertEqual(feature["estado"], "con-cambios")
        self.assertEqual(repo["cambios"], 1)

    def test_reconoce_una_rama_fusionada(self):
        run(self.repo, "switch", "-c", "feat/lista")
        (self.repo / "rama.txt").write_text("cambio\n")
        run(self.repo, "add", ".")
        run(self.repo, "commit", "-m", "rama")
        run(self.repo, "switch", "main")
        run(self.repo, "merge", "--ff-only", "feat/lista")

        medido = ramas.medir_repo(str(self.repo), ["repo"])
        feature = next(r for r in medido["ramas"] if r["nombre"] == "feat/lista")

        self.assertTrue(feature["fusionada"])
        self.assertEqual(feature["estado"], "fusionada")


if __name__ == "__main__":
    unittest.main()
