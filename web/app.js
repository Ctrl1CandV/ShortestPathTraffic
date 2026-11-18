import {setMap, setTrace, pickRoad} from "./map.js";

const byId = (id) => document.getElementById(id);
const citySelect = byId("city");
const startSelect = byId("start");
const endSelect = byId("end");
const roadSelect = byId("road-select");
const routeStatus = byId("route-status");
const routeDetails = byId("route-details");
const traversal = byId("traversal");
const roadList = byId("road-list");
const algorithmNames = {dijkstra: "Dijkstra", astar: "A*"};
const whole = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const tenths = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });
const hundredths = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
let cities = [];
let mapData = null;
let mapRequest = null;
let searchRequest = null;
let changingCatalog = false;
const closedByCity = new Map();
let closed = new Set();
let editing = false;
let result = null;
let displayedRoute = [];
let processed = 0;
let elapsed = 0;
let lastFrame = null;
let frame = 0;
let playing = false;

function choice(name) {
  return document.querySelector(`input[name="${name}"]:checked`).value;
}

function updateMap() {
  setMap(mapData, closed, displayedRoute, editing ? roadSelect.value : null);
}

function updateActions() {
  const ready = Boolean(mapData);
  const catalogBusy = changingCatalog || cities.length === 0;
  citySelect.disabled = catalogBusy;
  byId("import-city").disabled = catalogBusy;
  byId("city-file").disabled = catalogBusy;
  byId("remove-city").hidden = !cities.some(city => city.id === citySelect.value && !city.builtin);
  byId("remove-city").disabled = changingCatalog;
  [startSelect, endSelect, byId("demo"), byId("strategies"), byId("algorithms"), byId("edit-roads")].forEach(control => {
    control.disabled = !ready;
  });
  byId("search").disabled = !ready || !startSelect.value || !endSelect.value || Boolean(searchRequest);
}

async function readResponse(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `请求失败（${response.status}）`);
  return body;
}

function cityMessage(text, error = false) {
  const message = byId("city-message");
  message.textContent = text;
  message.hidden = !text;
  message.toggleAttribute("data-error", error);
}

function renderCityList(selected) {
  citySelect.replaceChildren(...cities.map(city => new Option(city.name, city.id)));
  citySelect.value = selected;
  updateActions();
}

function setEditing(on) {
  editing = on;
  byId("road-editor").hidden = !on;
  byId("edit-roads").setAttribute("aria-pressed", String(on));
  byId("edit-roads").textContent = on ? "完成修改" : "修改道路";
  byId("map-stage").classList.toggle("editing", on);
  updateMap();
}

function roadLabel(road) {
  return `${road.name || "未命名道路"} · 路段 ${road.id}`;
}

function updateRoadControls() {
  byId("toggle-road").disabled = !roadSelect.value;
  byId("toggle-road").textContent = closed.has(roadSelect.value) ? "恢复此段" : "封闭此段";
  byId("random-close").disabled = !mapData || closed.size >= mapData.roads.length;
  byId("restore-all").disabled = closed.size === 0;
  byId("closed-count").textContent = `已封闭 ${closed.size} 段`;
  byId("edit-roads").textContent = editing ? "完成修改" : closed.size ? `修改道路（已封 ${closed.size} 段）` : "修改道路";
  const closedList = byId("closed-roads");
  const items = [];
  for (const road of mapData?.roads ?? []) {
    if (!closed.has(road.id)) continue;
    const item = document.createElement("li");
    const restore = document.createElement("button");
    restore.type = "button";
    restore.dataset.id = road.id;
    restore.setAttribute("aria-label", "恢复" + roadLabel(road));
    restore.textContent = roadLabel(road) + " ×";
    item.append(restore);
    items.push(item);
  }
  closedList.replaceChildren(...items);
  closedList.hidden = items.length === 0;
}

function changeClosure(id) {
  if (closed.has(id)) closed.delete(id);
  else closed.add(id);
  updateRoadControls();
  resetSearch();
}

async function activateCity(id) {
  mapRequest?.abort();
  const request = new AbortController();
  mapRequest = request;
  mapData = null;
  closed = new Set();
  displayedRoute = [];
  setEditing(false);
  startSelect.replaceChildren(new Option("选择起点", ""));
  endSelect.replaceChildren(new Option("选择终点", ""));
  roadSelect.replaceChildren(new Option("选择指定路段", ""));
  byId("map-title").textContent = "正在加载路网…";
  byId("map-meta").textContent = "";
  byId("source-note").textContent = "";
  byId("source-link").hidden = true;
  byId("attribution").hidden = true;
  updateRoadControls();
  resetSearch("正在加载路网…");
  try {
    const data = await readResponse("/api/map?" + new URLSearchParams({city: id}), {signal: request.signal});
    if (mapRequest !== request) return;
    mapData = data;
    if (!closedByCity.has(id)) closedByCity.set(id, new Set());
    closed = closedByCity.get(id);
    for (const select of [startSelect, endSelect]) {
      select.append(...data.landmarks.map(place => new Option(place.name, place.id)));
    }
    const ordered = [...data.roads].sort((a, b) => (a.name || "未命名道路").localeCompare(b.name || "未命名道路", "zh-CN"));
    roadSelect.append(...ordered.map(road => new Option(roadLabel(road), road.id)));
    byId("map-title").textContent = data.city.area;
    byId("map-meta").textContent = `${data.city.name} · ${data.roads.length} 段道路`;
    const source = byId("source-link");
    source.href = data.source_url;
    const hasSource = ["http:", "https:"].includes(source.protocol) && Boolean(source.hostname);
    const osm = source.hostname === "openstreetmap.org" || source.hostname.endsWith(".openstreetmap.org");
    byId("source-note").textContent = `路网快照 ${data.extracted_on} · ${data.license}`;
    source.hidden = !hasSource;
    byId("attribution").href = osm ? "https://www.openstreetmap.org/copyright" : source.href;
    byId("attribution").textContent = osm ? "© OpenStreetMap contributors" : "路网数据来源";
    byId("attribution").hidden = !hasSource;
    updateRoadControls();
    resetSearch();
    return true;
  } catch (error) {
    if (mapRequest === request) {
      byId("map-title").textContent = "城区路网";
      setStatus("路网加载失败。请重选城市或刷新页面。", true);
    }
  } finally {
    if (mapRequest === request) mapRequest = null;
    updateActions();
  }
}

async function importPack(file) {
  if (!file || byId("city-file").disabled) return;
  changingCatalog = true;
  updateActions();
  cityMessage("正在导入城市包…");
  try {
    const {city} = await readResponse("/api/cities", {
      method: "POST", headers: {"Content-Type": "application/json"}, body: file,
    });
    cities.push(city);
    renderCityList(city.id);
    if (await activateCity(city.id)) {
      cityMessage(`已导入${city.name}，可通过「移除城市」移除此副本。`);
    } else {
      cityMessage(`${city.name}已保存。路网加载失败，请重新选择该城市。`, true);
    }
  } catch (error) {
    cityMessage(error.message, true);
  } finally {
    changingCatalog = false;
    byId("city-file").value = "";
    updateActions();
  }
}

async function removeCity() {
  const city = cities.find(item => item.id === citySelect.value);
  if (!city || city.builtin || changingCatalog) return;
  changingCatalog = true;
  updateActions();
  try {
    await readResponse("/api/cities/" + encodeURIComponent(city.id), {method: "DELETE"});
    closedByCity.delete(city.id);
    cities = cities.filter(item => item.id !== city.id);
    renderCityList(cities[0].id);
    await activateCity(citySelect.value);
    cityMessage(`已移除${city.name}的导入副本。`);
  } catch (error) {
    cityMessage(error.message, true);
  } finally {
    changingCatalog = false;
    updateActions();
  }
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
  displayedRoute = result.points;
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

function resetSearch(message) {
  searchRequest?.abort();
  searchRequest = null;
  cancelAnimationFrame(frame);
  playing = false;
  result = null;
  displayedRoute = [];
  processed = 0;
  elapsed = 0;
  lastFrame = null;
  byId("playback").hidden = true;
  byId("processed").textContent = "0";
  routeDetails.hidden = true;
  traversal.hidden = true;
  byId("comparison").hidden = true;
  byId("comparison").tBodies[0].replaceChildren();
  roadList.replaceChildren();
  setTrace([], 0);
  updateMap();
  updateActions();
  setStatus(message ?? (startSelect.value && endSelect.value
    ? "已准备好，点击开始搜索。" : "请选择起点和终点，或载入一键演示。"));
}

function displayComparison() {
  const strategy = choice("strategy");
  const table = byId("comparison");
  const rows = Object.entries(algorithmNames).map(([key, name]) => {
    const {visited, cost} = result.stats[key];
    const value = cost === null ? "不可达" : strategy === "time" ? tenths.format(cost) + " 秒"
      : tenths.format(cost) + (strategy === "surface" ? " 加权 m" : " m");
    const tr = document.createElement("tr");
    for (const text of [name, whole.format(visited), value]) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.append(td);
    }
    return tr;
  });
  table.tBodies[0].replaceChildren(...rows);
  table.hidden = false;
}

function finishPlayback() {
  cancelAnimationFrame(frame);
  playing = false;
  processed = result.trace.length;
  byId("processed").textContent = String(processed);
  byId("progress").value = processed;
  byId("play-title").textContent = algorithmNames[result.algorithm] + " 搜索结束";
  byId("pause").disabled = true;
  byId("pause").textContent = "暂停";
  byId("skip").disabled = true;
  byId("speed").disabled = true;
  setTrace([], 0);
  if (result.status === "ok") {
    displayRoute(result, choice("strategy"));
  } else {
    setStatus("在当前可通行的路网中无法到达终点。");
  }
  displayComparison();
  updateMap();
}

function tick(timestamp) {
  if (!playing || !result) return;
  if (lastFrame !== null) elapsed += Math.min(timestamp - lastFrame, 150) * Number(byId("speed").value);
  lastFrame = timestamp;
  const duration = Math.min(11000, Math.max(1500, result.trace.length * 18));
  const target = Math.min(result.trace.length, 1 + Math.floor(elapsed / duration * result.trace.length));
  if (target !== processed) {
    processed = target;
    setTrace(result.trace, processed);
    byId("processed").textContent = String(processed);
    byId("progress").value = processed;
  }
  if (processed >= result.trace.length) finishPlayback();
  else frame = requestAnimationFrame(tick);
}

function togglePlayback() {
  if (!result || processed >= result.trace.length) return;
  playing = !playing;
  byId("pause").textContent = playing ? "暂停" : "继续";
  byId("play-title").textContent = algorithmNames[result.algorithm] + (playing ? " 搜索中" : " 已暂停");
  setStatus(playing ? searchExplanation(result.algorithm) : "搜索已暂停，可继续播放或跳到结果。");
  lastFrame = null;
  if (playing) frame = requestAnimationFrame(tick);
  else cancelAnimationFrame(frame);
}

function searchExplanation(algorithm) {
  return algorithm === "dijkstra"
    ? "Dijkstra 优先处理从起点出发、累计代价最低的路口。"
    : "A* 将已走过的代价与到终点的估计代价相加，优先处理总和最低的路口。";
}

async function startSearch() {
  if (!mapData || !startSelect.value || !endSelect.value) return;
  setEditing(false);
  updateRoadControls();
  resetSearch("正在计算搜索过程…");
  const request = new AbortController();
  searchRequest = request;
  updateActions();
  const query = {
    city: mapData.city.id, start: startSelect.value, end: endSelect.value,
    strategy: choice("strategy"), algorithm: choice("algorithm"), closed: [...closed],
  };
  try {
    const data = await readResponse("/api/search", {
      method: "POST", signal: request.signal, headers: {"Content-Type":"application/json"}, body: JSON.stringify(query),
    });
    if (searchRequest !== request) return;
    result = data;
    setStatus(searchExplanation(result.algorithm));
    byId("playback").hidden = false;
    byId("play-title").textContent = algorithmNames[result.algorithm] + " 搜索中";
    byId("progress").max = Math.max(1, data.trace.length);
    byId("progress").value = 0;
    for (const id of ["pause", "skip", "speed"]) byId(id).disabled = false;
    byId("pause").textContent = "暂停";
    playing = true;
    frame = requestAnimationFrame(tick);
  } catch (error) {
    if (searchRequest === request) setStatus(error.message, true);
  } finally {
    if (searchRequest === request) searchRequest = null;
    updateActions();
  }
}

citySelect.addEventListener("change", () => { cityMessage(""); activateCity(citySelect.value); });
byId("import-city").addEventListener("click", () => byId("city-file").click());
byId("city-file").addEventListener("change", event => importPack(event.target.files[0]));
byId("remove-city").addEventListener("click", removeCity);
byId("edit-roads").addEventListener("click", () => {
  setEditing(!editing);
  updateRoadControls();
});
byId("road-map").addEventListener("click", event => {
  if (!editing) return;
  const road = pickRoad(event.clientX, event.clientY);
  if (road) {
    roadSelect.value = road.id;
    changeClosure(road.id);
  }
});
roadSelect.addEventListener("change", () => { updateRoadControls(); updateMap(); });
byId("toggle-road").addEventListener("click", () => { if (roadSelect.value) changeClosure(roadSelect.value); });
byId("random-close").addEventListener("click", () => {
  const available = mapData.roads.filter(road => !closed.has(road.id));
  const count = 1 + Math.floor(Math.random() * Math.min(3, available.length));
  for (let i = 0; i < count && available.length; i++) {
    const [road] = available.splice(Math.floor(Math.random() * available.length), 1);
    closed.add(road.id);
  }
  updateRoadControls();
  resetSearch();
});
byId("restore-all").addEventListener("click", () => {
  closed.clear();
  roadSelect.value = "";
  updateRoadControls();
  resetSearch();
});
byId("closed-roads").addEventListener("click", event => {
  const button = event.target.closest("button[data-id]");
  if (button) changeClosure(button.dataset.id);
});
for (const control of [startSelect, endSelect, byId("strategies"), byId("algorithms")]) {
  control.addEventListener("change", () => resetSearch());
}
byId("search").addEventListener("click", startSearch);
byId("demo").addEventListener("click", () => {
  startSelect.value = mapData.demo.start;
  endSelect.value = mapData.demo.end;
  document.querySelector(`input[name="strategy"][value="${mapData.demo.strategy}"]`).checked = true;
  startSearch();
});
byId("skip").addEventListener("click", finishPlayback);
byId("pause").addEventListener("click", togglePlayback);

async function initialize() {
  try {
    const registry = await readResponse("/api/cities");
    cities = registry.cities;
    const initial = cities.find(city => city.id === "tianjin") || cities[0];
    renderCityList(initial.id);
    await activateCity(initial.id);
  } catch (error) {
    setStatus("城市列表加载失败。请确认本地服务已启动，然后刷新页面。", true);
  }
}
initialize();
