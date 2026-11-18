"""Validate offline city packs and keep user-imported copies in the project."""

import json
import os
import re
from dataclasses import dataclass
from datetime import date
from ipaddress import IPv4Address, IPv6Address
from pathlib import Path
from tempfile import NamedTemporaryFile
from threading import RLock
from urllib.parse import unquote, urlsplit

from network import ROAD_PROFILES, RoadNetwork
from routing import STRATEGIES


ROOT = Path(__file__).resolve().parent
DATA_FILE = ROOT / "data" / "tianjin.json"
DEMO = {"start": "wudadao-park", "end": "tianjin-concert-hall", "strategy": "distance"}
TIANJIN_METADATA = {
    "city_id": "tianjin", "city_name": "天津", "area_name": "五大道—小白楼",
    "demo": DEMO, "license": "ODbL-1.0",
}
BUILTINS = {"tianjin": DATA_FILE, "beijing": ROOT / "data" / "beijing.json"}
CITY_ID = re.compile(r"[a-z][a-z0-9_-]{0,63}")
HOST_LABEL = re.compile(r"[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?")


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def coordinate(value, low, high):
    return type(value) in (int, float) and low <= value <= high


def valid_source_url(source):
    """Check the HTTP authority locally, including internationalized host names."""
    try:
        url = urlsplit(source)
        if url.scheme not in {"http", "https"} or not url.hostname or url.port == 0:
            return False
        if any(c.isspace() for c in url.netloc) or "\\" in url.netloc:
            return False

        authority = url.netloc.rsplit("@", 1)[-1]
        if authority.startswith("["):
            if "%" in authority or not re.fullmatch(r"\[[^\]]+\](?::[0-9]*)?", authority):
                return False
            IPv6Address(url.hostname)
            return True

        host = unquote(url.hostname, errors="strict").encode("idna").decode("ascii").removesuffix(".")
        labels = host.split(".")
        if len(host) > 253 or not all(HOST_LABEL.fullmatch(label) for label in labels):
            return False
        # A numeric final label makes browsers interpret this as an IPv4 address.
        if re.fullmatch(r"[0-9]+|0[xX][0-9a-fA-F]*", labels[-1]):
            IPv4Address(host)
        for label in labels:
            if label.lower().startswith("xn--"):
                label[4:].encode("ascii").decode("punycode").encode("idna")
        return True
    except (ValueError, UnicodeError):
        return False


def validate_pack(pack):
    if not isinstance(pack, dict):
        raise ValueError("城市包须为 JSON 对象。")
    for key in ("city_id", "city_name", "area_name", "source_url", "license", "extracted_on"):
        if not nonempty(pack.get(key)):
            raise ValueError(f"城市包字段 {key} 缺失或为空。")
    if not CITY_ID.fullmatch(pack["city_id"]):
        raise ValueError("城市标识须以小写字母开头，使用小写字母、数字、下划线或短横线，最多 64 个字符。")
    try:
        date.fromisoformat(pack["extracted_on"])
    except ValueError:
        raise ValueError("提取日期应为 YYYY-MM-DD。") from None
    if not valid_source_url(pack["source_url"]):
        raise ValueError("数据来源应为有效的 HTTP 或 HTTPS 地址，请检查主机名、IP 和端口。")

    bounds = pack.get("bounds")
    if not isinstance(bounds, list) or len(bounds) != 4:
        raise ValueError("缺少有效的地图边界。")
    west, south, east, north = bounds
    if not (coordinate(west, -180, 180) and coordinate(east, -180, 180) and west < east
            and coordinate(south, -90, 90) and coordinate(north, -90, 90) and south < north):
        raise ValueError("地图边界的经纬度或顺序有误。")
    for key in ("nodes", "roads", "landmarks"):
        if not isinstance(pack.get(key), list) or not pack[key]:
            raise ValueError(f"城市包需要非空的 {key} 列表。")

    nodes = set()
    for item in pack["nodes"]:
        if not isinstance(item, list) or len(item) != 3:
            raise ValueError("节点应包含编号、经度和纬度。")
        identifier, lon, lat = item
        if (type(identifier) is not int or identifier in nodes or
                not coordinate(lon, west, east) or not coordinate(lat, south, north)):
            raise ValueError("节点编号重复、格式错误或坐标超出地图边界。")
        nodes.add(identifier)

    used_nodes = set()
    for road in pack["roads"]:
        if not isinstance(road, dict) or not {"id", "nodes", "name", "surface", "highway", "oneway"} <= road.keys():
            raise ValueError("道路线形缺少必要字段。")
        if (type(road["id"]) is not int or not isinstance(road["highway"], str)
                or road["highway"] not in ROAD_PROFILES or type(road["oneway"]) is not int
                or road["oneway"] not in (-1, 0, 1)):
            raise ValueError("道路编号、道路类别或单行方向无效。")
        if any(value is not None and not isinstance(value, str) for value in (road["name"], road["surface"])):
            raise ValueError("路名和材质应为文本或 null。")
        refs = road["nodes"]
        if not isinstance(refs, list) or len(refs) < 2 or any(type(n) is not int or n not in nodes for n in refs):
            raise ValueError("道路引用了无效节点或缺少连续线段。")
        used_nodes.update(refs)

    places = set()
    for place in pack["landmarks"]:
        if not isinstance(place, dict) or not nonempty(place.get("id")) or not nonempty(place.get("name")):
            raise ValueError("地标需要有效的标识和名称。")
        if place["id"] in places or type(place.get("node")) is not int or place["node"] not in used_nodes:
            raise ValueError("地标标识重复或引用了无效道路节点。")
        places.add(place["id"])
    demo = pack.get("demo")
    if (not isinstance(demo, dict) or not all(nonempty(demo.get(key)) for key in ("start", "end", "strategy"))
            or demo["start"] not in places or demo["end"] not in places or demo["strategy"] not in STRATEGIES):
        raise ValueError("演示案例需要有效的起终点和策略。")


@dataclass
class City:
    info: dict
    network: RoadNetwork
    map_data: dict

    @classmethod
    def from_pack(cls, pack, builtin):
        validate_pack(pack)
        network = RoadNetwork.from_data(pack)
        info = {"id": pack["city_id"], "name": pack["city_name"], "area": pack["area_name"], "builtin": builtin}
        metadata = {key: pack[key] for key in ("demo", "license", "source_url", "extracted_on")}
        return cls(info, network, {**network.map_data, **metadata, "city": info})


class CityRegistry:
    def __init__(self, import_dir=ROOT / "local_data" / "cities"):
        self.import_dir = Path(import_dir)
        self.lock = RLock()
        self.cache = {}

    def get(self, city_id):
        if not isinstance(city_id, str) or not CITY_ID.fullmatch(city_id):
            raise ValueError("城市标识无效。")
        with self.lock:
            path = BUILTINS.get(city_id, self.import_dir / f"city-{city_id}.json")
            stamp = path.stat()
            version = (stamp.st_ino, stamp.st_size, stamp.st_mtime_ns)
            cached = self.cache.get(city_id)
            if cached and cached[0] == version:
                return cached[1]
            pack = json.loads(path.read_text(encoding="utf-8"))
            if city_id == "tianjin":
                pack.update(TIANJIN_METADATA)
            city = City.from_pack(pack, city_id in BUILTINS)
            self.cache[city_id] = (version, city)
            return city

    def list_cities(self):
        with self.lock:
            identifiers = list(BUILTINS)
            identifiers.extend(path.stem[5:] for path in sorted(self.import_dir.glob("city-*.json")))
            result = []
            for city_id in identifiers:
                try:
                    result.append(self.get(city_id).info)
                except FileNotFoundError:
                    if city_id in BUILTINS:
                        raise
            return result

    def add(self, pack):
        city = City.from_pack(pack, False)
        city_id = city.info["id"]
        with self.lock:
            path = self.import_dir / f"city-{city_id}.json"
            if city_id in BUILTINS or path.exists():
                raise ValueError("此城市标识已存在。")
            self.import_dir.mkdir(parents=True, exist_ok=True)
            with NamedTemporaryFile(dir=self.import_dir, delete=False) as staged:
                temp = Path(staged.name)
            try:
                temp.write_text(json.dumps(pack, ensure_ascii=False, allow_nan=False), encoding="utf-8")
                # Publish a fully written file without replacing another service's import.
                if os.name == "nt":
                    temp.rename(path)
                else:
                    os.link(temp, path)
            except FileExistsError:
                raise ValueError("此城市标识已存在。") from None
            finally:
                temp.unlink(missing_ok=True)
            return city.info

    def remove(self, city_id):
        if not isinstance(city_id, str) or not CITY_ID.fullmatch(city_id):
            raise ValueError("城市标识无效。")
        if city_id in BUILTINS:
            raise ValueError("只能移除已导入的城市。")
        with self.lock:
            (self.import_dir / f"city-{city_id}.json").unlink()
            self.cache.pop(city_id, None)
