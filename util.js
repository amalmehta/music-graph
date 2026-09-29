// Shared helpers: events, formatting, colors, matching keys, local storage.

const listeners = new Map();
export const bus = {
  on(type, fn) { (listeners.get(type) ?? listeners.set(type, new Set()).get(type)).add(fn); },
  emit(type, detail) { listeners.get(type)?.forEach((fn) => fn(detail)); },
};

// Mirrors norm() in build_data.py exactly.
export function norm(s) {
  return (s ?? "")
    .normalize("NFKD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replace(/\s*[(\[].*?[)\]]/g, "")
    .replace(/\s+-\s+.*$/, "")
    .replace(/[^\p{L}\p{N}\p{Mc}]+/gu, " ")
    .trim();
}
export const trackKey = (track, artist) => `${norm(track)}|${norm(artist)}`;

export const VIBE_COLORS = ["#ff4f8b", "#35d0c0", "#ffb03a", "#8b7bff", "#6fdc5c", "#ff7a45", "#3fa9ff", "#e45fd6", "#f3d34a", "#9aa6ff"];
export const vibeColor = (v) => (v >= 0 ? VIBE_COLORS[v % VIBE_COLORS.length] : "#8a8fa3");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtMonth = (label) => { const [y, m] = label.split("-"); return `${MONTHS[+m - 1]} ${y}`; };
export const fmtDate = (iso) => { const [y, m, d] = iso.split("-"); return `${MONTHS[+m - 1]} ${+d}, ${y}`; };
export const fmtHours = (minutes) => {
  const h = minutes / 60;
  return h >= 100 ? `${Math.round(h).toLocaleString()} h` : h >= 1 ? `${h.toFixed(1)} h` : `${Math.round(minutes)} min`;
};
export const fmtInt = (n) => Math.round(n).toLocaleString();
export const plural = (n, word) => `${fmtInt(n)} ${word}${Math.round(n) === 1 ? "" : "s"}`;
export const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
export function fmtAgo(days) {
  if (days < 45) return `${days} days ago`;
  if (days < 540) return `${Math.round(days / 30)} months ago`;
  const y = days / 365;
  return `${y < 1.75 ? "over a year" : `${Math.round(y)} years`} ago`;
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
};

// Expand a sparse [index, value, index, value, ...] list into a dense array.
export function dense(flat, length) {
  const out = new Array(length).fill(0);
  for (let i = 0; i < flat.length; i += 2) out[flat[i]] = flat[i + 1];
  return out;
}

export async function postJSON(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
export function toast(message, { error = false, html = false } = {}) {
  const el = document.getElementById("toast");
  el[html ? "innerHTML" : "textContent"] = message;
  el.classList.toggle("error", error);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), error ? 6000 : 3800);
}

export const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
