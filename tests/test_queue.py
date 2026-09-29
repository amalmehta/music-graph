"""Simulated test of the server-side play queue. Spotify is faked, so nothing plays.

    python3 tests/test_queue.py .
"""
import re, sys, time
sys.path.insert(0, sys.argv[1])
import server as S

URIS = ["spotify:track:" + c * 22 for c in "ABC"]
now = {"uri": None, "pos": 0, "dur": 10_000, "state": "playing"}
plays = []

def fake_osascript(script, timeout=4):
    m = re.search(r'play track "([^"]+)"', script)
    if m:
        plays.append(m.group(1))
        now.update(uri=m.group(1), pos=0, state="playing")
    return ""

S.osascript = fake_osascript
S.read_now_playing = lambda: {
    "source": "desktop", "state": now["state"], "track": "t", "artist": "a", "album": "",
    "track_uri": now["uri"], "artwork_url": None, "position_ms": now["pos"], "duration_ms": now["dur"],
}
S.now_playing = S.NowPlayingCache(ttl=0)

def wait_for(check, label, timeout=6):
    end = time.time() + timeout
    while time.time() < end:
        if check():
            return True
        time.sleep(0.2)
    print(f"FAIL: {label}")
    return False

ok = True
result = S.player.play(URIS)
ok &= result.get("ok") is True and plays == [URIS[0]]
print(f"start queue: played {plays} -> {result}")

now["pos"] = now["dur"] - 400                      # first song reaches its end
ok &= wait_for(lambda: plays[-1] == URIS[1], "advance to song 2")
print(f"after song 1 ends: {plays}")

now["pos"] = now["dur"] - 300                       # song 2 runs to its end...
time.sleep(1.2)
now.update(uri="spotify:track:" + "Z" * 22, pos=0)  # ...and Spotify auto-plays something else
ok &= wait_for(lambda: plays[-1] == URIS[2], "advance to song 3 after Spotify moved on")
print(f"after Spotify jumped elsewhere: {plays}")

now.update(uri="spotify:track:" + "Y" * 22, pos=2_000)  # listener picks a different track mid-song
ok &= wait_for(lambda: S.player.status()["active"] is False, "queue steps aside")
print(f"after a manual track change: queue active = {S.player.status()['active']}")

S.player.stop()
print("PASS" if ok else "FAILED")
sys.exit(0 if ok else 1)
