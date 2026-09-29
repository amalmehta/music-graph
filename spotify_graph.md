PROJECT NAME: SPOTIFY_MUSIC_GRAPH

prompt scaffolding:

meta-instructions:

<run the prompt below, if unclear, or you have ideas that make it more streamlined, ask away and then modify the project instructions below>

<show deliverable components at the end of build>

intructions:

summary/high level description:

Turn my Spotify Extended Streaming History export into a beautiful, interactive
single-page web app that shows my taste: the vibes I actually listen in, how my
artists connect, and how my listening changed over the years. When a song is
playing, the page becomes a full-screen, glowing, colorful light show that reacts
to the music and shows where that song sits in my listening life. Pick a vibe and
it builds a playlist from my own history that I can play right away or save to Spotify.

The history views and recommendations come from the export alone. Live mode reads
what's playing from the Spotify desktop app on this Mac, with the Spotify Web API
as a fallback. The Web API is also used to save playlists.

decisions (locked 2026-09-16):

- data source: Extended Streaming History export (Streaming_History_Audio_*.json), copied into `data/raw/`
- until the export arrives: build and test on generated sample data in the exact export format (`data/sample/`); real files drop in with no code changes
- deliverable: interactive web page (D3 + canvas/WebGL), served locally; history views can be published as a private share link
- scope: polished MVP — 3 headline views + live Now Playing mode + mood recommendations now, 2 more views in phase 2
- artist links: co-listening (artists played in the same sessions), no genre lookups
- "vibes map" = taste clusters map (see view 1)
- now playing detection: both — local Spotify desktop app first, Spotify Web API fallback
- light show driver: real audio (mic or BlackHole loopback) with album-art/progress fallback
- live graphs: all three — song in taste map, history with the song, live sound graph
- live mode placement: full-screen, phase 1
- mood = tap one of my vibes (clusters from the vibes map); vibes can be renamed with my own mood word
- recommendations source: my own listening history only (no Last.fm, no LLM)
- recommendation output: play on this Mac through the desktop app + "Save to Spotify" playlist button
- DJ tab (added 2026-09-16): two-deck mixer for audio files I own (Spotify audio is DRM-protected and can't be mixed); files from drag & drop + a music folder crate; full-screen DJ mode drives the light show; built now, independent of the export

architecture:

1. data pipeline — `build_data.py` (Python 3.12, `.venv`, networkx + numpy)
   - input: `data/raw/` (folder of `Streaming_History_Audio_*.json`, or `my_spotify_data.zip`); `--sample` uses `data/sample/`
   - sample generator: `make_sample_data.py` writes realistic fake export files (fictional artists, several vibe groups with distinct time-of-day habits, skips, sessions, 2019–2026)
   - clean: drop podcasts/audiobooks (episode_name / audiobook fields set), drop plays under 30s (Spotify's stream threshold), drop rows with no artist
   - timestamps: export `ts` is UTC and marks when the play ended; converted to this Mac's local time zone
   - sessions: split plays into sessions on a >30 min gap
   - output:
     - `data/graph_data.json` — aggregates for the 3 views + vibe definitions (small, loads first)
     - `data/history_index.json` — per-track and per-artist play histories (first/last play, monthly counts, total plays/hours, completion rate, vibe), keyed by track URI and by normalized "track — artist"; used by live mode and recommendations
   - fields used: ts, ms_played, master_metadata_track_name, master_metadata_album_artist_name, master_metadata_album_album_name, spotify_track_uri, reason_end, skipped, shuffle
2. local server — `server.py` (Python, stdlib only)
   - serves the web app at http://127.0.0.1:8765 (a local origin is required for mic access)
   - `GET /api/now-playing` → { source, state, track, artist, album, track_uri, artwork_url, position_ms, duration_ms }, read from the Spotify desktop app via AppleScript (`osascript`); the page polls it every 1s and interpolates position between polls
   - `GET /api/artwork?url=` → proxies album art from i.scdn.co so the page can read its pixels for colors
   - `POST /api/play` { uris } → plays a list through the desktop app; a server-side queue starts the next song when one ends (AppleScript can't queue); `POST /api/play-context` { uri } plays a saved playlist; `POST /api/queue/stop`
3. Spotify Web API — in the browser (optional for live mode, required for saving playlists)
   - Authorization Code + PKCE (no client secret); scopes `user-read-currently-playing user-read-playback-state playlist-modify-private`
   - redirect URI `http://127.0.0.1:8765/callback`, Client ID in `config.json` (`config.example.json` checked in)
   - follows the February 2026 dev-mode rules: app owner needs Premium, max 5 users; create playlist with `POST /me/playlists`, add songs with `POST /playlists/{id}/items`
   - now-playing fallback via `GET /me/player/currently-playing` when the desktop app isn't playing; tokens stay in the browser
4. web app — `index.html` + `app.js` + `nowplaying.js` + `recs.js` + `styles.css`
   - D3 v7 from cdnjs for the views, WebGL + canvas for the light show, no build step
   - shared header: headline stats (hours listened, artists, top artist) + a date-range brush over monthly listening
   - tabs: Vibes · Network · Over time · For you
   - hover tooltips, click an artist to highlight it across all views
   - light and dark theme, works at phone width

phase 1 views:

1. vibes map (taste clusters)
   - artists (top ~300 by minutes) positioned in 2D so co-listened artists sit together
   - co-occurrence weighted by PMI within sessions → community detection (Louvain) → 2D layout
   - each cluster is a "vibe": glowing colored region, auto-labelled from when it gets played (e.g. "late night · weekdays") plus its top artists
   - click a vibe → its top artists, tracks, peak hours, how its share changed over time, and "make a playlist"
2. artist network
   - force-directed graph, node size = minutes played, edge = co-listening strength (thresholded)
   - node color = vibe cluster from view 1, so the two views read as one system
   - zoom/pan, search an artist, neighbors highlight on hover
3. listening over time
   - streamgraph of top artists (or vibes, toggle) by month across all years
   - the header brush sets the date range for every view (node sizes, stats); co-listening links stay all-time
4. NOW PLAYING mode (full-screen live light show + graphs)
   - opens automatically when playback starts; Esc / close returns to the views and stays closed until the next song; song change crossfades
   - color: palette extracted from the album art (k-means on artwork pixels) drives every gradient and glow
   - light show: WebGL aurora-like flowing color field + canvas particles and bloom
     - bass → pulse and bloom, mids → flowing ribbons, highs → sparkles; beats via bass spectral-flux onset detection
     - audio input: Web Audio `getUserMedia` with echo cancellation / noise suppression / auto gain off; input picker so BlackHole can be chosen for a clean signal
     - fallback when no audio access: motion driven by album colors + song progress (slow breathing, swell toward the end)
   - live graphs layered into the scene:
     - live sound graph: glowing radial frequency ring + waveform around the album art
     - song in taste map: mini vibes map glides to the artist; its vibe cluster and co-listened neighbors light up in the album colors
     - history with it: glowing timeline of every play of this track and artist — first play, peak month, total plays/hours; a distinct "new to you" state when the song isn't in the export
     - "more like this vibe" button → For you tab with the artist's vibe selected
   - track matching: spotify_track_uri first, then normalized track + artist name
   - target 60fps; respects `prefers-reduced-motion` (calmer, no flashing)
5. FOR YOU (mood recommendations)
   - pick a vibe card (colors, name, top artists, when I play it); a "right now" hint highlights the vibe that best fits the current hour and weekday
   - rename a vibe with my own mood word (kept in the browser)
   - slider: rediscover (loved but not played in a long time) ↔ comfort (current favorites); length 15 / 25 / 40
   - scoring per track in the vibe: plays (log) × completion rate (not skipped) × recency weight from the slider; max 2 songs per artist
   - ordering: chains songs so neighbors come from co-listened artists, never the same artist back to back
   - each song shows why it was picked (e.g. "38 plays · last played Mar 2024")
   - actions: play one song, Play all (desktop app queue), Save to Spotify (private playlist named after the vibe, then plays it), Shuffle again (swap in new picks)

6. DJ (two-deck mixer)
   - crate: audio files under `music_dir` (config.json, default ~/Music; `--music-dir` overrides) via `GET /api/crate` + `GET /api/crate/file?id=` (files addressed by opaque id only), plus drag & drop / "Add files"; rows matched to my Spotify history show plays + vibe color
   - analysis in a Web Worker (`djworker.js`): BPM (onset autocorrelation + comb-filter refine, folded to 78–160), first beat / beat grid, key (Krumhansl–Schmuckler chroma → Camelot), colored overview + scrolling waveforms
   - decks: play / cue / sync (tempo + beat phase, re-aligned on play) / key lock (WSOLA time-stretch rendered in the worker, swapped in seamlessly), 4 hot cues, 1–16 beat loops, tempo ±8/16%, nudge, ÷2 ×2 BPM fix, 3-band EQ with kill, low/high-pass filter, channel fader + meter
   - mixer: equal-power crossfader, master volume, WAV recording of the master via AudioWorklet (90 min cap)
   - full-screen DJ mode reuses the Now Playing light show, fed by the mix's analyser: spinning disc in deck colors, dual scrolling waveforms, play/sync/crossfader on screen
   - keyboard: A / L play, S / K sync, ← → crossfader
   - `?deckA=` / `?deckB=` load crate tracks by id or name match on open; `&sync=B` beat-matches, `&play=1&lightshow=1` starts the decks in full-screen light show (a "set link")
   - per-track BPM/key/cues saved in the browser

7. HABITS (built 2026-09-18)
   - hour-of-day × day-of-week grid (peak cell outlined), sequential ramp starting at the page surface color, legend
   - summary: peak time, biggest day, longest streak, share of days with music, weekend share
   - calendar heatmap: one square per day, grouped by year, month ticks
   - both follow the header date range; pipeline adds `habits.dayMinutes` + `habits.monthHourDow`
8. POSTER (built 2026-09-18)
   - year rings: one ring per year, one bar per day (length = minutes, color = that month's dominant vibe), hours in the center
   - constellation: artists as glowing stars placed by the vibes map, co-listening links, top-12 labels
   - options: title, palette (vibes / duotone / mono), paper (dark is the default; light for a pastel print), labels on/off; style defaults to Aurora; follows the date range
   - export: PNG 3000 × 4242 via canvas, or SVG; system fonts in exports

deliverables (show at end of build):

- `build_data.py`, `make_sample_data.py`, `server.py`, `requirements.txt`
- `data/graph_data.json`, `data/history_index.json` (generated — from sample data until my export arrives)
- `index.html`, `app.js`, `nowplaying.js`, `recs.js`, `spotify.js`, `dj.js`, `djworker.js`, `habits.js`, `poster.js`, `util.js`, `styles.css`, `config.example.json`
- `make_test_audio.py` (synthetic tracks with known BPM/key for testing the decks)
- `README.md`: requesting the export, re-running with a new export, how each view and the recommendations are computed, run command, BlackHole setup for clean audio, creating the Spotify developer app
- `screenshots/`: the 3 views, For you, and Now Playing mode with a real song, plus the local run command

data location:

- raw export lives in `data/raw/` inside this project (folder or `my_spotify_data.zip`; pipeline unzips if needed)
- `data/raw/` is private input — never published; only aggregated JSON ships with the page

bridges between vibes (2026-09-28):

- pipeline adds `bridges` (per vibe pair: strength, shared sessions, top linking artist pairs) and `cross` per artist (share of its links reaching other vibes)
- vibes map draws the top 3 artist links per vibe pair as gradient arcs (hover for the pair + session count, click to select the artist); pairs under 5% strength are hidden
- artists in the top 8% for cross-vibe links get a dashed ring in the color of the vibe they reach toward
- side panel gains "What links them": each vibe pair with the artists doing the linking and how many sessions had both
- each bridge also carries *why*: mid-session vibe switches counted by hour and month, the dominant drift direction, and the top "gateway" songs (the track played right after a switch); shown in the panel and the arc tooltip
- arc thickness scales to the strongest link on screen (raw PMI weights needed normalising)
- network view: cross-vibe links drawn as gradient strokes above the rest, bridge artists ringed, "Bridges only" toggle (also `?bridges=1`) fades everything that stays inside one vibe
- the per-node top-6 edge pruning was dropping every cross-vibe link, so bridges (above the 5% threshold) are added back into `edges` after pruning
- gotcha: the `.edge` CSS rule overrode the gradient `stroke` attribute; bridge links carry their own class
- rings poster marks crossover days with a bead at the bar's tip (pipeline adds `habits.switchDays`), captioned with the count
- third poster style "Aurora": the Now Playing look as a print — SVG feTurbulence + feDisplacementMap color fields behind one ring of daily listening, with the same crossover beads; exports at 3000 × 4242 (~10 MB, filters rasterize fine)
- poster constellation draws bridges as brighter gradient links (gradients live in the poster's own defs, so PNG/SVG exports keep them); `?poster=rings|constellation` picks the style

final pass (2026-09-26):

- vibes map: new dots are drawn at their final size/place (they used to fly in from the corner on first paint)
- Now Playing: the dark backdrop is solid immediately, only the contents fade in
- screenshots/ recaptured from the finished build (7 views + live Now Playing)

performance + verification (2026-09-20):

- tested against a heavy-listener-sized library (320 artists, 87k plays, 8 years) generated with `make_sample_data.py --artists 320 --density 2.2`
- network view first render 1.3s → ~0.3s: layout now precomputed in `build_data.py` (`nx`/`ny` per artist), browser physics only while dragging; nodes shrink in big libraries so links stay visible
- vibes map: density grid coarsened (0.32s → 0.03s), collide relaxation halved, label nodes capped at 90
- pipeline cost: ~60–75s for 87k plays (two spring layouts); small sample ~6s
- `tests/test_queue.py`: play queue verified against a faked Spotify (start, advance on song end, advance when Spotify auto-plays, step aside on manual change)
- `tests/test_djworker.mjs`: tempo 3/3, beat grid within 5ms, key 2/3 (ambiguous track reads as a neighbouring key), stretch round-trip holds tempo + key
- DJ audio measured by tapping the deck output (master muted): loop wraps and key-lock swaps produce no sample jumps beyond the track's own transients, and no dropouts — still not judged by ear
- poster exports now embed the font (SVG 672 KB, PNG 3000 × 4242); verified the embedded face actually changes rasterized output

build status (2026-09-16):

- DJ tab built and tested on synthetic tracks: BPM 3/3 correct, key 2/3 (ambiguous A minor track read as G major, a neighbouring key); sync holds beat phase exactly; loops, crossfader, key lock and WAV recording verified; full-screen DJ light show verified
- DJ not yet tried on real music files (the ~/Music folder has no songs)
- Habits + Poster built and verified on sample data; poster exports checked (PNG 3000 × 4242, SVG); phase 2 is now complete

- phase 1 built and running on sample data; Now Playing verified live against the Spotify desktop app
- not yet exercised: Play / queue through the desktop app (skipped to avoid interrupting music), Save to Spotify (needs Client ID), mic / BlackHole sync (needs browser permission)

open items:

- export requested? → copy it into `data/raw/` when it arrives, then run `build_data.py` (no `--sample`)
- Spotify developer app Client ID for saving playlists + Web API fallback (developer.spotify.com → create app → redirect URI `http://127.0.0.1:8765/callback` → paste Client ID into `config.json`). Needs Premium on the app owner's account. Not a blocker for building or local play
