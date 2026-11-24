"""Invoke installed Graphify, supplying its structural labels for unlabeled exports."""
import json
import argparse
import hashlib
import re
import sqlite3
import sys
import tempfile
from contextlib import closing
from pathlib import Path

from graphify.__main__ import main
from graphify.cluster import cluster, label_communities_by_hub
from graphify.build import build
from graphify.extract import extract
from graphify.paths import write_json_atomic
from networkx.readwrite.json_graph import node_link_graph, node_link_data


TOPIC_GLOB = "document:" + "?" * 64 + ":part:*"
TOPIC_PATTERN = re.compile(r"document:([a-f0-9]{64}):part:([1-9][0-9]*)")
TITLE_PATTERN = re.compile(r"(.+) \(([1-9][0-9]*)/([1-9][0-9]*)\)")
DEFAULT_MAX_DOCUMENTS = 500
MAX_REPORTED = 20
DEFAULT_MAX_SOURCE_BYTES = 64 * 1024 * 1024


def document_rows(connection: sqlite3.Connection, max_documents: int, max_source_bytes: int) -> list[tuple]:
    """Fetch active importer chunks after checking the document count and total text size."""
    count, size = connection.execute(
        "SELECT COUNT(DISTINCT projectId || ':' || substr(topicKey, 10, 64)), COALESCE(SUM(LENGTH(CAST(narrative AS BLOB))), 0) "
        "FROM observations WHERE topicKey GLOB ? AND status = 'active'", (TOPIC_GLOB,)).fetchone()
    if count > max_documents:
        raise ValueError(f"Memorix holds {count} imported documents, over the graph limit of {max_documents} "
                         "(maxGraphDocuments); archive documents or raise the limit")
    if size > max_source_bytes:
        raise ValueError(f"Memorix imported documents hold {size} bytes of text, over the graph limit of {max_source_bytes} "
                         "(maxGraphSourceBytes); archive documents or raise the limit")
    return connection.execute(
        "SELECT id, projectId, topicKey, title, narrative FROM observations WHERE topicKey GLOB ? AND status = 'active'",
        (TOPIC_GLOB,)).fetchall()


def group_chunks(rows: list[tuple]) -> tuple[dict[tuple[str, str, int], list[tuple[int, int, str, str]]], list[str]]:
    """Group importer chunks by project, file hash and part total; list the rows that were left out."""
    documents: dict[tuple[str, str, int], list[tuple[int, int, str, str]]] = {}
    skipped: list[str] = []
    for identifier, project, topic, title, narrative in rows:
        topic_match = TOPIC_PATTERN.fullmatch(topic)
        if topic_match is None:
            continue
        title_match = TITLE_PATTERN.fullmatch(title or "")
        if title_match is None:
            skipped.append(f"observation {identifier} ({topic}): title is not '<name> (<part>/<total>)'")
        elif int(topic_match[2]) != int(title_match[2]):
            skipped.append(f"observation {identifier} ({topic}): title part {title_match[2]} disagrees with the topic key")
        else:
            documents.setdefault((project, topic_match[1], int(title_match[3])), []).append(
                (int(topic_match[2]), int(title_match[3]), title_match[1], narrative))
    return documents, skipped


def memorix_graph(database: Path, graph_path: Path, max_documents: int = DEFAULT_MAX_DOCUMENTS,
                  max_source_bytes: int = DEFAULT_MAX_SOURCE_BYTES) -> None:
    """Rebuild the official structural graph from complete active document imports."""
    with closing(sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True)) as connection:
        rows = document_rows(connection, max_documents, max_source_bytes)
    documents, skipped = group_chunks(rows)
    for line in skipped[:MAX_REPORTED]:
        print("graphify-native skipped: " + line, file=sys.stderr)
    if len(skipped) > MAX_REPORTED:
        print(f"graphify-native skipped: {len(skipped) - MAX_REPORTED} more damaged chunks", file=sys.stderr)
    graph_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="memorix-graph-", dir=graph_path.parent) as directory:
        root = Path(directory)
        paths = []
        titles = {}
        for (project, digest, _), chunks in sorted(documents.items()):
            chunks.sort()
            total = chunks[0][1]
            if len(chunks) != total or any(part != index or count != total
                    for index, (part, count, _, _) in enumerate(chunks, 1)):
                continue
            identifier = hashlib.sha256((project + ":" + digest).encode()).hexdigest()
            title = chunks[0][2].replace("\n", " ").replace("\r", " ")
            filename = re.sub(r"[^\w .-]", "_", title).strip(" .") or "Document"
            path = root / identifier / (Path(filename).stem + ".md")
            path.parent.mkdir()
            path.write_text("# " + title + "\n\n" + "".join(chunk[3] for chunk in chunks), encoding="utf-8")
            paths.append(path)
            titles[path.relative_to(root).as_posix()] = title
        graph = build([extract(paths, root=root, cache_root=root, parallel=False)], root=root)
        for _, attributes in graph.nodes(data=True):
            source = attributes.get("source_file")
            if source in titles and attributes.get("label") == source:
                attributes["label"] = titles[source]
        communities = cluster(graph)
        for community, nodes in communities.items():
            for node in nodes:
                graph.nodes[node]["community"] = community
        labels = label_communities_by_hub(graph, communities)
        write_json_atomic(graph_path.parent / ".graphify_labels.json", labels)
        write_json_atomic(graph_path, node_link_data(graph, edges="links"))


def run() -> None:
    """Export native community labels when absent, then run the official CLI."""
    args = sys.argv[1:]
    if args[:1] == ["--memorix-database"]:
        database = Path(args[1])
        args = args[2:]
        if args[:2] == ["export", "html"] and "--graph" in args:
            memorix_graph(database, Path(args[args.index("--graph") + 1]))
    if args[:1] == ["memorix"]:
        parser = argparse.ArgumentParser()
        parser.add_argument("--database", type=Path, required=True)
        parser.add_argument("--graph", type=Path, required=True)
        parser.add_argument("--max-documents", type=int, default=DEFAULT_MAX_DOCUMENTS)
        parser.add_argument("--max-source-bytes", type=int, default=DEFAULT_MAX_SOURCE_BYTES)
        options = parser.parse_args(args[1:])
        memorix_graph(options.database, options.graph, options.max_documents, options.max_source_bytes)
        args = ["export", "html", "--graph", str(options.graph)]
    if args[:2] == ["export", "html"] and "--graph" in args:
        graph_path = Path(args[args.index("--graph") + 1])
        labels_path = graph_path.parent / ".graphify_labels.json"
        if not labels_path.exists():
            graph = node_link_graph(json.loads(graph_path.read_text(encoding="utf-8")), edges="links")
            communities: dict[int, list[str]] = {}
            for node, attributes in graph.nodes(data=True):
                if "community" in attributes:
                    communities.setdefault(int(attributes["community"]), []).append(node)
            write_json_atomic(labels_path, label_communities_by_hub(graph, communities))
    sys.argv = ["graphify", *args]
    main()


if __name__ == "__main__":
    run()
