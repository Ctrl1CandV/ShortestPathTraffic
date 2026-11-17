"""Download the Tianjin OpenStreetMap extract and prepare the offline snapshot."""

import json
from datetime import date, datetime, timedelta, timezone
from itertools import groupby
from math import cos, hypot, radians
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET


REQUEST_BOUNDS = (117.193, 39.102, 117.220, 39.126)
DISPLAY_BOUNDS = (117.192, 39.101, 117.221, 39.127)
SOURCE_URL = (
    "https://api.openstreetmap.org/api/0.6/map?bbox="
    + ",".join(f"{coordinate:.3f}" for coordinate in REQUEST_BOUNDS)
)
OUTPUT = Path(__file__).resolve().parents[1] / "data" / "tianjin.json"
CHINA_TIME = timezone(timedelta(hours=8))

ROAD_TYPES = {
    "motorway", "motorway_link", "trunk", "trunk_link",
    "primary", "primary_link", "secondary", "secondary_link",
    "tertiary", "tertiary_link", "unclassified", "residential", "living_street",
}
ACCESS_KEYS = ("motorcar", "motor_vehicle", "vehicle", "access")
RESTRICTED_ACCESS = {
    "no", "private", "delivery", "destination", "customers", "permit",
    "agricultural", "forestry", "emergency",
}
DIRECTION_VALUES = {
    "yes": 1, "true": 1, "1": 1,
    "no": 0, "false": 0, "0": 0,
    "-1": -1,
}

# Place identifiers refer to OSM nodes or areas. Route endpoints are nearby road nodes.
LANDMARKS = (
    ("minyuan", "民园广场", "way", 1352895262),
    ("xiaobailou", "小白楼", "node", 274812260),
    ("wudadao-park", "五大道公园", "way", 1228253039),
    ("munan-park", "睦南公园", "way", 842783278),
    ("tfsu", "天津外国语大学（马场道校区）", "way", 961053101),
    ("tianjin-concert-hall", "天津音乐厅", "node", 1202964606),
    ("hisense-plaza", "海信广场", "way", 678547640),
    ("binjiangdao", "河北路滨江道", "node", 5588338624),
)


def allows_motorcar(tags: dict[str, str], direction: str) -> bool:
    """Honor the first applicable access tag, from specific to general."""
    for key in ACCESS_KEYS:
        value = tags.get(f"{key}:{direction}", tags.get(key))
        if value is not None:
            return value not in RESTRICTED_ACCESS
    return True


def road_direction(tags: dict[str, str]) -> int | None:
    oneway = tags.get("oneway:motorcar", tags.get("oneway:motor_vehicle", tags.get("oneway")))
    if oneway is None:
        direction = int(tags.get("junction") == "roundabout" or tags["highway"] == "motorway")
    else:
        # Alternating and reversible roads have no fixed direction in this model.
        direction = DIRECTION_VALUES.get(oneway)
        if direction is None:
            return None
    forward = direction >= 0 and allows_motorcar(tags, "forward")
    backward = direction <= 0 and allows_motorcar(tags, "backward")
    if not (forward or backward):
        return None
    return int(forward) - int(backward)


def reachable(start: int, adjacency: dict[int, set[int]]) -> set[int]:
    visited = {start}
    pending = [start]
    while pending:
        for neighbor in adjacency[pending.pop()] - visited:
            visited.add(neighbor)
            pending.append(neighbor)
    return visited


def distance_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    longitude_scale = cos(radians((a[1] + b[1]) / 2))
    return 111_320 * hypot((a[0] - b[0]) * longitude_scale, a[1] - b[1])


def snap_landmarks(landmarks, all_nodes, osm_ways, road_nodes, roads) -> list[dict]:
    anchors = []
    for landmark_id, name, kind, osm_id in landmarks:
        if kind == "node":
            center = all_nodes[osm_id]
        else:
            refs = dict.fromkeys(int(ref.attrib["ref"]) for ref in osm_ways[osm_id].findall("nd"))
            points = [all_nodes[ref] for ref in refs]
            center = tuple(sum(axis) / len(axis) for axis in zip(*points))
        anchors.append((landmark_id, name, center))

    forward = {node: set() for node in road_nodes}
    backward = {node: set() for node in road_nodes}
    for road in roads:
        for a, b in zip(road["nodes"], road["nodes"][1:]):
            if road["oneway"] >= 0:
                forward[a].add(b)
                backward[b].add(a)
            if road["oneway"] <= 0:
                forward[b].add(a)
                backward[a].add(b)

    first_center = anchors[0][2]
    seed = min(road_nodes, key=lambda node: (distance_m(road_nodes[node], first_center), node))
    candidates = reachable(seed, forward) & reachable(seed, backward)

    snapped = []
    for landmark_id, name, center in anchors:
        node = min(candidates, key=lambda node: (distance_m(road_nodes[node], center), node))
        if distance_m(road_nodes[node], center) > 250:
            raise ValueError(f"Landmark too far from a routable node: {landmark_id}")
        snapped.append({"id": landmark_id, "name": name, "node": node})
        candidates.remove(node)
    return snapped


def build_snapshot(osm: ET.Element, extracted_on: date, landmarks=LANDMARKS) -> dict:
    all_nodes = {
        int(node.attrib["id"]): (float(node.attrib["lon"]), float(node.attrib["lat"]))
        for node in osm.findall("node")
    }
    osm_ways = {int(way.attrib["id"]): way for way in osm.findall("way")}
    west, south, east, north = DISPLAY_BOUNDS
    in_bounds = {
        node_id for node_id, (lon, lat) in all_nodes.items()
        if west <= lon <= east and south <= lat <= north
    }
    roads = []
    for way_id, way in sorted(osm_ways.items()):
        tags = {tag.attrib["k"]: tag.attrib["v"] for tag in way.findall("tag")}
        highway = tags.get("highway")
        if highway not in ROAD_TYPES:
            continue
        oneway = road_direction(tags)
        if oneway is None:
            continue
        refs = [int(ref.attrib["ref"]) for ref in way.findall("nd")]
        runs = [list(run) for kept, run in groupby(refs, key=in_bounds.__contains__) if kept]
        for index, run in enumerate(runs):
            if len(run) < 2:
                continue
            road = {
                "id": way_id,
                "name": tags.get("name:zh") or tags.get("name"),
                "highway": highway,
                "surface": tags.get("surface"),
                "oneway": oneway,
                "nodes": run,
            }
            if len(runs) > 1:
                road["segment"] = index
            roads.append(road)
    if not roads:
        raise ValueError("The OSM extract contains no drivable roads.")

    road_node_ids = sorted({node_id for road in roads for node_id in road["nodes"]})
    road_nodes = {node: all_nodes[node] for node in road_node_ids}
    return {
        "bounds": list(DISPLAY_BOUNDS),
        "source_url": SOURCE_URL,
        "extracted_on": extracted_on.isoformat(),
        "nodes": [[node_id, *road_nodes[node_id]] for node_id in road_node_ids],
        "roads": roads,
        "landmarks": snap_landmarks(landmarks, all_nodes, osm_ways, road_nodes, roads) if landmarks else [],
    }


def write_snapshot(snapshot: dict) -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    output = NamedTemporaryFile("w", encoding="utf-8", dir=OUTPUT.parent, delete=False)
    temporary = Path(output.name)
    try:
        with output:
            json.dump(snapshot, output, ensure_ascii=False, indent=2)
            output.write("\n")
        temporary.replace(OUTPUT)
    finally:
        temporary.unlink(missing_ok=True)
    print(f"{OUTPUT.name}: {len(snapshot['roads'])} roads, {len(snapshot['nodes'])} nodes")


def main() -> None:
    request = Request(SOURCE_URL, headers={"User-Agent": "ShortestPathTrafficCourseProject/1.0"})
    with urlopen(request, timeout=60) as response:
        root = ET.parse(response).getroot()
    write_snapshot(build_snapshot(root, datetime.now(CHINA_TIME).date()))


if __name__ == "__main__":
    main()
