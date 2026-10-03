"""Test importing an export over HTTP: what the upload refuses, and a real build end to end.

    python3 tests/test_import.py .

Runs the server against a throwaway copy of the project, so your own data/ is untouched.
"""
import json, os, shutil, subprocess, sys, tempfile, time, urllib.error, urllib.request, zipfile
from http.server import ThreadingHTTPServer
from pathlib import Path

SRC = Path(sys.argv[1]).resolve()
ok = True


def check(label, got, want=True):
    global ok
    good = got == want
    ok &= good
    print(f"{'ok  ' if good else 'FAIL'} {label}" + ("" if good else f"  (got {got!r}, wanted {want!r})"))


# A throwaway copy, so the build writes its data/ and not yours.
work = Path(tempfile.mkdtemp(prefix="music-graph-import-"))
for name in ("server.py", "build_data.py"):
    shutil.copy(SRC / name, work / name)
(work / "data").mkdir()
if (SRC / ".venv").is_dir():
    os.symlink(SRC / ".venv", work / ".venv")

sys.path.insert(0, str(work))
import server as S

# An export-shaped zip built from the sample files, which are in Spotify's own format.
sample = SRC / "data" / "sample"
if not sample.is_dir():
    sys.exit("run make_sample_data.py first: tests/test_import.py needs data/sample")
export = work / "my_spotify_data.zip"
with zipfile.ZipFile(export, "w", zipfile.ZIP_DEFLATED) as z:
    for p in sorted(sample.rglob("*.json")):
        z.write(p, p.relative_to(sample))

httpd = ThreadingHTTPServer(("127.0.0.1", 0), S.Handler)
port = httpd.server_address[1]
S.crate = S.Crate(work)
import threading
threading.Thread(target=httpd.serve_forever, daemon=True).start()


def post(path, body, name=None, origin=None):
    headers = {"Content-Type": "application/octet-stream" if name else "application/json"}
    if name is not None:
        headers["X-Filename"] = name
    if origin:
        headers["Origin"] = origin
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", body, headers, method="POST")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.load(e)
        except Exception:
            return e.code, {}


blob = export.read_bytes()

# --- what the upload refuses ---
check("a path outside data/raw is refused", post("/api/import", blob, "../../evil.zip")[0], 400)
check("a non-export extension is refused", post("/api/import", blob, "notes.txt")[0], 400)
check("an empty body is refused", post("/api/import", b"", "my_spotify_data.zip")[0], 400)
check("a cross-site upload is refused", post("/api/import", blob, "my_spotify_data.zip", origin="https://evil.example")[0], 403)
check("nothing was written to data/raw", sorted(p.name for p in (work / "data" / "raw").glob("*")) if (work / "data" / "raw").is_dir() else [], [])

# --- the real thing ---
status, body = post("/api/import", blob, "my_spotify_data.zip")
check("the export uploads", (status, body.get("ok")), (200, True))

state = {}
for _ in range(120):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/import") as r:
        state = json.load(r)
    if state["state"] != "building":
        break
    time.sleep(1)
check("the build finishes", state.get("state"), "done")
check("the build log comes back", any("wrote data/graph_data.json" in line for line in state.get("lines", [])))

graph = work / "data" / "graph_data.json"
check("graph_data.json is written", graph.is_file())
if graph.is_file():
    meta = json.loads(graph.read_text())["meta"]
    check("it is not marked as sample data", meta.get("sample"), False)
    check("it records what it was built from", meta.get("source"), "my_spotify_data.zip")

# --- the Client ID field ---
check("a malformed Client ID is refused", post("/api/config", json.dumps({"client_id": "nope"}).encode())[1].get("ok"), False)
check("a valid Client ID is saved", post("/api/config", json.dumps({"client_id": "0" * 32}).encode())[1].get("client_id"), True)
check("config.json holds it", json.loads((work / "config.json").read_text()).get("client_id"), "0" * 32)
check("an empty Client ID clears it", post("/api/config", json.dumps({"client_id": ""}).encode())[1].get("client_id"), False)
check("config.json no longer holds it", "client_id" in json.loads((work / "config.json").read_text()), False)

httpd.shutdown()
shutil.rmtree(work, ignore_errors=True)
print("PASS" if ok else "FAILED")
sys.exit(0 if ok else 1)
