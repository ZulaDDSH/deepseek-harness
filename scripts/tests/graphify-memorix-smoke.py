"""Run with the configured Graphify Python interpreter to verify document-only rebuilds."""
import hashlib
import importlib.util
import json
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path

adapter = Path(__file__).resolve().parents[1] / "graphify-native.py"
spec = importlib.util.spec_from_file_location("graphify_native", adapter)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    database = root / "memorix.db"
    graph_path = root / "graph.json"
    with closing(sqlite3.connect(database)) as connection:
        connection.execute("CREATE TABLE observations(projectId TEXT, topicKey TEXT, title TEXT, narrative TEXT, status TEXT)")
        for name, text, part, total, status in [
            ("Guide", "# Alpha\n\n## Details\nShared explanation.", 1, 1, "active"),
            ("Pending", "# Partial", 1, 2, "active"),
            ("Archived", "# Hidden", 1, 1, "archived"),
        ]:
            digest = hashlib.sha256(name.encode()).hexdigest()
            connection.execute("INSERT INTO observations VALUES (?, ?, ?, ?, ?)",
                ("fixture", f"document:{digest}:part:{part}", f"{name}.md ({part}/{total})", text, status))
        connection.commit()
    module.memorix_graph(database, graph_path)
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    labels = [node["label"] for node in graph["nodes"]]
    assert any("Alpha" in label for label in labels), labels
    assert not any("/Guide.md" in label for label in labels), labels
    assert not any("Partial" in label or "Hidden" in label for label in labels), labels
    assert graph["links"], "Official Markdown extraction must retain heading relationships"
    assert all("community" in node for node in graph["nodes"])
    identifiers = {node["id"] for node in graph["nodes"]}
    module.memorix_graph(database, graph_path)
    assert identifiers == {node["id"] for node in json.loads(graph_path.read_text())["nodes"]}
    previous = graph_path.read_bytes()
    try:
        module.memorix_graph(root / "absent.db", graph_path)
    except sqlite3.OperationalError:
        pass
    else:
        raise AssertionError("Missing database must fail without creating a replacement")
    assert graph_path.read_bytes() == previous
    with closing(sqlite3.connect(database)) as connection:
        connection.execute("UPDATE observations SET status = 'archived'")
        connection.commit()
    module.memorix_graph(database, graph_path)
    assert json.loads(graph_path.read_text())["nodes"] == []
print("PASS: official document extraction, partial/archived exclusion, stable ids, failure preservation")
