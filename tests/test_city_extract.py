import json
from pathlib import Path

import networkx as nx
import pytest


ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize(
    ("relative_path", "expected_id"),
    [("data/beijing.json", "beijing"), ("examples/jinan.json", "jinan")],
)
def test_offline_city_packs_have_routable_places_and_a_demo(relative_path, expected_id):
    city = json.loads((ROOT / relative_path).read_text(encoding="utf-8"))
    places = {place["id"]: place["node"] for place in city["landmarks"]}
    coordinates = {point[0] for point in city["nodes"]}

    assert city["city_id"] == expected_id
    assert city["license"] == "ODbL-1.0"
    assert city["source_url"].startswith("https://api.openstreetmap.org/api/0.6/map?bbox=")
    assert len(set(places.values())) == len(places) >= 4

    graph = nx.DiGraph()
    for road in city["roads"]:
        assert set(road["nodes"]) <= coordinates
        for first, second in zip(road["nodes"], road["nodes"][1:]):
            if road["oneway"] >= 0:
                graph.add_edge(first, second)
            if road["oneway"] <= 0:
                graph.add_edge(second, first)
    assert any(set(places.values()) <= component for component in nx.strongly_connected_components(graph))
    start, end = places[city["demo"]["start"]], places[city["demo"]["end"]]
    assert start != end
