// Main page: data loading, header + date brush, and the Vibes / Network / Over time views.

import { bus, vibeColor, fmtHours, fmtInt, fmtMonth, fmtDate, escapeHtml, store, toast } from "./util.js";
import * as Spotify from "./spotify.js";
import * as Recs from "./recs.js";
import * as NowPlaying from "./nowplaying.js";
import * as DJ from "./dj.js";
import * as Habits from "./habits.js";
import * as Poster from "./poster.js";
import * as Setup from "./setup.js";

const $ = (s) => document.querySelector(s);

const state = {
  graph: null,
  history: null,
  range: null, // [firstMonthIndex, lastMonthIndex] or null for all time
  view: "vibes",
  selected: null, // { type: "artist" | "vibe", id }
  vibeNames: store.get("vibe-names", {}),
  neighbors: new Map(), // artist id -> [{ id, w, n }]
};

const api = {
  state,
  showView,
  selectArtist,
  selectVibe,
  vibeName: (v) => state.vibeNames[v] || state.graph.vibes[v]?.name || "Unsorted",
  renameVibe(v, name) {
    if (name && name.trim()) state.vibeNames[v] = name.trim().slice(0, 40);
    else delete state.vibeNames[v];
    store.set("vibe-names", state.vibeNames);
    bus.emit("vibe-names");
  },
  artistMinutes,
  rangeIdx: () => rangeIdx(),
  showTip,
  hideTip,
};

// ---------- helpers ----------

function rangeIdx() {
  return state.range ?? [0, state.graph.meta.months.length - 1];
}

// The vibe an artist is most linked to besides its own (used to mark bridge artists).
function bridgeTarget(id) {
  const own = state.graph.artists[id].vibe, weights = new Map();
  for (const n of state.neighbors.get(id) ?? []) {
    const v = state.graph.artists[n.id].vibe;
    if (v !== own) weights.set(v, (weights.get(v) ?? 0) + n.w);
  }
  return d3.greatest([...weights], (d) => d[1])?.[0] ?? -1;
}

function artistMinutes(a) {
  if (!state.range) return a.minutes;
  const [i0, i1] = state.range;
  let sum = 0;
  for (let i = i0; i <= i1; i++) sum += a.monthly[i];
  return sum;
}

function sumRange(arr) {
  const [i0, i1] = rangeIdx();
  let s = 0;
  for (let i = i0; i <= i1; i++) s += arr[i];
  return s;
}

const tooltip = $("#tooltip");
function showTip(html, event) {
  tooltip.innerHTML = html;
  tooltip.hidden = false;
  const pad = 14, { innerWidth: W, innerHeight: H } = window;
  const r = tooltip.getBoundingClientRect();
  let x = event.clientX + pad, y = event.clientY + pad;
  if (x + r.width > W - 8) x = event.clientX - r.width - pad;
  if (y + r.height > H - 8) y = event.clientY - r.height - pad;
  tooltip.style.left = `${Math.max(8, x)}px`;
  tooltip.style.top = `${Math.max(8, y)}px`;
}
function hideTip() {
  tooltip.hidden = true;
}

function onResize(el, fn) {
  let t, last = el.clientWidth;
  new ResizeObserver(() => {
    if (Math.abs(el.clientWidth - last) < 2) return;
    last = el.clientWidth;
    clearTimeout(t);
    t = setTimeout(fn, 120);
  }).observe(el);
}

function sparkArea(svgEl, values, color) {
  const svg = d3.select(svgEl), w = svgEl.clientWidth || 280, h = svgEl.clientHeight || 70;
  svg.attr("viewBox", `0 0 ${w} ${h}`).selectAll("*").remove();
  const x = d3.scaleLinear([0, values.length - 1], [0, w]);
  const y = d3.scaleLinear([0, d3.max(values) || 1], [h - 2, 4]);
  const id = `g${Math.random().toString(36).slice(2)}`;
  const grad = svg.append("defs").append("linearGradient").attr("id", id).attr("x2", 0).attr("y2", 1);
  grad.append("stop").attr("stop-color", color).attr("stop-opacity", 0.55);
  grad.append("stop").attr("offset", 1).attr("stop-color", color).attr("stop-opacity", 0.02);
  svg.append("path").attr("fill", `url(#${id})`).attr("d", d3.area().x((_, i) => x(i)).y0(h).y1(y).curve(d3.curveMonotoneX)(values));
  svg.append("path").attr("fill", "none").attr("stroke", color).attr("stroke-width", 1.5).attr("d", d3.line().x((_, i) => x(i)).y(y).curve(d3.curveMonotoneX)(values));
}

function hourBars(svgEl, values, color) {
  const svg = d3.select(svgEl), w = svgEl.clientWidth || 280, h = svgEl.clientHeight || 70;
  svg.attr("viewBox", `0 0 ${w} ${h}`).selectAll("*").remove();
  const x = d3.scaleBand(d3.range(24), [0, w]).padding(0.18);
  const y = d3.scaleLinear([0, d3.max(values) || 1], [h - 14, 2]);
  svg.selectAll("rect").data(values).join("rect")
    .attr("x", (_, i) => x(i)).attr("width", x.bandwidth()).attr("y", y).attr("height", (d) => h - 14 - y(d))
    .attr("rx", 2).attr("fill", color);
  svg.selectAll("text").data([0, 6, 12, 18]).join("text")
    .attr("x", (d) => x(d)).attr("y", h - 2).attr("font-size", 10).attr("fill", "currentColor").attr("opacity", 0.55)
    .text((d) => ["12a", "6a", "12p", "6p"][d / 6]);
}

// ---------- header, theme, tabs, brush ----------

function renderStats() {
  const g = state.graph;
  const minutes = sumRange(g.totals.minutes), plays = sumRange(g.totals.plays);
  const topArtist = d3.greatest(g.artists, artistMinutes);
  const vibeMinutes = g.vibes.map((v) => sumRange(v.monthly));
  const topVibe = d3.greatest(g.vibes, (v) => vibeMinutes[v.id]);
  const items = [
    ["Listening", fmtHours(minutes)],
    ["Plays", fmtInt(plays)],
    ["Top artist", topArtist && artistMinutes(topArtist) > 0 ? topArtist.name : "—"],
    ["Top vibe", topVibe && vibeMinutes[topVibe.id] > 0 ? api.vibeName(topVibe.id) : "—"],
  ];
  $("#stats").innerHTML = items.map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`).join("");
}

function setupTheme() {
  $("#theme-toggle").addEventListener("click", () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    store.set("theme", root.dataset.theme);
  });
}

function setupTabs() {
  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
}

const views = {};
function showView(name) {
  state.view = name;
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === name)));
  document.querySelectorAll(".view").forEach((s) => (s.hidden = s.id !== `view-${name}`));
  if (location.hash.slice(1) !== name) history.replaceState(null, "", name === "vibes" ? location.pathname + location.search : `#${name}`);
  hideTip();
  views[name]?.show();
}

function setupBrush() {
  const el = $("#brush");
  const months = state.graph.meta.months;
  const M = months.length;
  let x, brush, gBrush;

  function draw() {
    const w = el.clientWidth, h = 64, m = { l: 2, r: 2, t: 4, b: 16 };
    if (w < 80) return; // laid out later; the resize observer redraws
    const svg = d3.select(el).attr("viewBox", `0 0 ${w} ${h}`);
    svg.selectAll("*").remove();
    x = d3.scaleLinear([0, M - 1], [m.l, w - m.r]);
    const y = d3.scaleLinear([0, d3.max(state.graph.totals.minutes) || 1], [h - m.b, m.t]);
    const grad = svg.append("defs").append("linearGradient").attr("id", "brush-grad");
    ["#ff3d7f", "#ffb03a", "#35d0c0", "#8b7bff"].forEach((c, i, a) => grad.append("stop").attr("offset", i / (a.length - 1)).attr("stop-color", c));
    svg.append("path").attr("fill", "url(#brush-grad)").attr("fill-opacity", 0.45)
      .attr("d", d3.area().x((_, i) => x(i)).y0(h - m.b).y1(y).curve(d3.curveMonotoneX)(state.graph.totals.minutes));
    svg.append("path").attr("fill", "none").attr("stroke", "url(#brush-grad)").attr("stroke-width", 1.5)
      .attr("d", d3.line().x((_, i) => x(i)).y(y).curve(d3.curveMonotoneX)(state.graph.totals.minutes));
    const years = months.map((mo, i) => [mo, i]).filter(([mo, i]) => mo.endsWith("-01") || i === 0);
    svg.append("g").attr("class", "axis").selectAll("text").data(years).join("text")
      .attr("x", ([, i]) => x(i)).attr("y", h - 3).text(([mo]) => mo.slice(0, 4));

    brush = d3.brushX().extent([[m.l, m.t], [w - m.r, h - m.b]]).on("end", ({ selection, sourceEvent }) => {
      if (!sourceEvent) return;
      if (!selection) return setRange(null);
      let i0 = Math.round(x.invert(selection[0])), i1 = Math.round(x.invert(selection[1]));
      if (i1 - i0 < 2) i1 = Math.min(M - 1, i0 + 2), i0 = Math.max(0, i1 - 2);
      gBrush.transition().duration(200).call(brush.move, [x(i0), x(i1)]);
      setRange([i0, i1]);
    });
    gBrush = svg.append("g").call(brush);
    if (state.range) gBrush.call(brush.move, [x(state.range[0]), x(state.range[1])]);
  }

  function setRange(r) {
    state.range = r && (r[0] > 0 || r[1] < M - 1) ? r : null;
    const [i0, i1] = rangeIdx();
    $("#range-label").textContent = state.range ? `${fmtMonth(months[i0])} – ${fmtMonth(months[i1])}` : `All time · ${fmtMonth(months[0])} – ${fmtMonth(months[M - 1])}`;
    $("#range-reset").hidden = !state.range;
    renderStats();
    bus.emit("range");
  }

  $("#range-reset").addEventListener("click", () => {
    gBrush.call(brush.move, null);
    setRange(null);
  });
  draw();
  setRange(null);
  onResize(el, draw);
}

// ---------- side panel ----------

const panel = $("#vibe-panel");

function panelOverview() {
  const g = state.graph;
  const total = d3.sum(g.vibes, (v) => sumRange(v.monthly)) || 1;
  panel.innerHTML = `
    <h2>Your vibes</h2>
    <p class="sub">${g.vibes.length} clusters of artists you tend to play together, named by when you play them.</p>
    <div class="vibe-legend">
      ${g.vibes.map((v) => `
        <button data-vibe="${v.id}">
          <span class="swatch" style="background:${vibeColor(v.id)};box-shadow:0 0 10px ${vibeColor(v.id)}"></span>
          <span><strong>${escapeHtml(api.vibeName(v.id))}</strong>
          <small>${Math.round((100 * sumRange(v.monthly)) / total)}% · ${escapeHtml(v.artists.slice(0, 2).map((i) => g.artists[i].name).join(", "))}</small></span>
        </button>`).join("")}
    </div>
    ${bridgeList(g)}`;
  panel.querySelectorAll("[data-vibe]").forEach((b) => b.addEventListener("click", () => selectVibe(+b.dataset.vibe)));
}

const HOUR_BUCKETS = [
  ["late night", [0, 1, 2, 3, 4]], ["early morning", [5, 6, 7, 8]], ["morning", [9, 10, 11]],
  ["afternoon", [12, 13, 14, 15, 16]], ["evening", [17, 18, 19, 20]], ["night", [21, 22, 23]],
];

// Why two vibes meet: when you cross over, which way you drift, and the song you cross on.
function bridgeWhy(b) {
  if (!b.switches) return null;
  const peak = d3.greatest(HOUR_BUCKETS, ([, hours]) => d3.sum(hours, (h) => b.hours[h]))[0];
  const months = state.graph.meta.months;
  const years = d3.rollup(b.monthly.map((n, i) => ({ year: months[i].slice(0, 4), n })), (v) => d3.sum(v, (d) => d.n), (d) => d.year);
  const [ab, ba] = b.direction;
  return {
    peak,
    year: d3.greatest([...years], (d) => d[1])?.[0],
    from: api.vibeName(ab >= ba ? b.a : b.b),
    into: api.vibeName(ab >= ba ? b.b : b.a),
    share: Math.round((100 * Math.max(ab, ba)) / Math.max(1, ab + ba)),
    gateway: b.gateways?.[0],
    switches: b.switches,
  };
}

// What links the islands: vibe pairs, and the artists doing the linking.
function bridgeList(g) {
  const bridges = (g.bridges ?? []).filter((b) => b.w >= 0.05);
  if (!bridges.length) return `<h4>Bridges</h4><p class="sub">These vibes barely overlap — you keep them in separate sessions.</p>`;
  return `
    <h4>What links them</h4>
    <ul class="mini-list">
      ${bridges.map((b) => {
        const [i, j] = b.links[0];
        const why = bridgeWhy(b);
        return `<li class="bridge-row"><button data-artist="${i}">
          <strong><span class="swatch" style="background:${vibeColor(b.a)}"></span>${escapeHtml(api.vibeName(b.a))}
          <span class="swatch" style="background:${vibeColor(b.b)}"></span>${escapeHtml(api.vibeName(b.b))}</strong>
          <small>via ${escapeHtml(g.artists[i].name)} + ${escapeHtml(g.artists[j].name)}</small>
          ${why ? `<small class="why">${fmtInt(why.switches)} switches mid-session, mostly ${escapeHtml(why.peak)}${why.year ? `, peaking ${why.year}` : ""} ·
            ${why.share}% of the time you drift <em>${escapeHtml(why.from)} → ${escapeHtml(why.into)}</em>
            ${why.gateway ? `· usually on “${escapeHtml(why.gateway[0])}” by ${escapeHtml(why.gateway[1])}` : ""}</small>` : ""}
        </button><span>${fmtInt(b.sessions)}<br><small>sessions</small></span></li>`;
      }).join("")}
    </ul>
    <p class="sub" style="font-size:12px">Sessions where both vibes turned up together. Dashed rings on the map mark the artists pulling in two directions.</p>`;
}

function panelVibe(v) {
  const g = state.graph, vibe = g.vibes[v], color = vibeColor(v);
  const share = vibe.monthly.map((m, i) => (g.totals.minutes[i] ? m / g.totals.minutes[i] : 0));
  const artists = vibe.artists.map((i) => g.artists[i]).sort((a, b) => artistMinutes(b) - artistMinutes(a)).slice(0, 8);
  panel.innerHTML = `
    <h2><span class="swatch" style="background:${color};box-shadow:0 0 10px ${color}"></span>${escapeHtml(api.vibeName(v))}</h2>
    <p class="sub">${vibe.artists.length} artists · ${escapeHtml(vibe.when)}, ${escapeHtml(vibe.days)} · peaked ${vibe.peakYear}</p>
    <h4>When you play it</h4><svg class="panel-chart" id="p-hours"></svg>
    <h4>Share of your listening</h4><svg class="panel-chart" id="p-share"></svg>
    <h4>Top artists${state.range ? " (this period)" : ""}</h4>
    <ul class="mini-list">${artists.map((a) => `<li><button data-artist="${a.id}">${escapeHtml(a.name)}</button><span>${fmtHours(artistMinutes(a))}</span></li>`).join("")}</ul>
    <h4>Most played</h4>
    <ul class="mini-list">${vibe.topTracks.slice(0, 6).map(([t, a, n]) => `<li><span>${escapeHtml(t)} <span style="color:var(--muted)">· ${escapeHtml(a)}</span></span><span>${fmtInt(n)}</span></li>`).join("")}</ul>
    <div class="panel-actions">
      <button class="primary-btn" id="p-playlist">Make a playlist</button>
      <button class="ghost-btn" id="p-back">All vibes</button>
    </div>`;
  hourBars($("#p-hours"), vibe.hours, color);
  sparkArea($("#p-share"), share, color);
  bindPanelArtists();
  $("#p-playlist").addEventListener("click", () => { Recs.selectVibe(v); showView("foryou"); });
  $("#p-back").addEventListener("click", () => { state.selected = null; bus.emit("selection"); panelOverview(); });
}

function panelArtist(id) {
  const g = state.graph, a = g.artists[id], color = vibeColor(a.vibe);
  const neighbors = (state.neighbors.get(id) ?? []).slice(0, 6);
  panel.innerHTML = `
    <h2>${escapeHtml(a.name)}</h2>
    <p class="sub"><span class="swatch" style="background:${color}"></span>${escapeHtml(api.vibeName(a.vibe))}</p>
    <p class="sub">${fmtHours(a.minutes)} · ${fmtInt(a.plays)} plays · since ${fmtDate(a.first)}</p>
    <h4>Listening over time</h4><svg class="panel-chart" id="p-monthly"></svg>
    <h4>Top songs</h4>
    <ul class="mini-list">${a.topTracks.map(([t, n]) => `<li><span>${escapeHtml(t)}</span><span>${fmtInt(n)}</span></li>`).join("")}</ul>
    ${neighbors.length ? `<h4>Played alongside</h4>
    <ul class="mini-list">${neighbors.map((n) => `<li><button data-artist="${n.id}">${escapeHtml(g.artists[n.id].name)}</button><span>${fmtInt(n.n)} sessions</span></li>`).join("")}</ul>` : ""}
    <div class="panel-actions">
      <button class="ghost-btn" id="p-vibe">See its vibe</button>
      <button class="ghost-btn" id="p-network">Show in network</button>
    </div>`;
  sparkArea($("#p-monthly"), a.monthly, color);
  bindPanelArtists();
  $("#p-vibe").addEventListener("click", () => selectVibe(a.vibe));
  $("#p-network").addEventListener("click", () => { showView("network"); selectArtist(id); });
}

function bindPanelArtists() {
  panel.querySelectorAll("[data-artist]").forEach((b) => b.addEventListener("click", () => selectArtist(+b.dataset.artist)));
}

function selectArtist(id) {
  state.selected = id == null ? null : { type: "artist", id };
  if (id == null) panelOverview();
  else panelArtist(id);
  bus.emit("selection");
}

function selectVibe(v) {
  if (state.view !== "vibes") showView("vibes");
  state.selected = { type: "vibe", id: v };
  panelVibe(v);
  bus.emit("selection");
}

function refreshPanel() {
  const s = state.selected;
  if (!s) panelOverview();
  else if (s.type === "artist") panelArtist(s.id);
  else panelVibe(s.id);
}

// ---------- vibes map ----------

views.vibes = (() => {
  const el = $("#vibes-svg");
  let g, layers, geometry, transform = d3.zoomIdentity;

  function render() {
    const w = el.clientWidth, h = el.clientHeight;
    if (!w) return;
    const svg = d3.select(el).attr("viewBox", `0 0 ${w} ${h}`);
    svg.selectAll("*").remove();
    // Fit the artists' own extent to the card, so the islands fill it instead of sitting in a margin.
    const pad = 80, artists0 = state.graph.artists;
    const ex = d3.extent(artists0, (a) => a.x), ey = d3.extent(artists0, (a) => a.y);
    const spanX = Math.max(ex[1] - ex[0], 1e-6), spanY = Math.max(ey[1] - ey[0], 1e-6);
    const fit = Math.min((w - 2 * pad) / spanX, (h - 2 * pad - 20) / spanY);
    const scaleX = Math.min((w - 2 * pad) / spanX, fit * 1.35);   // a little stretch on wide cards
    const ox = (w - spanX * scaleX) / 2 - ex[0] * scaleX, oy = (h - spanY * fit) / 2 - 10 - ey[0] * fit;
    const base = artists0.map((a) => [ox + a.x * scaleX, oy + a.y * fit]);
    geometry = { w, h, base, pos: base };

    svg.append("defs").append("filter").attr("id", "vblur").attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%")
      .append("feGaussianBlur").attr("stdDeviation", 14);
    g = svg.append("g");
    layers = {
      glow: g.append("g").attr("class", "glow").attr("filter", "url(#vblur)"),
      bridges: g.append("g").attr("class", "bridges"),
      edges: g.append("g"),
      dots: g.append("g"),
      labels: g.append("g"),
      vibes: g.append("g"),
    };
    const zoom = d3.zoom().scaleExtent([0.6, 8]).on("zoom", (e) => {
      transform = e.transform;
      g.attr("transform", transform);
      updateLabels();
    });
    svg.call(zoom).on("dblclick.zoom", null).call(zoom.transform, transform);
    svg.on("click", (e) => { if (e.target === el) selectArtist(null); });
    update();
  }

  function update() {
    if (!g) return;
    const { w, h } = geometry, artists = state.graph.artists;
    const mins = artists.map(artistMinutes);
    const r = d3.scaleSqrt([0, d3.max(mins) || 1], [2, 24]);
    const pos = (geometry.pos = relax(geometry.base, artists.map((a) => r(mins[a.id]))));

    layers.glow.selectAll("*").remove();
    for (const vibe of state.graph.vibes) {
      const pts = vibe.artists.filter((i) => mins[i] > 0);
      if (!pts.length) continue;
      const contours = d3.contourDensity().x((i) => pos[i][0]).y((i) => pos[i][1]).weight((i) => Math.sqrt(mins[i]))
        .size([w, h]).cellSize(w > 900 ? 8 : 6).bandwidth(26).thresholds(4)(pts);
      layers.glow.append("g").selectAll("path").data(contours).join("path")
        .attr("d", d3.geoPath()).attr("fill", vibeColor(vibe.id)).attr("fill-opacity", (_, i) => 0.18 + i * 0.1);
    }

    drawBridges(pos, mins);
    const crossValues = artists.map((a) => a.cross ?? 0).sort(d3.ascending);
    const crossCut = Math.max(0.2, d3.quantile(crossValues, 0.92) ?? 1);

    const dots = layers.dots.selectAll("circle").data(artists, (a) => a.id).join("circle")
      .attr("class", "dot")
      .attr("fill", (a) => vibeColor(a.vibe)).attr("fill-opacity", (a) => (mins[a.id] > 0 ? 0.95 : 0.2))
      .on("mouseenter", (e, a) => hover(a, e))
      .on("mousemove", (e, a) => hover(a, e))
      .on("mouseleave", () => hover(null))
      .on("click", (e, a) => { e.stopPropagation(); selectArtist(a.id); })
      .classed("bridge-artist", (a) => (a.cross ?? 0) >= crossCut && mins[a.id] > 0)
      .style("stroke", (a) => ((a.cross ?? 0) >= crossCut && mins[a.id] > 0 ? vibeColor(bridgeTarget(a.id)) : null));
    // new dots are drawn at their final size and place; only later changes animate
    dots.filter(function () { return this.getAttribute("cx") === null; })
      .attr("cx", (a) => pos[a.id][0]).attr("cy", (a) => pos[a.id][1]).attr("r", (a) => r(mins[a.id]));
    dots.transition().duration(400).attr("r", (a) => r(mins[a.id])).attr("cx", (a) => pos[a.id][0]).attr("cy", (a) => pos[a.id][1]);

    const ranked = d3.sort(artists, (a) => -mins[a.id]).slice(0, 90); // only these can ever be shown
    layers.labels.selectAll("text").data(ranked, (a) => a.id).join("text")
      .attr("class", "artist-label").attr("text-anchor", "middle")
      .attr("x", (a) => pos[a.id][0]).attr("y", (a) => pos[a.id][1] - r(mins[a.id]) - 5)
      .text((a) => a.name).each(function (a, i) { this.dataset.rank = i; });

    const centers = state.graph.vibes.map((v) => {
      const pts = v.artists.map((i) => [pos[i], Math.max(mins[i], 0.01)]);
      const tw = d3.sum(pts, (p) => p[1]);
      return { v, x: d3.sum(pts, (p) => p[0][0] * p[1]) / tw, bottom: d3.max(v.artists, (i) => pos[i][1] + r(mins[i])) };
    });
    layers.vibes.selectAll("text").data(centers, (c) => c.v.id).join("text")
      .attr("class", "vibe-label").attr("text-anchor", "middle")
      .attr("x", (c) => c.x).attr("y", (c) => c.bottom + 20)
      .attr("fill", (c) => vibeColor(c.v.id))
      .text((c) => api.vibeName(c.v.id))
      .on("click", (e, c) => { e.stopPropagation(); selectVibe(c.v.id); });
    updateLabels();
    applySelection();
  }

  // Arcs between the artists that tie two vibes together.
  function drawBridges(pos, mins) {
    const defs = d3.select(el).select("defs");
    const paths = [];
    for (const bridge of (state.graph.bridges ?? []).filter((b) => b.w >= 0.05)) {
      for (const [i, j, w] of bridge.links.slice(0, 3)) {
        if (!(mins[i] > 0) || !(mins[j] > 0)) continue;
        const id = `bridge-${bridge.a}-${bridge.b}-${i}-${j}`;
        if (defs.select(`#${id}`).empty()) {
          const grad = defs.append("linearGradient").attr("id", id).attr("gradientUnits", "userSpaceOnUse");
          grad.append("stop").attr("offset", 0).attr("stop-color", vibeColor(state.graph.artists[i].vibe));
          grad.append("stop").attr("offset", 1).attr("stop-color", vibeColor(state.graph.artists[j].vibe));
        }
        defs.select(`#${id}`).attr("x1", pos[i][0]).attr("y1", pos[i][1]).attr("x2", pos[j][0]).attr("y2", pos[j][1]);
        paths.push({ id, bridge, i, j, w });
      }
    }
    const strongest = d3.max(paths, (d) => d.w) || 1;   // link weights are raw PMI, so scale them here
    layers.bridges.selectAll("path").data(paths, (d) => d.id).join("path")
      .attr("class", "bridge").attr("fill", "none").attr("stroke", (d) => `url(#${d.id})`)
      .attr("stroke-width", (d) => 3 + 7 * (d.w / strongest)).attr("stroke-linecap", "round")
      .attr("d", (d) => {
        const [x1, y1] = pos[d.i], [x2, y2] = pos[d.j];
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1;
        return `M${x1},${y1} Q${mx - dy * 0.12},${my + dx * 0.12} ${x2},${y2}`;   // gentle arc
      })
      .on("mousemove", (e, d) => {
        const why = bridgeWhy(d.bridge);
        showTip(
          `<strong>${escapeHtml(api.vibeName(d.bridge.a))} ↔ ${escapeHtml(api.vibeName(d.bridge.b))}</strong>` +
          `<span class="muted">${escapeHtml(state.graph.artists[d.i].name)} + ${escapeHtml(state.graph.artists[d.j].name)} · ` +
          `${fmtInt(d.bridge.sessions)} shared sessions` +
          (why ? `<br>${fmtInt(why.switches)} switches, mostly ${escapeHtml(why.peak)} · you drift ${escapeHtml(why.from)} → ${escapeHtml(why.into)}` : "") +
          `</span>`, e);
      })
      .on("mouseleave", hideTip)
      .on("click", (e, d) => { e.stopPropagation(); selectArtist(d.i); });
  }

  // Nudge dots apart so none overlap, while staying close to their computed spot.
  function relax(base, radii) {
    const nodes = base.map(([x, y], i) => ({ x, y, bx: x, by: y, r: radii[i] }));
    const sim = d3.forceSimulation(nodes)
      .force("x", d3.forceX((d) => d.bx).strength(0.25))
      .force("y", d3.forceY((d) => d.by).strength(0.25))
      .force("collide", d3.forceCollide((d) => d.r + 6).iterations(2))
      .stop();
    for (let i = 0; i < (nodes.length > 150 ? 55 : 110); i++) sim.tick();
    return nodes.map((d) => [d.x, d.y]);
  }

  function updateLabels() {
    const k = transform.k, limit = Math.round(14 * k * k);
    const sel = state.selected;
    layers.labels.selectAll("text")
      .attr("font-size", 11 / k).attr("stroke-width", 3 / k)
      .attr("display", function (a) { return +this.dataset.rank < limit || (sel?.type === "artist" && sel.id === a.id) ? null : "none"; });
    layers.vibes.selectAll("text").attr("font-size", 13 / Math.sqrt(k)).attr("stroke-width", 4 / Math.sqrt(k));
  }

  function hover(a, e) {
    const { pos } = geometry;
    if (!a) {
      hideTip();
      layers.edges.selectAll("*").remove();
      return applySelection();
    }
    const nb = state.neighbors.get(a.id) ?? [];
    showTip(`<strong>${escapeHtml(a.name)}</strong><span class="muted">${fmtHours(artistMinutes(a))}${state.range ? " in this period" : ""} · ${escapeHtml(api.vibeName(a.vibe))}</span>`, e);
    if (e.type !== "mouseenter") return;
    const ids = new Set([a.id, ...nb.map((n) => n.id)]);
    layers.edges.selectAll("line").data(nb.slice(0, 12)).join("line").attr("class", "edge")
      .attr("x1", pos[a.id][0]).attr("y1", pos[a.id][1]).attr("x2", (n) => pos[n.id][0]).attr("y2", (n) => pos[n.id][1])
      .attr("stroke", vibeColor(a.vibe)).attr("stroke-opacity", (n) => 0.25 + 0.6 * n.w).attr("stroke-width", (n) => 0.6 + 2 * n.w);
    layers.dots.selectAll("circle").classed("faded", (d) => !ids.has(d.id));
  }

  function applySelection() {
    if (!layers) return;
    const s = state.selected;
    let keep = null;
    if (s?.type === "artist") keep = new Set([s.id, ...(state.neighbors.get(s.id) ?? []).map((n) => n.id)]);
    if (s?.type === "vibe") keep = new Set(state.graph.vibes[s.id].artists);
    layers.dots.selectAll("circle").classed("faded", (d) => keep && !keep.has(d.id))
      .attr("stroke-width", (d) => (s?.type === "artist" && s.id === d.id ? 3 : 1));
    updateLabels();
  }

  bus.on("range", update);
  bus.on("selection", applySelection);
  bus.on("vibe-names", () => { update(); refreshPanel(); renderStats(); });
  onResize(el, () => state.view === "vibes" && render());
  return { show: () => (g && geometry.w === el.clientWidth ? update() : render()) };
})();

// ---------- network ----------

views.network = (() => {
  const el = $("#network-svg");
  let g, nodes, links, sim, zoom, svg, rendered = false, dirty = false;

  function radius() {
    const mins = state.graph.artists.map(artistMinutes);
    // smaller dots in a big library, so the connecting lines stay visible
    const r = d3.scaleSqrt([0, d3.max(mins) || 1], [2, mins.length > 150 ? 17 : 26]);
    return (d) => r(mins[d.id]);
  }

  function render() {
    const w = el.clientWidth, h = el.clientHeight;
    if (!w) return;
    rendered = true;
    svg = d3.select(el).attr("viewBox", `0 0 ${w} ${h}`);
    svg.selectAll("*").remove();
    const s = Math.min(w * 0.96, h * 0.96), ox = (w - s) / 2, oy = (h - s) / 2;
    const r0 = radius();
    nodes = state.graph.artists.map((a) => ({ id: a.id, a, x: ox + (a.nx ?? a.x) * s, y: oy + (a.ny ?? a.y) * s }));
    // open the precomputed layout out so artists breathe instead of clumping
    const spread = d3.forceSimulation(nodes)
      .force("collide", d3.forceCollide((d) => r0(d) + 12).iterations(2))
      .force("charge", d3.forceManyBody().strength(-30).distanceMax(220))
      .force("anchor-x", d3.forceX((d) => d.x).strength(0.035))
      .force("anchor-y", d3.forceY((d) => d.y).strength(0.035))
      // gentle gravity, so unconnected clusters drift together instead of hugging the corners
      .force("center-x", d3.forceX(w / 2).strength(0.03))
      .force("center-y", d3.forceY(h / 2).strength(0.03))
      .stop();
    for (let i = 0; i < 120; i++) spread.tick();
    links = state.graph.edges.map(([source, target, w, n]) => ({ source, target, w, n }));
    const centers = state.graph.vibes.map((v) => ({
      x: d3.mean(v.artists, (i) => nodes[i].x), y: d3.mean(v.artists, (i) => nodes[i].y),
    }));
    const r = radius();

    sim = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((d) => d.id).distance((l) => 55 + 90 * (1 - l.w)).strength((l) => 0.03 + 0.3 * l.w))
      .force("charge", d3.forceManyBody().strength(-150).distanceMax(400))
      .force("collide", d3.forceCollide((d) => r(d) + 6))
      .force("x", d3.forceX((d) => d3.mean([centers[d.a.vibe]?.x ?? w / 2, w / 2])).strength(0.03))
      .force("y", d3.forceY((d) => d3.mean([centers[d.a.vibe]?.y ?? h / 2, h / 2])).strength(0.03))
      .stop(); // the layout is precomputed by build_data.py; physics only runs while dragging

    g = svg.append("g");
    zoom = d3.zoom().scaleExtent([0.3, 8]).on("zoom", (e) => {
      g.attr("transform", e.transform);
      g.selectAll(".artist-label").attr("font-size", 11 / e.transform.k).attr("stroke-width", 3 / e.transform.k);
    });
    svg.call(zoom).on("dblclick.zoom", null);
    const bounds = [d3.extent(nodes, (d) => d.x), d3.extent(nodes, (d) => d.y)];
    const k = Math.min(2.5, 0.92 * Math.min(w / (bounds[0][1] - bounds[0][0] + 60), h / (bounds[1][1] - bounds[1][0] + 60)));
    svg.call(zoom.transform, d3.zoomIdentity.translate(w / 2, h / 2).scale(k).translate(-d3.mean(bounds[0]), -d3.mean(bounds[1])));
    svg.on("click", (e) => { if (e.target === el) selectArtist(null); });

    const crosses = (l) => l.source.a.vibe !== l.target.a.vibe;
    const defs = svg.append("defs");
    const gradientFor = (l) => {
      const id = `net-bridge-${l.source.id}-${l.target.id}`;
      if (defs.select(`#${id}`).empty()) {
        const grad = defs.append("linearGradient").attr("id", id).attr("gradientUnits", "userSpaceOnUse");
        grad.append("stop").attr("offset", 0).attr("stop-color", vibeColor(l.source.a.vibe));
        grad.append("stop").attr("offset", 1).attr("stop-color", vibeColor(l.target.a.vibe));
      }
      defs.select(`#${id}`).datum(l);
      return id;
    };
    g.append("g").attr("class", "links").selectAll("line").data(links.filter((l) => !crosses(l))).join("line").attr("class", "edge")
      .attr("stroke-width", (l) => 0.7 + 2.6 * l.w);
    // links between vibes are the bridges: blended color, thicker, drawn on top
    g.append("g").attr("class", "bridge-links").selectAll("line").data(links.filter(crosses)).join("line")
      .attr("class", "bridge-link").attr("stroke", (l) => `url(#${gradientFor(l)})`)   // no .edge class: it would override the gradient
      .attr("stroke-width", (l) => 1.6 + 4.5 * l.w)
      .on("mousemove", (e, l) => {
        const bridge = (state.graph.bridges ?? []).find((b) =>
          b.a === Math.min(l.source.a.vibe, l.target.a.vibe) && b.b === Math.max(l.source.a.vibe, l.target.a.vibe));
        const why = bridge && bridgeWhy(bridge);
        showTip(
          `<strong>${escapeHtml(l.source.a.name)} ↔ ${escapeHtml(l.target.a.name)}</strong>` +
          `<span class="muted">${escapeHtml(api.vibeName(l.source.a.vibe))} → ${escapeHtml(api.vibeName(l.target.a.vibe))} · ${fmtInt(l.n)} sessions together` +
          (why ? `<br>These vibes meet mostly ${escapeHtml(why.peak)}, usually on “${escapeHtml(why.gateway?.[0] ?? "")}”` : "") + `</span>`, e);
      })
      .on("mouseleave", hideTip);
    g.append("g").attr("class", "nodes").selectAll("circle").data(nodes).join("circle").attr("class", "dot")
      .attr("fill", (d) => vibeColor(d.a.vibe)).attr("r", r)
      .on("mouseenter", (e, d) => hover(d, e)).on("mousemove", (e, d) => hover(d, e)).on("mouseleave", () => hover(null))
      .on("click", (e, d) => { e.stopPropagation(); selectArtist(d.id); })
      .call(d3.drag()
        .on("start", (e, d) => { if (!e.active) sim.alphaTarget(0.2).restart(); d.fx = d.x; d.fy = d.y; })
        .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on("end", (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = d.fy = null; }));
    g.append("g").attr("class", "labels");
    sim.on("tick", positions);
    update();
    positions();
  }

  function positions() {
    g.selectAll(".links line, .bridge-links line").attr("x1", (l) => l.source.x).attr("y1", (l) => l.source.y).attr("x2", (l) => l.target.x).attr("y2", (l) => l.target.y);
    svg.selectAll("defs linearGradient").each(function (l) {
      const link = d3.select(this).datum();
      if (link?.source) d3.select(this).attr("x1", link.source.x).attr("y1", link.source.y).attr("x2", link.target.x).attr("y2", link.target.y);
    });
    g.selectAll(".nodes circle").attr("cx", (d) => d.x).attr("cy", (d) => d.y);
    g.selectAll(".labels text").attr("x", (d) => d.x).attr("y", (d) => d.y - radius()(d) - 5);
  }

  function update() {
    if (!rendered) return;
    const r = radius();
    const mins = state.graph.artists.map(artistMinutes);
    const crossValues = state.graph.artists.map((a) => a.cross ?? 0).sort(d3.ascending);
    const crossCut = Math.max(0.2, d3.quantile(crossValues, 0.92) ?? 1);
    g.selectAll(".nodes circle")
      .attr("fill-opacity", (d) => (mins[d.id] > 0 ? 0.95 : 0.2))
      .classed("bridge-artist", (d) => (d.a.cross ?? 0) >= crossCut && mins[d.id] > 0)
      .style("stroke", (d) => ((d.a.cross ?? 0) >= crossCut && mins[d.id] > 0 ? vibeColor(bridgeTarget(d.id)) : null))
      .transition().duration(400).attr("r", r);
    sim.force("collide").radius((d) => r(d) + 2);
    const top = new Set(d3.sort(nodes, (d) => -mins[d.id]).slice(0, nodes.length > 150 ? 16 : 24).map((d) => d.id));
    const s = state.selected;
    if (s?.type === "artist") top.add(s.id);
    g.select(".labels").selectAll("text").data(nodes.filter((d) => top.has(d.id)), (d) => d.id).join("text")
      .attr("class", "artist-label").attr("text-anchor", "middle").text((d) => d.a.name);
    positions();
    applySelection();
  }

  function hover(d, e) {
    if (!d) { hideTip(); return applySelection(); }
    showTip(`<strong>${escapeHtml(d.a.name)}</strong><span class="muted">${fmtHours(artistMinutes(d.a))} · ${(state.neighbors.get(d.id) ?? []).length} connections</span>`, e);
    if (e.type === "mouseenter") highlight(d.id);
  }

  function highlight(id) {
    const keep = id == null ? null : new Set([id, ...(state.neighbors.get(id) ?? []).map((n) => n.id)]);
    const color = id == null ? null : vibeColor(state.graph.artists[id].vibe);
    g.selectAll(".nodes circle").classed("faded", (d) => keep && !keep.has(d.id)).attr("stroke-width", (d) => (d.id === id ? 3 : 1));
    g.selectAll(".links line, .bridge-links line")
      .classed("faded", (l) => keep && l.source.id !== id && l.target.id !== id)
      .style("stroke", (l) => (keep && (l.source.id === id || l.target.id === id) ? color : null))
      .style("stroke-opacity", (l) => (keep && (l.source.id === id || l.target.id === id) ? 0.4 + 0.6 * l.w : null));
  }

  function applySelection() {
    const s = state.selected;
    highlight(s?.type === "artist" ? s.id : null);
    if (bridgesOnly) showBridgesOnly();
    if (s?.type === "vibe") g.selectAll(".nodes circle").classed("faded", (d) => d.a.vibe !== s.id);
  }

  function focus(id) {
    const d = nodes?.[id];
    if (!d) return;
    const w = el.clientWidth, h = el.clientHeight;
    svg.transition().duration(700).call(zoom.transform, d3.zoomIdentity.translate(w / 2, h / 2).scale(2.2).translate(-d.x, -d.y));
  }

  // "Bridges only": fade everything that stays inside one vibe
  let bridgesOnly = new URLSearchParams(location.search).get("bridges") === "1";
  function showBridgesOnly() {
    const linked = new Set();
    g.selectAll(".bridge-links line").each((l) => { linked.add(l.source.id); linked.add(l.target.id); });
    g.selectAll(".bridge-links line").style("stroke-width", (l) => (bridgesOnly ? (1.6 + 4.5 * l.w) * 2 : null));
    g.selectAll(".links line").classed("faded", bridgesOnly);
    g.selectAll(".nodes circle").classed("faded", (d) => bridgesOnly && !linked.has(d.id));
    g.selectAll(".labels text").classed("faded", (d) => bridgesOnly && !linked.has(d.id));
  }
  $("#bridges-only").addEventListener("click", (e) => {
    bridgesOnly = !bridgesOnly;
    e.currentTarget.setAttribute("aria-pressed", String(bridgesOnly));
    if (bridgesOnly) showBridgesOnly();
    else {
      g.selectAll(".links line, .nodes circle, .labels text").classed("faded", false);
      g.selectAll(".bridge-links line").style("stroke-width", null);
      applySelection();
    }
  });
  if (bridgesOnly) $("#bridges-only").setAttribute("aria-pressed", "true");

  const list = $("#artist-list");
  $("#artist-search").addEventListener("change", (e) => {
    const q = e.target.value.trim().toLowerCase();
    const a = state.graph.artists.find((x) => x.name.toLowerCase() === q) ?? state.graph.artists.find((x) => x.name.toLowerCase().includes(q));
    if (!a) return toast("No artist by that name on the map");
    selectArtist(a.id);
    focus(a.id);
  });

  bus.on("range", () => (state.view === "network" ? update() : (dirty = true)));
  bus.on("selection", () => {
    if (!rendered) return;
    update();
    if (state.view === "network" && state.selected?.type === "artist") focus(state.selected.id);
  });
  onResize(el, () => state.view === "network" && render());
  return {
    show() {
      if (!rendered) render();
      else if (dirty) { dirty = false; update(); }
    },
    fillSearch() {
      list.innerHTML = state.graph.artists.map((a) => `<option value="${escapeHtml(a.name)}"></option>`).join("");
    },
  };
})();

// ---------- over time (streamgraph) ----------

views.time = (() => {
  const el = $("#stream-svg");
  let mode = "artists";

  function render() {
    const w = el.clientWidth, h = el.clientHeight;
    if (!w) return;
    const g = state.graph, months = g.meta.months;
    const [i0, i1] = rangeIdx();
    const idx = d3.range(i0, i1 + 1);
    const m = { t: 64, r: 16, b: 58, l: 16 };
    const svg = d3.select(el).attr("viewBox", `0 0 ${w} ${h}`);
    svg.selectAll("*").remove();

    let series;
    if (mode === "artists") {
      const top = d3.sort(g.artists, (a) => -artistMinutes(a)).slice(0, 12).filter((a) => artistMinutes(a) > 0);
      const lightness = [0, 0.12, -0.1];
      const seen = new Map();
      series = top.map((a) => {
        const k = seen.get(a.vibe) ?? 0;
        seen.set(a.vibe, k + 1);
        const c = d3.hsl(vibeColor(a.vibe));
        c.l = Math.min(0.8, Math.max(0.3, c.l + lightness[k % 3]));
        return { key: `a${a.id}`, name: a.name, color: c.formatHex(), values: a.monthly, onClick: () => selectArtist(a.id) };
      });
    } else {
      series = g.vibes.map((v) => ({ key: `v${v.id}`, name: api.vibeName(v.id), color: vibeColor(v.id), values: v.monthly, onClick: () => selectVibe(v.id) }));
    }
    // Vibes cover nearly everything, so show the small remainder; for artists it would swamp the top 12.
    if (mode === "vibes") {
      const other = g.totals.minutes.map((t, i) => Math.max(0, t - d3.sum(series, (s) => s.values[i])));
      if (d3.sum(other) > 0.02 * d3.sum(g.totals.minutes)) series.push({ key: "other", name: "Other artists", color: "var(--faint)", values: other });
    }
    const byKey = new Map(series.map((s) => [s.key, s]));

    const rows = idx.map((i) => Object.fromEntries([["i", i], ...series.map((s) => [s.key, s.values[i]])]));
    const stacked = d3.stack().keys(series.map((s) => s.key)).offset(d3.stackOffsetWiggle).order(d3.stackOrderInsideOut)(rows);
    const x = d3.scaleLinear([i0, i1], [m.l, w - m.r]);
    const y = d3.scaleLinear([d3.min(stacked, (l) => d3.min(l, (d) => d[0])), d3.max(stacked, (l) => d3.max(l, (d) => d[1]))], [h - m.b, m.t]);
    const area = d3.area().x((d) => x(d.data.i)).y0((d) => y(d[0])).y1((d) => y(d[1])).curve(d3.curveBasis);

    const paths = svg.append("g").selectAll("path").data(stacked).join("path")
      .attr("class", "layer").attr("d", area)
      .attr("fill", (l) => byKey.get(l.key).color).attr("fill-opacity", (l) => (l.key === "other" ? 0.35 : 0.88))
      .on("mousemove", (e, l) => {
        const [mx] = d3.pointer(e, el);
        const i = Math.max(i0, Math.min(i1, Math.round(x.invert(mx))));
        const s = byKey.get(l.key);
        paths.classed("faded", (o) => o.key !== l.key);
        showTip(`<strong>${escapeHtml(s.name)}</strong><span class="muted">${fmtMonth(months[i])} · ${fmtHours(s.values[i])}</span>`, e);
      })
      .on("mouseleave", () => { paths.classed("faded", false); hideTip(); })
      .on("click", (e, l) => byKey.get(l.key).onClick?.());

    const labels = [];
    for (const l of stacked) {
      if (l.key === "other") continue;
      const best = d3.greatest(l, (d) => d[1] - d[0]);
      const thickness = y(best[0]) - y(best[1]);
      if (thickness > 18) labels.push({ x: x(best.data.i), y: y((best[0] + best[1]) / 2), text: byKey.get(l.key).name, size: Math.min(15, 9 + thickness / 8) });
    }
    svg.append("g").selectAll("text").data(labels).join("text")
      .attr("class", "artist-label").attr("text-anchor", "middle").attr("dominant-baseline", "middle")
      .attr("x", (d) => Math.max(m.l + 50, Math.min(w - m.r - 50, d.x))).attr("y", (d) => d.y).attr("font-size", (d) => d.size)
      .text((d) => d.text);

    const years = idx.filter((i) => months[i].endsWith("-01"));
    const ticks = years.length >= 2 ? years : idx.filter((_, k) => k % Math.max(1, Math.ceil(idx.length / 8)) === 0);
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${h - m.b + 18})`).selectAll("text").data(ticks).join("text")
      .attr("x", x).attr("text-anchor", "middle").text((i) => (years.length >= 2 ? months[i].slice(0, 4) : fmtMonth(months[i])));
  }

  $("#stream-mode").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    mode = b.dataset.mode;
    $("#stream-mode").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    render();
  });
  bus.on("range", () => state.view === "time" && render());
  bus.on("vibe-names", () => state.view === "time" && render());
  onResize(el, () => state.view === "time" && render());
  return { show: render };
})();

views.foryou = { show: () => Recs.show() };
views.dj = { show: () => DJ.show() };
views.habits = { show: () => Habits.show() };
views.poster = { show: () => Poster.show() };

// ---------- boot ----------

async function loadJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} not found`);
  return res.json();
}

async function main() {
  setupTheme();
  try {
    await Spotify.init();
  } catch (e) {
    toast(e.message, { error: true });
  }
  try {
    [state.graph, state.history] = await Promise.all([loadJSON("data/graph_data.json"), loadJSON("data/history_index.json")]);
  } catch {
    document.querySelector("main").innerHTML = `<div class="viz-card empty-first"><h2>Nothing here yet</h2>
      <p>Import the listening history Spotify sent you and this fills up with your own music.</p>
      <button class="primary-btn" id="empty-import">Import your export</button>
      <p class="setup-sub">Prefer the terminal? <code>.venv/bin/python build_data.py</code>, or <code>--sample</code> to look around first.</p></div>`;
    Setup.init(null);
    document.getElementById("empty-import").addEventListener("click", () => Setup.open());
    return;
  }
  for (const [s, t, w, n] of state.graph.edges) {
    (state.neighbors.get(s) ?? state.neighbors.set(s, []).get(s)).push({ id: t, w, n });
    (state.neighbors.get(t) ?? state.neighbors.set(t, []).get(t)).push({ id: s, w, n });
  }
  state.neighbors.forEach((list) => list.sort((a, b) => b.w - a.w));
  $("#sample-badge").hidden = !state.graph.meta.sample;
  $("#sample-badge").addEventListener("click", () => Setup.open());
  Setup.init(state.graph.meta);

  setupTabs();
  setupBrush();
  views.network.fillSearch();
  panelOverview();
  Recs.init(api);
  NowPlaying.init(api);
  DJ.init(api);
  Habits.init(api);
  Poster.init(api);
  showView(views[location.hash.slice(1)] ? location.hash.slice(1) : "vibes");

  const resume = Spotify.takeResume();
  if (resume?.type === "playlists" || resume?.type === "set") {
    showView("dj");                  // the login was started from the DJ crate, so come back to it
    DJ.resume(resume);
  } else if (resume) {
    showView("foryou");
    Recs.resume(resume);
  }
}

main();
