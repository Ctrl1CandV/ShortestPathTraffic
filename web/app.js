"use strict";

const startSelect = document.getElementById("start");
const endSelect = document.getElementById("end");
const strategyControl = document.getElementById("strategies");
const strategyInputs = [...strategyControl.querySelectorAll("input")];
const demoButton = document.getElementById("demo");
const routeStatus = document.getElementById("route-status");
const routeDetails = document.getElementById("route-details");
const traversal = document.getElementById("traversal");
const roadList = document.getElementById("road-list");
const stage = document.getElementById("map-stage");
const canvas = document.getElementById("road-map");
const context = canvas.getContext("2d");
const mapScale = document.getElementById("map-scale");
const scaleValue = document.getElementById("scale-value");

const fontFamily = '"Inter", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif';
const whole = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const tenths = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });
const hundredths = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const roadLevels = {
  motorway: 2,
  trunk: 2,
  primary: 2,
  secondary: 1,
  tertiary: 1
};
const palette = {
  start: "#005747",
  end: "#a13a1b",
  route: "#007461",
  context: "#506b60"
};

let mapData;
let routePoints = [];
let currentRequest;

function selectedStrategy() {
  return strategyInputs.find((input) => input.checked).value;
}

function layoutMap(width, height) {
  const [west, south, east, north] = mapData.bounds;
  const latitude = (north + south) / 2;
  const longitudeScale = Math.cos(latitude * Math.PI / 180);
  const padding = width < 480 ? 20 : 44;
  const scale = Math.min(
    Math.max(width - padding * 2, 1) / ((east - west) * longitudeScale),
    Math.max(height - padding * 2, 1) / (north - south)
  );
  const longitude = (east + west) / 2;

  return {
    pixelsPerMeter: scale / 111195,
    project([lon, lat]) {
      return [
        width / 2 + (lon - longitude) * longitudeScale * scale,
        height / 2 + (latitude - lat) * scale
      ];
    }
  };
}

function trace(points, project) {
  const path = new Path2D();
  const [x, y] = project(points[0]);
  path.moveTo(x, y);
  for (let index = 1; index < points.length; index += 1) {
    path.lineTo(...project(points[index]));
  }
  return path;
}

function stroke(path, color, width) {
  context.strokeStyle = color;
  context.lineWidth = width;
  context.stroke(path);
}

function drawRoads(project) {
  const paths = [new Path2D(), new Path2D(), new Path2D()];
  for (const road of mapData.roads) {
    const level = roadLevels[road.highway.replace(/_link$/, "")] ?? 0;
    paths[level].addPath(trace(road.points, project));
  }
  stroke(paths[0], "#c0cec5", 1.25);
  stroke(paths[1], "#aebfb3", 3);
  stroke(paths[1], "#f9fbf7", 1.25);
  stroke(paths[2], "#8fa69a", 4.5);
  stroke(paths[2], "#fffef8", 2.6);
}

function boxIntersects(a, b) {
  return a.left < b.right && a.right > b.left
    && a.top < b.bottom && a.bottom > b.top;
}

function placeLabel(text, x, y, margin, layout) {
  const textWidth = Math.ceil(context.measureText(text).width);
  const halfWidth = textWidth / 2 + 5;
  const halfHeight = 10;
  const candidates = [
    [x + margin + halfWidth, y],
    [x - margin - halfWidth, y],
    [x, y - margin - halfHeight],
    [x, y + margin + halfHeight]
  ];
  for (const [centerX, centerY] of candidates) {
    const bounds = {
      left: centerX - halfWidth,
      right: centerX + halfWidth,
      top: centerY - halfHeight,
      bottom: centerY + halfHeight
    };
    if (bounds.left < 4 || bounds.top < 4 || bounds.right > layout.width - 4
        || bounds.bottom > layout.height - 4
        || layout.occupied.some((other) => boxIntersects(bounds, other))) {
      continue;
    }
    layout.occupied.push(bounds);
    return [centerX, centerY, textWidth];
  }
  return null;
}

function drawMarker(kind, x, y) {
  context.beginPath();
  if (kind === "both") {
    context.roundRect(x - 21, y - 12, 42, 24, 9);
  } else if (kind === "end") {
    context.moveTo(x, y - 14);
    context.lineTo(x + 14, y);
    context.lineTo(x, y + 14);
    context.lineTo(x - 14, y);
    context.closePath();
  } else {
    context.arc(x, y, kind === "start" ? 12 : 4.2, 0, 2 * Math.PI);
  }

  context.fillStyle = palette[kind] ?? (kind === "both" ? palette.start : "#6e8b80");
  context.fill();
  context.strokeStyle = "#ffffff";
  context.lineWidth = kind ? 2.6 : 1.7;
  context.stroke();
  if (kind) {
    const symbol = { start: "起", end: "终", both: "起终" }[kind];
    context.font = `700 12px ${fontFamily}`;
    context.fillStyle = "#ffffff";
    context.fillText(symbol, x, y);
  }
}

function drawLandmarks(project, layout) {
  const start = mapData.landmarks.find(({ id }) => id === startSelect.value);
  const end = mapData.landmarks.find(({ id }) => id === endSelect.value);
  const shared = start && end && start.point.every((value, index) => value === end.point[index]);
  const markers = mapData.landmarks
    .filter((place) => !(shared && place === end && start !== end))
    .map((place) => {
      const kind = place === start ? (shared ? "both" : "start") : place === end ? "end" : "";
      return { ...place, kind, xy: project(place.point) };
    });

  for (const { xy: [x, y], kind } of markers) {
    const halfWidth = kind === "both" ? 23 : kind ? 15 : 5;
    const halfHeight = kind ? 15 : 5;
    layout.occupied.push({ left: x - halfWidth, top: y - halfHeight, right: x + halfWidth, bottom: y + halfHeight });
    drawMarker(kind, x, y);
  }

  // If labels compete for room, the selected endpoints keep their names first.
  markers.sort((a, b) => Number(Boolean(b.kind)) - Number(Boolean(a.kind)));
  for (const { xy: [x, y], kind, name } of markers) {
    context.font = `${kind ? 700 : 600} ${kind ? 13 : 12}px ${fontFamily}`;
    const label = placeLabel(name, x, y, kind === "both" ? 25 : kind ? 17 : 7, layout);
    if (!label) {
      continue;
    }
    const [labelX, labelY, textWidth] = label;
    context.beginPath();
    context.roundRect(labelX - textWidth / 2 - 5, labelY - 10, textWidth + 10, 20, 4);
    context.fillStyle = kind ? "#ffffff" : "#f9fbf6";
    context.fill();
    context.fillStyle = palette[kind] ?? palette.context;
    context.fillText(name, labelX, labelY);
  }
}

function drawRoadNames(project, layout) {
  const labels = mapData.roads.filter((road) => road.name && roadLevels[road.highway] > 0)
    .map(({ name, points }) => {
      const [x1, y1] = project(points[0]);
      const [x2, y2] = project(points.at(-1));
      const middle = Math.floor((points.length - 1) / 2);
      const [x3, y3] = project(points[middle]);
      const [x4, y4] = project(points[middle + 1]);
      return { name, span: Math.hypot(x2 - x1, y2 - y1), x: (x3 + x4) / 2, y: (y3 + y4) / 2 };
    })
    .sort((a, b) => b.span - a.span);
  const placed = new Set();
  const limit = layout.width < 560 ? 5 : 11;
  context.font = `500 12px ${fontFamily}`;
  for (const { name, x, y } of labels) {
    if (placed.has(name)) {
      continue;
    }
    const label = placeLabel(name, x, y, 7, layout);
    if (!label) {
      continue;
    }
    const [labelX, labelY] = label;
    context.strokeStyle = "#f9fbf6";
    context.lineWidth = 3;
    context.strokeText(name, labelX, labelY);
    context.fillStyle = palette.context;
    context.fillText(name, labelX, labelY);
    placed.add(name);
    if (placed.size === limit) {
      break;
    }
  }
}

function reserveRouteLabels(project, occupied) {
  const points = routePoints.map(project);
  const padding = 6;
  for (let index = 1; index < points.length; index += 1) {
    const [x1, y1] = points[index - 1];
    const [x2, y2] = points[index];
    occupied.push({
      left: Math.min(x1, x2) - padding,
      right: Math.max(x1, x2) + padding,
      top: Math.min(y1, y2) - padding,
      bottom: Math.max(y1, y2) + padding
    });
  }
}

function drawMap() {
  if (!mapData) {
    return;
  }

  const { width, height } = stage.getBoundingClientRect();
  if (!width || !height) {
    return;
  }
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.lineJoin = "round";
  context.lineCap = "round";
  context.textAlign = "center";
  context.textBaseline = "middle";

  const { project, pixelsPerMeter } = layoutMap(width, height);
  const maxBarWidth = width < 480 ? 70 : 114;
  const barMeters = [1000, 500, 250, 100, 50].find((value) => value * pixelsPerMeter <= maxBarWidth) ?? 50;
  const barWidth = Math.round(barMeters * pixelsPerMeter);
  mapScale.style.width = `${barWidth}px`;
  scaleValue.textContent = barMeters === 1000 ? "1 km" : `${barMeters} m`;
  mapScale.hidden = false;
  const layout = {
    width,
    height,
    occupied: [
      { left: width - 50, right: width, top: 0, bottom: 62 },
      { left: 0, right: Math.max(70, barWidth + 25), top: height - 39, bottom: height }
    ]
  };
  drawRoads(project);
  if (routePoints.length > 1) {
    const routePath = trace(routePoints, project);
    stroke(routePath, "#ffffff", 10);
    stroke(routePath, palette.route, 6.5);
    reserveRouteLabels(project, layout.occupied);
  }
  drawLandmarks(project, layout);
  drawRoadNames(project, layout);
}

function setStatus(message, isError = false) {
  routeStatus.textContent = message;
  routeStatus.toggleAttribute("data-error", isError);
}

function displayDistance(meters) {
  return meters >= 1000 ? [hundredths.format(meters / 1000), "km"] : [whole.format(meters), "m"];
}

function displayTime(seconds) {
  return seconds >= 60 ? [tenths.format(seconds / 60), "分钟"] : [tenths.format(seconds), "秒"];
}

function fillMetric(key, [value, unit], strategy) {
  document.getElementById(`${key}-value`).textContent = value;
  document.getElementById(`${key}-unit`).textContent = unit;
  document.querySelector(`[data-metric="${key}"]`).toggleAttribute("data-active", strategy === key);
}

function displayRoute(result, strategy) {
  routePoints = result.points;
  fillMetric("distance", displayDistance(result.distance_m), strategy);
  fillMetric("time", displayTime(result.time_s), strategy);
  fillMetric("surface", [whole.format(result.surface_m), "加权 m"], strategy);
  const segments = result.roads.map((road) => {
    const item = document.createElement("li");
    const row = document.createElement("div");
    const name = document.createElement("span");
    const length = document.createElement("span");
    name.textContent = road.name || "未命名道路";
    length.className = "road-length";
    length.textContent = displayDistance(road.distance_m).join(" ");
    row.append(name, length);
    item.append(row);
    return item;
  });
  roadList.replaceChildren(...segments);
  roadList.scrollTop = 0;
  traversal.hidden = segments.length === 0;
  routeDetails.hidden = false;
  const message = segments.length > 0
    ? `${startSelect.selectedOptions[0].text} → ${endSelect.selectedOptions[0].text}`
    : "起点与终点相同。";
  setStatus(message);
}

async function updateRoute() {
  currentRequest?.abort();
  currentRequest = null;
  const start = startSelect.value;
  const end = endSelect.value;
  const strategy = selectedStrategy();
  routePoints = [];
  routeDetails.hidden = true;
  roadList.replaceChildren();
  startSelect.title = startSelect.selectedOptions[0].text;
  endSelect.title = endSelect.selectedOptions[0].text;
  drawMap();

  if (!start || !end) {
    setStatus("选好起点和终点后显示路线。");
    return;
  }

  setStatus("正在规划路线…");
  const request = new AbortController();
  currentRequest = request;
  const params = new URLSearchParams({ start, end, strategy });
  try {
    const response = await fetch(`/api/route?${params}`, { signal: request.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const result = await response.json();
    if (currentRequest !== request) {
      return;
    }
    if (result.status === "unreachable") {
      setStatus("在当前路网范围内找不到可通行的路线。");
    } else {
      displayRoute(result, strategy);
      drawMap();
    }
  } catch {
    if (currentRequest === request) {
      setStatus("路线查询失败。请检查本地服务后重试。", true);
    }
  } finally {
    if (currentRequest === request) {
      currentRequest = null;
    }
  }
}

async function loadMap() {
  try {
    const response = await fetch("/api/map");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    mapData = await response.json();
    for (const select of [startSelect, endSelect]) {
      select.append(...mapData.landmarks.map(({ name, id }) => new Option(name, id)));
      select.disabled = false;
    }
    strategyControl.disabled = false;
    demoButton.disabled = false;
    updateRoute();
  } catch {
    setStatus("路网加载失败。请确认本地服务已启动，然后刷新页面。", true);
  }
}

startSelect.addEventListener("change", updateRoute);
endSelect.addEventListener("change", updateRoute);
strategyControl.addEventListener("change", updateRoute);
demoButton.addEventListener("click", () => {
  const { start, end, strategy } = mapData.demo;
  startSelect.value = start;
  endSelect.value = end;
  strategyInputs.find((input) => input.value === strategy).checked = true;
  updateRoute();
});
new ResizeObserver(drawMap).observe(stage);
loadMap();
