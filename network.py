"""Load a fixed road snapshot and translate OSM roads into routing costs."""

from dataclasses import dataclass
from math import asin, cos, fsum, radians, sin, sqrt

from routing import Edge, Graph, search_graph, shortest_path


# Reference speed (km/h), traffic multiplier, default surface multiplier.
ROAD_PROFILES = {
    "motorway": (80, 1.45, 1.00),
    "motorway_link": (40, 1.35, 1.05),
    "trunk": (60, 1.70, 1.00),
    "trunk_link": (35, 1.35, 1.05),
    "primary": (50, 2.00, 1.04),
    "primary_link": (35, 1.35, 1.08),
    "secondary": (40, 1.50, 1.08),
    "secondary_link": (30, 1.25, 1.12),
    "tertiary": (35, 1.25, 1.14),
    "tertiary_link": (25, 1.20, 1.18),
    "residential": (25, 1.10, 1.28),
    "unclassified": (25, 1.15, 1.30),
    "living_street": (15, 1.05, 1.40),
}

SURFACE_FACTORS = {
    "asphalt": 1.00,
    "concrete": 1.04,
    "paved": 1.08,
    "paving_stones": 1.18,
    "sett": 1.30,
    "cobblestone": 1.35,
    "compacted": 1.45,
    "gravel": 1.60,
    "unpaved": 1.75,
    "ground": 1.80,
}


def segment_length(first: list[float], second: list[float]) -> float:
    """Return the great-circle distance between two [lon, lat] positions in metres."""
    lon1, lat1 = map(radians, first)
    lon2, lat2 = map(radians, second)
    chord = sin((lat2 - lat1) / 2) ** 2
    chord += cos(lat1) * cos(lat2) * sin((lon2 - lon1) / 2) ** 2
    return 2 * 6_371_008.8 * asin(min(1.0, sqrt(chord)))


@dataclass(slots=True)
class RoadNetwork:
    points: dict[int, list[float]]
    graph: Graph
    landmarks: dict[str, int]
    map_data: dict

    @classmethod
    def from_data(cls, data: dict) -> "RoadNetwork":
        points = {node: [lon, lat] for node, lon, lat in data["nodes"]}
        graph: Graph = {node: [] for node in points}
        map_roads = []

        for index, road in enumerate(data["roads"]):
            # A clipped OSM way may have several independent records in the snapshot.
            road_id = str(index)
            highway = road["highway"]
            speed, traffic, default_surface = ROAD_PROFILES[highway]
            surface = SURFACE_FACTORS.get(road["surface"], default_surface)
            name = road["name"] or "未命名道路"
            nodes = road["nodes"]
            map_roads.append({
                "id": road_id,
                "name": road["name"],
                "highway": highway,
                "points": [points[node] for node in nodes],
            })

            for first, second in zip(nodes, nodes[1:]):
                if first == second:
                    continue
                distance = segment_length(points[first], points[second])
                time = distance * 3.6 / speed * traffic
                surface_cost = distance * surface
                if road["oneway"] >= 0:
                    graph[first].append(Edge(second, name, distance, time, surface_cost, road_id))
                if road["oneway"] <= 0:
                    graph[second].append(Edge(first, name, distance, time, surface_cost, road_id))

        landmarks = {item["id"]: item["node"] for item in data["landmarks"]}
        map_data = {
            "bounds": data["bounds"],
            "roads": map_roads,
            "landmarks": [
                {"id": item["id"], "name": item["name"], "point": points[item["node"]]}
                for item in data["landmarks"]
            ],
        }
        return cls(points, graph, landmarks, map_data)

    def route(self, start: str, end: str, strategy: str) -> dict:
        start_node, end_node = self.landmarks[start], self.landmarks[end]
        edges = shortest_path(self.graph, start_node, end_node, strategy)
        return self.describe_route(start_node, edges)

    def search(self, start: str, end: str, strategy: str, closed_ids: set[str]) -> dict:
        source, target = self.landmarks[start], self.landmarks[end]
        trace = []
        result = search_graph(self.graph, source, target, strategy, closed_ids=closed_ids, trace=trace)
        edges = result.edges
        return {
            **self.describe_route(source, edges),
            "road_ids": [edge.road_id for edge in edges] if edges else [],
            "algorithm": "dijkstra",
            "trace": [[*self.points[node], *self.points[parent]] for node, parent in trace],
            "stats": {"visited": result.visited, "cost": result.cost},
        }

    def describe_route(self, start_node: int, edges: list[Edge] | None) -> dict:
        if edges is None:
            return {"status": "unreachable"}

        roads = []
        for edge in edges:
            if roads and roads[-1]["name"] == edge.name:
                roads[-1]["distance_m"] += edge.distance_m
            else:
                roads.append({"name": edge.name, "distance_m": edge.distance_m})

        return {
            "status": "ok",
            "points": [self.points[start_node], *(self.points[edge.target] for edge in edges)],
            "roads": roads,
            "distance_m": fsum(edge.distance_m for edge in edges),
            "time_s": fsum(edge.time_s for edge in edges),
            "surface_m": fsum(edge.surface_m for edge in edges),
        }
