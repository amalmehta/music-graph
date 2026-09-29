#!/usr/bin/env python3
"""Generate fake listening history in the exact Extended Streaming History format.

    .venv/bin/python make_sample_data.py                          # ~60 artists
    .venv/bin/python make_sample_data.py --artists 300 --density 2 --out data/sample_big

Writes <out>/Spotify Extended Streaming History/Streaming_History_Audio_*.json.
Artists, songs and track URIs are fictional; each group of artists has its own
time-of-day habits and era so the vibes, history and recommendations have
something real-looking to find.
"""
import argparse
import json
import math
import random
import string
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from build_data import local_tz

ROOT = Path(__file__).resolve().parent
START, END = date(2019, 1, 1), date(2026, 9, 12)
rng = random.Random(7)

# peak hours (hour, spread), weekend multiplier, era center year, era width, neighbor groups
GROUPS = {
    "midnight": dict(peaks=[(0.5, 2.0)], weekend=1.0, era=(2021.5, 3.0), neighbors=["party"]),
    "coffee":   dict(peaks=[(8.0, 1.4)], weekend=1.5, era=(2023.5, 3.5), neighbors=["sunday", "focus"]),
    "focus":    dict(peaks=[(11.0, 2.0), (15.0, 2.0)], weekend=0.2, era=(2022.5, 4.0), neighbors=["coffee"]),
    "gym":      dict(peaks=[(18.0, 1.2)], weekend=0.8, era=(2025.0, 2.0), neighbors=["party"]),
    "sunday":   dict(peaks=[(13.0, 3.0)], weekend=3.0, era=(2020.5, 3.0), neighbors=["coffee"]),
    "party":    dict(peaks=[(22.5, 1.5)], weekend=2.5, era=(2019.8, 2.0), neighbors=["midnight", "gym"]),
}

ADJ = ("Velvet Neon Paper Hollow Golden Static Lunar Amber Silver Quiet Electric Crimson Wild Glass Saffron Cobalt "
       "Faded Tidal Ivory Midnight Honey Violet Rusty Distant Solar Coral Marble Indigo Copper Echo").split()
NOUN = ("Harbor Monsoon Satellites Orchard Parade Motel Rivers Lanterns Cassette Foxes Tides Arcade Garden Signals "
        "Horizon Postcards Comets Palms Machines Winters Bloom Ghosts Avenue Choir Weather Kites Mirage Cinema").split()
WORDS = ("slow dance fever gold summer rain letters highway blue hours soft light runaway cold coffee "
         "static heart burn over city lights fire escape paper planes wild honey moon tides echo night "
         "drive home neon dreams falling satellite loop sunday morning velvet sky ghost town").split()


def uri():
    return "spotify:track:" + "".join(rng.choice(string.ascii_letters + string.digits) for _ in range(22))


def title():
    return " ".join(rng.sample(WORDS, rng.choice([1, 2, 2, 3]))).title()


def make_catalog(per_group):
    names = rng.sample([f"{a} {n}" for a in ADJ for n in NOUN], min(len(ADJ) * len(NOUN), per_group * len(GROUPS) + 10))
    catalog = {}
    for g, cfg in GROUPS.items():
        artists = []
        for rank in range(rng.randint(per_group - 2, per_group + 2)):
            name = names.pop()
            tracks = []
            for _ in range(rng.randint(2, 3)):
                album = title()
                for _ in range(rng.randint(5, 8)):
                    center, width = cfg["era"]
                    start = center + rng.uniform(-width, width)
                    tracks.append(dict(
                        name=title(), album=album, uri=uri(), dur=rng.randint(140_000, 320_000),
                        window=(start, start + rng.uniform(0.8, 4.0)), weight=rng.paretovariate(1.6),
                    ))
            artists.append(dict(name=name, weight=1 / (rank + 1) ** 0.9, tracks=tracks))
        catalog[g] = artists
    return catalog


def hour_weight(cfg, hour):
    return sum(math.exp(-min(abs(hour - p), 24 - abs(hour - p)) ** 2 / (2 * s * s)) for p, s in cfg["peaks"])


def era_weight(cfg, t):
    center, width = cfg["era"]
    return 0.15 + math.exp(-((t - center) / width) ** 2)


def pick(items, weights):
    return rng.choices(items, weights=weights, k=1)[0]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--artists", type=int, default=60, help="roughly how many artists in total")
    ap.add_argument("--density", type=float, default=1.0, help="multiplier on sessions per day")
    ap.add_argument("--out", type=Path, default=ROOT / "data" / "sample", help="folder to write the export into")
    args = ap.parse_args()
    out_dir = args.out / "Spotify Extended Streaming History"

    tz = local_tz()
    catalog = make_catalog(max(3, round(args.artists / len(GROUPS))))
    groups = list(GROUPS)
    rows, day = [], START
    while day <= END:
        t = day.year + (day.timetuple().tm_yday - 1) / 365
        weekend = day.weekday() >= 5
        n_sessions = sum(1 for _ in range(5) if rng.random() < min(0.95, args.density * (0.38 if weekend else 0.3)))
        for _ in range(n_sessions):
            hour = rng.randrange(24)
            weights = [hour_weight(GROUPS[g], hour) * era_weight(GROUPS[g], t) * (GROUPS[g]["weekend"] if weekend else 1) for g in groups]
            group = pick(groups, weights)
            clock = datetime(day.year, day.month, day.day, hour, rng.randrange(60), rng.randrange(60), tzinfo=tz)
            shuffle, reason_start = rng.random() < 0.4, "clickrow"
            if rng.random() < 0.02:  # a podcast episode, which the pipeline should ignore
                ms = rng.randint(600_000, 2_400_000)
                clock += timedelta(milliseconds=ms)
                rows.append(podcast_row(clock, ms))
                continue
            for i in range(max(2, min(45, int(rng.expovariate(1 / 10))))):
                roll = rng.random()
                if roll < 0.04:
                    group = rng.choice(GROUPS[group]["neighbors"])
                elif roll < 0.05:
                    group = rng.choice(groups)
                artists = catalog[group]
                artist = pick(artists, [a["weight"] for a in artists])
                track = pick(artist["tracks"], [tr["weight"] * (1 if tr["window"][0] <= t <= tr["window"][1] else 0.06) for tr in artist["tracks"]])
                if rng.random() < 0.1:
                    ms = rng.randint(1_500, 29_000) if rng.random() < 0.8 else rng.randint(30_000, int(track["dur"] * 0.6))
                    reason_end, skipped = "fwdbtn", True
                else:
                    ms, reason_end, skipped = track["dur"] - rng.randint(0, 800), "trackdone", False
                clock += timedelta(milliseconds=ms)
                rows.append(track_row(clock, ms, artist["name"], track, reason_start, reason_end, shuffle, skipped))
                reason_start = reason_end
                clock += timedelta(seconds=rng.randint(0, 3))
        day += timedelta(days=1)

    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("Streaming_History_Audio_*.json"):
        old.unlink()
    chunk = 12_000
    for n, i in enumerate(range(0, len(rows), chunk)):
        part = rows[i:i + chunk]
        y0, y1 = part[0]["ts"][:4], part[-1]["ts"][:4]
        name = f"Streaming_History_Audio_{y0}_{n}.json" if y0 == y1 else f"Streaming_History_Audio_{y0}-{y1}_{n}.json"
        (out_dir / name).write_text(json.dumps(part, indent=2), "utf-8")
    print(f"wrote {len(rows):,} rows to {out_dir}")


def base_row(end, ms):
    return {
        "ts": end.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "platform": rng.choice(["osx", "ios", "ios", "android"]),
        "ms_played": ms, "conn_country": "US", "ip_addr": "0.0.0.0",
        "master_metadata_track_name": None, "master_metadata_album_artist_name": None, "master_metadata_album_album_name": None,
        "spotify_track_uri": None, "episode_name": None, "episode_show_name": None, "spotify_episode_uri": None,
        "audiobook_title": None, "audiobook_uri": None, "audiobook_chapter_uri": None, "audiobook_chapter_title": None,
        "reason_start": "clickrow", "reason_end": "trackdone", "shuffle": False, "skipped": False,
        "offline": False, "offline_timestamp": None, "incognito_mode": False,
    }


def track_row(end, ms, artist, track, reason_start, reason_end, shuffle, skipped):
    row = base_row(end, ms)
    row.update(
        master_metadata_track_name=track["name"], master_metadata_album_artist_name=artist,
        master_metadata_album_album_name=track["album"], spotify_track_uri=track["uri"],
        reason_start=reason_start, reason_end=reason_end, shuffle=shuffle, skipped=skipped,
    )
    return row


def podcast_row(end, ms):
    row = base_row(end, ms)
    row.update(episode_name="Episode " + str(rng.randint(1, 300)), episode_show_name="The Sample Show",
               spotify_episode_uri="spotify:episode:" + uri()[14:])
    return row


if __name__ == "__main__":
    main()
