"""Static hosting regression checks; no Kafka startup or paid agent calls."""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from fastapi.testclient import TestClient
from web import server


class FrontendHostingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "index.html").write_text("<html>Replit SentinelSat</html>")
        (self.root / "assets").mkdir()
        (self.root / "assets" / "app.js").write_text("/* imported bundle */")
        (self.root / "favicon.svg").write_text("<svg/>")
        self.patch = patch.object(server, "FRONTEND", self.root)
        self.patch.start()
        # No context manager: don't start the real Kafka lifespan in a unit test.
        self.client = TestClient(server.app)

    def tearDown(self):
        self.client.close()
        self.patch.stop()
        self.temp.cleanup()

    def test_deep_links_and_public_assets(self):
        for path in ("/", "/telemetry", "/incidents/INC-123", "/threat-lab", "/analysis"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200, path)
            self.assertIn("Replit SentinelSat", response.text)
        self.assertEqual(self.client.get("/favicon.svg").text, "<svg/>")
        self.assertEqual(self.client.get("/assets/app.js").status_code, 200)

    def test_reserved_routes_missing_assets_and_traversal_are_not_spa_html(self):
        for path in ("/api/missing", "/ws", "/static/style.css", "/assets/missing.js",
                     "/missing.woff2", "/assets/..%2Findex.html", "/..%5Coutside"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 404, path)
            self.assertNotIn("<html>", response.text)

    def test_missing_build_is_actionable(self):
        (self.root / "index.html").unlink()
        response = self.client.get("/telemetry")
        self.assertEqual(response.status_code, 503)
        self.assertIn("pnpm", response.json()["detail"])


if __name__ == "__main__":
    unittest.main()
