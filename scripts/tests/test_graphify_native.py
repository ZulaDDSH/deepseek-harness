"""Acceptance check using the installed Graphify package and exporter."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class NativeGraphifyTest(unittest.TestCase):
    def test_official_export_includes_structural_community_names(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            graph_path = Path(directory) / "graph.json"
            graph_path.write_text(json.dumps({
                "directed": False, "multigraph": False, "graph": {},
                "nodes": [{"id": "a", "label": "Memory", "community": 0},
                          {"id": "b", "label": "Document", "community": 1}],
                "links": [{"source": "a", "target": "b"}],
            }), encoding="utf-8")
            script = Path(__file__).resolve().parents[1] / "graphify-native.py"
            subprocess.run([sys.executable, str(script), "export", "html", "--graph", str(graph_path)],
                           check=True, capture_output=True, timeout=30)
            labels_path = Path(directory) / ".graphify_labels.json"
            self.assertEqual(json.loads(labels_path.read_text()), {"0": "Memory", "1": "Document"})
            html = (Path(directory) / "graph.html").read_text(encoding="utf-8")
            self.assertIn("vis-network@9.1.6", html)
            self.assertIn("<h3>Communities</h3>", html)
            self.assertIn('"label": "Memory"', html)
            labels_path.write_text('{"0":"Existing name","1":"Document"}', encoding="utf-8")
            subprocess.run([sys.executable, str(script), "export", "html", "--graph", str(graph_path)],
                           check=True, capture_output=True, timeout=30)
            self.assertEqual(json.loads(labels_path.read_text())["0"], "Existing name")


if __name__ == "__main__":
    unittest.main()
