from math import fsum, isfinite

import networkx as nx
import pytest

from app import DEMO, load_network
from network import RoadNetwork
from routing import shortest_path


def test_reverse_oneway_and_metrics_come_from_the_actual_driven_edges():
    network = RoadNetwork.from_data(
        {
            "bounds": [0.0, 0.0, 0.002, 0.002],
            "nodes": [[10, 0.0, 0.0], [11, 0.001, 0.0], [12, 0.002, 0.0]],
            "roads": [
                {
                    "id": 99,
                    "name": "示例路",
                    "highway": "residential",
                    "surface": "asphalt",
                    "oneway": -1,
                    "nodes": [10, 11, 12],
                }
            ],
            "landmarks": [
                {"id": "west", "name": "西端", "node": 10},
                {"id": "east", "name": "东端", "node": 12},
            ],
        }
    )

    forward = network.route("west", "east", "distance")
    reverse = network.route("east", "west", "distance")

    assert forward == {"status": "unreachable"}
    assert reverse["points"] == [[0.002, 0.0], [0.001, 0.0], [0.0, 0.0]]
    assert reverse["distance_m"] == pytest.approx(222.39, abs=0.01)
    assert reverse["time_s"] == pytest.approx(35.23, abs=0.01)
    assert reverse["surface_m"] == pytest.approx(222.39, abs=0.01)
    assert len(reverse["roads"]) == 1
    assert reverse["roads"][0]["name"] == "示例路"
    assert reverse["roads"][0]["distance_m"] == reverse["distance_m"]


@pytest.fixture(scope="module")
def tianjin():
    return load_network()


@pytest.fixture(scope="module")
def reference_graph(tianjin):
    graph = nx.MultiDiGraph()
    graph.add_nodes_from(tianjin.points)
    for node, edges in tianjin.graph.items():
        for edge in edges:
            graph.add_edge(
                node, edge.target,
                distance_m=edge.distance_m, time_s=edge.time_s, surface_m=edge.surface_m,
            )
    return graph


@pytest.mark.parametrize(
    ("strategy", "attribute"),
    [("distance", "distance_m"), ("time", "time_s"), ("surface", "surface_m")],
)
@pytest.mark.parametrize(
    ("start", "end"),
    [("minyuan", "xiaobailou"), ("binjiangdao", "munan-park"), ("tfsu", "wudadao-park")],
)
def test_tianjin_costs_match_networkx(tianjin, reference_graph, strategy, attribute, start, end):
    start_node, end_node = tianjin.landmarks[start], tianjin.landmarks[end]
    edges = shortest_path(tianjin.graph, start_node, end_node, strategy)
    assert edges

    node = start_node
    for edge in edges:
        assert edge in tianjin.graph[node]
        assert all(isfinite(value) and value >= 0 for value in (
            edge.distance_m, edge.time_s, edge.surface_m,
        ))
        node = edge.target
    assert node == end_node

    result = tianjin.route(start, end, strategy)
    assert result["status"] == "ok"
    assert result["points"] == [tianjin.points[start_node], *(tianjin.points[e.target] for e in edges)]
    assert result[attribute] == pytest.approx(
        nx.shortest_path_length(reference_graph, start_node, end_node, weight=attribute)
    )
    assert result["distance_m"] == pytest.approx(fsum(edge.distance_m for edge in edges))
    assert result["time_s"] == pytest.approx(fsum(edge.time_s for edge in edges))
    assert result["surface_m"] == pytest.approx(fsum(edge.surface_m for edge in edges))
    assert result["distance_m"] == pytest.approx(fsum(road["distance_m"] for road in result["roads"]))


def test_demo_pair_changes_route_under_different_weights(tianjin):
    start, end = DEMO["start"], DEMO["end"]
    paths = [tianjin.route(start, end, strategy) for strategy in ("distance", "time", "surface")]

    assert all(path["status"] == "ok" for path in paths)
    assert len({tuple(map(tuple, path["points"])) for path in paths}) >= 2
