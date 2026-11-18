"""Dijkstra and A* routing for nonnegative road costs."""

from collections.abc import Callable, Set
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
    estimate: Callable[[int], float] | None = None,
    trace: list[tuple[int, int]] | None = None,
) -> SearchResult:
    """A* with a consistent remaining-cost bound, or Dijkstra when omitted."""
    weight = STRATEGIES[strategy]
    costs = {start: 0.0}
    previous: dict[int, tuple[int, Edge]] = {}
    queue = [(0.0, start, 0.0)]
    visited = 0

    while queue:
        _, node, cost = heappop(queue)
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
                remaining = estimate(edge.target) if estimate else 0.0
                heappush(queue, (candidate + remaining, edge.target, candidate))
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
