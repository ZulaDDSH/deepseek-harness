import importlib.util
import sqlite3
import sys
import types
from pathlib import Path

import networkx
import pytest

HASH_A = "a" * 64
HASH_B = "b" * 64
SOURCE = Path(__file__).with_name("graphify-native.py")


@pytest.fixture
def adapter(monkeypatch):
    built = []

    def module(name, **members):
        stub = types.ModuleType(name)
        stub.__dict__.update(members)
        monkeypatch.setitem(sys.modules, name, stub)

    def extract(paths, root, cache_root, parallel):
        built.append({path.relative_to(root).parts[-1]: path.read_text(encoding="utf-8") for path in paths})
        return {}

    module("graphify")
    module("graphify.__main__", main=lambda: None)
    module("graphify.cluster", cluster=lambda graph: {}, label_communities_by_hub=lambda graph, communities: {})
    module("graphify.build", build=lambda parts, root: networkx.Graph())
    module("graphify.extract", extract=extract)
    module("graphify.paths", write_json_atomic=lambda path, data: Path(path).write_text("{}", encoding="utf-8"))
    spec = importlib.util.spec_from_file_location("graphify_native_under_test", SOURCE)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    loaded.built = built
    return loaded


def database(tmp_path, rows):
    path = tmp_path / "memorix.db"
    connection = sqlite3.connect(path)
    connection.execute("CREATE TABLE observations(id INTEGER PRIMARY KEY, projectId TEXT, topicKey TEXT, title TEXT, narrative TEXT, status TEXT)")
    connection.executemany("INSERT INTO observations(projectId, topicKey, title, narrative, status) VALUES (?, ?, ?, ?, ?)", rows)
    connection.commit()
    connection.close()
    return path


def chunk(digest, part, total, text, name="guide.md", status="active"):
    return ("p", f"document:{digest}:part:{part}", f"{name} ({part}/{total})", text, status)


def test_unrelated_prefix_and_damaged_chunk_do_not_block_valid_documents(adapter, tmp_path, capsys):
    rows = [
        chunk(HASH_A, 1, 2, "alpha "), chunk(HASH_A, 2, 2, "omega"),
        ("p", "document:design-notes", "Design notes", "unrelated memory", "active"),
        ("p", f"document:{HASH_B}:part:1", "no part suffix", "damaged", "active"),
    ]
    adapter.memorix_graph(database(tmp_path, rows), tmp_path / "out" / "graph.json")
    assert [list(documents.values()) for documents in adapter.built] == [["# guide.md\n\nalpha omega"]]
    assert "graphify-native skipped: observation 4 (document:" + HASH_B + ":part:1)" in capsys.readouterr().err


def test_stale_parts_from_an_earlier_chunk_size_do_not_hide_the_new_import(adapter, tmp_path):
    rows = [
        chunk(HASH_A, 1, 2, "new one "), chunk(HASH_A, 2, 2, "new two"),
        chunk(HASH_A, 3, 4, "old three"), chunk(HASH_A, 4, 4, "old four"),
    ]
    adapter.memorix_graph(database(tmp_path, rows), tmp_path / "out" / "graph.json")
    assert [list(documents.values()) for documents in adapter.built] == [["# guide.md\n\nnew one new two"]]


def test_documents_and_bytes_are_bounded_before_any_narrative_is_read(adapter, tmp_path):
    rows = [chunk(HASH_A, 1, 1, "x" * 10), chunk(HASH_B, 1, 1, "y" * 10, name="other.md")]
    path = database(tmp_path, rows)
    with pytest.raises(ValueError, match="2 imported documents.*limit of 1"):
        adapter.memorix_graph(path, tmp_path / "out" / "graph.json", max_documents=1)
    with pytest.raises(ValueError, match="20 bytes.*limit of 19"):
        adapter.memorix_graph(path, tmp_path / "out" / "graph.json", max_source_bytes=19)
    assert adapter.built == []
    adapter.memorix_graph(path, tmp_path / "out" / "graph.json", max_documents=2, max_source_bytes=20)
    assert len(adapter.built) == 1


def test_archived_chunks_are_ignored_by_the_limits(adapter, tmp_path):
    rows = [chunk(HASH_A, 1, 1, "x" * 100, status="archived"), chunk(HASH_B, 1, 1, "ok", name="other.md")]
    adapter.memorix_graph(database(tmp_path, rows), tmp_path / "out" / "graph.json", max_documents=1, max_source_bytes=10)
    assert [list(documents.values()) for documents in adapter.built] == [["# other.md\n\nok"]]


def test_damaged_chunk_reports_are_capped(adapter, tmp_path, capsys):
    rows = [("p", f"document:{HASH_A}:part:{index}", "broken", "x", "active") for index in range(1, 31)]
    adapter.memorix_graph(database(tmp_path, rows), tmp_path / "out" / "graph.json")
    lines = capsys.readouterr().err.splitlines()
    assert len(lines) == 21 and lines[-1] == "graphify-native skipped: 10 more damaged chunks"
