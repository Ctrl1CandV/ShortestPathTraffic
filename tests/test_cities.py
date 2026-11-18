import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

import pytest

from cities import CityRegistry
from app import make_server


ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def import_dir():
    qa = ROOT / ".qa"
    qa.mkdir(exist_ok=True)
    with TemporaryDirectory(dir=qa) as folder:
        yield Path(folder)


@pytest.fixture
def pack():
    return {
        "city_id": "class-demo", "city_name": "课堂样例", "area_name": "样区",
        "source_url": "https://www.openstreetmap.org", "extracted_on": "2026-11-17",
        "license": "ODbL-1.0", "bounds": [110, 30, 111, 31],
        "nodes": [[1, 110.1, 30.1], [2, 110.2, 30.2]],
        "roads": [{"id": 10, "name": "车站路", "highway": "residential",
                   "surface": None, "oneway": 0, "nodes": [1, 2]}],
        "landmarks": [{"id": "a", "name": "北口", "node": 1}, {"id": "b", "name": "南口", "node": 2}],
        "demo": {"start": "a", "end": "b", "strategy": "distance"},
    }


def test_import_restart_remove_and_reimport(import_dir, pack):
    registry = CityRegistry(import_dir)
    assert registry.add(pack)["id"] == "class-demo"
    after_restart = CityRegistry(import_dir)
    assert after_restart.get("class-demo").network.route("a", "b", "distance")["status"] == "ok"
    with pytest.raises(ValueError, match="已存在"):
        after_restart.add(pack)
    after_restart.remove("class-demo")
    assert "class-demo" not in {city["id"] for city in registry.list_cities()}
    assert registry.add(pack)["name"] == "课堂样例"


@pytest.mark.parametrize("field,value", [("city_id", "../bad"), ("bounds", [0, 1, 0, 5]),
                         ("source_url", "https://unknown host/"), ("source_url", "https://localhost:99999/"),
                         ("source_url", "https://192.168.1.999/"), ("source_url", "https://%/"),
                         ("landmarks", [{"id": "a", "name": "北口", "node": 999}])])
def test_invalid_package_preserves_library(import_dir, pack, field, value):
    registry = CityRegistry(import_dir)
    registry.add(pack)
    bad = dict(pack, city_id="other")
    bad[field] = value
    with pytest.raises(ValueError):
        registry.add(bad)
    assert [city["id"] for city in registry.list_cities()] == ["tianjin", "beijing", "class-demo"]
    assert json.loads(next(import_dir.glob("*.json")).read_text(encoding="utf-8")) == pack


@pytest.mark.parametrize("source", [
    "https://maps.example.org/城区", "https://示例.中国/地图",
    "http://192.0.2.8:8765/map", "https://[2001:db8::1]/map",
])
def test_import_accepts_domain_names_and_ip_literals(import_dir, pack, source):
    pack["source_url"] = source
    registry = CityRegistry(import_dir)
    registry.add(pack)
    assert registry.get(pack["city_id"]).map_data["source_url"] == source


def test_concurrent_import_cannot_overwrite_first_copy(import_dir, pack):
    def try_import(name):
        try:
            return CityRegistry(import_dir).add(dict(pack, city_name=name))["name"]
        except ValueError as error:
            assert "已存在" in str(error)
            return None

    with ThreadPoolExecutor(2) as pool:
        outcomes = list(pool.map(try_import, ("第一次", "第二次")))
    winners = [name for name in outcomes if name is not None]
    assert len(winners) == 1
    assert CityRegistry(import_dir).get("class-demo").info["name"] == winners[0]


def test_city_api_lifecycle_and_search_after_closure(import_dir, pack):
    server = make_server(0, CityRegistry(import_dir))
    worker = Thread(target=server.serve_forever, daemon=True)
    worker.start()
    base = f"http://127.0.0.1:{server.server_port}"
    client = build_opener(ProxyHandler({}))

    def request(method, path, data=None):
        body = json.dumps(data).encode() if data is not None else None
        req = Request(base + path, data=body, method=method,
                      headers={"Content-Type": "application/json", "Origin": base})
        with client.open(req, timeout=5) as response:
            return json.load(response)

    try:
        assert request("POST", "/api/cities", pack)["city"]["id"] == "class-demo"
        city_map = request("GET", "/api/map?city=class-demo")
        road_id = city_map["roads"][0]["id"]
        query = dict(city="class-demo", start="a", end="b", strategy="distance", algorithm="astar")
        assert request("POST", "/api/search", query)["status"] == "ok"
        blocked = request("POST", "/api/search", dict(query, closed=[road_id]))
        assert blocked["status"] == "unreachable"
        assert blocked["stats"]["dijkstra"]["cost"] is None
        assert request("POST", "/api/search", query)["status"] == "ok"
        with pytest.raises(HTTPError) as invalid:
            request("POST", "/api/search", dict(query, closed=["bad-id"]))
        assert invalid.value.code == 400
        assert request("DELETE", "/api/cities/class-demo")["removed"] == "class-demo"
        with pytest.raises(HTTPError) as absent:
            request("GET", "/api/map?city=class-demo")
        assert absent.value.code == 404
        assert request("GET", "/api/map")["city"]["id"] == "tianjin"
    finally:
        server.shutdown()
        server.server_close()
        worker.join()
