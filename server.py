#!/usr/bin/env python3
"""Local server for the music graph (standard library only).

    python3 server.py            # http://127.0.0.1:8765

Serves the web app, reads what the Spotify desktop app is playing (AppleScript),
proxies album art so the page can read its colors, plays song lists through
the desktop app with a small server-side queue (AppleScript can't queue songs),
and serves the audio files in your music folder to the DJ decks.
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.request
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
PORT = 8765
SEP = "\x1f"
PLAYABLE_URI = re.compile(r"^spotify:(track|playlist|album):[A-Za-z0-9]{22}$")
ARTWORK_URL = re.compile(r"^https://(i\.scdn\.co|mosaic\.scdn\.co|image-cdn-[a-z0-9-]+\.spotifycdn\.com)/image/[A-Za-z0-9]+$")
STATIC = {"/": "index.html", "/callback": "index.html"}
AUDIO_TYPES = {
    ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".wav": "audio/wav", ".aif": "audio/aiff",
    ".aiff": "audio/aiff", ".flac": "audio/flac", ".ogg": "audio/ogg", ".opus": "audio/ogg",
}
MAX_CRATE = 10_000
MAX_UPLOAD = 1_000_000_000          # a very large extended history is a few hundred MB
SAFE_UPLOAD = re.compile(r"^[A-Za-z0-9 ._-]{1,120}\.(zip|json)$")
STATIC_FILES = re.compile(r"^/([a-z]+\.(js|css|html)|data/(graph_data|history_index)\.json|config\.json)$")

NOW_PLAYING_SCRIPT = f'''
if application "Spotify" is not running then return "not_running"
tell application "Spotify"
  set s to player state as string
  if s is "stopped" then return s
  set t to current track
  return s & "{SEP}" & (name of t) & "{SEP}" & (artist of t) & "{SEP}" & (album of t) & "{SEP}" & (id of t) & "{SEP}" & (artwork url of t) & "{SEP}" & ((player position * 1000) as integer) & "{SEP}" & (duration of t)
end tell
'''


def osascript(script, timeout=4):
    r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=timeout)
    if r.returncode:
        raise RuntimeError(r.stderr.strip() or "osascript failed")
    return r.stdout.rstrip("\n")


def read_now_playing():
    try:
        out = osascript(NOW_PLAYING_SCRIPT)
    except Exception as e:
        return {"source": "desktop", "state": "error", "error": str(e)}
    if SEP not in out:
        return {"source": "desktop", "state": out}  # not_running / stopped
    state, track, artist, album, uri, art, pos, dur = (out.split(SEP) + [""] * 8)[:8]
    return {
        "source": "desktop", "state": state, "track": track, "artist": artist, "album": album,
        "track_uri": uri, "artwork_url": art or None,
        "position_ms": int(pos or 0), "duration_ms": int(float(dur or 0)),
    }


class NowPlayingCache:
    def __init__(self, ttl=0.5):
        self.ttl, self.lock, self.at, self.value = ttl, threading.Lock(), 0.0, None

    def get(self, fresh=False):
        with self.lock:
            if fresh or time.monotonic() - self.at > self.ttl:
                self.value, self.at = read_now_playing(), time.monotonic()
            return self.value


now_playing = NowPlayingCache()


class Player:
    """Plays a list of songs through the desktop app, starting the next one as each ends."""

    def __init__(self):
        self.lock = threading.Lock()
        self.queue, self.index, self.started_at, self.last_remaining = [], 0, 0.0, None
        threading.Thread(target=self._watch, daemon=True).start()

    def _play(self, uri):
        osascript(f'tell application "Spotify" to play track "{uri}"')
        self.started_at, self.last_remaining = time.monotonic(), None

    def play(self, uris):
        with self.lock:
            self.queue, self.index = list(uris), 0
            self._play(self.queue[0])
        return self._confirm(self.queue[0])

    def play_context(self, uri):
        self.stop()
        osascript(f'tell application "Spotify" to play track "{uri}"')
        return {"ok": True}

    def _confirm(self, uri):
        """Spotify ignores URIs it can't find (e.g. sample data), so check it actually switched."""
        for _ in range(8):
            time.sleep(0.25)
            np = now_playing.get(fresh=True)
            if np.get("track_uri") == uri:
                return {"ok": True, "started": True}
        with self.lock:
            self.queue = []
        return {"ok": False, "error": "Spotify didn't start that song. It may not exist (sample data songs are fictional)."}

    def next(self):
        with self.lock:
            if self.queue:
                self._advance()

    def stop(self):
        with self.lock:
            self.queue = []

    def status(self):
        with self.lock:
            return {"active": bool(self.queue), "index": self.index, "length": len(self.queue),
                    "uri": self.queue[self.index] if self.queue else None}

    def _advance(self):
        self.index += 1
        if self.index >= len(self.queue):
            self.queue = []
        else:
            self._play(self.queue[self.index])

    def _watch(self):
        while True:
            time.sleep(0.75)
            with self.lock:
                if not self.queue:
                    continue
                expected, settling = self.queue[self.index], time.monotonic() - self.started_at < 3
            np = now_playing.get(fresh=True)
            with self.lock:
                if not self.queue or self.queue[self.index] != expected:
                    continue
                if np.get("track_uri") == expected:
                    remaining = np.get("duration_ms", 0) - np.get("position_ms", 0)
                    self.last_remaining = remaining
                    if np.get("state") == "playing" and remaining < 1200:
                        self._advance()
                elif not settling:
                    if self.last_remaining is not None and self.last_remaining < 5000:
                        self._advance()          # song ended and Spotify moved on by itself
                    else:
                        self.queue = []          # listener picked something else; step aside


player = Player()


def spotlight(files, attribute):
    """One Spotlight attribute for many files (mdls prints one NUL-separated value per file, in order)."""
    values = []
    for i in range(0, len(files), 200):
        batch = [str(f) for f in files[i:i + 200]]
        try:
            out = subprocess.run(["mdls", "-raw", "-nullMarker", "", "-name", attribute, *batch],
                                 capture_output=True, text=True, timeout=30).stdout.split("\0")
        except Exception:
            out = []
        values += (out + [""] * len(batch))[:len(batch)]
    return values


def first_quoted(value):
    """mdls prints arrays like '(\n    "Artist"\n)'."""
    m = re.search(r'"((?:[^"\\]|\\.)*)"', value)
    if m:
        return m.group(1)
    return value.strip("() \n\t") if value.startswith("(") else value


def display_path(p):
    """Shorten a path for the UI so screenshots and screen shares don't leak a home directory."""
    home = Path.home()
    try:
        return "~/" + str(Path(p).relative_to(home))
    except ValueError:
        return str(p)


class Crate:
    """Audio files under the music folder. Files are only ever addressed by id, never by path."""

    def __init__(self, root):
        self.root, self.lock, self.tracks, self.paths = root, threading.Lock(), None, {}

    def list(self, refresh=False):
        with self.lock:
            if self.tracks is None or refresh:
                self._scan()
            return {"dir": display_path(self.root), "exists": self.root.is_dir(), "tracks": self.tracks, "truncated": len(self.tracks) >= MAX_CRATE}

    def _scan(self):
        files = []
        if self.root.is_dir():
            for dirpath, dirnames, filenames in os.walk(self.root):
                dirnames[:] = sorted(d for d in dirnames if not d.startswith(".") and not d.endswith((".app", ".photoslibrary", ".musiclibrary")))
                for name in sorted(filenames):
                    if not name.startswith(".") and Path(name).suffix.lower() in AUDIO_TYPES:
                        files.append(Path(dirpath) / name)
                if len(files) >= MAX_CRATE:
                    break
        files = files[:MAX_CRATE]
        titles, authors, albums, durations = (spotlight(files, a) for a in ("kMDItemTitle", "kMDItemAuthors", "kMDItemAlbum", "kMDItemDurationSeconds"))
        self.paths, self.tracks = {}, []
        for f, title, author, album, duration in zip(files, titles, authors, albums, durations):
            tid = hashlib.sha1(str(f).encode()).hexdigest()[:16]
            guess_artist, _, guess_title = f.stem.partition(" - ")
            if not guess_title:
                guess_artist, guess_title = "", f.stem
            self.paths[tid] = f
            self.tracks.append({
                "id": tid, "title": title or guess_title, "artist": first_quoted(author) or guess_artist,
                "album": album, "duration": round(float(duration), 1) if re.match(r"^[\d.]+$", duration or "") else None,
                "ext": f.suffix.lower().lstrip("."), "size": f.stat().st_size,
                "folder": str(f.parent.relative_to(self.root)) if f.parent != self.root else "",
            })

    def path(self, tid):
        with self.lock:
            return self.paths.get(tid)


class Importer:
    """Runs build_data.py on an uploaded export, so nobody has to open a terminal."""

    def __init__(self):
        self.lock = threading.Lock()
        self.state = "idle"       # idle | building | done | error
        self.lines = []
        self.source = ""
        self.started = 0.0

    def status(self):
        with self.lock:
            return {"state": self.state, "lines": list(self.lines), "source": self.source,
                    "seconds": round(time.time() - self.started, 1) if self.started else 0}

    def busy(self):
        with self.lock:
            return self.state == "building"

    def start(self, path):
        with self.lock:
            if self.state == "building":
                return False
            self.state, self.lines, self.source, self.started = "building", [], path.name, time.time()
        threading.Thread(target=self._run, args=(path,), daemon=True).start()
        return True

    def _say(self, line):
        with self.lock:
            self.lines.append(line)
            del self.lines[:-200]

    def _run(self, path):
        self._say(f"Reading {path.name}…")
        try:
            proc = subprocess.Popen(
                [python_for_build(), str(ROOT / "build_data.py"), "--src", str(path)],
                cwd=str(ROOT), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
            for line in proc.stdout:
                self._say(line.rstrip())
            code = proc.wait()
        except Exception as e:
            self._say(str(e))
            code = 1
        with self.lock:
            self.state = "done" if code == 0 else "error"


def python_for_build():
    """Prefer the project venv: build_data.py needs networkx, which the server does not."""
    venv = ROOT / ".venv" / "bin" / "python"
    return str(venv) if venv.exists() else sys.executable


importer = Importer()


crate = None


def write_config(body):
    """Save the few settings the page can change, so nobody has to hand-edit config.json."""
    path = ROOT / "config.json"
    try:
        config = json.loads(path.read_text())
        if not isinstance(config, dict):
            config = {}
    except (OSError, ValueError):
        config = {}
    if "client_id" in body:
        cid = str(body["client_id"]).strip()
        if cid and not re.fullmatch(r"[0-9a-f]{32}", cid):
            return {"ok": False, "error": "A Spotify Client ID is 32 characters, digits and a\u2013f."}
        if cid:
            config["client_id"] = cid
        else:
            config.pop("client_id", None)
    path.write_text(json.dumps(config, indent=2) + "\n")
    return {"ok": True, "client_id": bool(config.get("client_id"))}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        if not self.path.startswith(("/api/now-playing", "/api/queue")):
            super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _host_ok(self):  # blocks DNS-rebinding and cross-site requests
        host = self.headers.get("Host", "")
        origin = self.headers.get("Origin")
        allowed = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
        return host in allowed and (origin is None or urlparse(origin).netloc in allowed)

    def _json(self, obj, status=HTTPStatus.OK):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self._host_ok():
            return self.send_error(HTTPStatus.FORBIDDEN)
        url = urlparse(self.path)
        if url.path == "/api/now-playing":
            return self._json(now_playing.get())
        if url.path == "/api/queue":
            return self._json(player.status())
        if url.path == "/api/import":
            return self._json(importer.status())
        if url.path == "/api/crate":
            return self._json(crate.list(refresh=parse_qs(url.query).get("refresh") == ["1"]))
        if url.path == "/api/crate/file":
            return self._audio(parse_qs(url.query).get("id", [""])[0])
        if url.path == "/api/artwork":
            return self._artwork(parse_qs(url.query).get("url", [""])[0])
        if url.path == "/config.json" and not (ROOT / "config.json").exists():
            return self._json({})
        if url.path in STATIC:
            self.path = "/" + STATIC[url.path]
        elif not STATIC_FILES.match(url.path):
            return self.send_error(HTTPStatus.NOT_FOUND)
        return super().do_GET()

    def do_POST(self):
        upload = urlparse(self.path).path == "/api/import"
        if not self._host_ok():
            if upload:
                self._drain(int(self.headers.get("Content-Length") or 0))
            return self.send_error(HTTPStatus.FORBIDDEN)
        if upload:
            return self._import()
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            return self.send_error(HTTPStatus.FORBIDDEN)
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            path = urlparse(self.path).path
            if path == "/api/play":
                uris = body.get("uris") or []
                if not uris or len(uris) > 200 or not all(isinstance(u, str) and PLAYABLE_URI.match(u) for u in uris):
                    return self._json({"ok": False, "error": "invalid uris"}, HTTPStatus.BAD_REQUEST)
                return self._json(player.play(uris))
            if path == "/api/play-context":
                uri = body.get("uri", "")
                if not PLAYABLE_URI.match(uri):
                    return self._json({"ok": False, "error": "invalid uri"}, HTTPStatus.BAD_REQUEST)
                return self._json(player.play_context(uri))
            if path == "/api/queue/next":
                player.next()
                return self._json(player.status())
            if path == "/api/config":
                return self._json(write_config(body))
            if path == "/api/queue/stop":
                player.stop()
                return self._json(player.status())
        except Exception as e:
            return self._json({"ok": False, "error": str(e)}, HTTPStatus.INTERNAL_SERVER_ERROR)
        self.send_error(HTTPStatus.NOT_FOUND)

    def _drain(self, size):
        """Read and discard a rejected upload, so the client sees the refusal rather than a reset."""
        left = min(size, MAX_UPLOAD)
        while left > 0:
            chunk = self.rfile.read(min(1 << 20, left))
            if not chunk:
                return
            left -= len(chunk)

    def _import(self):
        name = (self.headers.get("X-Filename") or "").strip()
        size = int(self.headers.get("Content-Length") or 0)
        def refuse(message, status=HTTPStatus.BAD_REQUEST):
            self._drain(size)   # answering before reading the body only gets the client a reset
            return self._json({"ok": False, "error": message}, status)

        if not SAFE_UPLOAD.match(name):
            return refuse("Needs to be the .zip Spotify sent you, or a .json from inside it.")
        if size <= 0:
            return refuse("That file is empty.")
        if size > MAX_UPLOAD:
            return refuse(f"File is {size / 1e6:.0f} MB; the limit is {MAX_UPLOAD / 1e6:.0f} MB.")
        if importer.busy():
            return refuse("An import is already running.", HTTPStatus.CONFLICT)
        raw = ROOT / "data" / "raw"
        raw.mkdir(parents=True, exist_ok=True)
        path = raw / name                       # name is a bare filename, checked against SAFE_UPLOAD
        try:
            with path.open("wb") as f:
                left = size
                while left > 0:
                    chunk = self.rfile.read(min(1 << 20, left))
                    if not chunk:
                        raise OSError("upload ended early")
                    f.write(chunk)
                    left -= len(chunk)
        except Exception as e:
            path.unlink(missing_ok=True)
            return self._json({"ok": False, "error": str(e)}, HTTPStatus.INTERNAL_SERVER_ERROR)
        importer.start(path)
        return self._json({"ok": True, "name": name})

    def _audio(self, tid):
        path = crate.path(tid)
        if not path or not path.is_file():
            return self.send_error(HTTPStatus.NOT_FOUND)
        size = path.stat().st_size
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", AUDIO_TYPES.get(path.suffix.lower(), "application/octet-stream"))
        self.send_header("Content-Length", str(size))
        self.end_headers()
        with path.open("rb") as f:
            while chunk := f.read(1 << 20):
                self.wfile.write(chunk)

    _art_cache, _art_lock = {}, threading.Lock()

    def _artwork(self, url):
        if not ARTWORK_URL.match(url):
            return self.send_error(HTTPStatus.BAD_REQUEST)
        with self._art_lock:
            cached = self._art_cache.get(url)
        if not cached:
            try:
                with urllib.request.urlopen(url, timeout=6) as r:
                    cached = (r.headers.get("Content-Type", "image/jpeg"), r.read(5_000_000))
            except Exception:
                return self.send_error(HTTPStatus.BAD_GATEWAY)
            with self._art_lock:
                if len(self._art_cache) > 30:
                    self._art_cache.clear()
                self._art_cache[url] = cached
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", cached[0])
        self.send_header("Content-Length", str(len(cached[1])))
        self.end_headers()
        self.wfile.write(cached[1])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--open", action="store_true", help="open the page in your browser")
    ap.add_argument("--music-dir", type=Path, help="folder of audio files for the DJ crate (default: music_dir in config.json, else ~/Music)")
    args = ap.parse_args()
    global crate
    config = {}
    try:
        config = json.loads((ROOT / "config.json").read_text())
    except (OSError, ValueError):
        pass
    music_dir = args.music_dir or Path(os.path.expanduser(config.get("music_dir") or "~/Music"))
    crate = Crate(music_dir.resolve())
    if not (ROOT / "data" / "graph_data.json").exists():
        print("data/graph_data.json is missing: run build_data.py first (or build_data.py --sample)")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    url = f"http://127.0.0.1:{args.port}"
    print(f"Music graph running at {url}  (Ctrl+C to stop)")
    print(f"DJ crate folder: {crate.root}")
    if args.open:
        subprocess.run(["open", url])
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
