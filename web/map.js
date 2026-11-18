const startSelect = document.getElementById("start");
const endSelect = document.getElementById("end");
const stage = document.getElementById("map-stage");
const canvas = document.getElementById("road-map");
const context = canvas.getContext("2d");
const mapScale = document.getElementById("map-scale");
const scaleValue = document.getElementById("scale-value");

const fontFamily = '"Inter", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif';
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
let closed = new Set();
let focusedRoad = null;
let activeTrace = [];
let visibleCount = 0;
let projection = null;
let landmarkLabels = [];
const overlay = document.getElementById("search-layer");
const searchContext = overlay.getContext("2d");

function layoutMap(width, height) {
  const [west, south, east, north] = mapData.bounds;
  const latitude = (north + south) / 2;
  const longitudeScale = Math.cos(latitude * Math.PI / 180);
  const padding = width < 480 ? 14 : 24;
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
    landmarkLabels.push([labelX - textWidth / 2 - 5, labelY - 10, textWidth + 10, 20]);
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
  landmarkLabels = [];

  const { width, height } = stage.getBoundingClientRect();
  if (!width || !height) {
    return;
  }
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  overlay.width = canvas.width;
  overlay.height = canvas.height;
  searchContext.setTransform(ratio, 0, 0, ratio, 0, 0);
  if (!mapData) {
    projection = null;
    mapScale.hidden = true;
    return;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.lineJoin = "round";
  context.lineCap = "round";
  context.textAlign = "center";
  context.textBaseline = "middle";

  projection = layoutMap(width, height);
  const { project, pixelsPerMeter } = projection;
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
  drawClosures(project);
  drawLandmarks(project, layout);
  drawRoadNames(project, layout);
  paintTrace();
}

function drawClosures(project) {
  for (const road of mapData.roads) {
    const isClosed = closed.has(road.id);
    if (!isClosed && road.id !== focusedRoad) continue;
    const path = trace(road.points, project);
    stroke(path, "#fffefb", 7);
    if (isClosed) {
      stroke(path, "#eabdaf", 5);
      context.setLineDash([6, 4]);
      stroke(path, "#a73a25", 4);
      context.setLineDash([]);
    } else {
      stroke(path, "#ad5922", 4);
    }
  }
}

function paintTrace() {
  const { width, height } = stage.getBoundingClientRect();
  searchContext.clearRect(0, 0, width, height);
  if (!projection || !visibleCount) return;
  const {project} = projection;
  const tree = new Path2D();
  const dots = new Path2D();
  for (let index = 0; index < visibleCount; index++) {
    const row = activeTrace[index];
    const [x, y] = project(row);
    tree.moveTo(...project([row[2], row[3]]));
    tree.lineTo(x, y);
    dots.moveTo(x + 1.65, y);
    dots.arc(x, y, 1.65, 0, 2 * Math.PI);
  }
  searchContext.strokeStyle = "#437cc2b8";
  searchContext.lineWidth = 2.4;
  searchContext.stroke(tree);
  searchContext.fillStyle = "#336cad";
  searchContext.fill(dots);
  // Keep the geographic names legible even as the search tree crosses them.
  searchContext.save();
  searchContext.globalCompositeOperation = "destination-out";
  searchContext.globalAlpha = 0.78;
  for (const box of landmarkLabels) searchContext.fillRect(...box);
  searchContext.restore();
  const [x, y] = project(activeTrace[visibleCount - 1]);
  searchContext.beginPath();
  searchContext.arc(x, y, 7, 0, 2 * Math.PI);
  searchContext.fillStyle = "#214f91";
  searchContext.fill();
  searchContext.strokeStyle = "#fff";
  searchContext.lineWidth = 2.6;
  searchContext.stroke();
}

export function setMap(data, closedIds, route = [], focus = null) {
  mapData = data;
  closed = closedIds;
  routePoints = route;
  focusedRoad = focus;
  canvas.setAttribute("aria-label", data ? data.city.area + "机动车路网" : "城区机动车路网");
  drawMap();
}

export function setTrace(traceRows, count) {
  activeTrace = traceRows;
  visibleCount = count;
  paintTrace();
}

export function pickRoad(clientX, clientY) {
  if (!projection || !mapData) return null;
  const rect = canvas.getBoundingClientRect();
  const px = clientX - rect.left;
  const py = clientY - rect.top;
  let bestSquared = 9 ** 2;
  let nearest = null;
  for (const road of mapData.roads) {
    let [x, y] = projection.project(road.points[0]);
    for (let index = 1; index < road.points.length; index++) {
      const [nx, ny] = projection.project(road.points[index]);
      const dx = nx - x;
      const dy = ny - y;
      const squaredLength = dx * dx + dy * dy;
      const t = squaredLength ? Math.max(0, Math.min(1, ((px - x) * dx + (py - y) * dy) / squaredLength)) : 0;
      const distance = (px - x - t * dx) ** 2 + (py - y - t * dy) ** 2;
      if (distance < bestSquared) {
        bestSquared = distance;
        nearest = road;
      }
      x = nx;
      y = ny;
    }
  }
  return nearest;
}

new ResizeObserver(drawMap).observe(stage);
