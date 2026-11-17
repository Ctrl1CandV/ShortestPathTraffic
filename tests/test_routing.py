from routing import Edge, shortest_path


def test_routes_follow_the_selected_weight():
    direct = Edge(2, "直达路", 100, 30, 200)
    detour = Edge(3, "绕行路", 60, 5, 60)
    finish = Edge(2, "绕行路", 70, 5, 70)
    graph = {1: [direct, detour], 2: [], 3: [finish]}

    assert shortest_path(graph, 1, 2, "distance") == [direct]
    assert shortest_path(graph, 1, 2, "time") == [detour, finish]
    assert shortest_path(graph, 1, 2, "surface") == [detour, finish]


def test_handles_zero_distance_and_unreachable_reverse_direction():
    edge = Edge(2, "单行路", 10, 3, 11)
    graph = {1: [edge], 2: []}

    assert shortest_path(graph, 1, 1, "distance") == []
    assert shortest_path(graph, 1, 2, "distance") == [edge]
    assert shortest_path(graph, 2, 1, "distance") is None


def test_keeps_the_actual_edge_when_parallel_roads_are_optimal():
    slow = Edge(2, "短路", 9, 10, 10)
    fast = Edge(2, "快路", 10, 4, 10)
    graph = {1: [slow, fast], 2: []}

    assert shortest_path(graph, 1, 2, "distance") == [slow]
    assert shortest_path(graph, 1, 2, "time") == [fast]
    assert shortest_path(graph, 1, 2, "surface") in ([slow], [fast])
