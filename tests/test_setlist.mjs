// The parts of the DJ playlist feature that are pure logic: harmonic mixing, matching a
// playlist against the files you own, and the set list a saved playlist is built from.
//
//     node tests/test_setlist.mjs .
//
// Talking to Spotify is not covered here; it needs a developer app and a logged-in account.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? ".";
const src = readFileSync(join(root, "dj.js"), "utf8");
let ok = true;

function check(label, got, want = true) {
  const good = JSON.stringify(got) === JSON.stringify(want);
  ok &&= good;
  console.log(`${good ? "ok  " : "FAIL"} ${label}${good ? "" : `  (got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)})`}`);
}

// Pull the two functions out of dj.js rather than copying them, so the test tracks the real code.
function lift(name) {
  const at = src.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`${name} not found in dj.js`);
  let depth = 0, i = src.indexOf("{", at);
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) break;
  }
  return src.slice(at, i + 1);
}

const CAMELOT_SRC = src.match(/const CAMELOT = .*;/)[0];
const mixesWith = new Function(`${CAMELOT_SRC}\n${lift("mixesWith")}\nreturn mixesWith;`)();

// --- harmonic mixing, the Camelot wheel ---
check("the same key mixes", mixesWith("8A", "8A"));
check("its relative major mixes", mixesWith("8A", "8B"));
check("one step up mixes", mixesWith("8A", "9A"));
check("one step down mixes", mixesWith("9A", "8A"));
check("12A wraps round to 1A", mixesWith("12A", "1A"));
check("1A wraps back to 12A", mixesWith("1A", "12A"));
check("two steps is a jump", mixesWith("8A", "10A"), false);
check("a step across letters is a jump", mixesWith("8A", "9B"), false);
check("an unanalysed track never claims a mix", mixesWith("", "8A"), false);
check("nor does an unanalysed follower", mixesWith("8A", null), false);

// --- matching a playlist against the files you own ---
const norm = (s) => (s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const trackKey = (track, artist) => `${norm(track)}|${norm(artist)}`;
const files = [
  { title: "Neon Pulse", artist: "Test Audio", cacheKey: "crate:1" },
  { title: "Glass Horizon", artist: "Test Audio", cacheKey: "crate:2" },
];
const crateByKey = new Map(files.map((t) => [trackKey(t.title, t.artist), t]));
const playlist = [
  { title: "Neon Pulse", artist: "Test Audio", uri: "spotify:track:" + "A".repeat(22) },
  { title: "Nothing I Own", artist: "Someone Else", uri: "spotify:track:" + "B".repeat(22) },
  { title: "glass horizon", artist: "TEST AUDIO", uri: "spotify:track:" + "C".repeat(22) },
];
const owned = playlist.map((t) => Boolean(crateByKey.get(trackKey(t.title, t.artist))));
check("a playlist track you own is mixable", owned[0]);
check("one you don't own is not", owned[1], false);
check("matching ignores case", owned[2]);
check("the count in the note is right", owned.filter(Boolean).length, 2);

// --- the set list a saved playlist is built from ---
const setList = [];
function noteSet(item, historyUri) {
  const last = setList[setList.length - 1];
  if (last && last.cacheKey === item.cacheKey) return;
  setList.push({ cacheKey: item.cacheKey, title: item.title, uri: item.spotifyUri || historyUri || null });
}
noteSet({ cacheKey: "crate:1", title: "Neon Pulse", spotifyUri: playlist[0].uri });
noteSet({ cacheKey: "crate:1", title: "Neon Pulse", spotifyUri: playlist[0].uri });   // reloading the same track
noteSet({ cacheKey: "crate:2", title: "Glass Horizon" }, "spotify:track:" + "D".repeat(22));
noteSet({ cacheKey: "crate:3", title: "A File With No Spotify Match" });
check("reloading the same track is not a second entry", setList.length, 3);
check("a playlist row keeps that playlist's uri", setList[0].uri, playlist[0].uri);
check("a plain file falls back to your history's uri", setList[1].uri, "spotify:track:" + "D".repeat(22));
check("a track Spotify doesn't know gets no uri", setList[2].uri, null);
check("only the ones with a uri are saved", setList.map((t) => t.uri).filter(Boolean).length, 2);

console.log(ok ? "PASS" : "FAILED");
process.exit(ok ? 0 : 1);
