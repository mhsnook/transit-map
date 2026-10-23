#!/usr/bin/env python3 -I
"""Sample the JSON API and the GTFS-RT feed side by side and append JSON lines.

Every INTERVAL seconds for DURATION minutes this fetches
  - get_vehicles (JSON API) and
  - position_updates.pb (GTFS-RT feed)
and writes one line per tick to <out_dir>/samples.jsonl with the wall time,
response headers that carry server time, and a condensed record per transit
vehicle from each source. It fetches get_stops once to <out_dir>/stops.json.

Usage:
  python3 -I lag-sampler.py <out_dir> [--minutes 40] [--interval 10]

Requires gtfs-realtime-bindings (pip install --user gtfs-realtime-bindings).
Running with -I hides the user site-packages, so the script appends that
directory to sys.path itself; it never adds the data directory.
"""
import argparse
import json
import os
import site
import sys
import time
import urllib.request

sys.path.append(site.getusersitepackages())
from google.transit import gtfs_realtime_pb2  # noqa: E402

BASE = "https://catpublic.etaspot.net/service.php?token=TESTING&service="
VEHICLES_URL = BASE + "get_vehicles&includeETAData=1&inService=1&orderedETAArray=1"
STOPS_URL = BASE + "get_stops"
RT_URL = "https://s3.amazonaws.com/etatransit.gtfs/catpublic.etaspot.net/position_updates.pb"

VEHICLE_FIELDS = (
    "equipmentID scheduleNumber tripID routeID patternID blockID lat lng h "
    "receiveTime nextStopID nextStopETA nextStopPctProg lastStopID seq "
    "atStop inService onSchedule deadHead"
).split()


def fetch(url, timeout=8):
    req = urllib.request.Request(url, headers={"User-Agent": "transit-map lag-sampler"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read()
        headers = {k.lower(): v for k, v in resp.getheaders()}
    return body, headers, time.time() - t0


def condense_vehicle(v):
    out = {k: v.get(k) for k in VEHICLE_FIELDS}
    nxt = v.get("minutesToNextStops") or []
    out["next"] = [
        {"stopID": s.get("stopID"), "minutes": s.get("minutes"), "time": s.get("time"),
         "schedule": s.get("schedule"), "status": s.get("status")}
        for s in nxt[:3]
    ]
    return out


def condense_rt(feed):
    out = []
    for e in feed.entity:
        if not e.HasField("vehicle"):
            continue
        v = e.vehicle
        out.append({
            "entity_id": e.id,
            "vehicle_id": v.vehicle.id,
            "label": v.vehicle.label,
            "trip_id": v.trip.trip_id,
            "route_id": v.trip.route_id,
            "lat": v.position.latitude,
            "lng": v.position.longitude,
            "bearing": v.position.bearing,
            "timestamp": v.timestamp,
            "stop_id": v.stop_id,
            "current_status": v.current_status,
            "current_stop_sequence": v.current_stop_sequence,
        })
    return out


def sample_once():
    rec = {"wall": time.time()}
    try:
        body, hdr, dt = fetch(VEHICLES_URL)
        rec["json"] = {
            "date": hdr.get("date"),
            "elapsed": round(dt, 3),
            "vehicles": [condense_vehicle(v) for v in json.loads(body)["get_vehicles"]],
        }
    except Exception as exc:  # noqa: BLE001 - record and keep sampling
        rec["json"] = {"error": repr(exc)}
    try:
        body, hdr, dt = fetch(RT_URL)
        feed = gtfs_realtime_pb2.FeedMessage()
        feed.ParseFromString(body)
        rec["rt"] = {
            "date": hdr.get("date"),
            "last_modified": hdr.get("last-modified"),
            "etag": hdr.get("etag"),
            "elapsed": round(dt, 3),
            "header_timestamp": feed.header.timestamp,
            "vehicles": condense_rt(feed),
        }
    except Exception as exc:  # noqa: BLE001
        rec["rt"] = {"error": repr(exc)}
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dir")
    ap.add_argument("--minutes", type=float, default=40)
    ap.add_argument("--interval", type=float, default=10)
    args = ap.parse_args()
    os.makedirs(args.out_dir, exist_ok=True)

    stops_path = os.path.join(args.out_dir, "stops.json")
    if not os.path.exists(stops_path):
        body, _, _ = fetch(STOPS_URL, timeout=20)
        with open(stops_path, "wb") as f:
            f.write(body)

    out_path = os.path.join(args.out_dir, "samples.jsonl")
    start = time.time()
    end = start + args.minutes * 60
    tick = 0
    with open(out_path, "a") as f:
        while True:
            planned = start + tick * args.interval
            rec = sample_once()
            rec["tick"] = tick
            f.write(json.dumps(rec, separators=(",", ":")) + "\n")
            f.flush()
            n_json = len(rec["json"].get("vehicles", []))
            n_rt = len(rec["rt"].get("vehicles", []))
            print(f"tick {tick} {time.strftime('%H:%M:%S')} json={n_json} rt={n_rt}", flush=True)
            tick += 1
            nxt = start + tick * args.interval
            if nxt >= end:
                break
            time.sleep(max(0.0, nxt - time.time()))
    print("done", out_path)


if __name__ == "__main__":
    main()
