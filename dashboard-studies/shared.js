"use strict";

const paths = {
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  home: "m3 11 9-8 9 8v9h-6v-6H9v6H3z",
  chart: "M4 20V5m0 15h17M8 16l4-5 4 2 5-7",
  bag: "M4 7h16l1 13H3zM8 8V6a4 4 0 0 1 8 0v2",
  people: "M4 21v-3a4 4 0 0 1 4-4h3a4 4 0 0 1 4 4v3m2-7a4 4 0 0 1 4 4v3M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zm3-3a4 4 0 0 1 0 7",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0-6 2 3 4 1 3 3-1 3 1 3-3 3-4 1-2 3-2-3-4-1-3-3 1-3-1-3 3-3 4-1z",
  search: "M15 15l5 5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0z",
  bell: "M5 17h14l-2-4V8a5 5 0 0 0-10 0v5zM10 21h4",
  calendar: "M4 5h16v16H4zM8 3v5m8-5v5M4 10h16",
  message: "M3 4h18v13H9l-6 4zM7 8h10m-10 4h7",
  list: "M8 5h13M8 12h13M8 19h13M3 5h1M3 12h1M3 19h1",
  card: "M3 5h18v14H3zM3 10h18M7 15h4",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  swap: "M4 8h16l-4-4m4 12H4l4 4",
  plus: "M12 5v14M5 12h14",
  more: "M4 12h1m6 0h1m6 0h1",
  check: "m5 12 4 4 10-10",
  clock: "M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  user: "M5 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2m-3-14a4 4 0 1 1-8 0 4 4 0 0 1 8 0z",
  file: "M5 3h10l4 4v14H5zM9 12h6m-6 4h6",
  help: "M9 9a3 3 0 1 1 4 3c-1 1-1 2-1 2m0 3h.01m9-5a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  phone: "m7 3 3 4-2 3c1 3 3 5 6 6l3-2 4 3-2 4C9 21 3 15 3 5z",
  video: "M3 5h12v14H3zM15 10l6-4v12l-6-4",
  menu: "M4 6h16M4 12h16M4 18h16",
  target: "M12 12h.01m4 0a4 4 0 1 1-8 0 4 4 0 0 1 8 0zm5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
};

const icon = (name) => `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[name] || paths.file}"/></svg>`;
document.querySelectorAll("[data-icon]").forEach((node) => { node.innerHTML = icon(node.dataset.icon); });
document.querySelectorAll("[data-menu]").forEach((node) => {
  for (const entry of node.dataset.menu.split("|")) {
    const [label, symbol = "file", selected] = entry.split(":");
    const item = document.createElement(selected ? "span" : "button");
    if (selected) item.setAttribute("aria-current", "page");
    else {
      item.type = "button";
      item.dataset.detail = label;
      item.dataset.copy = "This study reconstructs the dashboard view. This destination is represented in the navigation for comparison.";
    }
    item.className = "side-item";
    item.innerHTML = icon(symbol);
    item.append(label);
    node.append(item);
  }
});

function drawChart(node, mode = "full") {
  const series = node.dataset.values.split("|").map((line) => line.split(",").map(Number));
  const labels = (node.dataset.labels || "").split(",");
  const omitted = mode === "recent" ? Math.floor(series[0].length / 2) : 0;
  if (mode === "recent") {
    series.forEach((line) => line.splice(0, omitted));
    labels.splice(0, omitted);
  }
  const names = (node.dataset.series || "Value").split(",");
  const colors = (node.dataset.colors || "").split(",");
  const color = (index) => colors[index] || "currentColor";
  const type = node.dataset.chart;
  const stacked = node.hasAttribute("data-stack");
  const axes = Boolean(node.dataset.labels);
  const width = axes ? 560 : 300, height = axes ? 175 : 100;
  const left = axes ? 34 : 5, right = width - 7, top = 8, bottom = axes ? 151 : 94;
  const max = Number(node.dataset.max) || Math.max(1, ...series.flat()) * 1.1;
  const min = Math.min(0, ...series.flat());
  const span = max - min;
  const y = (v) => bottom - (v - min) / span * (bottom - top);
  const step = (right - left) / series[0].length;
  const x = (i) => type === "bars" ? left + step * (i + .5) : left + (right - left) * i / Math.max(1, series[0].length - 1);
  const grid = axes ? Array.from({ length: 5 }, (_, i) => {
    const val = min + span * i / 4;
    return `<line class="gridline" x1="${left}" x2="${right}" y1="${y(val)}" y2="${y(val)}"/><text class="plot-label" x="1" y="${y(val) + 3}">${Math.round(val)}${node.dataset.unit || ""}</text>`;
  }).join("") + labels.map((label, i) => `<text class="plot-label" x="${x(i)}" y="170" text-anchor="${i === 0 && type !== "bars" ? "start" : i === labels.length - 1 && type !== "bars" ? "end" : "middle"}">${label}</text>`).join("") : "";
  const marks = [];
  const plot = series.map((values, index) => {
    if (type === "bars") {
      const barWidth = stacked ? step * .62 : Math.min(28, step * .53 / series.length);
      return values.map((v, i) => {
        const selected = node.dataset.highlight == null || Number(node.dataset.highlight) === i + omitted;
        const base = stacked ? series.slice(0, index).reduce((sum, row) => Math.sign(row[i]) === Math.sign(v) ? sum + row[i] : sum, 0) : 0;
        const px = stacked ? x(i) - barWidth / 2 : x(i) + (index - series.length / 2) * barWidth;
        const py = Math.min(y(base + v), y(base));
        const h = Math.abs(y(base + v) - y(base));
        marks.push([i, index, px + barWidth * .43, py + h / 2]);
        return `<rect data-bar-index="${i}" data-bar-color="${color(index)}" x="${px}" y="${py}" width="${barWidth * .86}" height="${h}" rx="2" fill="${selected ? color(index) : "#e9eaed"}"/>`;
      }).join("");
    }
    const points = values.map((v, i) => [x(i), y(v)]);
    let line = `M${points[0].join(",")}`;
    for (let i = 1; i < points.length; i++) {
      const [x0,y0] = points[i-1], [x1,y1] = points[i];
      line += node.hasAttribute("data-smooth") ? ` C${(x0+x1)/2},${y0} ${(x0+x1)/2},${y1} ${x1},${y1}` : ` L${x1},${y1}`;
    }
    points.forEach(([px,py],i)=>marks.push([i,index,px,py]));
    return `<path d="${line} L${right},${y(0)} L${left},${y(0)}Z" fill="${color(index)}" opacity=".055"/><path d="${line}" fill="none" stroke="${color(index)}" stroke-width="1.65" vector-effect="non-scaling-stroke" ${index && node.hasAttribute("data-dash") ? 'stroke-dasharray="3 3"' : ""}/>`
      + (node.hasAttribute("data-dots") ? points.map(([px,py])=>`<circle cx="${px}" cy="${py}" r="2.1" fill="${color(index)}"/>`).join("") : "");
  }).join("");
  const title = node.dataset.title || "Chart";
  node.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="group" aria-label="${title}">${grid}${plot}${marks.map(([i,j,px,py]) => {
    const label = `${labels[i] || "Point " + (i+1)} · ${names[j] || "Value"}: ${series[j][i]}${node.dataset.unit || ""}`;
    return `<circle class="marker" data-tip="${label}" data-point-index="${i}" role="button" aria-label="${label}" tabindex="0" cx="${px}" cy="${py}" r="8" fill="transparent"/>`;
  }).join("")}</svg><div class="chart-tip" hidden></div>`;
  const tip = node.querySelector(".chart-tip");
  node.querySelectorAll("[data-tip]").forEach((mark) => {
    const show = () => {
      const index = Number(mark.dataset.pointIndex);
      tip.textContent = series.length > 1
        ? [labels[index] || `Point ${index + 1}`, ...series.map((line, i) => `${names[i]}  ${line[index]}${node.dataset.unit || ""}`)].join("\n")
        : mark.dataset.tip;
      tip.hidden = false;
    };
    const hide = () => { tip.hidden = true; };
    mark.addEventListener("focus", show);
    mark.addEventListener("blur", hide);
    mark.addEventListener("pointerenter", show);
    mark.addEventListener("pointerleave", hide);
    const activate = () => {
      show();
      if (node.dataset.highlight != null) {
        node.dataset.highlight = Number(mark.dataset.pointIndex) + omitted;
        node.querySelectorAll("[data-bar-index]").forEach((bar) => {
          bar.setAttribute("fill", bar.dataset.barIndex === mark.dataset.pointIndex ? bar.dataset.barColor : "#e9eaed");
        });
      }
    };
    mark.addEventListener("click", activate);
    mark.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      activate();
    });
  });
}

document.querySelectorAll("[data-chart]").forEach((node) => drawChart(node));
document.querySelectorAll("[data-period]").forEach((control) => {
  control.addEventListener("change", () => {
    document.querySelectorAll(control.dataset.period).forEach((chart) => drawChart(chart, control.value));
    document.querySelectorAll("[data-period]").forEach((peer) => {
      if (peer.dataset.period === control.dataset.period) peer.value = control.value;
    });
  });
});

const dialog = document.createElement("dialog");
dialog.setAttribute("aria-labelledby", "study-dialog-title");
dialog.innerHTML = '<div class="card-head"><h2 id="study-dialog-title"></h2><form method="dialog"><button class="btn">Close</button></form></div><p></p>';
document.body.append(dialog);
document.addEventListener("click", (event) => {
  const action = event.target.closest("[data-detail]");
  if (!action) return;
  dialog.querySelector("h2").textContent = action.dataset.detail;
  dialog.querySelector("p").textContent = action.dataset.copy || "Local demonstration using the values shown in this recreation.";
  dialog.showModal();
});

document.querySelectorAll("[data-search]").forEach((input) => {
  input.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase();
    document.querySelectorAll(input.dataset.search).forEach((row) => {
      row.hidden = !row.textContent.toLowerCase().includes(query);
    });
  });
});

const platformFilter = document.querySelector("#platform-filter");
platformFilter?.addEventListener("change", () => {
  document.querySelectorAll(".platform-row").forEach((row) => {
    row.hidden = Boolean(platformFilter.value) && row.dataset.detail !== platformFilter.value;
  });
});

const platformMetric = document.querySelector("#platform-metric");
platformMetric?.addEventListener("change", () => {
  const chart = document.querySelector("#platform-chart");
  const measures = { Revenue: "6901,11035,9288", Leads: "87,116,104", "Win rate": "14,19,16" };
  chart.dataset.values = measures[platformMetric.value];
  chart.dataset.series = platformMetric.value;
  chart.dataset.unit = platformMetric.value === "Win rate" ? "%" : "";
  drawChart(chart);
});

const taskFilter = document.querySelector("#task-filter");
taskFilter?.addEventListener("change", () => {
  document.querySelectorAll(".task-row").forEach((row) => {
    row.hidden = Boolean(taskFilter.value) && row.querySelector(".task-state").textContent !== taskFilter.value;
  });
});

const collapseACRU = document.querySelector("#collapse-acru");
collapseACRU?.addEventListener("click", () => {
  const collapsed = collapseACRU.closest(".frame").classList.toggle("rail-collapsed");
  collapseACRU.setAttribute("aria-expanded", String(!collapsed));
  collapseACRU.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
  collapseACRU.textContent = collapsed ? "»" : "« Collapse sidebar";
});

const activityForm = document.querySelector("#activity-form");
activityForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const input = document.querySelector("#activity-message");
  const message = input.value.trim();
  if (!message) return;
  const item = document.createElement("li");
  item.innerHTML = '<span class="avatar" aria-hidden="true">ME</span><div><strong>You</strong><p class="bubble"></p></div>';
  item.querySelector(".bubble").textContent = message;
  document.querySelector("#activity-list").append(item);
  document.querySelector("#activity-status").textContent = "Message added to this local activity feed.";
  input.value = "";
  input.focus();
});
