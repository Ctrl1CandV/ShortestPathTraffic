"""Dijkstra routing for nonnegative road costs."""

from collections.abc import Set
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
    road_id: str = ""


Graph = dict[int, list[Edge]]


@dataclass(slots=True)
class SearchResult:
    edges: list[Edge] | None
    cost: float | None
    visited: int


def search_graph(
    graph: Graph,
    start: int,
    end: int,
    strategy: str,
    *,
    closed_ids: Set[str] = frozenset(),
    trace: list[tuple[int, int]] | None = None,
) -> SearchResult:
    """Settle vertices by cumulative cost; optionally record the search tree."""
    weight = STRATEGIES[strategy]
    costs = {start: 0.0}
    previous: dict[int, tuple[int, Edge]] = {}
    queue = [(0.0, start)]
    visited = 0

    while queue:
        cost, node = heappop(queue)
        if cost != costs[node]:
            continue
        visited += 1
        if trace is not None:
            parent = start if node == start else previous[node][0]
            trace.append((node, parent))
        if node == end:
            break
        for edge in graph[node]:
            if edge.road_id in closed_ids:
                continue
            candidate = cost + getattr(edge, weight)
            if candidate < costs.get(edge.target, float("inf")):
                costs[edge.target] = candidate
                previous[edge.target] = (node, edge)
                heappush(queue, (candidate, edge.target))
    else:
        return SearchResult(None, None, visited)

    route = []
    while node != start:
        node, edge = previous[node]
        route.append(edge)
    route.reverse()
    return SearchResult(route, costs[end], visited)


def shortest_path(graph: Graph, start: int, end: int, strategy: str) -> list[Edge] | None:
    return search_graph(graph, start, end, strategy).edges
