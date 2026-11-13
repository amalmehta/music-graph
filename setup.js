// Setup: import your Spotify export and connect a developer app, without opening a terminal.

import { fmtAgo, fmtDate, daysBetween, escapeHtml, postJSON, toast } from "./util.js";

const $ = (s) => document.querySelector(s);
const MAX_UPLOAD = 1_000_000_000;

let meta = null;
let polling = null;
let startedAt = 0;

export function init(graphMeta) {
  meta = graphMeta;
  $("#setup-open").addEventListener("click", () => open());
  $("#setup-close").addEventListener("click", () => $("#setup").close());
  $("#setup").addEventListener("click", (e) => { if (e.target.id === "setup") $("#setup").close(); });

  const picker = $("#import-file");
  $("#import-pick").addEventListener("click", () => picker.click());
  picker.addEventListener("change", () => picker.files[0] && send(picker.files[0]));

  const drop = $("#import-drop");
  for (const type of ["dragenter", "dragover"]) {
    drop.addEventListener(type, (e) => { e.preventDefault(); drop.classList.add("over"); });
  }
  for (const type of ["dragleave", "drop"]) {
    drop.addEventListener(type, () => drop.classList.remove("over"));
  }
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) send(file);
  });
  wireWindowImport();

  $("#import-reload").addEventListener("click", () => location.reload());
  $("#import-again").addEventListener("click", () => {
    $("#import-progress").hidden = true;
    $("#import-drop").hidden = false;
  });

  $("#setup-redirect").textContent = `${location.origin}/callback`;
  $("#spotify-save").addEventListener("click", saveClientId);
  fetch("/config.json").then((r) => r.json()).then((c) => { $("#spotify-client-id").value = c.client_id || ""; }).catch(() => {});
  describe();
  // An import may still be running from a page the user already closed.
  fetch("/api/import").then((r) => r.json()).then((s) => s.state === "building" && (open(), watch())).catch(() => {});
}

// ---------- drop or paste the export anywhere ----------

// Names only, mirroring SAFE_UPLOAD's extensions; the server still has the final word and its
// refusal shows up in the dialog. Anything else (audio for the DJ decks, a .txt) is left alone.
const EXPORT_NAME = /\.(zip|json)$/i;
const EXPORT_TYPE = /^application\/(zip|x-zip-compressed|json)$/;
const exportFile = (files) => [...(files || [])].find((f) => EXPORT_NAME.test(f.name));

function importFrom(file) {
  if (!$("#setup").open) open();
  send(file);
}

function wireWindowImport() {
  const veil = $("#drop-veil");
  let hideTimer = 0;
  const hide = () => { clearTimeout(hideTimer); veil.classList.remove("show"); };

  // Mid-drag only the MIME types are readable, not names, so the veil goes by type.
  window.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();   // every file drag, so a stray drop never opens the file in the tab
    const looksLikeExport = [...e.dataTransfer.items].some((i) => i.kind === "file" && EXPORT_TYPE.test(i.type));
    if (!looksLikeExport || $("#setup").open) return hide();
    veil.classList.add("show");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 250);   // dragover keeps firing while over the window; silence means it left
  });
  window.addEventListener("dragleave", (e) => { if (!e.relatedTarget) hide(); });
  window.addEventListener("drop", (e) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    hide();
    if (e.target.closest?.("#import-drop")) return;   // the dialog's own drop zone already sent it
    const file = exportFile(e.dataTransfer.files);
    if (file) importFrom(file);
  });

  // ⌘V of a file copied in Finder
  document.addEventListener("paste", (e) => {
    const file = exportFile(e.clipboardData?.files);
    if (!file) return;
    e.preventDefault();
    importFrom(file);
  });
}

export function open() {
  $("#setup").showModal();
}

// ---------- what you are looking at ----------

function describe() {
  const el = $("#data-summary");
  if (!meta) {
    el.innerHTML = `<p class="setup-none">No data yet. Import the export Spotify sent you, or run
      <code>build_data.py --sample</code> to look around with made-up listening.</p>`;
    return;
  }
  const age = daysBetween(meta.generated.slice(0, 10), new Date().toISOString().slice(0, 10));
  const built = age <= 0 ? "built today" : `built ${fmtAgo(age)}`;
  el.innerHTML = meta.sample
    ? `<p><strong>Generated sample data.</strong> Everything you see is made up — import your own export to replace it.</p>
       <p class="setup-sub">${escapeHtml(built)}</p>`
    : `<p><strong>${escapeHtml(meta.source || "Your export")}</strong></p>
       <p class="setup-sub">${escapeHtml(fmtDate(meta.first))} – ${escapeHtml(fmtDate(meta.last))} · ${escapeHtml(built)}</p>`;
}

// ---------- import ----------

async function send(file) {
  if (!/\.(zip|json)$/i.test(file.name)) {
    return toast("That needs to be the .zip Spotify sent you, or a .json from inside it.", { error: true });
  }
  if (file.size > MAX_UPLOAD) {
    return toast(`${(file.size / 1e6).toFixed(0)} MB is past the ${MAX_UPLOAD / 1e6} MB limit.`, { error: true });
  }
  startedAt = 0;   // a leftover anchor from an earlier import would flash a wild number
  progress("building", [`Uploading ${file.name}…`]);
  try {
    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-Filename": file.name },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || `Upload failed (${res.status})`);
  } catch (e) {
    progress("error", [e.message]);
    return;
  }
  watch();
}

async function poll() {
  let status;
  try {
    status = await (await fetch("/api/import")).json();
  } catch {
    return;   // the server restarting mid-build should not wipe the panel
  }
  // Anchor the clock to this machine. A hidden tab has its timers throttled, so echoing the
  // server's own count leaves a stale number on screen until the next poll happens to land.
  if (status.state === "building") startedAt = Date.now() - status.seconds * 1000;
  progress(status.state, status.lines);
  if (status.state === "done" || status.state === "error") stopWatching();
}

function onVisible() {
  if (!document.hidden) poll();   // catch up the moment anyone can see it again
}

function stopWatching() {
  clearInterval(polling);
  polling = null;
  document.removeEventListener("visibilitychange", onVisible);
}

function watch() {
  stopWatching();
  polling = setInterval(poll, 700);
  document.addEventListener("visibilitychange", onVisible);
  poll();
}

function progress(state, lines) {
  const box = $("#import-progress");
  const log = $("#import-log");
  const seconds = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0;
  box.hidden = false;
  box.dataset.state = state;
  $("#import-drop").hidden = state === "building";
  log.textContent = (lines || []).join("\n");
  log.scrollTop = log.scrollHeight;
  $("#import-state").textContent =
    state === "building" ? `Building your graph… ${seconds ? `${seconds}s` : ""}`
    : state === "error" ? "That didn't work."
    : "Done.";
  $("#import-reload").hidden = state !== "done";
  $("#import-again").hidden = state !== "error";
}

// ---------- Spotify developer app ----------

async function saveClientId() {
  const input = $("#spotify-client-id");
  const button = $("#spotify-save");
  button.disabled = true;
  try {
    await postJSON("/api/config", { client_id: input.value });
    toast(input.value.trim() ? "Saved. Reload the page to connect to Spotify." : "Client ID cleared.");
  } catch (e) {
    toast(e.message, { error: true });
  } finally {
    button.disabled = false;
  }
}
