# Music Graph

Your Spotify listening history, turned into something you can explore, print and play with. Runs entirely on your own machine.

![The light show: album colors, a frequency ring, and where the song sits in your history](screenshots/hero.png)

## What it does

- **Vibes** — artists you play in the same sessions, grouped into "vibes" named by when you play them, with arcs showing what bridges one vibe to another and why.
- **Network** — the same artists as a web of co-listening, bridges highlighted.
- **Over time** — a streamgraph of your top artists or vibes, month by month.
- **Habits** — when you listen, hour by hour across the week, plus a calendar of every day.
- **Poster** — a print of your listening: aurora, year rings or constellation, exported as PNG or SVG.
- **For you** — pick a vibe, get a playlist from your own history; play it on this Mac or save it to Spotify.
- **Now Playing** — when a song plays, the page becomes a full-screen light show in the album's colors that reacts to the sound.
- **DJ** — two decks for your own audio files: BPM and key detection, beat sync, key lock, loops, EQ, crossfader, and WAV recording.

| Vibes | Poster | DJ |
| --- | --- | --- |
| ![](screenshots/1-vibes.png) | ![](screenshots/11-poster-aurora.png) | ![](screenshots/13-dj-synced.png) |

## Run it

```bash
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt
```

```bash
.venv/bin/python make_sample_data.py && .venv/bin/python build_data.py --sample
```

```bash
python3 server.py --open
```

That opens <http://127.0.0.1:8765> on generated sample data, so you can look around straight away.

**To use your own listening:** request your **Extended streaming history** from [spotify.com/account/privacy](https://www.spotify.com/account/privacy/), put the zip in `data/raw/`, and run `.venv/bin/python build_data.py`. Spotify can take up to 30 days to send it.

## More

- **[GUIDE.md](GUIDE.md)** — getting your export, the DJ controls, syncing the light show to sound, saving playlists to Spotify, how everything is computed, and the file map.
- **[spotify_graph.md](spotify_graph.md)** — the project brief: every decision, why it was made, and what's been verified.

## Privacy

Everything runs locally. Your export never leaves the machine: `data/raw/` and the generated `data/*.json` are gitignored, the server only listens on `127.0.0.1` and refuses requests from other sites, and Spotify login tokens stay in your browser.

## Requirements

macOS (the Now Playing and crate features use AppleScript and Spotlight), Python 3.12 for the pipeline, Python 3 for the server, and a Chromium-based browser or Safari. No build step, no framework.
