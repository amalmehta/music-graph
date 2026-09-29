// Poster: a frameable print of your listening — year rings or an artist constellation.
// Exports as PNG or SVG.

import { bus, escapeHtml, fmtHours, fmtInt, fmtMonth, vibeColor, toast } from "./util.js";

const $ = (s) => document.querySelector(s);
const W = 1000, H = 1414; // A-series proportions
const FONT = "'Space Grotesk', 'Inter', system-ui, sans-serif";

let api, state;
const opts = { style: "aurora", palette: "vibes", dark: true, labels: true, title: "My Music" };

export function init(a) {
  api = a;
  state = a.state;
  const wanted = new URLSearchParams(location.search).get("poster");   // ?poster=constellation
  if (["rings", "constellation", "aurora"].includes(wanted)) {
    opts.style = wanted;
    document.querySelectorAll('#poster-controls [data-opt="style"]')
      .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === wanted)));
  }
  const paperWanted = new URLSearchParams(location.search).get("paper");   // ?paper=light
  if (paperWanted === "light" || paperWanted === "dark") {
    opts.dark = paperWanted === "dark";
    document.querySelectorAll('#poster-controls [data-opt="dark"]')
      .forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.value === "true") === opts.dark)));
  }
  $("#poster-title").value = opts.title;
  $("#poster-title").addEventListener("input", (e) => { opts.title = e.target.value; render(); });
  $("#poster-controls").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-opt]");
    if (!b) return;
    opts[b.dataset.opt] = b.dataset.value === "true" ? true : b.dataset.value === "false" ? false : b.dataset.value;
    document.querySelectorAll(`#poster-controls [data-opt="${b.dataset.opt}"]`)
      .forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    render();
  });
  $("#poster-png").addEventListener("click", () => download("png"));
  $("#poster-svg").addEventListener("click", () => download("svg"));
  bus.on("range", () => state.view === "poster" && render());
  bus.on("vibe-names", () => state.view === "poster" && render());
}

export function show() {
  render();
}

const ink = () => (opts.dark ? "#f6f4ef" : "#17161d");
const paper = () => (opts.dark ? "#0b0b14" : "#f7f4ee");
const dim = (o = 0.55) => (opts.dark ? `rgba(246,244,239,${o})` : `rgba(23,22,29,${o})`);

function colorFor(vibe, t = 0.5) {
  if (opts.palette === "vibes") return vibeColor(vibe);
  if (opts.palette === "mono") return ink();
  return d3.interpolateRgbBasis(opts.dark ? ["#3fa9ff", "#ff3d7f", "#ffb03a"] : ["#8b7bff", "#ff3d7f", "#ff8a3d"])(t);
}

function dominantVibe(monthIndex) {
  return d3.greatest(state.graph.vibes, (v) => v.monthly[monthIndex])?.id ?? 0;
}

function render() {
  const svg = d3.select("#poster-svg-el").attr("viewBox", `0 0 ${W} ${H}`);
  svg.selectAll("*").remove();
  const [i0, i1] = api.rangeIdx(), months = state.graph.meta.months;
  svg.append("rect").attr("width", W).attr("height", H).attr("fill", paper());

  const defs = svg.append("defs");
  const glow = defs.append("filter").attr("id", "poster-glow").attr("x", "-60%").attr("y", "-60%").attr("width", "220%").attr("height", "220%");
  glow.append("feGaussianBlur").attr("stdDeviation", 9);

  svg.append("text").attr("x", 80).attr("y", 132).attr("fill", ink()).attr("font-family", FONT)
    .attr("font-size", 62).attr("font-weight", 700).attr("letter-spacing", -1).text(opts.title || "My Music");
  svg.append("text").attr("x", 80).attr("y", 176).attr("fill", dim()).attr("font-family", FONT).attr("font-size", 22)
    .text(`${fmtMonth(months[i0])} – ${fmtMonth(months[i1])}`);

  ({ rings: drawRings, constellation: drawConstellation, aurora: drawAurora })[opts.style](svg);

  const minutes = d3.sum(d3.range(i0, i1 + 1), (i) => state.graph.totals.minutes[i]);
  const topArtist = d3.greatest(state.graph.artists, api.artistMinutes);
  const topVibe = d3.greatest(state.graph.vibes, (v) => d3.sum(d3.range(i0, i1 + 1), (i) => v.monthly[i]));
  const stats = [
    ["Hours", fmtInt(minutes / 60)],
    ["Artists", fmtInt(state.graph.stats.artists)],
    ["Top artist", topArtist?.name ?? "—"],
    ["Top vibe", topVibe ? api.vibeName(topVibe.id).split(" · ")[0] : "—"],
  ];
  const footer = svg.append("g").attr("transform", `translate(80, ${H - 116})`);
  footer.append("line").attr("x2", W - 160).attr("stroke", dim(0.25));
  stats.forEach(([label, value], i) => {
    const g = footer.append("g").attr("transform", `translate(${i * ((W - 160) / 4)}, 44)`);
    g.append("text").attr("fill", dim(0.6)).attr("font-family", FONT).attr("font-size", 15).attr("letter-spacing", 2).text(label.toUpperCase());
    g.append("text").attr("y", 32).attr("fill", ink()).attr("font-family", FONT)
      .attr("font-size", value.length > 14 ? 20 : 26).attr("font-weight", 600)
      .text(value.length > 22 ? `${value.slice(0, 21)}…` : value);
  });
}

// Each year is a ring; each day a bar whose length is how long you listened.
function rangeDays() {
  const habits = state.graph.habits;
  if (!habits) return [];
  const [i0, i1] = api.rangeIdx(), months = state.graph.meta.months;
  const from = new Date(`${months[i0]}-01T00:00:00`);
  const to = new Date(`${months[i1]}-01T00:00:00`);
  to.setMonth(to.getMonth() + 1);
  const start = new Date(`${habits.firstDay}T00:00:00`);
  const days = [];
  for (let i = 0; i < habits.dayMinutes.length; i++) {
    const date = new Date(start);
    date.setDate(date.getDate() + i);
    if (date >= from && date < to) days.push({ date, minutes: habits.dayMinutes[i], switches: habits.switchDays?.[i] ?? 0 });
  }
  return days;
}

function drawRings(svg) {
  const months = state.graph.meta.months;
  const days = rangeDays();
  if (!days.length) return;

  const years = [...new Set(days.map((d) => d.date.getFullYear()))].sort();
  const cx = W / 2, cy = 700, outer = 430, inner = 120;
  const band = (outer - inner) / years.length;
  const max = d3.quantile(days.map((d) => d.minutes).sort(d3.ascending), 0.98) || 1;
  const g = svg.append("g").attr("transform", `translate(${cx}, ${cy})`);

  for (const [row, year] of years.entries()) {
    const r0 = inner + row * band;
    g.append("circle").attr("r", r0).attr("fill", "none").attr("stroke", dim(0.12));
    for (const day of days.filter((d) => d.date.getFullYear() === year && d.minutes > 0)) {
      const yearStart = new Date(year, 0, 1);
      const dayOfYear = (day.date - yearStart) / 86400000;
      const total = (new Date(year + 1, 0, 1) - yearStart) / 86400000;
      const angle = (dayOfYear / total) * 2 * Math.PI - Math.PI / 2;
      const value = Math.min(1, day.minutes / max);
      const len = band * 0.92 * Math.sqrt(value);
      const monthIndex = months.indexOf(`${year}-${String(day.date.getMonth() + 1).padStart(2, "0")}`);
      g.append("line")
        .attr("x1", Math.cos(angle) * r0).attr("y1", Math.sin(angle) * r0)
        .attr("x2", Math.cos(angle) * (r0 + len)).attr("y2", Math.sin(angle) * (r0 + len))
        .attr("stroke", colorFor(monthIndex >= 0 ? dominantVibe(monthIndex) : 0, value))
        .attr("stroke-opacity", 0.45 + 0.55 * value)
        .attr("stroke-width", Math.max(1.1, (2 * Math.PI * (r0 + len / 2)) / total * 0.85))
        .attr("stroke-linecap", "round");
      if (day.switches) {   // a day your vibes crossed over: a bead at the tip of the bar
        const tip = r0 + len + 3.5;
        g.append("circle")
          .attr("cx", Math.cos(angle) * tip).attr("cy", Math.sin(angle) * tip)
          .attr("r", Math.min(3.4, 1.2 + day.switches * 0.25))
          .attr("fill", ink()).attr("fill-opacity", 0.75);
      }
    }
    if (opts.labels) {
      const y = -(r0 + band * 0.45);
      g.append("rect").attr("x", 2).attr("y", y - 12).attr("width", 40).attr("height", 17).attr("rx", 4)
        .attr("fill", paper()).attr("fill-opacity", 0.78);
      g.append("text").attr("x", 7).attr("y", y).attr("fill", dim(0.8))
        .attr("font-family", FONT).attr("font-size", 14).attr("font-weight", 600).text(year);
    }
  }
  g.append("circle").attr("r", inner - 16).attr("fill", paper()).attr("stroke", dim(0.15));
  const hours = d3.sum(days, (d) => d.minutes) / 60;
  g.append("text").attr("text-anchor", "middle").attr("y", -4).attr("fill", ink())
    .attr("font-family", FONT).attr("font-size", 46).attr("font-weight", 700).text(fmtInt(hours));
  g.append("text").attr("text-anchor", "middle").attr("y", 26).attr("fill", dim()).attr("font-family", FONT)
    .attr("font-size", 16).attr("letter-spacing", 2).text("HOURS");
  const crossovers = days.filter((d) => d.switches).length;
  if (opts.labels && crossovers) {
    g.append("text").attr("text-anchor", "middle").attr("y", outer + 52).attr("fill", dim(0.7))
      .attr("font-family", FONT).attr("font-size", 15)
      .text(`· ${fmtInt(crossovers)} days your vibes crossed over ·`);
  }
}

// The Now Playing look as a print: flowing color fields behind one ring of your listening.
function drawAurora(svg) {
  const days = rangeDays();
  if (!days.length) return;
  const defs = svg.select("defs");
  const months = state.graph.meta.months;

  // wispy background: big soft blobs pushed around by turbulence
  const filter = defs.append("filter").attr("id", "aurora-flow").attr("x", "-25%").attr("y", "-25%").attr("width", "150%").attr("height", "150%");
  filter.append("feTurbulence").attr("type", "fractalNoise").attr("baseFrequency", 0.0016).attr("numOctaves", 4).attr("seed", 7).attr("result", "noise");
  filter.append("feDisplacementMap").attr("in", "SourceGraphic").attr("in2", "noise").attr("scale", 320).attr("xChannelSelector", "R").attr("yChannelSelector", "G");
  filter.append("feGaussianBlur").attr("stdDeviation", 26);

  // insert behind the title, which render() has already drawn
  const sky = svg.insert("g", "text").attr("filter", "url(#aurora-flow)").attr("opacity", opts.dark ? 1 : 0.7);
  const blobs = [[0.28, 0.3, 430], [0.74, 0.34, 400], [0.2, 0.68, 460], [0.8, 0.74, 420], [0.5, 0.5, 380]];
  blobs.forEach(([fx, fy, r], i) => {
    const id = `aurora-blob-${i}`;
    const grad = defs.append("radialGradient").attr("id", id);
    grad.append("stop").attr("offset", 0).attr("stop-color", colorFor(i % Math.max(1, state.graph.vibes.length), i / blobs.length)).attr("stop-opacity", 1);
    grad.append("stop").attr("offset", 1).attr("stop-color", colorFor(i % Math.max(1, state.graph.vibes.length), i / blobs.length)).attr("stop-opacity", 0);
    sky.append("circle").attr("cx", fx * W).attr("cy", fy * H).attr("r", r).attr("fill", `url(#${id})`);
  });
  svg.insert("rect", "text").attr("width", W).attr("height", H).attr("fill", paper()).attr("opacity", opts.dark ? 0.28 : 0.2);

  // one ring for the whole period: a spike per day, like the light show's frequency ring
  const cx = W / 2, cy = 700, inner = 190, reach = 250;
  const max = d3.quantile(days.map((d) => d.minutes).sort(d3.ascending), 0.98) || 1;
  const ring = svg.append("g").attr("transform", `translate(${cx}, ${cy})`);
  const glow = defs.append("filter").attr("id", "aurora-glow").attr("x", "-40%").attr("y", "-40%").attr("width", "180%").attr("height", "180%");
  glow.append("feGaussianBlur").attr("stdDeviation", 7);
  const spikes = ring.append("g"), halo = ring.append("g").attr("filter", "url(#aurora-glow)").attr("opacity", 0.75);

  days.forEach((day, i) => {
    const angle = (i / days.length) * 2 * Math.PI - Math.PI / 2;
    const value = Math.min(1, day.minutes / max);
    if (!day.minutes) return;
    const len = 12 + reach * Math.sqrt(value);
    const monthIndex = months.indexOf(`${day.date.getFullYear()}-${String(day.date.getMonth() + 1).padStart(2, "0")}`);
    const color = colorFor(monthIndex >= 0 ? dominantVibe(monthIndex) : 0, value);
    const line = [Math.cos(angle) * inner, Math.sin(angle) * inner, Math.cos(angle) * (inner + len), Math.sin(angle) * (inner + len)];
    const width = Math.max(1.2, ((2 * Math.PI * inner) / days.length) * 0.8);
    for (const layer of [halo, spikes]) {
      layer.append("line")
        .attr("x1", line[0]).attr("y1", line[1]).attr("x2", line[2]).attr("y2", line[3])
        .attr("stroke", color).attr("stroke-opacity", layer === halo ? 0.9 : 0.5 + 0.5 * value)
        .attr("stroke-width", layer === halo ? width * 1.6 : width).attr("stroke-linecap", "round");
    }
    if (day.switches) {
      spikes.append("circle").attr("cx", Math.cos(angle) * (inner + len + 5)).attr("cy", Math.sin(angle) * (inner + len + 5))
        .attr("r", Math.min(3, 1 + day.switches * 0.2)).attr("fill", ink()).attr("fill-opacity", 0.8);
    }
  });

  ring.append("circle").attr("r", inner - 26).attr("fill", paper()).attr("fill-opacity", 0.8).attr("stroke", dim(0.2));
  const hours = d3.sum(days, (d) => d.minutes) / 60;
  ring.append("text").attr("text-anchor", "middle").attr("y", -2).attr("fill", ink())
    .attr("font-family", FONT).attr("font-size", 52).attr("font-weight", 700).text(fmtInt(hours));
  ring.append("text").attr("text-anchor", "middle").attr("y", 30).attr("fill", dim()).attr("font-family", FONT)
    .attr("font-size", 16).attr("letter-spacing", 2).text("HOURS");
  const years = new Set(days.map((d) => d.date.getFullYear()));
  ring.append("text").attr("text-anchor", "middle").attr("y", inner + reach + 60).attr("fill", dim(0.7))
    .attr("font-family", FONT).attr("font-size", 15)
    .text(`· ${fmtInt(days.filter((d) => d.minutes).length)} days of listening across ${years.size} year${years.size > 1 ? "s" : ""} ·`);
}

// Artists as stars, placed by the vibes map and linked by co-listening.
function drawConstellation(svg) {
  const artists = state.graph.artists, minutes = artists.map(api.artistMinutes);
  const max = d3.max(minutes) || 1;
  const box = { x: 90, y: 250, w: W - 180, h: 900 };
  // stretch the map's own extent to fill the frame
  const shown = artists.filter((a) => minutes[a.id] > 0);
  const ex = d3.extent(shown, (a) => a.x), ey = d3.extent(shown, (a) => a.y);
  const fit = (v, [lo, hi]) => (hi - lo < 1e-6 ? 0.5 : (v - lo) / (hi - lo));
  const px = (a) => box.x + fit(a.x, ex) * box.w, py = (a) => box.y + fit(a.y, ey) * box.h;
  const r = d3.scaleSqrt([0, max], [1.5, 26]);
  const g = svg.append("g");

  const crosses = (e) => artists[e[0]].vibe !== artists[e[1]].vibe;
  g.append("g").selectAll("line").data(state.graph.edges.filter((e) => !crosses(e))).join("line")
    .attr("x1", (e) => px(artists[e[0]])).attr("y1", (e) => py(artists[e[0]]))
    .attr("x2", (e) => px(artists[e[1]])).attr("y2", (e) => py(artists[e[1]]))
    .attr("stroke", dim(0.25)).attr("stroke-width", (e) => 0.3 + e[2]);

  // the links that cross between vibes, in both vibes' colors
  const defs = svg.select("defs");
  const bridges = state.graph.edges.filter((e) => crosses(e) && minutes[e[0]] > 0 && minutes[e[1]] > 0);
  g.append("g").selectAll("line").data(bridges).join("line")
    .attr("x1", (e) => px(artists[e[0]])).attr("y1", (e) => py(artists[e[0]]))
    .attr("x2", (e) => px(artists[e[1]])).attr("y2", (e) => py(artists[e[1]]))
    .attr("stroke", (e) => {
      const id = `poster-bridge-${e[0]}-${e[1]}`;
      if (defs.select(`#${id}`).empty()) {
        const grad = defs.append("linearGradient").attr("id", id).attr("gradientUnits", "userSpaceOnUse")
          .attr("x1", px(artists[e[0]])).attr("y1", py(artists[e[0]]))
          .attr("x2", px(artists[e[1]])).attr("y2", py(artists[e[1]]));
        grad.append("stop").attr("offset", 0).attr("stop-color", colorFor(artists[e[0]].vibe, 0.35));
        grad.append("stop").attr("offset", 1).attr("stop-color", colorFor(artists[e[1]].vibe, 0.8));
      }
      return `url(#${id})`;
    })
    .attr("stroke-opacity", 0.9).attr("stroke-width", (e) => 1.2 + 2.6 * e[2]).attr("stroke-linecap", "round");

  const stars = shown;
  g.append("g").attr("filter", "url(#poster-glow)").selectAll("circle").data(stars).join("circle")
    .attr("cx", px).attr("cy", py).attr("r", (a) => r(minutes[a.id]) * 1.5)
    .attr("fill", (a) => colorFor(a.vibe, minutes[a.id] / max)).attr("opacity", 0.5);
  g.append("g").selectAll("circle").data(stars).join("circle")
    .attr("cx", px).attr("cy", py).attr("r", (a) => r(minutes[a.id]))
    .attr("fill", (a) => colorFor(a.vibe, minutes[a.id] / max));

  if (opts.labels) {
    const top = d3.sort(stars, (a) => -minutes[a.id]).slice(0, 12);
    const flip = (a) => px(a) > box.x + box.w * 0.68; // keep names inside the frame
    g.append("g").selectAll("text").data(top).join("text")
      .attr("x", (a) => px(a) + (flip(a) ? -1 : 1) * (r(minutes[a.id]) + 8)).attr("y", (a) => py(a) + 5)
      .attr("text-anchor", (a) => (flip(a) ? "end" : "start"))
      .attr("fill", ink()).attr("font-family", FONT).attr("font-size", 17).attr("font-weight", 500)
      .text((a) => a.name);
  }
}

// Exports carry the font inside them, so saved files look like the preview.
let fontCss;
async function embeddedFont() {
  if (fontCss !== undefined) return fontCss;
  fontCss = "";
  try {
    const sheet = await (await fetch("https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&display=swap")).text();
    const latin = sheet.split("@font-face").filter((block) => /U\+0000-00FF/.test(block)); // latin subset only
    const faces = await Promise.all(latin.map(async (block) => {
      const url = block.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
      const weight = block.match(/font-weight:\s*(\d+)/)?.[1] ?? "400";
      if (!url) return "";
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      return `@font-face{font-family:'Space Grotesk';font-style:normal;font-weight:${weight};src:url(data:font/woff2;base64,${btoa(binary)}) format('woff2');}`;
    }));
    fontCss = faces.join("");
  } catch {
    fontCss = ""; // offline: exports fall back to a system font
  }
  return fontCss;
}

async function download(kind) {
  const node = $("#poster-svg-el");
  const clone = node.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", W);
  clone.setAttribute("height", H);
  const css = await embeddedFont();
  if (css) {
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = css;
    clone.insertBefore(style, clone.firstChild);
  }
  const source = new XMLSerializer().serializeToString(clone);
  const name = `${(opts.title || "music-poster").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "poster"}-${opts.style}`;
  const save = (blob, ext) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 20000);
    toast(`Saved ${name}.${ext} to Downloads`);
  };
  if (kind === "svg") return save(new Blob([source], { type: "image/svg+xml;charset=utf-8" }), "svg");

  const scale = 3;
  const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("couldn't render the poster"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = W * scale;
    canvas.height = H * scale;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    save(blob, "png");
  } catch (e) {
    toast(`Export failed: ${e.message}`, { error: true });
  } finally {
    URL.revokeObjectURL(url);
  }
}
