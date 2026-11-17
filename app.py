"""Serve the offline route planner on the local Windows computer."""

import argparse
import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from network import RoadNetwork
from routing import STRATEGIES


ROOT = Path(__file__).resolve().parent
DATA_FILE = ROOT / "data" / "tianjin.json"
STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
}
DEMO = {"start": "wudadao-park", "end": "tianjin-concert-hall", "strategy": "distance"}


def json_bytes(value: dict) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def load_network() -> RoadNetwork:
    return RoadNetwork.from_data(json.loads(DATA_FILE.read_text(encoding="utf-8")))


def make_server(port: int = 8765) -> ThreadingHTTPServer:
    network = load_network()
    map_body = json_bytes({**network.map_data, "demo": DEMO})
    assets = {
        path: ((ROOT / "web" / filename).read_bytes(), content_type)
        for path, (filename, content_type) in STATIC_FILES.items()
    }

    class Handler(BaseHTTPRequestHandler):
        def respond(self, status: HTTPStatus, body: bytes, content_type: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def respond_json(self, status: HTTPStatus, value: dict) -> None:
            self.respond(status, json_bytes(value), "application/json; charset=utf-8")

        def do_GET(self) -> None:
            url = urlsplit(self.path)
            if url.path in assets:
                self.respond(HTTPStatus.OK, *assets[url.path])
            elif url.path == "/api/map":
                self.respond(HTTPStatus.OK, map_body, "application/json; charset=utf-8")
            elif url.path == "/api/route":
                self.get_route(url.query)
            else:
                self.respond_json(HTTPStatus.NOT_FOUND, {"error": "找不到该页面。"})

        def get_route(self, query: str) -> None:
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

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


def main() -> None:
    parser = argparse.ArgumentParser(description="在本机运行天津城区最短路径演示")
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
