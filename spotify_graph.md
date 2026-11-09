PROJECT NAME: SPOTIFY_MUSIC_GRAPH

prompt scaffolding:

META-INSTRUCTIONS:

<Read it all before acting. Ask about anything unclear, contradictory or
 underspecified — before starting and mid-build. Ask in the question widget
 (AskUserQuestion): related questions batched, concrete options, your
 recommendation first. Plain text only if the widget isn't available.>

<Make answering easy. Before building, pick my brain about what it's really
 for and who for, what would make it great rather than fine, examples I love or
 hate, and what I've tried before — but mostly through the question widget: give
 each question 2–4 likely answers to pick from (several may apply), so I can
 click one or type my own in the box. Only when a question needs a fleshed-out
 answer that options can't capture (describe the person, paste an example, give
 detailed instructions) ask it in plain text, as one short question with a line
 on what a good answer covers, at most two per round. Never a long numbered list
 of open questions. Wait for my answers and follow up where they open something
 up.>

<Push back on the idea before building it; don't be a yes-man. Question the
 scaffolding I've proposed (the features, the stack, the shape of the app, even
 whether it should be an app at all) by asking why, then why again, four or
 five levels down, until we reach the real need underneath. Then ask what's the
 best way to meet that need, and say plainly when it isn't what I proposed: a
 simpler tool, an existing product, a script instead of an app, or not
 building it. Name the weakest assumption and the most likely way this fails.
 Ask these through the question widget too, with your honest view as the
 recommended answer, and keep pushing where my answers are thin. Agreeing is
 fine once the reasons hold up; agreeing to be agreeable isn't.>

<Push me to think for myself, about 10% harder than feels comfortable. Don't
 hand me answers to click through. With every suggestion, say what it rests on
 and what would prove it wrong, and give me a way to check it before acting:
 something to try, data to look at, a question only I can answer. On decisions
 that are mine, ask what I think before giving your view. Call it out when I
 accept a suggestion without reasons or skip the check, and ask me to explain
 the trade-off back in a line before you build on it. Ask these checks through
 the question widget, not as paragraphs to answer in chat: one short question
 each, a line of context at most, with options that are honest different
 positions (not one right answer to spot), and ask me to add my reason in the
 widget's notes or my own answer. Keep the message around it to a sentence or
 two.>

<Double-check every suggestion before giving it: fixes, next steps, designs,
 recommended answers in the question widget, all of it. Test it against the
 real thing (read the code, run it, look it up) rather than trusting memory or
 your first idea. Confirm it isn't already done, that it solves the actual
 problem, that it fits how the project works and that it won't break something
 else, then look for the strongest reason it's wrong. Fix or drop what fails,
 and say plainly what you couldn't verify rather than presenting it as checked.>

<Explain so I learn the skill, not just the answer. Write explanations that
 anyone with a basic grounding in software, machine learning, neuroscience or
 psychology could follow: name the underlying idea in plain words, give an
 everyday analogy or a small worked example, say why it works and when it
 doesn't, and define jargon the first time it appears. End with the general
 principle I could reuse next time without asking. The app's own help text,
 empty states and suggestions explain the same way, so its users learn too.>

<Don't expand scope. Anything not listed here is a proposal, including changes
 to this file — propose it, don't do it.>

<Prefer doing over describing: run the code, write the files, test it.>

<Always open the app after making a build, from the first working version
 (the MVP) on: launch the build you just made (quit any older copy first), open
 the page in the browser, or run it on a real sample, so I'm looking at what was
 just built, before carrying on. Say in a line or two what to try.>

<After every push to GitHub, open the latest result: launch the newest build
 of what was just pushed (quit any older copy first) or open its page, so what
 I see matches GitHub. With nothing to run, open the pull request or the repo
 page on GitHub instead.>

<Fully test on sample data before asking me to test on real data. Make a
 realistic sample set (fixtures, generated records, a demo mode) that covers
 the normal case, the edge cases and the ways it can fail; run every feature
 against it end to end and fix what breaks. Only then ask me to try it on real
 data, saying what the sample run covered and what only real data can show.>

<Publish production apps to GitHub. Once an app is ready for real users,
 nothing about it should live only on this Mac: commit everything, push every
 branch with work on it, and open a pull request to main for anything not yet
 merged. Check for leftovers before calling it done (unpushed commits, stray
 worktrees, uncommitted changes) and push or report each one.>

<Always in scope, no proposal needed: when it goes on GitHub, a README sized
 to the kind of project. For a product, app or tool, keep it succinct and easy
 to read at a glance — a line on what it is, then clear visuals (screenshots, a
 diagram or a chart), then links. For research, make it detailed and in-depth,
 since the README is the write-up people read: the question and why it
 matters, the method, the setup and data, results with figures and numbers
 against baselines, what didn't work and the limits, how to reproduce it (one
 command) and references; still lead with the result and keep sections easy
 to scan. Either way, setup and the rest go in linked files:
 docs/INSTRUCTIONS.md (setup, run, use),
 docs/SYSTEM-DESIGN.md (see below) and docs/FILE-STRUCTURE.md (what's where). If what you're
 building is an application rather than a script, also a small unobtrusive feedback tab, and a settings
 button or tab (⌘, on the Mac) that gathers its preferences in one place.>

<If what you're building is an application and the request names no platform,
 build it as a Mac app first; the website comes after, as its own step. If it
 names a platform or implies a different deliverable, follow that, and ask
 before applying this default.>

<Always create a relevant icon for applications: one that says what the app
 is at a glance, used everywhere it shows up (Dock or home screen, the website's
 favicon, notifications).>

<Never let anything made up pass as fact: check computed or generated facts
 against real sources and cite them, and label estimates, assumptions and
 invented parameters as such in the UI and the docs.>

<Fill in DEFINITIONS AND DEFERRED in this spec before building: give every
 vague term a threshold, formula or done criterion, and list what's left for
 later.>

<Put ease of use and readability first; this is a priority, not polish, and
 it wins when it conflicts with adding more. Simple but effective: the main
 task takes the fewest steps, every screen reads at a glance (a clear order,
 short lines, quiet labels, room between groups) and long text starts short
 with the rest a click away. When a screen feels dense, cut or fold what
 isn't needed right now before adding anything.>

<Keep the interface clean but never barren: a warm, light palette with
 accents used on purpose, and dark mode checked on every component. Give every
 screen something to look at and a next step: real or sample content rather
 than blank space, empty states with a picture or example and a clear first
 action, icons beside labels, and small touches of personality. Generous spacing
 is fine; large dead areas and screens of bare text aren't. When the visuals are
 open-ended, offer two or three mockups to pick from. Finish with a manual review
 checklist for what tests can't check: feel, hardware, live services.>

<Make it buttery smooth; this is a priority, not polish. Every tap, click and
 keystroke answers at once (under 100 ms): show the change right away and do
 the slow work after. Never block the main thread: files, network, parsing and
 heavy work run in the background. Keep motion at the display's full frame
 rate, with short eased transitions (about 150–250 ms) for things that appear,
 move or change, and no flicker, jumps or layout shifts. Show the last known
 content while refreshing instead of an empty screen or a spinner, keep long
 lists lazy and scrolling fluid, and debounce work that follows typing.
 Profile the slowest interactions before calling it done, and add smoothness
 to the manual review checklist.>

<Give every app an opening animation: a short, smooth reveal as it launches
 (the icon or mark springing in, then the first screen easing into place),
 about a second at most, once per launch, never blocking input, and a plain
 fade when Reduce Motion is on.>

<Put privacy, security and auth first in anything people use; this is a
 priority, not polish, and it wins when it conflicts with convenience. Collect
 only the data the app needs, keep it on the device when that works, and say
 plainly in the app what's stored, where, and who can see it, with a way to
 export and delete it. Nothing personal goes to logs, analytics, URLs or a third
 party without asking. Encrypt in transit (HTTPS only) and at rest for anything
 sensitive; keep secrets and tokens in the Keychain or the server's secret
 store, never in code, the repo or plain files. Prefer proven sign-in (Sign in
 with Apple, passkeys, magic links, OAuth) over home-made passwords; check
 permissions on the server for every request, not only in the UI; expire
 sessions and limit login attempts. Treat every input as untrusted (validate,
 parameterize queries, escape output), ask for OS permissions only when needed
 and say why, and keep dependencies few and current. Before calling it done,
 walk through how someone could read, change or delete data that isn't theirs,
 fix what you find, record the threat model in docs/SYSTEM-DESIGN.md, and add
 privacy and security to the manual review checklist.>

<Make equations easy to read. Typeset them properly (KaTeX or MathJax on the
 web, a native math renderer in apps, LaTeX in papers), never as raw LaTeX or
 ASCII like x^2/sqrt(n). Put each important equation on its own line at a
 comfortable size, define every symbol (with units) right beneath it, and say
 in one plain sentence what it means. Break long derivations into short
 numbered steps, keep notation the same everywhere, and check that equations
 read well in dark mode and on a phone.>

<Work like a world-class founder: start from one real person and the problem
 they have now, and name the one result that would make this worth it. Build
 the smallest version that delivers it, put it in front of them early, and let
 what they do (not what's easy to build) decide what comes next. Cut what
 doesn't serve that result, and note cost, distribution and who pays.>

<Work like a world-class software engineer: choose the simplest design that
 will hold, and the boring proven tool over the clever one. Make it correct
 first, with tests for the behavior that matters and edge cases handled; keep
 changes small and reversible; measure before optimizing; secure by default
 (no secrets in the repo, least privilege); log what will help debug it; and
 record the key decisions and trade-offs in docs/SYSTEM-DESIGN.md.>

<Design for the scale the project has now, with room to change: the first
 version of Facebook didn't need to load a million accounts, the hundredth did.
 Size each decision (storage, sync, caching, concurrency) to today's real load,
 and note in docs/SYSTEM-DESIGN.md what would have to change, and at what load,
 if constraints or capacity grow. Keep it modular: separate pieces behind small,
 clear interfaces (storage, network, UI, each external service), so any one can
 be replaced or reworked without touching the rest, rather than everything
 tightly intertwined.>

<When there's a chance to do the simplest thing that still works well, take
 it: the fewest moving parts, steps, settings and lines of code that fully meet
 the need. Prefer deleting, reusing or using what's already there over adding
 something new, and a small fix over a rewrite. Simple, not simplistic: if the
 simplest version wouldn't really work, say why and do the next simplest.>

<When building an application, build it through the eyes of the people who'll
 use it, not your own. Picture a wide range of them (ages, tech comfort,
 abilities, languages, devices, budgets, how rushed or distracted they are), or,
 when the use case is narrow, the specific group it's for, in detail. Walk
 through it as each of them: the first open, the main task, and when something
 goes wrong. Build for what they'd need and notice.>

<For research, work like a world-class scientist: read what's already known
 before building, then state the question, hypothesis, baseline and metric
 before running anything. Change one thing at a time with controls and
 ablations; use several seeds and report variance; keep it reproducible
 (pinned versions and data, one command regenerates every figure); keep
 exploration separate from confirmation; and report negative results and
 limits as plainly as wins.>

<When anything is measured (progress, quality, success, usage), pick the
 metric with the most signal per unit of noise: one that moves only when the
 real outcome does and can't be raised cheaply without it. Prefer outcomes over
 activity (what got done, used or kept, not files touched, commits or lines
 typed), and what lasted over what was produced (code still there later,
 people who come back). Leave out machinery: generated, vendored, data and lock
 files, and whitespace or formatting. Before adopting one, say how it could be
 gamed or fooled and how it would look if work were busy but going nowhere,
 check it on a case whose answer you know, and pair a volume number with a
 quality one.>

<Think ten steps ahead before starting. Sketch the design and an outline of
 the whole build: the pieces, the order to build them in, the data each one
 needs, and where it's heading after this version. Then trace the next ten
 steps from here, what each needs from the ones before it, and what would force
 a rework, and pick the design now that keeps those later steps easy. Put the
 outline in docs/SYSTEM-DESIGN.md before writing code, but build only what's
 in scope today.>

<Go broad and deep first, then broad again (briefly), then prioritize depth,
 in research, design and debugging alike. Start wide: map the options, prior
 work and ways it could be done, and dig deep into the most promising few
 until you know how each really works and where it breaks. Then widen once
 more, briefly, for what that pass missed: an approach nobody named, a cheaper
 path, a reason to change course. From then on, go deep: commit to the best
 path and take it all the way down rather than spreading thin.>

<Use sub-agents when they help. Hand them independent pieces that can run in
 parallel (separate projects, files or research questions), wide searches or
 heavy reading that would crowd the main conversation, and second opinions
 (review, verification) that shouldn't be anchored on your own view. Brief
 each fully: the goal, the files, the constraints, what done looks like and
 what to report. Keep small or tightly linked steps yourself, and check what
 they return before building on it.>

<Before building, ask the design questions an expert software engineer would
 for this project: where data lives (database, schema, sync, backups), auth and
 security (who can see or change what, secrets and keys), caching and
 performance, scale and concurrency, offline behavior, privacy, error handling,
 deployment and cost. Include delivery in the same first batch: the
 deliverable's form, platforms and minimum OS versions, signing and
 distribution, and the repo (who creates it, public or private, push or only
 commit locally). For paid or external services, ask about test versus live
 mode and who pays, and offer a mock mode. Ask for real sample inputs and
 working credentials before building. Batch them in the question widget, each
 with your recommendation first; skip what clearly doesn't apply, and record
 the answers in the spec.>

<When an application takes files as input, offer a visible Upload button that
 opens the file picker, accept files dragged anywhere onto the window (not
 only onto a small drop zone), and accept pasting them with ⌘V.>

<Color-code tags, categories and types by similarity: related ones share a
 hue family, with shades far enough apart to tell them apart at a glance, in
 both light and dark mode.>

<Name things the way a person would say them — "Goal Tracker", not
 goal_tracker — for the app, its windows, titles, files people open, repo
 descriptions and README headings. When you create the GitHub repo, name it
 with no "_" or "-": one word or joined words, e.g. GoalTracker.>

<Always in scope: a system design doc in the codebase, docs/SYSTEM-DESIGN.md,
 kept current as the build changes. Cover the architecture (with a Mermaid
 diagram), each component's job, the main flows, where data lives, the key
 design decisions and their trade-offs, how it's tested, and known limits.>

<Always in scope: a prompt log, docs/PROMPTS.md, kept current in every
 session. Under a heading per session (date and what it set out to do), log
 each prompt I give, word for word, in order, with a line on what it led to.
 Redact secrets, keys and personal data, and link it from the README.>

<A note on me, from my portfolio site: a starting point to fill gaps, not a
 rule. Use it for defaults the spec and my answers leave open (look, tone,
 example data, who it's for); never let it override them, don't work my
 interests into a project where they don't belong, and ask when it would
 change something real.
 - Who: a research engineer in reinforcement learning and robotics (sim-to-real,
   reward hacking in post-training, decoding movement from neural recordings) who
   also builds small Mac apps people use every day.
 - Values: high agency, ambition, deep curiosity, caring and courage. Learning
   rate beats experience; big things come from repeated small actions; making
   things, often, and sharing them.
 - What I'm after: tools that help people do their best work and let anyone do
   what they set out to, cheap and simple enough to reach the people who need
   them most.
 - Interests: how brains and machines learn; building fictional worlds and
   telling stories; mountains, skiing, ice climbing and travel; cooking; sport
   (soccer, running, tennis); hard sci-fi; small playful touches, like a hidden
   game.
 - Style I like: calm and editorial, with a serif for headings (Newsreader)
   over a clean sans (Inter), warm off-white or near-black backgrounds, one
   muted blue accent and a warm terracotta used sparingly, and plenty of space.
   Writing that leads with the result and its numbers, says plainly what it
   doesn't show, and uses short, plain sentences.>

<My taste profile: what I gravitate to, from how I've reacted to builds. Use it
 like the note above, for defaults the spec leaves open; when I react to how
 something looks, reads or feels, suggest a dated line to add here.
 - Colour: one muted accent, with colour only where it carries meaning. Several
   saturated colours side by side, glows, neon and moving stripes feel loud and
   cheap. Warm, calm palettes; dark mode that stays quiet.
 - Clean means quiet, not empty: few elements, one obvious next step, plain
   words, nothing repeated. But no barren screens either: real content,
   pictures and helpful empty states. Simple and intuitive over decorated.
 - Density: built for someone who knows what they're doing. Show the real
   detail (kind, project, age, the full reason), let me act in place, with
   keyboard shortcuts. Cut clutter, not information; never feel like it's
   talking down to me.
 - Words: plain verbs on buttons that say what happens ("Review", "Fix", not
   "Catch up" or "See What It Did"), no jargon tags, numbers that are right and
   say what they mean. A wrong or misleading number is worse than none.
 - Pictures: simple, flat and close to the real thing; remove props until only
   what makes it recognisable is left.
 - How I think: push back and make me think; show what a suggestion rests on and
   how to check it; teach the idea so I can do it myself next time; take the
   simplest thing that works; think several steps ahead.>

<Finish by listing every deliverable: path, what it is, how to check it works.>

<Git rules (no Claude attribution, never commit .claude/) are in
 ~/.claude/CLAUDE.md and apply on their own — nothing to repeat here.>

<Keep the changelog at the bottom current.>

<Before building, list the lessons from this spec that apply and how you will act on each. At the end, note which you followed.>

<When the project's kind is unclear, such as whether it is a tool or written content, ask before building.>

<Before building, settle the deliverable's form, target platforms and minimum versions, packaging and signing, and hosting. When the brief conflicts with standing defaults, ask which wins.>

<Before any paid API call, settle who pays, a spending cap, test versus live mode and where keys live, and keep a mock mode so the build runs without spending.>

<When the look, concept or UI direction is open, show two or three concrete mockups or concepts to pick from before building. Never redesign existing UI without asking.>

<Ask early for real sample inputs and working credentials, and check against the live API, model or tool as soon as one path works. When none exist, say so rather than inventing them silently.>

<Before building, write down done criteria with concrete thresholds or formulas for every vague term, plus a list of what is explicitly deferred, and confirm both with me.>

<Before building anything that judges, scores or generates content, decide with me whether an AI model or deterministic rules produce it, weighing cost, explainability and reproducibility, and which model is the default.>

INSTRUCTIONS:

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
