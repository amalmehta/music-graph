// Recaptures screenshots/ by driving headless Chrome over the DevTools
// protocol, so the set is reproducible instead of re-staged by hand.
//
//     python3 server.py            # in another terminal
//     node make_screenshots.mjs    # writes straight into screenshots/
//     node make_screenshots.mjs --out /tmp/shots 13-dj   # one shot, elsewhere
//
// Every shot states its own size, so the set stays consistent: 1424 px wide for
// anything with the app's chrome around it. Two shots need something this
// script cannot conjure and are skipped with a note when it is missing:
// now-playing.png needs a song playing in the Spotify desktop app, and
// 13-dj-synced.png needs at least one audio file in the crate folder.
//
// Not captured here: 14-dj-lightshow.png, a live two-deck mix of the files
// make_test_audio.py generates, taken by hand with the light show full-screen.
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333;
const BASE = process.env.BASE || "http://127.0.0.1:8765";

const argv = process.argv.slice(2);
const outAt = argv.indexOf("--out");
const OUT = outAt === -1 ? new URL("screenshots", import.meta.url).pathname : argv[outAt + 1];
const ONLY = argv.filter((a, i) => a !== "--out" && i !== outAt + 1 && !a.startsWith("--"))[0] || "";
mkdirSync(OUT, { recursive: true });

// ---------- a very small CDP client ----------
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map();
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method) {
        for (const f of this.handlers.get(m.method) || []) f(m.params);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, f) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(f);
    return () => { const a = this.handlers.get(method); a.splice(a.indexOf(f), 1); };
  }
  once(method) { return new Promise((res) => { const off = this.on(method, (p) => { off(); res(p); }); }); }
}

const json = async (path) => (await fetch(`http://127.0.0.1:${PORT}${path}`)).json();

// ---------- the shots ----------
// full  -> the whole scrollable page, `w` wide
// clip  -> just that element's box
// act   -> an interaction to run before the frame is taken
//
// np=hide keeps the Now Playing pill and its auto-opening light show out of the
// app shots, so they do not depend on what Spotify happens to be playing.
const SHOTS = [
  { file: "1-vibes.png",                 url: "/?np=hide#vibes",                           w: 1424, h: 1010 },
  { file: "15-vibes-dark.png",           url: "/?np=hide&theme=dark#vibes",                w: 1424, h: 1010 },
  { file: "2-network.png",               url: "/?np=hide#network",                         w: 1424, h: 1010 },
  { file: "3-over-time.png",             url: "/?np=hide#time",                            w: 1424, h: 1010 },
  { file: "6-habits.png",                url: "/?np=hide#habits",                          w: 1424, h: 1010, full: true },
  { file: "4-for-you.png",               url: "/?np=hide#foryou",                          w: 1424, h: 1010, full: true },
  { file: "16-poster-tab.png",           url: "/?np=hide&poster=aurora&paper=dark#poster", w: 1424, h: 1080 },
  { file: "11-poster-aurora.png",        url: "/?np=hide&poster=aurora&paper=dark#poster", w: 1424, h: 1080, clip: "#view-poster" },
  { file: "7-poster.png",                url: "/?np=hide&poster=rings&paper=light#poster", w: 1424, h: 1080, clip: "#view-poster" },
  { file: "10-poster-constellation.png", url: "/?np=hide&poster=constellation&paper=light#poster", w: 1424, h: 1080, clip: "#view-poster" },
  { file: "17-import.png",               url: "/?np=hide#vibes",                           w: 1424, h: 1010, act: "setup" },
  { file: "now-playing.png",             url: "/#vibes",                                   w: 1440, h: 900,  act: "nowplaying", needs: "a song playing in Spotify" },
  { file: "13-dj-synced.png",            url: "/?np=hide#dj",                              w: 1424, h: 1010, full: true, act: "dj", needs: "an audio file in the crate" },
];

const ACTS = {
  // The ⚙ "your data and setup" dialog.
  setup: `(async () => {
    document.querySelector("#setup-open").click();
    await new Promise(r => setTimeout(r, 600));
    return true;
  })()`,

  // Wait for the light show to open off whatever Spotify is playing, then let
  // the aurora and the melody trail build before the frame is taken.
  nowplaying: `(async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 25000) {
      const np = document.querySelector("#np");
      if (np && !np.hidden && document.querySelector("#np-title")?.textContent.trim()) {
        await new Promise(r => setTimeout(r, 6000));
        return document.querySelector("#np-title").textContent.trim();
      }
      document.querySelector("#np-open")?.click();
      await new Promise(r => setTimeout(r, 500));
    }
    return null;
  })()`,

  // Load the crate onto both decks, let them analyse, play, then beat-match B
  // to A — the state the README calls "DJ decks".
  dj: `(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const busy = (sel) => /Analyzing|Loading/.test(document.querySelector(sel)?.textContent || "");

    let rows = [];
    for (let i = 0; i < 60 && rows.length < 1; i++) {
      rows = [...document.querySelectorAll("#crate-body tr")].filter((r) => r.querySelector('[data-load="A"]'));
      if (rows.length < 1) await wait(300);
    }
    if (rows.length < 1) return null;

    // Two distinct tracks when the crate holds them, otherwise one on both decks.
    const deckA = rows[0], deckB = rows[1] || rows[0];
    deckA.querySelector('[data-load="A"]').click();
    await wait(500);
    deckB.querySelector('[data-load="B"]').click();

    for (let i = 0; i < 120; i++) {
      if (!busy("#dj-decks-a") && !busy("#dj-decks-b")) break;
      await wait(500);
    }
    await wait(1500);
    if (busy("#dj-decks-a") || busy("#dj-decks-b")) return null;

    document.querySelector("#dj-decks-a [data-act=play]").click();
    document.querySelector("#dj-decks-b [data-act=play]").click();
    await wait(7000);
    document.querySelector("#dj-decks-b [data-act=sync]").click();
    await wait(2500);
    return "loaded";
  })()`,
};

// Resolve once the app has swapped its skeleton for real data.
const READY = `(async () => {
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    if (!document.body.dataset.loading && document.querySelector("#stats")?.textContent.trim()) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
})()`;

async function main() {
  try {
    await (await fetch(BASE, { signal: AbortSignal.timeout(3000) })).text();
  } catch {
    console.error(`No server at ${BASE} — start one with: python3 server.py`);
    process.exit(1);
  }

  let chrome = null, up = false;
  try { await json("/json/version"); up = true; } catch {}
  if (!up) {
    chrome = spawn(CHROME, [
      "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${OUT}/.chrome`,
      "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
      "--autoplay-policy=no-user-gesture-required", "--mute-audio",
      "--force-prefers-reduced-motion", "about:blank",
    ], { stdio: ["ignore", "ignore", "pipe"], detached: true });
    let err = "";
    chrome.stderr.on("data", (d) => { err += d; });
    chrome.on("exit", (c) => { if (c) console.error(`chrome exited ${c}\n${err.slice(0, 2000)}`); });
  }

  let targets;
  for (let i = 0; i < 150 && !targets; i++) {
    try { await json("/json/version"); targets = await json("/json/list"); } catch { await sleep(200); }
  }
  if (!targets) throw new Error("chrome did not come up");

  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  const cdp = new CDP(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  for (const s of SHOTS) {
    if (ONLY && !s.file.includes(ONLY)) continue;
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: s.w, height: s.h, deviceScaleFactor: 1, mobile: false });

    // Blank the page first: two URLs differing only by #hash fire no load
    // event, and the wait below would never return.
    let loaded = cdp.once("Page.loadEventFired");
    await cdp.send("Page.navigate", { url: "about:blank" });
    await loaded;
    loaded = cdp.once("Page.loadEventFired");
    await cdp.send("Page.navigate", { url: BASE + s.url });
    await loaded;

    const ok = await cdp.send("Runtime.evaluate", { expression: READY, awaitPromise: true });
    if (!ok.result.value) { console.log(`  !!  ${s.file} — the app never finished loading`); continue; }
    await sleep(2500);   // let layout and animation settle

    if (s.act) {
      const r = await cdp.send("Runtime.evaluate", { expression: ACTS[s.act], awaitPromise: true });
      if (s.needs && !r.result.value) { console.log(`  --  ${s.file} — needs ${s.needs}; left as it was`); continue; }
    }

    let clip;
    if (s.full) {
      const r = await cdp.send("Runtime.evaluate", { expression: `Math.ceil(document.documentElement.scrollHeight)` });
      clip = { x: 0, y: 0, width: s.w, height: r.result.value, scale: 1 };
    } else if (s.clip) {
      const r = await cdp.send("Runtime.evaluate", {
        expression: `(() => { const b = document.querySelector(${JSON.stringify(s.clip)}).getBoundingClientRect();
          return JSON.stringify({x: Math.round(b.x), y: Math.round(b.y + scrollY), w: Math.round(b.width), h: Math.round(b.height)}); })()`,
      });
      const b = JSON.parse(r.result.value);
      clip = { x: b.x, y: b.y, width: b.w, height: b.h, scale: 1 };
    }

    const shot = await cdp.send("Page.captureScreenshot", {
      format: "png", captureBeyondViewport: Boolean(s.full || s.clip), ...(clip ? { clip } : {}),
    });
    writeFileSync(`${OUT}/${s.file}`, Buffer.from(shot.data, "base64"));
    console.log(`  ok  ${s.file} (${clip ? `${clip.width}x${clip.height}` : `${s.w}x${s.h}`})`);
  }

  ws.close();
  if (chrome) process.kill(-chrome.pid, "SIGTERM");
}

main().catch((e) => { console.error(e); process.exit(1); });
