// Pure computations. Each step owns its state so replay never reads a later round.
export function warshall(n, arcs) {
  const r = Array.from({length: n}, (_, i) => Array.from({length: n}, (_, j) => i === j));
  for (const [i, j] of arcs) r[i][j] = true;
  const snapshot = (via, added) => ({via, added, matrix: r.map(row => [...row])});
  const steps = [snapshot(null, [])];
  for (let k = 0; k < n; k++) {
    const added = [];
    for (let i = 0; i < n; i++) {
      if (!r[i][k]) continue;
      for (let j = 0; j < n; j++) {
        if (!r[i][j] && r[k][j]) {
          r[i][j] = true;
          added.push([i, j]);
        }
      }
    }
    steps.push(snapshot(k, added));
  }
  return steps;
}

export function nearestNeighbor(stops, depot, required) {
  const pending = new Set(required);
  pending.delete(depot);
  let current = depot, distance = 0;
  const route = [depot];
  const steps = [{route: [...route], leg: 0, distance}];
  const lengthTo = id => Math.hypot(stops[id].x - stops[current].x, stops[id].y - stops[current].y);
  function move(id, leg) {
    distance += leg;
    route.push(id);
    steps.push({route: [...route], leg, distance});
    current = id;
  }
  while (pending.size) {
    let best = null, shortest = Infinity;
    for (const id of pending) {
      const leg = lengthTo(id);
      if (leg < shortest || (leg === shortest && id < best)) [best, shortest] = [id, leg];
    }
    pending.delete(best);
    move(best, shortest);
  }
  if (current !== depot) move(depot, lengthTo(depot));
  return steps;
}

// Unweighted maximum matching: grow an alternating tree from each new left vertex.
export function hungarian(nLeft, nRight, edges) {
  const adj = Array.from({length: nLeft}, () => []);
  for (const [x, y] of edges) adj[x].push(y);
  const match = Array(nLeft).fill(-1), owner = Array(nRight).fill(-1);
  const snapshot = (root, path) => ({root, path, matching: [...match]});
  const steps = [snapshot(null, [])];
  for (let root = 0; root < nLeft; root++) {
    const queue = [root], from = Array(nRight).fill(-1);
    let free = -1;
    for (let head = 0; head < queue.length && free < 0; head++) {
      const x = queue[head];
      for (const y of adj[x]) {
        if (from[y] !== -1 || match[x] === y) continue;
        from[y] = x;
        if (owner[y] === -1) { free = y; break; }
        queue.push(owner[y]);
      }
    }
    const path = [];
    while (free !== -1) {
      const x = from[free], old = match[x];
      path.push([x, free]);
      match[x] = free;
      owner[free] = x;
      free = old;
    }
    steps.push(snapshot(root, path.reverse()));
  }
  return steps;
}

export function sequentialColoring(n, borders, order) {
  const neighbors = Array.from({length: n}, () => []);
  for (const [a, b] of borders) { neighbors[a].push(b); neighbors[b].push(a); }
  const colors = Array(n).fill(0);
  const steps = [{region: null, unavailable: [], colors: [...colors]}];
  for (const region of order) {
    const blocked = new Set(neighbors[region].map(id => colors[id]).filter(Boolean));
    let color = 1;
    while (blocked.has(color)) color++;
    colors[region] = color;
    steps.push({region, unavailable: [...blocked], colors: [...colors]});
  }
  return steps;
}

export function preorderSearch(folders, root, keyword) {
  const query = keyword.trim();
  const visited = [], hits = [], steps = [{visited: [], hits: []}];
  function visit(id) {
    visited.push(id);
    for (const name of folders[id].records) if (name.includes(query)) hits.push({name, id});
    steps.push({visited: [...visited], hits: [...hits]});
    for (const child of folders[id].children) visit(child);
  }
  visit(root);
  return steps;
}
