"""Serve the offline route planner on the local Windows computer."""

import argparse
import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from cities import DATA_FILE, DEMO, ROOT, CityRegistry
from network import RoadNetwork
from routing import STRATEGIES


STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/map.js": ("map.js", "text/javascript; charset=utf-8"),
    "/scenes.js": ("scenes.js", "text/javascript; charset=utf-8"),
    "/algorithms.mjs": ("algorithms.mjs", "text/javascript; charset=utf-8"),
    "/examples.mjs": ("examples.mjs", "text/javascript; charset=utf-8"),
    "/scenes.css": ("scenes.css", "text/css; charset=utf-8"),
}
MAX_BODY = 12 * 1024 * 1024


def json_bytes(value: dict) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def load_network() -> RoadNetwork:
    return RoadNetwork.from_data(json.loads(DATA_FILE.read_text(encoding="utf-8")))


def make_server(port: int = 8765, registry=None) -> ThreadingHTTPServer:
    registry = registry or CityRegistry()
    assets = {
        path: ((ROOT / "web" / filename).read_bytes(), content_type)
        for path, (filename, content_type) in STATIC_FILES.items()
    }

    class Handler(BaseHTTPRequestHandler):
        server: ThreadingHTTPServer

        def respond(self, status: HTTPStatus, body: bytes, content_type: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                self.wfile.write(body)
            except ConnectionError:
                pass  # The browser cancelled a request after a selection changed.

        def respond_json(self, status: HTTPStatus, value: dict) -> None:
            self.respond(status, json_bytes(value), "application/json; charset=utf-8")

        def do_GET(self) -> None:
            url = urlsplit(self.path)
            if url.path in assets:
                self.respond(HTTPStatus.OK, *assets[url.path])
            elif url.path == "/api/cities":
                self.respond_json(HTTPStatus.OK, {"cities": registry.list_cities()})
            elif url.path == "/api/map":
                city_id = parse_qs(url.query, keep_blank_values=True).get("city", ["tianjin"])[0]
                try:
                    self.respond_json(HTTPStatus.OK, registry.get(city_id).map_data)
                except (FileNotFoundError, ValueError):
                    self.respond_json(HTTPStatus.NOT_FOUND, {"error": "找不到该城市路网。"})
            elif url.path == "/api/route":
                self.get_route(url.query)
            else:
                self.respond_json(HTTPStatus.NOT_FOUND, {"error": "找不到该页面。"})

        def get_route(self, query: str) -> None:
            network = registry.get("tianjin").network
            fields = parse_qs(query, keep_blank_values=True)
            required = ("start", "end", "strategy")
            if any(len(fields.get(name, ())) != 1 for name in required):
                self.respond_json(HTTPStatus.BAD_REQUEST, {"error": "请选择起点、终点和路线策略。"})
                return

            start, end, strategy = (fields[name][0] for name in required)
            if start not in network.landmarks or end not in network.landmarks:
                self.respond_json(HTTPStatus.BAD_REQUEST, {"error": "请选择路网中的起点和终点。"})
            elif strategy not in STRATEGIES:
                self.respond_json(HTTPStatus.BAD_REQUEST, {"error": "请选择有效的路线策略。"})
            else:
                self.respond_json(HTTPStatus.OK, network.route(start, end, strategy))

        def valid_origin(self):
            origin = self.headers.get("Origin")
            port = self.server.server_port
            hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
            if port == 80:
                hosts.update({"127.0.0.1", "localhost"})
            return self.headers.get("Host") in hosts and (origin is None or origin in {f"http://{h}" for h in hosts})

        def read_json(self):
            if self.headers.get_content_type() != "application/json":
                raise ValueError("请求需要 JSON 格式。")
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= MAX_BODY:
                raise ValueError("请选择不超过 12 MiB 的非空 JSON 文件。")
            try:
                raw = self.rfile.read(size).decode("utf-8-sig")
                value = json.loads(raw)
            except (UnicodeError, json.JSONDecodeError, RecursionError):
                raise ValueError("文件不是有效的 UTF-8 JSON。") from None
            if not isinstance(value, dict):
                raise ValueError("请求内容应为 JSON 对象。")
            return value

        def do_POST(self):
            if not self.valid_origin():
                self.respond_json(HTTPStatus.FORBIDDEN, {"error": "请在本地演示页面操作。"})
                return
            try:
                path = urlsplit(self.path).path
                if path == "/api/cities":
                    info = registry.add(self.read_json())
                    self.respond_json(HTTPStatus.CREATED, {"city": info})
                elif path == "/api/search":
                    fields = self.read_json()
                    city = registry.get(fields.get("city"))
                    network = city.network
                    start, end = fields.get("start"), fields.get("end")
                    strategy = fields.get("strategy")
                    if not (isinstance(start, str) and start in network.landmarks
                            and isinstance(end, str) and end in network.landmarks):
                        raise ValueError("请选择当前城市的起点和终点。")
                    if fields.get("algorithm", "dijkstra") != "dijkstra":
                        raise ValueError("本场景只运行 Dijkstra 算法。")
                    if not isinstance(strategy, str) or strategy not in STRATEGIES:
                        raise ValueError("请选择有效的路线策略。")
                    closed = fields.get("closed", [])
                    if not isinstance(closed, list) or any(not isinstance(key, str) for key in closed):
                        raise ValueError("封路列表需要有效的路段编号。")
                    closed_ids = set(closed)
                    if closed_ids.difference(road["id"] for road in city.map_data["roads"]):
                        raise ValueError("封路列表含有其他城市或无效的路段编号。")
                    self.respond_json(HTTPStatus.OK, network.search(start, end, strategy, closed_ids))
                else:
                    self.respond_json(HTTPStatus.NOT_FOUND, {"error": "找不到该操作。"})
            except FileNotFoundError:
                self.respond_json(HTTPStatus.NOT_FOUND, {"error": "找不到该城市。"})
            except ValueError as error:
                self.respond_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            except OSError:
                self.respond_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "无法读写项目内的城市数据目录。"})

        def do_DELETE(self):
            if not self.valid_origin():
                self.respond_json(HTTPStatus.FORBIDDEN, {"error": "请在本地演示页面操作。"})
                return
            path = urlsplit(self.path).path
            if not path.startswith("/api/cities/"):
                self.respond_json(HTTPStatus.NOT_FOUND, {"error": "找不到该操作。"})
                return
            try:
                city_id = path.removeprefix("/api/cities/")
                registry.remove(city_id)
                self.respond_json(HTTPStatus.OK, {"removed": city_id})
            except FileNotFoundError:
                self.respond_json(HTTPStatus.NOT_FOUND, {"error": "该城市已经移除。"})
            except ValueError as error:
                self.respond_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            except OSError:
                self.respond_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "无法移除项目内的城市副本。"})

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


def main() -> None:
    parser = argparse.ArgumentParser(description="在本机运行六个图论算法课堂演示")
    parser.add_argument("--port", type=int, default=8765, help="本地端口（默认 8765）")
    args = parser.parse_args()
    if not 1 <= args.port <= 65_535:
        parser.error("端口必须在 1 到 65535 之间。")
    try:
        server = make_server(args.port)
    except OSError as error:
        parser.exit(1, f"启动失败：{error}\n")

    with server:
        print(f"在浏览器打开 http://127.0.0.1:{server.server_port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
