"""Invoke installed Graphify, supplying its structural labels for unlabeled exports."""
import json
import sys
from pathlib import Path

from graphify.__main__ import main
from graphify.cluster import label_communities_by_hub
from graphify.paths import write_json_atomic
from networkx.readwrite.json_graph import node_link_graph


def run() -> None:
    """Export native community labels when absent, then run the official CLI."""
    args = sys.argv[1:]
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
    sys.argv[0] = "graphify"
    main()


if __name__ == "__main__":
    run()
