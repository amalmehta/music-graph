# System design

How Music Graph is put together, why it is built this way, and where it breaks.
Every number here is read off the code; the constant is named so you can check it.

## Shape of the thing

One Python script turns a Spotify export into two JSON files. A stdlib-only
server hands those files to a browser, talks to the Spotify desktop app on your
behalf, and streams audio files you own. Everything else is a static page.

```mermaid
flowchart TD
    export["Spotify export<br/>data/raw/*.json"] --> build["build_data.py<br/>clean, session, cluster, lay out"]
    build --> graph["data/graph_data.json<br/>~95 KB, aggregates"]
    build --> hist["data/history_index.json<br/>~350 KB, per-track history"]

    graph --> app["app.js<br/>Vibes / Network / Over time"]
    hist --> app
    graph --> np["nowplaying.js<br/>light show + live graphs"]
    hist --> np
    graph --> recs["recs.js · habits.js · poster.js"]

    server["server.py<br/>127.0.0.1:8765"] -->|"AppleScript"| spotify["Spotify desktop app"]
    server -->|"proxy i.scdn.co"| art["album art pixels"]
    server -->|"opaque id -> file"| crate["~/Music audio files"]

    app --> server
    np --> server
    dj["dj.js + djdraw.js"] --> worker["djworker.js<br/>tempo · beat grid · key"]
    dj --> server
    web["spotify.js<br/>PKCE, Web API"] -->|"save playlists"| api["api.spotify.com"]
```

## What each piece does

| File | Job |
| --- | --- |
| `build_data.py` | The whole pipeline. Reads the export, drops what does not count, splits sessions, builds the co-listening graph, finds vibes, precomputes layouts, writes both JSON files. |
| `make_sample_data.py` | Writes a fake export in the real format, so everything can be built and tested before a real export exists. |
| `server.py` | Static files, `/api/now-playing` (AppleScript), `/api/play` and a play queue, an album-art proxy, the DJ crate, and export import. Stdlib only. |
| `app.js` | Boot, shared header and date brush, and the Vibes, Network and Over time views. Owns `state`, which every other module reads. |
| `nowplaying.js` | The full-screen light show: WebGL colour field, audio analysis, the live melody trail, and the three live graphs. |
| `recs.js` · `habits.js` · `poster.js` | For you, Habits and Poster. Each exposes `init(api)` and `show()`. |
| `dj.js` · `djdraw.js` · `djworker.js` | Two decks, crossfader, crate. `djdraw.js` is pure drawing; `djworker.js` does tempo, beat grid and key off the main thread. |
| `spotify.js` | Authorization Code + PKCE, and the Web API calls for saving playlists. |

## Where data lives

- **`data/raw/`** — your export. Private input, never published, never served.
- **`data/graph_data.json`** — aggregates only. Loads first because every view needs it.
- **`data/history_index.json`** — per-track and per-artist histories, keyed by track URI and by a normalised `track — artist`. Only Now Playing and For you need it, but it is fetched at boot alongside the graph.
- **The browser** — vibe renames, DJ cue points and per-track BPM/key, theme. `localStorage`, via `store` in `util.js`. Never leaves the machine.
- **`config.json`** — Spotify Client ID and `music_dir`. Gitignored. No client secret exists: PKCE does not need one.

Nothing is uploaded anywhere. The only outbound calls are to Spotify's own API
and image CDN.

## Key decisions, and what they cost

**Co-listening, not genres.** Artists are related because you play them in the
same sessions, not because a service filed them under the same label. The graph
is yours rather than someone else's taxonomy. The cost is that a new artist has
no neighbours until you have played them a few times.

**PMI, not raw counts.** Edge weight is `log(n·N / (nᵢ·nⱼ))`, kept only when
positive, then scaled by `log1p(n)`. Raw co-occurrence would just rank your most
played artists against each other; PMI asks whether a pair turns up together
*more than chance*, and the `log1p(n)` factor stops a single shared session from
looking like a strong tie.

**Louvain with an escalating resolution.** Dense taste graphs collapse into two
blobs, so the resolution climbs 1.0 → 1.3 → 1.7 → 2.2 until the split is useful,
capped at 10 vibes (`MAX_VIBES`). `seed=42` everywhere, so the same export always
gives the same map. The cost is that vibe numbering is not stable across
*different* exports.

**Layout precomputed in Python.** `nx`/`ny` per artist are written by the
pipeline. First render of the network went 1.3s → ~0.3s; the browser only runs
physics while you drag. The cost is a slower pipeline (~60–75s for 87k plays).

**Pruning, then putting bridges back.** Each node keeps its 6 strongest links
(`EDGES_PER_NODE`). That pruning dropped nearly every cross-vibe link, which were
the interesting ones, so bridges at or above 0.05 strength are added back after
pruning. Without this the network looked tidy and said nothing.

**Stdlib-only server.** No Flask, no dependencies to install or keep current for
something that serves one person on loopback. The cost is writing routing by hand.

**AppleScript for now-playing.** The desktop app knows what is playing without
any account setup; the Web API needs a Client ID and Premium. AppleScript is
macOS-only and cannot queue, so the server runs its own queue on a daemon thread
and starts the next track when one ends.

## Threat model

The server binds `127.0.0.1` only and sends `Cache-Control: no-store`. It is not
hardened against a hostile local user; it is built so that a hostile *web page*
cannot use it.

| Risk | What stops it |
| --- | --- |
| A web page you are visiting calls the API | `Host` is checked against `127.0.0.1:<port>` / `localhost:<port>`; cross-site uploads are refused (`tests/test_import.py` covers this). |
| The art proxy fetching anything on your network | `ARTWORK_URL` is an anchored allowlist: https only, Spotify CDN hosts only, and a fixed path shape. Anything else is a 400. |
| Reading files outside the music folder | The crate never accepts a path. Files are scanned under `music_dir` and addressed by a SHA-1 id; `Crate.path()` is a dictionary lookup, so a traversal string resolves to nothing. |
| Playing arbitrary URIs through Spotify | `PLAYABLE_URI` must match before anything is sent to AppleScript. |
| Leaking your listening history | Only aggregates reach the page. `data/raw/` is gitignored and never served. Nothing is published. |
| Token theft | Tokens stay in the browser. PKCE means no client secret exists to leak. |

The album-art cache holds at most `ART_CACHE_MAX` (30) images in memory, oldest
evicted first, so a long session cannot grow it without bound.

## How it is tested

| Suite | What it covers |
| --- | --- |
| `tests/test_djworker.mjs` | Tempo, beat grid and key against synthetic tracks whose answers are known by construction. Needs `data/test_audio` — `make_test_audio.py` regenerates it. |
| `tests/test_melody.mjs` | The pitch detector against steady notes, a glide, an octave leap, silence and noise. Generates its own signals. |
| `tests/test_setlist.mjs` | Which playlist tracks are mixable, and what gets saved back to Spotify. |
| `tests/test_queue.py` | The play queue against a faked Spotify: start, advance, step aside on a manual change. |
| `tests/test_import.py` | Uploading an export over HTTP and building from it, against a throwaway copy of the project. Covers the cross-site refusal. |

`./test` runs all five. What tests cannot reach: how the mix *sounds*, the light
show at 60fps, mic and BlackHole capture, and anything needing a Spotify Client
ID. Those stay on the manual checklist.

## Known limits

- **Sized for one listener.** 300 artists on the map (`TOP_ARTISTS`); the pipeline
  holds every play in memory. At roughly 10× a heavy library the two spring
  layouts, not the IO, are what would hurt first.
- **macOS only** for now-playing and local playback, because of AppleScript.
- **The export is a snapshot.** There is no incremental update: a newer export
  means a full rebuild. At 87k plays that is 60–75 seconds.
- **Vibes are unnamed by you unless you rename them.** Automatic names come from
  when you listen, which is a good guess and sometimes a wrong one.
- **The DJ needs files you own.** Spotify's audio is DRM-protected and cannot be
  mixed, so the crate is your own music folder.
