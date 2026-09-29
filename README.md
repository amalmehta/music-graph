# Music Graph

An interactive map of your Spotify listening, built from your own streaming history:

- **Vibes:** artists you play in the same sessions are grouped into "vibes" and named by when you play them, with arcs showing what links one vibe to another.
- **Network:** the web of artists you listen to together, with the links that cross between vibes drawn in both vibes' colors. "Bridges only" fades everything else; `?bridges=1` opens in that state.
- **Over time:** how your top artists and vibes rose and faded, month by month.
- **For you:** pick a vibe and get a playlist from your own history, then play it on this Mac or save it to Spotify.
- **Now Playing:** when a song plays in Spotify, the page turns into a full-screen light show in the album's colors that reacts to the sound. It also shows where the song sits in your taste map and your history with it.
- **Habits:** when you listen, hour by hour across the week, plus a calendar of every day.
- **Poster:** a frameable print of your listening — year rings or an artist constellation — exported as PNG or SVG.
- **DJ:** two decks for mixing audio files you own. It detects BPM and key, syncs beats with key lock, and has EQ and filters, loops, hot cues and a crossfader. You can record the mix to a WAV file, and the full-screen light show can dance to your mix.

Everything runs locally. Your raw export never leaves this Mac.

## Run it

```bash
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt
```

```bash
.venv/bin/python build_data.py
```

```bash
python3 server.py --open
```

That opens <http://127.0.0.1:8765>. Useful links:

- `#network`, `#time`, `#habits`, `#poster`, `#foryou`, `#dj` open a specific tab.
- `?np=off` stops Now Playing from opening by itself. You can still open it with the "now playing" button in the header.

### No export yet? Use sample data

```bash
.venv/bin/python make_sample_data.py && .venv/bin/python build_data.py --sample
```

This generates fictional artists and songs in the exact export format. Play and Save are turned off while sample data is loaded, because the songs don't exist.

For a library the size of a heavy listener's (about 320 artists and 87,000 plays), which is useful for checking speed:

```bash
.venv/bin/python make_sample_data.py --artists 320 --density 2.2 --out data/sample_big && .venv/bin/python build_data.py --src data/sample_big
```

### Tests

```bash
python3 tests/test_queue.py . && node tests/test_djworker.mjs .
```

The first fakes Spotify and checks the play queue starts, advances when a song ends, keeps going when Spotify auto-plays something else, and steps aside when you pick a different track. The second checks tempo, beat grid and key detection against the generated test tracks (run `make_test_audio.py` first).

## 1. Get your listening history

1. Go to [spotify.com/account/privacy](https://www.spotify.com/account/privacy/) and log in.
2. Under **Download your data**, tick **Extended streaming history**, then click **Request data**.
3. Click the confirmation link in the email Spotify sends you.
4. Wait for the download email. Spotify says it can take up to 30 days, and the link expires after about 2 weeks.
5. Put `my_spotify_data.zip`, or the unzipped folder, into `data/raw/`. Then run `build_data.py`.

The older **Account data** package (the last year only, with no track IDs) also works, but it gives less detail.

## 2. Sync the light show to the sound (optional)

Click **Sync to sound** in Now Playing and allow microphone access. The page then listens to the music through your mic.

For a clean signal with no room noise, install [BlackHole](https://existential.audio/blackhole/) (free):

1. Install **BlackHole 2ch**.
2. Open **Audio MIDI Setup** and create a **Multi-Output Device** that includes your speakers or headphones plus BlackHole 2ch.
3. Set that as your Mac's sound output.
4. In Now Playing, pick **BlackHole 2ch** from the input menu.

Without audio access, the light show still moves, driven by the album colors and song progress.

## 3. Save playlists to Spotify (optional)

Playing songs on this Mac works without any setup: the server controls the Spotify desktop app. Two features need a Spotify developer app: saving playlists, and showing Now Playing for music on your phone or other devices.

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and create an app. Select **Web API**.
2. Add the redirect URI `http://127.0.0.1:8765/callback`.
3. Copy `config.example.json` to `config.json` and paste in your **Client ID**. No client secret is needed; the app uses PKCE.
4. Under **User Management**, add the Spotify account you'll log in with.

Spotify's February 2026 rules for development-mode apps apply: the app owner needs Spotify Premium, and each app allows at most 5 users.

## 4. DJ tab

**Getting music in:**

- **Music folder:** the crate lists every audio file under `~/Music`. To use another folder, set `"music_dir"` in `config.json`, or start the server with `--music-dir /path/to/folder`. Click **Rescan** after adding files.
- **Drag & drop:** drop files onto a deck to load them, or onto the crate to add them. You can also use **Add files**.
- **By link:** `?deckA=neon&deckB=glass#dj` loads crate tracks whose title or artist matches, handy for reopening a pair. Add `&sync=B` to beat-match on open, and `&play=1&lightshow=1` to start both decks straight into the light show (browsers may still require a click before audio starts).
- **Formats:** MP3, M4A/AAC, WAV, AIFF, FLAC and OGG. DRM-protected downloads, such as Apple Music or Spotify offline files, can't be decoded.
- **Why not Spotify?** Spotify's audio is protected, so Spotify songs can't be mixed here.
- **Your history:** files whose title and artist match your streaming history show your Spotify play count and vibe color.

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

## 5. Habits and Poster

**Habits** shows the hour-by-weekday grid (your peak time is outlined), five summary numbers, and a calendar where each square is a day. Both follow the date range at the top.

**Poster** renders a print-ready page:

- **Aurora (default):** the Now Playing light show as a print — flowing color fields behind a single ring of every day you listened.
- **Year rings:** one ring per year, one bar per day, sized by listening time and colored by that month's main vibe. Beads mark the days your vibes crossed over.
- **Constellation:** your artists as stars, placed by the vibes map and linked by co-listening, with the links that cross between vibes drawn brighter in both vibes' colors.
- **Options:** title, colors (vibes / duotone / mono), paper (dark by default, light for a pastel print), labels on or off. `?poster=rings`, `?poster=constellation` or `?poster=aurora` opens a style directly, and `?paper=dark` / `?paper=light` sets the paper.
- **Export:** PNG at 3000 × 4242 (A3 at 250+ dpi) or SVG. The font is embedded in both, so saved files match the preview. With no internet, exports fall back to a system font.

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
| `server.py` | Local web server, now-playing check, album-art proxy, playback queue (standard library only) |
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
| `util.js` | Shared helpers |

## Privacy and safety

- The server only listens on `127.0.0.1`.
- It only serves the app files and the two generated JSON files. `data/raw/` and the Python files are never served.
- Audio files in the music folder are only reachable by an opaque ID from the crate scan, never by file path.
- It rejects requests from other websites: it checks the Host and Origin headers and requires a JSON content type on POST.
- Spotify login tokens stay in your browser.
