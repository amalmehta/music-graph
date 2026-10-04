#!/usr/bin/env python3
"""Turn a Spotify streaming history export into the JSON files the web app reads.

    .venv/bin/python build_data.py            # reads data/raw/ (your export)
    .venv/bin/python build_data.py --sample   # reads data/sample/ (fake data)

Writes data/graph_data.json (views + vibes) and data/history_index.json
(per-track / per-artist history for Now Playing and recommendations).
"""
import argparse
import json
import math
import os
import re
import sys
import unicodedata
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import networkx as nx
import numpy as np

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"

MIN_MS = 30_000                      # Spotify counts a stream after 30s
SESSION_GAP = timedelta(minutes=30)  # a longer pause starts a new session
TOP_ARTISTS = 300                    # artists placed on the vibes map / network
MAX_SESSION_ARTISTS = 50             # ignore pairs from huge all-day shuffle sessions
MAX_VIBES = 10
EDGES_PER_NODE = 6

TIME_BUCKETS = [  # (label, hours)
    ("late night", range(0, 5)),
    ("early morning", range(5, 9)),
    ("morning", range(9, 12)),
    ("afternoon", range(12, 17)),
    ("evening", range(17, 21)),
    ("night", range(21, 24)),
]


def local_tz():
    """This Mac's IANA time zone (DST-aware), falling back to the current offset."""
    if os.environ.get("TZ"):
        try:
            return ZoneInfo(os.environ["TZ"])
        except Exception:
            pass
    try:
        return ZoneInfo(os.path.realpath("/etc/localtime").split("zoneinfo/", 1)[1])
    except Exception:
        return datetime.now().astimezone().tzinfo


def norm(s):
    """Loose matching key. Mirrored exactly by normKey() in util.js."""
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    s = re.sub(r"\s*[(\[].*?[)\]]", "", s)   # (feat. X), [Remastered]
    s = re.sub(r"\s+-\s+.*$", "", s)         # " - Remastered 2011"
    s = "".join(c if unicodedata.category(c)[0] in "LN" or unicodedata.category(c) == "Mc" else " " for c in s)
    return " ".join(s.split())


def track_key(track, artist):
    return norm(track) + "|" + norm(artist)


@dataclass(slots=True)
class Play:
    end: datetime
    ms: int
    track: str
    artist: str
    album: str
    uri: str | None
    reason_end: str | None
    skipped: bool


def is_history_file(name):
    return name.startswith("Streaming_History_Audio") or re.match(r"StreamingHistory(_music_)?\d+\.json$", name)


def iter_rows(src: Path):
    paths = [src] if src.is_file() else sorted(src.rglob("*"))
    for p in paths:
        if p.suffix.lower() == ".zip":
            with zipfile.ZipFile(p) as z:
                for name in sorted(z.namelist()):
                    if name.endswith(".json") and is_history_file(Path(name).name):
                        yield from json.loads(z.read(name))
        elif p.suffix.lower() == ".json" and is_history_file(p.name):
            yield from json.loads(p.read_text("utf-8"))


def display_path(p):
    """Shorten a path for messages, which end up on screen and in the import log."""
    try:
        return "~/" + str(Path(p).relative_to(Path.home()))
    except ValueError:
        return str(p)


def parse_row(r):
    if "ts" in r:  # Extended streaming history
        if r.get("episode_name") or r.get("spotify_episode_uri") or r.get("audiobook_title") or r.get("audiobook_uri"):
            return None
        track, artist = r.get("master_metadata_track_name"), r.get("master_metadata_album_artist_name")
        if not track or not artist:
            return None
        return Play(
            datetime.fromisoformat(r["ts"].replace("Z", "+00:00")), int(r.get("ms_played") or 0),
            track, artist, r.get("master_metadata_album_album_name") or "", r.get("spotify_track_uri"),
            r.get("reason_end"), bool(r.get("skipped")),
        )
    if "endTime" in r:  # Account data (last year only, no URIs)
        track, artist = r.get("trackName"), r.get("artistName")
        if not track or not artist or artist == "Unknown Artist":
            return None
        end = datetime.strptime(r["endTime"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
        return Play(end, int(r.get("msPlayed") or 0), track, artist, "", None, None, False)
    return None


def load_plays(src):
    seen, plays = set(), []
    for r in iter_rows(src):
        p = parse_row(r)
        if p is None:
            continue
        ident = (p.end, p.ms, p.uri or p.track)  # the zip and its unzipped folder may both be present
        if ident not in seen:
            seen.add(ident)
            plays.append(p)
    plays.sort(key=lambda p: p.end)
    return plays


class Months:
    def __init__(self, first, last):
        self.y0, self.m0 = first.year, first.month
        self.count = self.index(last) + 1

    def index(self, dt):
        return (dt.year - self.y0) * 12 + dt.month - self.m0

    def labels(self):
        return [f"{self.y0 + (self.m0 - 1 + i) // 12}-{(self.m0 - 1 + i) % 12 + 1:02d}" for i in range(self.count)]


def dominant_name(counter):
    return counter.most_common(1)[0][0]


def layout(G, members, n):
    """2D positions in [0, 1]: vibes spread apart by how linked they are, artists spread within their vibe."""
    V = len(members)
    if n == 0:
        return np.zeros((0, 2))
    vibe_of = {i: v for v, mem in enumerate(members) for i in mem}
    VG = nx.Graph()
    VG.add_nodes_from(range(V))
    for i, j, d in G.edges(data=True):
        a, b = vibe_of[i], vibe_of[j]
        if a != b:
            VG.add_edge(a, b, weight=VG.get_edge_data(a, b, {"weight": 0})["weight"] + d["weight"])
    base = max((d["weight"] for _, _, d in VG.edges(data=True)), default=1.0) * 0.05
    for a in range(V):
        for b in range(a + 1, V):  # keeps unconnected vibes on the same canvas instead of flung to the edges
            VG.add_edge(a, b, weight=VG.get_edge_data(a, b, {"weight": 0})["weight"] + base)
    if V == 1:
        centers = np.zeros((1, 2))
    else:
        cpos = nx.spring_layout(VG, weight="weight", seed=42, k=2.6 / math.sqrt(V), iterations=200)
        centers = np.array([cpos[v] for v in range(V)])
    gaps = [np.linalg.norm(centers[a] - centers[b]) for a in range(V) for b in range(a + 1, V)]
    spacing = min(gaps) if gaps else 1.0
    biggest = max(len(m) for m in members)

    xy = np.zeros((n, 2))
    for v, mem in enumerate(members):
        radius = 0.38 * spacing * math.sqrt(len(mem) / biggest) if V > 1 else 1.0   # smaller islands = wider water between them
        sub = G.subgraph(mem)
        local = nx.spring_layout(sub, weight="weight", seed=42, iterations=200) if len(mem) > 1 else {mem[0]: np.zeros(2)}
        pts = np.array([local[i] for i in mem], dtype=float)
        pts -= pts.mean(axis=0)
        scale = np.percentile(np.linalg.norm(pts, axis=1), 90) if len(mem) > 2 else 1.0
        pts = np.clip(pts / max(scale, 1e-9), -1.3, 1.3)
        for i, pt in zip(mem, pts):
            xy[i] = centers[v] + pt * radius
    lo, hi = xy.min(axis=0), xy.max(axis=0)
    span = max(hi - lo)
    return (xy - lo) / max(span, 1e-9) + (1 - (hi - lo) / max(span, 1e-9)) / 2


def network_layout(G, n):
    """Force layout of the co-listening graph, precomputed so the page doesn't have to run physics."""
    if n == 0:
        return np.zeros((0, 2))
    pos = nx.spring_layout(G, weight="weight", seed=42, iterations=250, k=6.5 / math.sqrt(max(n, 2)))
    xy = np.array([pos[i] for i in range(n)])
    lo, hi = xy.min(axis=0), xy.max(axis=0)
    span = max(hi - lo)
    return (xy - lo) / max(span, 1e-9) + (1 - (hi - lo) / max(span, 1e-9)) / 2


def build(src, sample):
    tz = local_tz()
    plays = load_plays(src)
    if not plays:
        sys.exit(f"No streaming history found in {display_path(src)}")

    # Skips come from all attempts; everything else only counts plays of 30s+.
    attempts, skips = Counter(), Counter()
    kept = []
    for p in plays:
        k = track_key(p.track, p.artist)
        attempts[k] += 1
        if p.skipped or p.reason_end in ("fwdbtn", "backbtn"):
            skips[k] += 1
        if p.ms >= MIN_MS:
            kept.append(p)
    if not kept:
        sys.exit("No plays of 30s or longer found")

    for p in kept:
        p.end = p.end.astimezone(tz)
    kept.sort(key=lambda p: p.end)
    months = Months(kept[0].end - timedelta(milliseconds=kept[0].ms), kept[-1].end)
    M = months.count

    artist_names = defaultdict(Counter)
    artists = defaultdict(lambda: {
        "minutes": 0.0, "plays": 0, "monthly": [0.0] * M, "hours": [0.0] * 24, "dow": [0.0] * 7,
        "first": None, "last": None, "tracks": Counter(),
    })
    track_names, track_artist, track_album = defaultdict(Counter), {}, defaultdict(Counter)
    tracks = defaultdict(lambda: {"plays": 0, "ms": 0, "first": None, "last": None, "monthly": Counter(), "uris": Counter()})
    total_minutes, total_plays = [0.0] * M, [0] * M
    overall_hours, overall_dow = [0.0] * 24, [0.0] * 7
    first_day = (kept[0].end - timedelta(milliseconds=kept[0].ms)).date()
    day_count = (kept[-1].end.date() - first_day).days + 1
    day_minutes = [0.0] * day_count
    month_hour_dow = [[0.0] * 168 for _ in range(M)]  # per month: weekday * 24 + hour
    sessions, current, session_end = [], set(), None

    for p in kept:
        start = p.end - timedelta(milliseconds=p.ms)
        mi, minutes = months.index(start), p.ms / 60000
        ak, tk = norm(p.artist), track_key(p.track, p.artist)

        if session_end is None or start - session_end > SESSION_GAP:
            if current:
                sessions.append(current)
            current = set()
        current.add(ak)
        session_end = max(session_end, p.end) if session_end and start - session_end <= SESSION_GAP else p.end

        artist_names[ak][p.artist] += 1
        a = artists[ak]
        a["minutes"] += minutes
        a["plays"] += 1
        a["monthly"][mi] += minutes
        a["hours"][start.hour] += minutes
        a["dow"][start.weekday()] += minutes
        a["first"] = a["first"] or start
        a["last"] = p.end
        a["tracks"][tk] += 1

        track_names[tk][p.track] += 1
        track_album[tk][p.album] += 1
        track_artist[tk] = ak
        t = tracks[tk]
        t["plays"] += 1
        t["ms"] += p.ms
        t["first"] = t["first"] or start
        t["last"] = p.end
        t["monthly"][mi] += 1
        if p.uri:
            t["uris"][p.uri] += 1

        total_minutes[mi] += minutes
        total_plays[mi] += 1
        overall_hours[start.hour] += minutes
        overall_dow[start.weekday()] += minutes
        day = (start.date() - first_day).days
        if 0 <= day < day_count:
            day_minutes[day] += minutes
        month_hour_dow[mi][start.weekday() * 24 + start.hour] += minutes
    if current:
        sessions.append(current)

    # ---- Vibes: co-listening graph of top artists -> Louvain communities ----
    top = [k for k, a in sorted(artists.items(), key=lambda kv: -kv[1]["minutes"]) if a["plays"] >= 3][:TOP_ARTISTS]
    top_index = {k: i for i, k in enumerate(top)}
    n_sessions, n_artist, n_pair = 0, Counter(), Counter()
    for s in sessions:
        present = sorted(top_index[a] for a in s if a in top_index)
        if not present:
            continue
        n_sessions += 1
        n_artist.update(present)
        if len(present) <= MAX_SESSION_ARTISTS:
            for x in range(len(present)):
                for y in range(x + 1, len(present)):
                    n_pair[(present[x], present[y])] += 1

    min_pair = 3 if n_sessions > 2000 else 2
    G = nx.Graph()
    G.add_nodes_from(range(len(top)))
    for (i, j), n in n_pair.items():
        if n < min_pair:
            continue
        pmi = math.log(n * n_sessions / (n_artist[i] * n_artist[j]))
        if pmi > 0:
            G.add_edge(i, j, weight=pmi * math.log1p(n), count=n)

    min_size = max(3, len(top) // 100)
    for resolution in (1.0, 1.3, 1.7, 2.2):  # dense taste graphs can collapse into 2 blobs; split further if so
        communities = [set(c) for c in nx.community.louvain_communities(G, weight="weight", resolution=resolution, seed=42)]
        communities.sort(key=lambda c: -sum(artists[top[i]]["minutes"] for i in c))
        big = [c for c in communities if len(c) >= min_size][:MAX_VIBES] or [set(range(len(top)))]
        if len(big) >= 4:
            break
    vibe_of = {i: v for v, c in enumerate(big) for i in c}

    def hour_profile(idx):
        h = np.array([artists[top[i]]["hours"] for i in idx]).sum(axis=0) + 1e-9
        return h / h.sum()

    profiles = [hour_profile(c) for c in big]
    for i in range(len(top)):  # small communities and isolates join their best-connected (or most time-similar) vibe
        if i in vibe_of:
            continue
        links = Counter()
        for j, d in G[i].items():
            if j in vibe_of:
                links[vibe_of[j]] += d["weight"]
        if links:
            vibe_of[i] = links.most_common(1)[0][0]
        else:
            h = hour_profile([i])
            vibe_of[i] = int(np.argmax([h @ prof for prof in profiles]))
    members = [[i for i in range(len(top)) if vibe_of[i] == v] for v in range(len(big))]

    # Non-top artists inherit the vibe they're most often played alongside.
    other_votes = defaultdict(Counter)
    for s in sessions:
        vibes_here = Counter(vibe_of[top_index[a]] for a in s if a in top_index)
        if not vibes_here:
            continue
        for a in s:
            if a not in top_index:
                other_votes[a].update(vibes_here)
    artist_vibe = {k: vibe_of[i] for k, i in top_index.items()}
    for a, votes in other_votes.items():
        if sum(votes.values()) >= 2:
            artist_vibe[a] = votes.most_common(1)[0][0]

    # ---- Layout: place vibes relative to each other, then lay out artists inside each vibe ----
    weights = [d["weight"] for _, _, d in G.edges(data=True)]
    xy = layout(G, members, len(top))
    net_xy = network_layout(G, len(top))

    # ---- Vibe names: when they get played, relative to overall listening ----
    oh = np.array(overall_hours) / max(sum(overall_hours), 1e-9)
    od = np.array(overall_dow) / max(sum(overall_dow), 1e-9)
    vibes, used = [], Counter()
    for v, mem in enumerate(members):
        hours = np.array([artists[top[i]]["hours"] for i in mem]).sum(axis=0)
        dow = np.array([artists[top[i]]["dow"] for i in mem]).sum(axis=0)
        monthly = np.array([artists[top[i]]["monthly"] for i in mem]).sum(axis=0)
        hs, ds = hours / max(hours.sum(), 1e-9), dow / max(dow.sum(), 1e-9)
        lifts = [(hs[list(r)].sum() / max(oh[list(r)].sum(), 1e-9), label) for label, r in TIME_BUCKETS if hs[list(r)].sum() >= 0.12]
        when = max(lifts)[1] if lifts else "all day"
        weekend_lift = ds[5:].sum() / max(od[5:].sum(), 1e-9)
        days = "weekends" if weekend_lift > 1.25 else "weekdays" if weekend_lift < 0.8 else "any day"
        ranked = sorted(mem, key=lambda i: -artists[top[i]]["minutes"])
        name = f"{when.capitalize()} · {days}"
        used[name] += 1
        if used[name] > 1:
            name = f"{name} ({dominant_name(artist_names[top[ranked[0]]])})"
        years = Counter()
        for mi, m in enumerate(monthly):
            years[months.y0 + (months.m0 - 1 + mi) // 12] += m
        vibe_tracks = Counter()
        for i in mem:
            vibe_tracks.update(artists[top[i]]["tracks"])
        vibes.append({
            "id": v, "name": name, "when": when, "days": days,
            "peakYear": years.most_common(1)[0][0] if years else None,
            "minutes": round(float(monthly.sum())),
            "artists": ranked,
            "hours": [round(float(x)) for x in hours], "dow": [round(float(x)) for x in dow],
            "monthly": [round(float(x)) for x in monthly],
            "topTracks": [[dominant_name(track_names[k]), dominant_name(artist_names[track_artist[k]]), n] for k, n in vibe_tracks.most_common(8)],
        })

    # ---- Edges for the network (each node keeps its strongest links) ----
    keep = set()
    for i in G.nodes:
        for j, _ in sorted(G[i].items(), key=lambda kv: -kv[1]["weight"])[:EDGES_PER_NODE]:
            keep.add((min(i, j), max(i, j)))
    w_max = max(weights) if weights else 1.0
    edges = [[i, j, round(G[i][j]["weight"] / w_max, 3), G[i][j]["count"]] for i, j in sorted(keep)]

    # ---- Bridges: the co-listening links that tie two vibes together ----
    pair_weight, pair_sessions, pair_links = defaultdict(float), defaultdict(int), defaultdict(list)
    cross_weight, all_weight = [0.0] * len(top), [0.0] * len(top)
    for i, j, d in G.edges(data=True):
        all_weight[i] += d["weight"]
        all_weight[j] += d["weight"]
        if vibe_of[i] == vibe_of[j]:
            continue
        cross_weight[i] += d["weight"]
        cross_weight[j] += d["weight"]
        key = (min(vibe_of[i], vibe_of[j]), max(vibe_of[i], vibe_of[j]))
        pair_weight[key] += d["weight"]
        pair_sessions[key] += d["count"]
        pair_links[key].append((round(d["weight"], 3), d["count"], i, j))
    # Why a pair meets: walk the plays again and watch the moments the vibe changes mid-session.
    pair_hours = defaultdict(lambda: [0] * 24)
    pair_monthly = defaultdict(lambda: [0] * M)
    pair_direction = defaultdict(lambda: [0, 0])   # [a->b, b->a]
    pair_gateways = defaultdict(Counter)
    switch_days = [0] * day_count
    prev_vibe, prev_end = None, None
    for p in kept:
        start = p.end - timedelta(milliseconds=p.ms)
        vibe = artist_vibe.get(norm(p.artist), -1)
        same_session = prev_end is not None and start - prev_end <= SESSION_GAP
        if same_session and vibe >= 0 and prev_vibe is not None and prev_vibe >= 0 and vibe != prev_vibe:
            key = (min(prev_vibe, vibe), max(prev_vibe, vibe))
            pair_hours[key][start.hour] += 1
            pair_monthly[key][months.index(start)] += 1
            pair_direction[key][0 if prev_vibe == key[0] else 1] += 1
            pair_gateways[key][track_key(p.track, p.artist)] += 1   # the song you cross over on
            day = (start.date() - first_day).days
            if 0 <= day < day_count:
                switch_days[day] += 1
        prev_vibe, prev_end = vibe, p.end if not same_session else max(prev_end, p.end)

    w_bridge = max(pair_weight.values(), default=1.0)
    bridges = [
        {
            "a": a, "b": b, "w": round(w / w_bridge, 3), "sessions": pair_sessions[(a, b)],
            "links": [[i, j, wt, c] for wt, c, i, j in sorted(pair_links[(a, b)], reverse=True)[:5]],
            "switches": sum(pair_direction[(a, b)]),
            "hours": pair_hours[(a, b)],
            "monthly": pair_monthly[(a, b)],
            "direction": pair_direction[(a, b)],
            "gateways": [
                [dominant_name(track_names[k]), dominant_name(artist_names[track_artist[k]]), n]
                for k, n in pair_gateways[(a, b)].most_common(3)
            ],
        }
        for (a, b), w in sorted(pair_weight.items(), key=lambda kv: -kv[1])
    ]

    # the per-node top-k pruning drops cross-vibe links, so put the bridges back
    have = {(min(i, j), max(i, j)) for i, j, *_ in edges}
    for bridge in bridges:
        if bridge["w"] < 0.05:      # trivial overlaps stay out of the picture
            continue
        for i, j, wt, c in bridge["links"]:
            if (min(i, j), max(i, j)) not in have:
                edges.append([i, j, round(wt / w_max, 3), c])
                have.add((min(i, j), max(i, j)))

    date = lambda d: d.strftime("%Y-%m-%d")
    graph = {
        "meta": {
            "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "sample": sample,
            "source": src.name,
            "timezone": str(tz), "first": date(kept[0].end), "last": date(kept[-1].end), "months": months.labels(),
        },
        "stats": {
            "minutes": round(sum(total_minutes)), "plays": len(kept), "artists": len(artists), "tracks": len(tracks),
            "sessions": len(sessions),
        },
        "totals": {"minutes": [round(m) for m in total_minutes], "plays": total_plays},
        "overall": {"hours": [round(h) for h in overall_hours], "dow": [round(d) for d in overall_dow]},
        "habits": {
            "firstDay": first_day.isoformat(),
            "dayMinutes": [round(m) for m in day_minutes],
            "switchDays": switch_days,
            "monthHourDow": [[round(v) for v in month] for month in month_hour_dow],
        },
        "vibes": vibes,
        "artists": [
            {
                "id": i, "name": dominant_name(artist_names[k]), "vibe": vibe_of[i],
                "x": round(float(xy[i][0]), 4), "y": round(float(xy[i][1]), 4),
                "nx": round(float(net_xy[i][0]), 4), "ny": round(float(net_xy[i][1]), 4),
                "cross": round(cross_weight[i] / all_weight[i], 2) if all_weight[i] else 0,
                "minutes": round(artists[k]["minutes"]), "plays": artists[k]["plays"],
                "monthly": [round(m) for m in artists[k]["monthly"]],
                "first": date(artists[k]["first"]), "last": date(artists[k]["last"]),
                "topTracks": [[dominant_name(track_names[t]), n] for t, n in artists[k]["tracks"].most_common(5)],
            }
            for i, k in enumerate(top)
        ],
        "edges": edges,
        "bridges": bridges,
    }

    def sparse(counter_or_list):
        items = enumerate(counter_or_list) if isinstance(counter_or_list, list) else sorted(counter_or_list.items())
        flat = []
        for mi, v in items:
            if v:
                flat += [mi, round(v, 1) if isinstance(v, float) else v]
        return flat

    history = {
        "months": months.labels(),
        "ref": date(kept[-1].end),
        "tracks": [
            {
                "k": k, "u": [u for u, _ in t["uris"].most_common()], "n": dominant_name(track_names[k]),
                "a": dominant_name(artist_names[track_artist[k]]), "al": dominant_name(track_album[k]),
                "p": t["plays"], "m": round(t["ms"] / 60000, 1),
                "c": round((attempts[k] - skips[k] + 1) / (attempts[k] + 1), 2),
                "f": date(t["first"]), "l": date(t["last"]), "h": sparse(t["monthly"]),
                "v": artist_vibe.get(track_artist[k], -1),
            }
            for k, t in sorted(tracks.items(), key=lambda kv: -kv[1]["plays"])
        ],
        "artists": [
            {
                "k": k, "n": dominant_name(artist_names[k]), "id": top_index.get(k, -1), "p": a["plays"],
                "m": round(a["minutes"], 1), "f": date(a["first"]), "l": date(a["last"]),
                "h": sparse(a["monthly"]), "v": artist_vibe.get(k, -1),
            }
            for k, a in sorted(artists.items(), key=lambda kv: -kv[1]["minutes"])
        ],
    }
    return graph, history


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sample", action="store_true", help="use data/sample instead of data/raw")
    ap.add_argument("--src", type=Path, help="export folder or zip (overrides --sample)")
    args = ap.parse_args()
    src = args.src or DATA / ("sample" if args.sample else "raw")
    if not src.exists():
        sys.exit(f"{display_path(src)} not found")

    graph, history = build(src, sample=args.sample and not args.src)
    for name, obj in (("graph_data.json", graph), ("history_index.json", history)):
        path = DATA / name
        path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), "utf-8")
        print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size / 1e6:.1f} MB)")
    s = graph["stats"]
    print(f"{s['plays']:,} plays · {s['minutes'] / 60:,.0f} h · {s['artists']:,} artists · {s['tracks']:,} tracks · {s['sessions']:,} sessions")
    print(f"{len(graph['vibes'])} vibes:")
    for v in graph["vibes"]:
        names = ", ".join(graph["artists"][i]["name"] for i in v["artists"][:3])
        print(f"  {v['name']:<40} {len(v['artists']):>3} artists  {v['minutes'] / 60:>7,.0f} h  ({names})")


if __name__ == "__main__":
    main()
