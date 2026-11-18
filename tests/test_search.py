import json
from pathlib import Path

import networkx as nx
import pytest

from network import ROAD_PROFILES, SURFACE_FACTORS, RoadNetwork, segment_length


def road(way_id, name, nodes, *, direction=0, surface="asphalt"):
    return {
        "id": way_id,
        "name": name,
        "highway": "residential",
        "surface": surface,
        "oneway": direction,
        "nodes": nodes,
    }


@pytest.fixture
def small_network():
    return RoadNetwork.from_data({
        "bounds": [0, 0, 0.002, 0.001],
        "nodes": [[1, 0, 0], [2, 0, 0.0005], [3, 0.001, 0], [4, 0.002, 0]],
        "roads": [
            road(10, "直达路", [1, 3, 4]),
            road(20, "支路", [1, 2]),
        ],
        "landmarks": [
            {"id": "S", "name": "西", "node": 1},
            {"id": "T", "name": "东", "node": 4},
        ],
    })


@pytest.mark.parametrize("algorithm", ["dijkstra", "astar"])
def test_trace_records_the_real_expansion_order_and_parent(small_network, algorithm):
    result = small_network.search("S", "T", "distance", algorithm, set())
    trace = [[0, 0, 0, 0], [0.001, 0, 0, 0], [0.002, 0, 0.001, 0]]
    if algorithm == "dijkstra":
        trace.insert(1, [0, 0.0005, 0, 0])
    assert result["trace"] == trace
    assert result["algorithm"] == algorithm
    assert result["stats"]["dijkstra"]["visited"] == 4
    assert result["stats"]["astar"]["visited"] == 3
    for stats in result["stats"].values():
        assert stats["cost"] == pytest.approx(222.39, abs=0.01)


@pytest.mark.parametrize("algorithm", ["dijkstra", "astar"])
def test_closing_one_record_preserves_parallel_roads_and_directions(algorithm):
    # Two records of the same OSM way can survive clipping as separate pieces.
    network = RoadNetwork.from_data({
        "bounds": [0, 0, 0.001, 0.001],
        "nodes": [[1, 0, 0], [2, 0.001, 0]],
        "roads": [
            road(10, "双向路", [1, 2]),
            road(10, "单行路", [1, 2], direction=-1, surface="ground"),
        ],
        "landmarks": [
            {"id": "A", "name": "甲", "node": 1},
            {"id": "B", "name": "乙", "node": 2},
        ],
    })
    assert [line["id"] for line in network.map_data["roads"]] == ["0", "1"]

    opened = network.search("B", "A", "surface", algorithm, set())
    closed = network.search("B", "A", "surface", algorithm, {"0"})
    blocked = network.search("A", "B", "surface", algorithm, {"0"})
    restored = network.search("B", "A", "surface", algorithm, set())
    assert opened["roads"][0]["name"] == "双向路"
    assert closed["roads"][0]["name"] == "单行路"
    assert closed["surface_m"] == pytest.approx(1.8 * opened["surface_m"])
    assert blocked["status"] == "unreachable"
    assert blocked["trace"] == [[0, 0, 0, 0]]
    assert all(stats == {"visited": 1, "cost": None} for stats in blocked["stats"].values())
    assert restored == opened


def test_same_place_with_all_roads_closed(small_network):
    result = small_network.search("S", "S", "time", "astar", {"0", "1"})
    assert result["points"] == [[0, 0]]
    assert result["roads"] == []
    assert result["trace"] == [[0, 0, 0, 0]]
    assert all(stats == {"visited": 1, "cost": 0} for stats in result["stats"].values())


@pytest.mark.parametrize("algorithm", ["dijkstra", "astar"])
def test_equal_cost_routes_return_one_complete_path(algorithm):
    network = RoadNetwork.from_data({
        "bounds": [-0.001, 0, 0.001, 0.002],
        "nodes": [[1, 0, 0], [2, -0.001, 0.001], [3, 0.001, 0.001], [4, 0, 0.002]],
        "roads": [road(1, "西线", [1, 2, 4]), road(2, "东线", [1, 3, 4])],
        "landmarks": [{"id": "S", "name": "南", "node": 1}, {"id": "N", "name": "北", "node": 4}],
    })
    result = network.search("S", "N", "distance", algorithm, set())
    assert result["road_ids"] in (["0", "0"], ["1", "1"])
    assert result["distance_m"] == pytest.approx(314.51, abs=0.01)


def build_reference(data, closed):
    """Build a separate directed graph from the serialized roads."""
    coords = {node: [lon, lat] for node, lon, lat in data["nodes"]}
    graph = nx.MultiDiGraph()
    graph.add_nodes_from(coords)
    for index, road_data in enumerate(data["roads"]):
        road_id = str(index)
        if road_id in closed:
            continue
        speed, traffic, default_surface = ROAD_PROFILES[road_data["highway"]]
        surface = SURFACE_FACTORS.get(road_data["surface"], default_surface)
        for first, second in zip(road_data["nodes"], road_data["nodes"][1:]):
            distance = segment_length(coords[first], coords[second])
            costs = {
                "distance_m": distance,
                "time_s": distance / speed * 3.6 * traffic,
                "surface_m": distance * surface,
            }
            if road_data["oneway"] in (0, 1):
                graph.add_edge(first, second, key=road_id, **costs)
            if road_data["oneway"] in (0, -1):
                graph.add_edge(second, first, key=road_id, **costs)
    return graph


@pytest.mark.parametrize(("file", "closure"), [
    ("data/tianjin.json", "253"),
    ("data/beijing.json", "82"),
    ("examples/jinan.json", "70"),
])
def test_demo_search_matches_networkx_after_road_edits(file, closure):
    root = Path(__file__).resolve().parents[1]
    data = json.loads((root / file).read_text(encoding="utf-8"))
    network = RoadNetwork.from_data(data)
    demo = data.get("demo", {"start": "wudadao-park", "end": "tianjin-concert-hall"})
    start, end = demo["start"], demo["end"]
    lengths = []
    for closed in (set(), {closure}, set()):
        oracle = build_reference(data, closed)
        for strategy, metric in (("distance", "distance_m"), ("time", "time_s"), ("surface", "surface_m")):
            expected = nx.shortest_path_length(
                oracle, network.landmarks[start], network.landmarks[end], weight=metric
            )
            for algorithm in ("dijkstra", "astar"):
                result = network.search(start, end, strategy, algorithm, closed)
                assert result["status"] == "ok"
                assert result[metric] == pytest.approx(expected)
                assert all(item["cost"] == pytest.approx(expected) for item in result["stats"].values())
                assert len(result["trace"]) == result["stats"][algorithm]["visited"]
                assert len(result["road_ids"]) == len(result["points"]) - 1
                assert closed.isdisjoint(result["road_ids"])
            if strategy == "distance":
                lengths.append(expected)
    assert lengths[0] < lengths[1]
    assert lengths[0] == lengths[2]
