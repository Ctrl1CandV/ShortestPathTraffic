import {warshall, nearestNeighbor, hungarian, sequentialColoring, preorderSearch} from "./algorithms.mjs";

import {clubs, people, contacts, activeContacts, stores, dailyOrders, workers, jobs, qualifications, district, archive} from "./examples.mjs";

const panel = document.getElementById("other-panel");
const traffic = document.getElementById("traffic-panel");
const nav = [...document.querySelectorAll(".scene-nav a")];
const width = 840;
const height = 400;
const accent = "#007461";
const amber = "#a45813";
const muted = "#60736b";
const palette = ["#ebefeb", "#a6dbca", "#ffd192", "#c7c5fa", "#8ac9ef", "#f6adbc", "#d9e69a"];
const number = new Intl.NumberFormat("zh-CN", {maximumFractionDigits: 1});

function node(tag, text = "", attrs = {}) {
  const element = document.createElement(tag);
  element.textContent = text;
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
}

function table(headers, rows) {
  const element = node("table", "", {class: "scene-table"});
  const header = element.createTHead().insertRow();
  for (const name of headers) header.append(node("th", name, {scope: "col"}));
  const body = element.createTBody();
  for (const values of rows) {
    const row = body.insertRow();
    row.append(node("th", values[0], {scope: "row"}));
    for (const value of values.slice(1)) row.insertCell().textContent = value;
  }
  return element;
}

function selectField(parent, name, options) {
  const label = node("label", name, {class: "scene-field"});
  const select = node("select");
  for (const [value, text] of options) select.append(new Option(text, value));
  label.append(select);
  parent.append(label);
  return select;
}

function inputField(parent, name, value) {
  const label = node("label", name, {class: "scene-field"});
  const input = node("input", "", {type: "text", value, autocomplete: "off"});
  label.append(input);
  parent.append(label);
  return input;
}

function checkField(parent, name, defaultValue) {
  const label = node("label", "", {class: "scene-check"});
  const input = node("input", "", {type: "checkbox"});
  input.checked = defaultValue;
  label.append(input, name);
  parent.append(label);
  return input;
}

function checkboxList(parent, name, labels, enabled) {
  const group = node("fieldset", "", {class: "scene-checks"});
  group.append(node("legend", name));
  parent.append(group);
  return labels.map((label, index) => checkField(group, label, enabled.includes(index)));
}

function describe(parent, text) {
  parent.append(node("p", text, {class: "scene-note"}));
}

function chain(values) {
  return values.length ? values.join(" → ") : "—";
}

function text(ctx, value, x, y, color = "#1d3830", size = 19) {
  ctx.font = `600 ${size}px "Microsoft YaHei", system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(value, x, y);
}

function edge(ctx, from, to, {color = "#a6b9b1", weight = 2, arrow = false, offset = 0, pad = 24} = {}) {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const x = to[0] - pad * ux - offset * uy;
  const y = to[1] - pad * uy + offset * ux;
  ctx.strokeStyle = color;
  ctx.lineWidth = weight;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(from[0] + pad * ux - offset * uy, from[1] + pad * uy + offset * ux);
  ctx.lineTo(x, y);
  if (arrow) {
    ctx.moveTo(x - 10 * ux - 5 * uy, y - 10 * uy + 5 * ux);
    ctx.lineTo(x, y);
    ctx.lineTo(x - 10 * ux + 5 * uy, y - 10 * uy - 5 * ux);
  }
  ctx.stroke();
}

function vertex(ctx, point, label, state = "") {
  const [x, y] = point;
  ctx.beginPath();
  ctx.arc(x, y, 21, 0, Math.PI * 2);
  ctx.fillStyle = state === "current" ? "#fff2d8" : state === "active" ? "#bde8d8" :
    state === "muted" ? "#f1f3f0" : "#fff";
  ctx.fill();
  ctx.strokeStyle = state === "current" ? amber : state === "active" ? accent :
    state === "muted" ? "#cdd8d1" : "#819b90";
  ctx.lineWidth = state === "current" ? 3 : 2;
  ctx.stroke();
  if (label) text(ctx, label, x, y + 39, state === "muted" ? muted : undefined);
}

function labelBox(ctx,[x,y],name,state,span=90) {
  ctx.fillStyle = state === "current" ? "#fff0d7" : state === "active" ? "#d8efe3" : "#f5f7f3";
  ctx.strokeStyle = state === "current" ? amber : state === "active" ? accent : "#aabbb0";
  ctx.lineWidth = state === "current" ? 3 : 1.5;
  ctx.beginPath(); ctx.roundRect(x-span/2,y-14,span,28,7); ctx.fill(); ctx.stroke();
  text(ctx,name,x,y,state === "current" ? amber : undefined,17);
}

function social(controls) {
  const local = [[42,166],[134,101],[221,180],[169,277],[55,283]];
  const points = people.map((_, i) => [18 + Math.floor(i/5)*278 + local[i%5][0], local[i%5][1]]);
  const source = selectField(controls, "发布消息的人", people.map((name, id) => [id, `${name} · ${clubs[Math.floor(id/5)]}`]));
  const switches = (parent, title, ids) => checkboxList(parent, title,
    ids.map(i => contacts[i].map(id => people[id]).join(" → ")), ids.flatMap((id,i) => activeContacts[id] ? [i] : []));
  const enabled = switches(controls, "跨社团转发", [0,1,2,3]);
  describe(controls, "断开「陈曦 → 周宁」，看看校报的消息还能传到哪一团。保持断开，再接通「杜若 → 唐棠」。");
  const details = node("details");
  details.append(node("summary", "编辑三个社团内部的转发关系"));
  controls.append(details);
  clubs.forEach((name,k) => enabled.push(...switches(details, name, Array.from({length:6}, (_,i) => 4+6*k+i))));

  return () => {
    const arcs = contacts.filter((_, id) => enabled[id].checked);
    const sender = Number(source.value);
    return {
      steps: warshall(people.length, arcs),
      draw(ctx, step) {
        clubs.forEach((club,k) => {
          ctx.fillStyle = ["#e6efe8", "#e9edf0", "#f2ece1"][k];
          ctx.fillRect(12+k*278,36,258,309);
          text(ctx, club, 140+k*278,60,muted,18);
        });
        for (const [a, b] of arcs) edge(ctx, points[a], points[b], {
          arrow: true, weight: Math.floor(a/5) !== Math.floor(b/5) ? 4 : 2,
          color: step.matrix[sender][a] ? accent : "#a6b9b1",
        });
        text(ctx,"箭头表示直接转发　·　粗线连接两个社团",width/2,373,muted,16);
        for (let id = 0; id < people.length; id++) {
          const state = id === step.via ? "current" : step.matrix[sender][id] ? "active" : "";
          vertex(ctx, points[id], "", state);
          text(ctx, people[id], ...points[id], state === "current" ? amber : undefined, 16);
          const caption = [id === sender && "发布", id === step.via && "中介"].filter(Boolean).join(" / ");
          if (caption) text(ctx, caption, points[id][0], points[id][1]+33, amber, 15);
        }
      },
      result(out, step) {
        const reachable = people.filter((_, id) => id !== sender && step.matrix[sender][id]);
        const added = step.added.map(([a, b]) => `${people[a]}→${people[b]}`);
        out.append(node("strong", `${people[sender]}可触达 ${reachable.length} 位其他用户`));
        describe(out, reachable.length ? reachable.join("、") : "没有可触达的其他用户。");
        describe(out, step.via === null ? "初始矩阵包含直接转发和自身可达。" :
          `允许${people[step.via]}作为中介。本步新增 ${added.length} 条可达关系${added.length ? `，例如 ${added.slice(0,3).join("、")}` : ""}。`);
        const matrix = table(["发布方 / 接收方", ...people], step.matrix.map((row, id) =>
          [people[id], ...row.map(value => value ? "1" : "0")]));
        matrix.tBodies[0].rows[sender].classList.add("selected-row");
        for (const [a, b] of step.added) matrix.tBodies[0].rows[a].cells[b + 1].classList.add("updated-cell");
        const scroll = node("div", "", {class:"matrix-scroll", tabindex:"0", "aria-label":"可达矩阵"});
        scroll.append(matrix);
        out.append(scroll);
      },
    };
  };
}

function tsp(controls) {
  const stops = stores;
  const enabled = checkboxList(controls, "今日需要配送", stops.slice(1).map(stop => stop.name), dailyOrders.map(i => i-1));
  describe(controls, "从西侧仓库发车。勾上「临时自提点」，比较西门店之后先送哪家。多送一站，全程一定会更远吗？底图每格 5 km，按直线距离选站。");
  const points = stops.map(({x, y}) => [30 + 19*x, 14 + 19*y]);

  return () => {
    const required = stops.flatMap((_, id) => id > 0 && enabled[id - 1].checked ? [id] : []);
    const steps = nearestNeighbor(stops, 0, required);
    return {
      steps,
      draw(ctx, step) {
        ctx.strokeStyle = "#d7e1d7"; ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x=30; x<width; x+=95) { ctx.moveTo(x,0); ctx.lineTo(x,height); }
        for (let y=14; y<height; y+=95) { ctx.moveTo(0,y); ctx.lineTo(width,y); }
        ctx.stroke();
        for (let i = 1; i < step.route.length; i++) {
          edge(ctx, points[step.route[i - 1]], points[step.route[i]], {
            arrow: true, offset: 3, weight: 4, color: i === step.route.length - 1 ? amber : accent,
          });
        }
        for (let id = 0; id < stops.length; id++) {
          const state = id === step.route.at(-1) ? "current" : step.route.includes(id) ? "active" :
            id > 0 && !required.includes(id) ? "muted" : "";
          vertex(ctx, points[id], "", state);
          const [x,y] = points[id];
          ctx.lineWidth = 5; ctx.strokeStyle = "#f4f7f1";
          ctx.font = '600 17px "Microsoft YaHei",system-ui,sans-serif'; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.strokeText(stops[id].name,x,y+33);
          text(ctx, stops[id].name,x,y+33,state === "muted" ? muted : undefined,17);
          const order = step.route.indexOf(id);
          if (order >= 0) text(ctx, String(order), ...points[id], accent);
        }
      },
      result(out, step, index) {
        const returned = index > 0 && step.route.at(-1) === 0;
        const title = !required.length ? "今天没有需要配送的站点" : returned ?
          required.length === 1 ? "往返配送已完成" : "闭合配送路线已生成" : "正在构建配送顺序";
        out.append(node("strong", title));
        describe(out, chain(step.route.map(id => stops[id].name)));
        describe(out, `累计 ${number.format(step.distance)} km。本段 ${number.format(step.leg)} km。`);
        if (returned && required.length === 1) describe(out, "只有一个配送点，车辆沿同一对站点往返。");
        else if (returned) describe(out, "最后一段是返仓里程。该回路可行，但不保证全局最短。");
        else if (required.length) {
          const here = stops[step.route.at(-1)];
          const choices = required.filter(id => !step.route.includes(id)).map(id =>
            `${stops[id].name} ${number.format(Math.hypot(stops[id].x - here.x, stops[id].y - here.y))}`);
          describe(out, choices.length ? `下一步从这些站中选最近者（km）：${choices.join("、")}。` : "所有站点已送达，下一步返仓。");
        }
      },
    };
  };
}

function matching(controls) {
  const left = workers.map((_, id) => [134, 43 + id*44]);
  const right = jobs.map((_, id) => [706, 43 + id*44]);
  const grid = table(["人／岗", ...jobs], workers.map(name => [name, ...jobs.map(() => "")]));
  grid.classList.add("qualifications");
  const eligible = workers.map((worker, i) => jobs.map((job, j) => {
    const cell = grid.tBodies[0].rows[i].cells[j + 1];
    const input = node("input", "", {type: "checkbox", "aria-label": `${worker}可负责${job}`});
    input.checked = qualifications[i].includes(j);
    cell.append(input);
    return input;
  }));
  controls.append(grid);
  describe(controls, "开放日有八个岗位，只有小陶会直播。看最后一轮小林如何上岗，再取消小陶的直播资格，检查还能否排满。");

  return () => {
    const edges = eligible.flatMap((row, i) => row.flatMap((input, j) => input.checked ? [[i, j]] : []));
    return {
      steps: hungarian(workers.length, jobs.length, edges),
      draw(ctx, step) {
        for (const [a, b] of edges) edge(ctx, left[a], right[b]);
        for (const [a, b] of step.matching.entries()) {
          if (b >= 0) edge(ctx, left[a], right[b], {color: accent, weight: 4});
        }
        ctx.setLineDash([7, 5]);
        for (let i = 1; i < step.path.length; i++) {
          edge(ctx, left[step.path[i][0]], right[step.path[i - 1][1]], {color: amber});
        }
        ctx.setLineDash([]);
        for (const [a, b] of step.path) edge(ctx, left[a], right[b], {color: amber, weight: 4});
        for (const [id, name] of workers.entries()) {
          labelBox(ctx,left[id],name,id === step.root ? "current" : step.matching[id]>=0 ? "active" : "");
        }
        for (const [id, name] of jobs.entries()) labelBox(ctx,right[id],name,step.matching.includes(id) ? "active" : "");
        text(ctx,"灰线：可申请　　绿线：已配对　　橙色：本轮改派（虚线为退出的配对）",width/2,378,muted,16);
      },
      result(out, step, index, last) {
        const count = step.matching.filter(id => id >= 0).length;
        out.append(node("strong", `${index === last ? "最多可安排" : "已安排"} ${count} 个岗位`));
        const assignments = step.matching.flatMap((job, id) => job < 0 ? [] : [`${workers[id]} · ${jobs[job]}`]);
        describe(out, assignments.length ? assignments.join("　") : "当前没有已分配岗位。");
        if (step.root === null) describe(out, "初始匹配为空。");
        else if (step.path.length) describe(out, "本步增广路为 " + chain(step.path.flatMap(([a, b]) =>
          [workers[a], jobs[b]])) + "。");
        else describe(out, `从${workers[step.root]}出发没有找到增广路。`);
      },
    };
  };
}

const maps = [
  {
    names: ["西苑", "河湾", "东港", "南埔"],
    borders: [[0, 1], [1, 2], [2, 3]],
    shapes: [
      [[55, 86], [198, 86], [230, 141], [200, 248], [55, 248]],
      [[198, 86], [380, 86], [352, 182], [383, 248], [200, 248], [230, 141]],
      [[380, 86], [549, 86], [575, 162], [543, 248], [383, 248], [352, 182]],
      [[549, 86], [705, 86], [705, 248], [543, 248], [575, 162]],
    ],
    centers: [[122, 163], [290, 163], [466, 163], [633, 163]],
  },
  {
    names: ["西苑", "河湾", "东港", "南埔", "竹里", "新城"],
    borders: [[0, 1], [1, 2], [0, 3], [1, 4], [2, 5], [3, 4], [4, 5]],
    shapes: [
      [[55, 51], [255, 51], [270, 155], [146, 166], [55, 155]],
      [[255, 51], [503, 51], [492, 170], [375, 149], [270, 155]],
      [[503, 51], [705, 51], [705, 160], [612, 149], [492, 170]],
      [[55, 155], [146, 166], [270, 155], [248, 274], [55, 274]],
      [[270, 155], [375, 149], [492, 170], [516, 274], [248, 274]],
      [[492, 170], [612, 149], [705, 160], [705, 274], [516, 274]],
    ],
    centers: [[151, 105], [379, 105], [615, 105], [151, 216], [379, 216], [615, 216]],
  },
];
maps.unshift(district);
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const regionId = id => alphabet[id];

function coloring(controls) {
  const template = selectField(controls, "区划模板", [[0, "滨江城区 · 十五区"], [1, "四区条带"], [2, "六区片区"]]);
  const naturalOrder = () => maps[template.value].names.map((_,id) => regionId(id)).join(" ");
  const orderField = inputField(controls, "区域处理顺序", naturalOrder());
  orderField.maxLength = 36;
  const alternate = node("button", "试用 J 区先于 I 区", {type: "button"});
  alternate.onclick = () => {
    orderField.value = template.value === "0" ? naturalOrder().replace("I J", "J I") : "A D B C";
    orderField.dispatchEvent(new Event("input", {bubbles: true}));
  };
  template.addEventListener("change", () => {
    orderField.value = naturalOrder();
    alternate.hidden = template.value === "2";
    alternate.textContent = template.value === "0" ? "试用 J 区先于 I 区" : "试用 A D B C";
  });
  controls.append(alternate);
  describe(controls, "输入每个地区的字母一次，顺序可改。共用一段边界的地区需要不同颜色。");

  return () => {
    const map = maps[template.value];
    const order = orderField.value.toUpperCase().replace(/[\s,，、]+/g, "").split("")
      .map(letter => alphabet.indexOf(letter));
    const valid = order.length === map.names.length && new Set(order).size === map.names.length &&
      order.every(id => id >= 0 && id < map.names.length);
    return {
      steps: sequentialColoring(map.names.length, map.borders, valid ? order : []),
      draw(ctx, step) {
        ctx.save();
        if (map !== district) ctx.translate(40,35);
        for (const [id, shape] of map.shapes.entries()) {
          ctx.beginPath();
          ctx.moveTo(...shape[0]);
          for (const point of shape.slice(1)) ctx.lineTo(...point);
          ctx.closePath();
          ctx.fillStyle = palette[step.colors[id]];
          ctx.fill();
          ctx.strokeStyle = "#446157";
          ctx.lineWidth = 2;
          ctx.stroke();
          const [x, y] = map.centers[id];
          text(ctx, `${regionId(id)} ${map.names[id]}`, x, y - 12);
          text(ctx, step.colors[id] ? `颜色 ${step.colors[id]}` : "待着色", x, y + 16, muted, 16);
        }
        ctx.restore();
      },
      result(out, step, index, last) {
        if (!valid) {
          out.append(node("strong", `请输入 ${map.names.map((_, id) => regionId(id)).join("、")} 各一次。`));
          return;
        }
        const used = Math.max(...step.colors);
        out.append(node("strong", `${index === last ? "配色完成，使用" : "目前使用"} ${used} 种颜色`));
        describe(out, "处理顺序为 " + chain(order.map(regionId)) + "。");
        if (step.region !== null) {
          const blocked = step.unavailable.length ? step.unavailable.join("、") : "无";
          describe(out, `地区 ${regionId(step.region)} 已着色邻区占用的颜色为 ${blocked}，本步选颜色 ${step.colors[step.region]}。`);
        }
        describe(out, step.colors.flatMap((color, id) => color ? [`${regionId(id)}＝${color}`] : []).join("　"));
      },
    };
  };
}

function tree(controls) {
  const folders = archive;
  const points = [];
  let leaf = 0;
  function place(id, level) {
    const ys = folders[id].children.map(child => place(child,level+1));
    const y = ys.length ? (ys[0]+ys.at(-1))/2 : 22+34*leaf++;
    points[id] = [78+171*level,y];
    return y;
  }
  place(0,0);
  const branch = selectField(controls, "从哪个目录开始", folders.map((folder, id) => [id, folder.name]));
  const keyword = inputField(controls, "文件名关键词", "算法");
  keyword.maxLength = 60;
  describe(controls, "先访问当前目录，再进入左、右分支。关键词留空会列出检索范围内的全部资料。");

  return () => ({
    steps: preorderSearch(folders, Number(branch.value), keyword.value),
    draw(ctx, step) {
      for (const [i,{children}] of folders.entries()) {
        const [x,y] = points[i];
        for (const child of children) {
          const [cx,cy] = points[child], mid = (x+cx)/2;
          ctx.strokeStyle = step.visited.includes(child) && step.visited.includes(i) ? accent : "#b4c5b9";
          ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(mid,y); ctx.lineTo(mid,cy); ctx.lineTo(cx,cy); ctx.stroke();
        }
      }
      for (const [id, folder] of folders.entries()) {
        const order = step.visited.indexOf(id);
        const hit = step.hits.some(item => item.id === id);
        const label = `${order<0 ? "" : `${order+1} `}${folder.name}${hit ? " ✓" : ""}`;
        labelBox(ctx,points[id],label,id === step.visited.at(-1) ? "current" : order >= 0 ? "active" : "",140);
      }
      text(ctx,"从左往右读树，同一父目录先查上支、再查下支　·　数字是访问次序，✓ 表示有命中",width/2,386,muted,15);
    },
    result(out, step) {
      out.append(node("strong", `已访问 ${step.visited.length} 个目录，找到 ${step.hits.length} 份资料`));
      describe(out, "访问顺序为 " + chain(step.visited.map(id => folders[id].name)) + "。");
      if (step.hits.length) {
        const list = node("ul", "", {class: "scene-hits"});
        for (const {id, name} of step.hits) list.append(node("li", `${folders[id].name} / ${name}`));
        out.append(list);
      }
    },
  });
}

const scenes = {
  social: {
    title: "社交网络的消息触达", method: "Warshall 算法", page: "§1.2 第 15–16 页 · §2.3.5 第 54 页",
    note: "校报发布征稿通知。15 位成员分属三个社团，跨团联系人决定通知能传多远。",
    visual: "社交网络有向图", setup: social,
  },
  tsp: {
    title: "旅行商的配送回路", method: "最邻近方法", page: "§3.6 第 100 页",
    note: "城区有 14 个可接单站点。车辆从西侧仓库出发，送完今天的订单再回仓。",
    visual: "配送站点与当前访问路线", setup: tsp,
  },
  matching: {
    title: "志愿者与岗位分配", method: "匈牙利算法", page: "§5.4 第 144–145 页",
    note: "开放日的八名志愿者要分到八个岗位。看最后一人加入时，哪些人得换岗。",
    visual: "志愿者、岗位与当前匹配", setup: matching,
  },
  coloring: {
    title: "行政区划地图着色", method: "顺序着色法", page: "§6.5 第 175–176 页",
    note: "滨江城区划为十五区。先给新城上色还是先给江口上色，会影响整张图用了几种颜色。",
    visual: "行政地区当前配色，结果区另列每区色号", setup: coloring,
  },
  tree: {
    title: "课程资料目录检索", method: "前序遍历算法", page: "§3.3 第 84–85 页",
    note: "同一套资料分散在课堂和项目两支，共 21 个目录。试着只搜项目里的文件。",
    visual: "资料目录树与当前访问顺序", setup: tree,
  },
};

function mount(config) {
  panel.innerHTML = `
    <header class="scene-heading">
      <div><h2 id="scene-title"></h2><p class="scene-intro"></p></div>
      <p class="scene-method"><strong></strong><span></span></p>
    </header>
    <div class="scene-grid">
      <article class="scene-board" aria-label="演示结果">
        <canvas width="${width}" height="${height}" role="img"></canvas>
        <div class="scene-play">
          <span class="scene-position"></span>
          <div>
            <button type="button" data-step="first">从头看</button>
            <button type="button" data-step="previous">上一步</button>
            <button type="button" data-step="next">下一步</button>
            <button type="button" data-step="last">查看结果</button>
          </div>
        </div>
        <div class="scene-output" role="status" aria-live="polite"></div>
      </article>
      <aside class="scene-controls" aria-labelledby="parameter-title">
        <h3 id="parameter-title">现场参数</h3><p class="sample-label">教学样例 · 修改后自动计算</p>
        <div class="scene-inputs"></div>
        <button class="scene-reset" type="button">恢复示例</button>
      </aside>
    </div>`;
  const find = selector => panel.querySelector(selector);
  find("h2").textContent = config.title;
  find(".scene-intro").textContent = config.note;
  find(".scene-method strong").textContent = config.method;
  find(".scene-method span").textContent = "课本 " + config.page;
  const canvas = find("canvas");
  canvas.setAttribute("aria-label", config.visual);
  canvas.width = width * 2;
  canvas.height = height * 2;
  const ctx = canvas.getContext("2d");
  ctx.scale(2, 2);
  const controls = find(".scene-inputs");
  const out = find(".scene-output");
  const buttons = [...panel.querySelectorAll("[data-step]")];
  const position = find(".scene-position");
  let compute = config.setup(controls);
  let view;
  let index;

  function paint() {
    const last = view.steps.length - 1;
    ctx.clearRect(0, 0, width, height);
    view.draw(ctx, view.steps[index]);
    out.replaceChildren();
    view.result(out, view.steps[index], index, last);
    position.textContent = last === 0 ? "无待执行步骤" : index === 0 ? `初始状态 · 共 ${last} 步` : `步骤 ${index} / ${last}`;
    buttons.forEach((button, i) => { button.disabled = i < 2 ? index === 0 : index === last; });
  }

  function recompute() {
    view = compute();
    index = view.steps.length - 1;
    paint();
  }

  const steps = {first: () => 0, previous: () => index - 1, next: () => index + 1,
    last: () => view.steps.length - 1};
  for (const button of buttons) {
    button.onclick = () => {
      index = steps[button.dataset.step]();
      paint();
    };
  }
  controls.addEventListener("change", recompute);
  controls.addEventListener("input", event => {
    if (event.target.type === "text") recompute();
  });
  find(".scene-reset").onclick = () => {
    controls.replaceChildren();
    compute = config.setup(controls);
    recompute();
    controls.querySelector("select, input")?.focus();
  };
  recompute();
}

let current = null;
const savedPanels = new Map();
function switchScene() {
  const hash = location.hash.slice(1);
  const target = Object.hasOwn(scenes, hash) ? hash : "traffic";
  if (target === current) return;
  if (current && current !== "traffic") {
    const saved = document.createDocumentFragment();
    saved.append(...panel.childNodes);
    savedPanels.set(current, saved);
  }
  current = target;
  traffic.hidden = target !== "traffic";
  panel.hidden = target === "traffic";
  for (const link of nav) {
    if (link.hash === "#" + target) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  if (panel.hidden) return;
  if (savedPanels.has(target)) panel.append(savedPanels.get(target));
  else mount(scenes[target]);
}

document.getElementById("traffic-reference").textContent = "课本 §3.4 第 89–90 页";
window.addEventListener("hashchange", switchScene);
switchScene();
