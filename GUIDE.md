# Guide

Everything beyond the quick start in the [README](README.md): getting your data in, the optional setup, the DJ controls, and how each number is worked out.

## Contents

- [1. Get your listening history](#1-get-your-listening-history)
- [2. Sample data and tests](#2-sample-data-and-tests)
- [3. Sync the light show to the sound](#3-sync-the-light-show-to-the-sound)
- [4. Save playlists to Spotify](#4-save-playlists-to-spotify)
- [5. DJ tab](#5-dj-tab)
- [6. Habits and Poster](#6-habits-and-poster)
- [Links that open a specific view](#links-that-open-a-specific-view)
- [How it works](#how-it-works)
- [Files](#files)

## 1. Get your listening history

1. Go to [spotify.com/account/privacy](https://www.spotify.com/account/privacy/) and log in.
2. Under **Download your data**, tick **Extended streaming history**, then click **Request data**.
3. Click the confirmation link in the email Spotify sends you.
4. Wait for the download email. Spotify says it can take up to 30 days, and the link expires after about 2 weeks.
5. Open the app, click the ⚙ in the header, and drop `my_spotify_data.zip` on it. It saves the file to
   `data/raw/` and runs `build_data.py` for you, showing the build log as it goes; a few minutes of listening
   history takes seconds, a decade takes a minute or so.

   Prefer the terminal? Put the zip (or the unzipped folder) in `data/raw/` yourself and run `build_data.py`.

The older **Account data** package (the last year only, with no track IDs) also works, but it gives less detail.

## 2. Sample data and tests

No export yet? Generate fictional artists and songs in the exact export format:

```bash
.venv/bin/python make_sample_data.py && .venv/bin/python build_data.py --sample
```

Play and Save stay off while sample data is loaded, because the songs don't exist.

For a library the size of a heavy listener's (about 320 artists and 87,000 plays), useful for checking speed:

```bash
.venv/bin/python make_sample_data.py --artists 320 --density 2.2 --out data/sample_big && .venv/bin/python build_data.py --src data/sample_big
```

Tests:

```bash
python3 tests/test_queue.py . && python3 tests/test_import.py . && node tests/test_djworker.mjs . && node tests/test_setlist.mjs . && node tests/test_melody.mjs .
```

The first fakes Spotify and checks the play queue starts, advances when a song ends, keeps going when Spotify auto-plays something else, and steps aside when you pick a different track. The second uploads a sample export to a throwaway copy of the project and checks the build runs, the refused filenames stay refused, and the Client ID round-trips. The third checks tempo, beat grid and key detection against the generated test tracks (run `make_test_audio.py` first). The fourth covers the playlist logic that needs no Spotify account: harmonic mixing on the Camelot wheel, matching a playlist against the files you own, and the set list a saved playlist is built from. The fifth checks the melody detector against signals whose pitch is known by construction — steady notes, a two-octave glide, an octave leap, silence and noise.

## 3. Sync the light show to the sound

Click **Sync to sound** in Now Playing and allow microphone access. The page then listens to the music through your mic.

For a clean signal with no room noise, install [BlackHole](https://existential.audio/blackhole/) (free):

1. Install **BlackHole 2ch**.
2. Open **Audio MIDI Setup** and create a **Multi-Output Device** that includes your speakers or headphones plus BlackHole 2ch.
3. Set that as your Mac's sound output.
4. In Now Playing, pick **BlackHole 2ch** from the input menu.

Without audio access, the light show still moves, driven by the album colors and song progress.

## 4. Save playlists to Spotify

Playing songs on this Mac works without any setup: the server controls the Spotify desktop app. Two features need a Spotify developer app: saving playlists, and showing Now Playing for music on your phone or other devices.

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and create an app. Select **Web API**.
2. Add the redirect URI `http://127.0.0.1:8765/callback` — the ⚙ panel prints the exact one for your port.
3. Click the ⚙ in the header and paste your **Client ID** into the Spotify field, then reload. No client secret
   is needed; the app uses PKCE. (The terminal equivalent is copying `config.example.json` to `config.json`.)
4. Under **User Management**, add the Spotify account you'll log in with.

Spotify's February 2026 rules for development-mode apps apply: the app owner needs Spotify Premium, and each app allows at most 5 users.

## 5. DJ tab

**Getting music in:**

- **Music folder:** the crate lists every audio file under `~/Music`. To use another folder, set `"music_dir"` in `config.json`, or start the server with `--music-dir /path/to/folder`. Click **Rescan** after adding files.
- **Drag & drop:** drop files onto a deck to load them, or onto the crate to add them. You can also use **Add files**.
- **Spotify playlist:** the third crate tab lists your playlists (needs the Client ID from §4). Each track says whether
  you own the audio: the ones you do get **A** / **B** to load onto a deck, with BPM, key and a **mixes** / **jump** hint
  against the track above it, so a playlist doubles as a set list. The ones you don't own get ▶, which plays them through
  the Spotify desktop app — an audition, not a deck, because the audio is protected. BPM and key are filled in from your own
  files the first time each one goes on a deck.
- **Save set to Spotify:** once you have played two or more tracks, **Save set to Spotify** writes them to a new private
  playlist in the order you played them. A track is included if it came from a playlist row or matches your streaming
  history; anything Spotify doesn't know is left out and the count is reported.
- **By link:** `?deckA=neon&deckB=glass#dj` loads crate tracks whose title or artist matches, handy for reopening a pair. Add `&sync=B` to beat-match on open, and `&play=1&lightshow=1` to start both decks straight into the light show (browsers may still require a click before audio starts).
- **Formats:** MP3, M4A/AAC, WAV, AIFF, FLAC and OGG. DRM-protected downloads, such as Apple Music or Spotify offline files, can't be decoded.
- **Why not Spotify?** Spotify's audio is protected (encrypted, with no access to the decoded samples), so it can't be beat-matched, key-locked or crossfaded. An account also only streams to one device at a time, so two Spotify decks could not play together. Playlists are therefore a way to choose and audition what to mix, not a source of deck audio.
- **Your history:** files whose title and artist match your streaming history show your Spotify play count and vibe color.

- **Melody:** under each deck's waveform, a line of the tune's rises and falls — the strongest pitch in every frame, scaled to the notes that track actually uses, with gaps where nothing is pitched (drums, silence). It is worked out from the decoded file when the track loads, so it covers the whole song, not just the part you have heard.

**On each deck:**

| Control | What it does |
| --- | --- |
| **CUE** | While paused, sets the cue point on the nearest beat. While playing, jumps back to it and pauses. |
| **SYNC** | Matches this deck's tempo and beat position to the other deck. If you pressed SYNC while paused, the beats line up again when you press play. |
| **KEY** (key lock) | Keeps the original pitch when you change tempo. Tempo changes are instant at "vinyl" pitch; a pitch-corrected copy is rendered in the background (a few seconds for a full song) and swapped in seamlessly. |
| **Hot cues 1–4** | Click to set, click again to jump. Shift-click or right-click clears one. |
| **Loop 1–16** | Loops that many beats from the current beat. Click the same length again to exit. |
| **Tempo** | ±8% or ±16% range. Double-click to reset. **−/+** nudge while held. **÷2 / ×2** fix a half- or double-time BPM reading. |
| **HI / MID / LOW** | EQ (all the way down kills the band). |
| **FILTER** | Down is a low-pass sweep, up is a high-pass sweep. |
| **VOL** | Channel volume, with a level meter. |

**Center section:**

- **Waveforms:** both decks scroll past one playhead. Bar lines line up when the decks are in sync, and each lane shows the beat within the bar.
- **Crossfader:** blends between decks with an equal-power curve.
- **Master:** overall volume.
- **● Record:** captures the master output. Press it again to save a 16-bit WAV to Downloads. Recordings stop automatically at 90 minutes.
- **✦ Light show:** opens the full-screen visuals driven directly by your mix (no mic needed), with transport and crossfader controls on screen.

**Keyboard shortcuts:**

| Key | Action |
| --- | --- |
| `A` / `L` | Play or pause deck A / B |
| `S` / `K` | Sync deck A / B |
| `←` / `→` | Move the crossfader |

**No music files handy?** Generate test tracks with known tempo and key:

```bash
.venv/bin/python make_test_audio.py
```

```bash
python3 server.py --music-dir data/test_audio
```

## 6. Habits and Poster

**Habits** shows the hour-by-weekday grid (your peak time is outlined), five summary numbers, and a calendar where each square is a day. Both follow the date range at the top.

**Poster** renders a print-ready page:

- **Aurora (default):** the Now Playing light show as a print — flowing color fields behind a single ring of every day you listened.
- **Year rings:** one ring per year, one bar per day, sized by listening time and colored by that month's main vibe. Beads mark the days your vibes crossed over.
- **Constellation:** your artists as stars, placed by the vibes map and linked by co-listening, with the links that cross between vibes drawn brighter in both vibes' colors.
- **Options:** title, colors (vibes / duotone / mono), paper (dark by default, light for a pastel print), labels on or off. `?poster=rings`, `?poster=constellation` or `?poster=aurora` opens a style directly, and `?paper=dark` / `?paper=light` sets the paper.
- **Export:** PNG at 3000 × 4242 (A3 at 250+ dpi) or SVG. The font is embedded in both, so saved files match the preview. With no internet, exports fall back to a system font.

## Links that open a specific view

| Link | Opens |
| --- | --- |
| `#network`, `#time`, `#habits`, `#poster`, `#foryou`, `#dj` | that tab |
| `?np=off` | without Now Playing taking over (the header button still opens it) |
| `?np=hide` | with the Now Playing pill hidden entirely, for clean screenshots |
| `?setup=1` | with the setup panel open, for importing an export or pasting a Client ID |
| `?theme=dark` / `?theme=light` | in a specific theme, whatever your system is set to |
| `?bridges=1#network` | the network with only the links that cross between vibes |
| `?poster=aurora&paper=light#poster` | a poster style and paper directly |
| `?deckA=neon&deckB=glass&sync=B#dj` | two crate tracks loaded and beat-matched |
| `&play=1&lightshow=1` | added to the above: starts both decks in the full-screen light show |

## How it works

**`build_data.py`** turns the export into two small JSON files:

- **Cleaning:** podcasts and audiobooks are dropped, as are plays under 30 seconds (the same threshold Spotify uses to count a stream). Short plays still count as skips.
- **Time:** timestamps are converted to your Mac's time zone.
- **Sessions:** a pause of more than 30 minutes starts a new listening session.
- **Vibes:**
  - Your top 300 artists (by minutes) are linked when they show up in the same sessions more often than chance would predict (positive PMI).
  - Louvain community detection groups them into vibes.
  - Each vibe is named by the time of day and part of the week where it stands out most compared with your overall listening.
- **Bridges:** links that cross between two vibes are totalled per pair of vibes, and the strongest artist pairs are kept. The map draws them as arcs, the panel lists them, and artists whose links reach across (top 8%) get a dashed ring.
- **Why a bridge exists:** the plays are walked again to catch every moment a session changes vibe. That gives the hour the crossovers happen, the year they peaked, which direction you usually drift, and the songs you most often cross over on.
- **Layout:** vibes are placed by how connected they are, then artists are spread out within their vibe. The network view's layout is computed here too, so the page never has to run physics to show it (dragging a node still does). In the page, overlapping dots are nudged apart.
- **Build time:** roughly a minute per 90,000 plays, mostly the two layouts. It only runs when you rebuild.
- **Habits data:** minutes per day, plus an hour × weekday grid for each month so the views can follow the date range.
- **History index:** every song and artist gets a monthly play history, a first and last play, and a completion rate. Artists outside the top 300 inherit the vibe they're most often played alongside.

**For you**, for a chosen vibe:

- **Score:** each song gets `log(plays) × completion rate × recency weight × a little randomness`.
- **Rediscover ↔ Comfort slider:** moves the recency weight from "loved but not played in months" to "on repeat lately".
- **Variety:** at most 2 songs per artist (3 in small vibes).
- **Order:** each next song comes from an artist you often play alongside the previous one, never the same artist twice in a row.
- **Right now:** the "Fits right now" badge compares the current hour and weekday with each vibe's listening pattern.

**Now Playing:**

- **Detecting the song:** `server.py` asks the Spotify desktop app what's playing (via AppleScript) once a second. The Web API is the fallback if you've connected it.
- **Colors:** album art is proxied through the local server so the page can read its pixels. k-means clustering picks the most vivid colors.
- **Background:** a WebGL shader draws colored light fields and aurora ribbons.
- **Reacting to sound:** the Web Audio API splits the sound into bass, mids and highs. Bass drives pulses and bloom, and sudden bass jumps (spectral flux) trigger particle bursts.
- **Matching your history:** by Spotify track ID first, then by normalized song and artist name.

**DJ decks** (`dj.js` + `djworker.js`, all in the browser):

- **Tempo:**
  - A beat-strength curve is built from bass-weighted energy jumps.
  - Autocorrelation finds the likely tempo.
  - A comb filter refines it to 0.02 BPM and finds where the first beat falls.
  - Readings are folded into 78–160 BPM, so use ÷2/×2 for drum & bass or half-time tracks.
- **Key:**
  - A chromagram (energy per pitch class) is compared against the Krumhansl–Schmuckler major and minor key profiles.
  - The result is shown in Camelot notation for harmonic mixing.
  - Ambiguous tracks can land on a neighbouring key. That key is usually still harmonically compatible with the true one, but check by ear.
- **Key lock:** WSOLA time-stretching overlaps and adds short windowed frames, choosing each frame's offset to best continue the previous one. It runs in a Web Worker.
- **Playback:** Web Audio buffer sources with sample-accurate loops. Each deck runs through EQ, filter, channel volume and the crossfader into the master, which feeds the recorder (an AudioWorklet) and the light show's analyser.
- **Saved per track in your browser:** BPM and key readings, cue points and hot cues.

## Files

| File | What it does |
| --- | --- |
| `build_data.py` | Export → `data/graph_data.json` + `data/history_index.json` |
| `make_sample_data.py` | Fictional export in the real format, for trying things out |
| `server.py` | Local web server, now-playing check, album-art proxy, playback queue, export import (standard library only) |
| `index.html`, `styles.css` | Page layout and styles, light and dark theme |
| `app.js` | Header, date brush, Vibes / Network / Over time views |
| `recs.js` | For you: vibe cards and playlists |
| `nowplaying.js` | Light show, audio analysis, live graphs |
| `spotify.js` | Spotify Web API login (PKCE), playlists, now-playing fallback |
| `dj.js` | DJ decks, mixer, crate, recording, DJ light-show mode |
| `djworker.js` | Tempo / key / waveform analysis and key-lock time-stretch (Web Worker) |
| `make_test_audio.py` | Synthetic test tracks with known tempo and key |
| `habits.js` | Hour × weekday grid and the calendar |
| `poster.js` | Poster rendering and PNG / SVG export |
| `setup.js` | Setup panel: import an export, show what it was built from, save a Client ID |
| `util.js` | Shared helpers |
| `tests/` | Play-queue test (faked Spotify), export-import test, DJ analysis test, playlist/set-list test, and melody-detector test |

---

Back to the [README](README.md) for the tour, or read the project brief in [spotify_graph.md](spotify_graph.md) for the decisions behind all of this and what has been verified.
