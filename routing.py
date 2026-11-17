"""Dijkstra routing for the three nonnegative road costs."""

from dataclasses import dataclass
from heapq import heappop, heappush


STRATEGIES = {
    "distance": "distance_m",
    "time": "time_s",
    "surface": "surface_m",
}


@dataclass(frozen=True, slots=True)
class Edge:
    target: int
    name: str
    distance_m: float
    time_s: float
    surface_m: float


Graph = dict[int, list[Edge]]


def shortest_path(graph: Graph, start: int, end: int, strategy: str) -> list[Edge] | None:
    """Return the selected directed edges, or None if the destination is unreachable."""
    weight = STRATEGIES[strategy]
    costs = {start: 0.0}
    previous: dict[int, tuple[int, Edge]] = {}
    queue = [(0.0, start)]

    while queue:
        cost, node = heappop(queue)
        if cost != costs[node]:
            continue
        if node == end:
            break
        for edge in graph[node]:
            candidate = cost + getattr(edge, weight)
            if candidate < costs.get(edge.target, float("inf")):
                costs[edge.target] = candidate
                previous[edge.target] = (node, edge)
                heappush(queue, (candidate, edge.target))
    else:
        return None

    route = []
    while node != start:
        node, edge = previous[node]
        route.append(edge)
    route.reverse()
    return route
