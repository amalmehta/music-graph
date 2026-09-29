// Habits: when you listen (hour × weekday) and a calendar of every day.

import { bus, escapeHtml, fmtHours, fmtInt, fmtDate } from "./util.js";

const $ = (s) => document.querySelector(s);
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// Sequential ramp that starts at the page's own surface color, so quiet hours recede.
const ramp = () => {
  const bg = getComputedStyle(document.body).getPropertyValue("--surface-solid").trim() || "#fff";
  return d3.interpolateRgbBasis([bg, "#35d0c0", "#ffb03a", "#ff3d7f"]);
};
const HOUR_LABELS = { 0: "12am", 6: "6am", 12: "12pm", 18: "6pm" };

let api, state, rendered = false;

const hourName = (h) => (h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`);

export function init(a) {
  api = a;
  state = a.state;
  bus.on("range", () => state.view === "habits" && render());
  let width = 0;
  new ResizeObserver(() => {
    const w = $("#habits-grid").clientWidth;
    if (state.view === "habits" && Math.abs(w - width) > 2) {
      width = w;
      render();
    }
  }).observe($("#view-habits"));
}

export function show() {
  render();
}

// hour × weekday minutes across the selected months
function grid() {
  const [i0, i1] = api.rangeIdx();
  const cells = new Array(168).fill(0);
  for (let m = i0; m <= i1; m++) {
    const month = state.graph.habits.monthHourDow[m];
    for (let i = 0; i < 168; i++) cells[i] += month[i];
  }
  return cells;
}

// days inside the selected months, as { date, minutes }
function days() {
  const { firstDay, dayMinutes } = state.graph.habits;
  const [i0, i1] = api.rangeIdx();
  const months = state.graph.meta.months;
  const from = new Date(`${months[i0]}-01T00:00:00`);
  const to = new Date(`${months[i1]}-01T00:00:00`);
  to.setMonth(to.getMonth() + 1);
  const start = new Date(`${firstDay}T00:00:00`);
  const out = [];
  for (let i = 0; i < dayMinutes.length; i++) {
    const date = new Date(start);
    date.setDate(date.getDate() + i);
    if (date >= from && date < to) out.push({ date, minutes: dayMinutes[i] });
  }
  return out;
}

function render() {
  if (!state.graph.habits) return;
  const cells = grid(), dayList = days();
  const RAMP = ramp();
  const scale = d3.scaleLinear([0, d3.quantile(cells.filter((v) => v > 0).sort(d3.ascending), 0.97) || 1], [0.12, 1]).clamp(true);
  const color = (v) => (v <= 0 ? "none" : RAMP(scale(v)));
  const legend = d3.select("#habits-legend").attr("viewBox", "0 0 210 12");
  legend.selectAll("*").remove();
  legend.selectAll("rect").data(d3.range(10)).join("rect")
    .attr("x", (i) => 30 + i * 12).attr("width", 10).attr("height", 10).attr("rx", 2)
    .attr("fill", (i) => RAMP(0.12 + (i / 9) * 0.88));
  legend.append("text").attr("class", "axis-label").attr("x", 26).attr("y", 9).attr("text-anchor", "end").text("less");
  legend.append("text").attr("class", "axis-label").attr("x", 154).attr("y", 9).text("more");

  // ---- hour × weekday grid ----
  const el = $("#habits-grid");
  const w = el.clientWidth || 800;
  if (w < 200) return;
  const pad = { l: 46, t: 18, r: 8, b: 26 };
  const cw = (w - pad.l - pad.r) / 24;
  const ch = Math.min(34, Math.max(18, cw * 0.8));
  const h = pad.t + ch * 7 + pad.b;
  const svg = d3.select(el).attr("viewBox", `0 0 ${w} ${h}`).attr("height", h);
  svg.selectAll("*").remove();
  const peak = d3.maxIndex(cells);

  svg.append("g").selectAll("text").data(DAYS).join("text")
    .attr("class", "axis-label").attr("x", pad.l - 10).attr("y", (_, i) => pad.t + i * ch + ch / 2)
    .attr("text-anchor", "end").attr("dominant-baseline", "middle").text((d) => d);
  svg.append("g").selectAll("text").data(Object.keys(HOUR_LABELS).map(Number)).join("text")
    .attr("class", "axis-label").attr("x", (d) => pad.l + d * cw + cw / 2).attr("y", pad.t + 7 * ch + 16)
    .attr("text-anchor", "middle").text((d) => HOUR_LABELS[d]);

  svg.append("g").selectAll("rect").data(cells.map((v, i) => ({ v, i }))).join("rect")
    .attr("x", (d) => pad.l + (d.i % 24) * cw + 1).attr("y", (d) => pad.t + Math.floor(d.i / 24) * ch + 1)
    .attr("width", Math.max(1, cw - 2)).attr("height", Math.max(1, ch - 2)).attr("rx", 4)
    .attr("fill", (d) => color(d.v)).attr("stroke", (d) => (d.i === peak && d.v > 0 ? "currentColor" : "none")).attr("stroke-width", 1.5)
    .attr("class", (d) => (d.v > 0 ? "cell" : "cell empty"))
    .on("mousemove", (e, d) => api.showTip(
      `<strong>${DAYS[Math.floor(d.i / 24)]}, ${hourName(d.i % 24)}</strong><span class="muted">${d.v ? fmtHours(d.v) : "nothing played"}</span>`, e))
    .on("mouseleave", api.hideTip);

  // ---- headline stats ----
  const active = dayList.filter((d) => d.minutes > 0);
  const best = d3.greatest(dayList, (d) => d.minutes);
  let streak = 0, bestStreak = 0, streakEnd = null;
  for (const d of dayList) {
    streak = d.minutes > 0 ? streak + 1 : 0;
    if (streak > bestStreak) { bestStreak = streak; streakEnd = d.date; }
  }
  const weekend = d3.sum(cells.slice(5 * 24)) / (d3.sum(cells) || 1);
  const iso = (d) => d.toISOString().slice(0, 10);
  $("#habits-summary").innerHTML = [
    ["Peak time", `${DAYS[Math.floor(peak / 24)]} · ${hourName(peak % 24)}`, fmtHours(cells[peak])],
    ["Biggest day", best && best.minutes ? fmtDate(iso(best.date)) : "—", best ? fmtHours(best.minutes) : ""],
    ["Longest streak", `${fmtInt(bestStreak)} days`, streakEnd ? `to ${fmtDate(iso(streakEnd))}` : ""],
    ["Days with music", `${Math.round((100 * active.length) / (dayList.length || 1))}%`, `${fmtInt(active.length)} of ${fmtInt(dayList.length)} days`],
    ["Weekend share", `${Math.round(weekend * 100)}%`, "Saturday + Sunday"],
  ].map(([label, value, note]) => `<div class="habit-stat"><dt>${label}</dt><dd>${escapeHtml(value)}</dd><small>${escapeHtml(note)}</small></div>`).join("");

  // ---- calendar ----
  const cal = $("#habits-calendar");
  const dayScale = d3.scaleLinear([0, d3.quantile(dayList.filter((d) => d.minutes > 0).map((d) => d.minutes).sort(d3.ascending), 0.97) || 1], [0.12, 1]).clamp(true);
  const size = 13, gap = 3, cell = size + gap;
  const byYear = d3.group(dayList, (d) => d.date.getFullYear());
  cal.innerHTML = "";
  const calSvg = d3.select(cal);
  const years = [...byYear.keys()].sort();
  const rowHeight = cell * 7 + 34;
  const calWidth = 40 + 54 * cell;
  calSvg.attr("viewBox", `0 0 ${calWidth} ${years.length * rowHeight}`).attr("width", calWidth).attr("height", years.length * rowHeight);
  years.forEach((year, row) => {
    const g = calSvg.append("g").attr("transform", `translate(0, ${row * rowHeight + 18})`);
    g.append("text").attr("class", "axis-label").attr("x", 0).attr("y", cell * 3.5).attr("dominant-baseline", "middle").text(year);
    const items = byYear.get(year);
    const start = new Date(year, 0, 1);
    const week = (d) => Math.floor(((d - start) / 86400000 + ((start.getDay() + 6) % 7)) / 7);
    g.selectAll("rect").data(items).join("rect")
      .attr("x", (d) => 40 + week(d.date) * cell).attr("y", (d) => ((d.date.getDay() + 6) % 7) * cell)
      .attr("width", size).attr("height", size).attr("rx", 3)
      .attr("fill", (d) => (d.minutes > 0 ? RAMP(dayScale(d.minutes)) : "none"))
      .attr("class", (d) => (d.minutes > 0 ? "cell" : "cell empty"))
      .on("mousemove", (e, d) => api.showTip(
        `<strong>${fmtDate(iso(d.date))}</strong><span class="muted">${d.minutes ? fmtHours(d.minutes) : "nothing played"}</span>`, e))
      .on("mouseleave", api.hideTip);
    g.selectAll("text.month").data(d3.range(12)).join("text")
      .attr("class", "axis-label month").attr("x", (m) => 40 + week(new Date(year, m, 1)) * cell).attr("y", -6)
      .text((m) => ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"][m]);
  });
  rendered = true;
}
