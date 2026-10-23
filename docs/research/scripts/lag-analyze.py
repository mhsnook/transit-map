#!/usr/bin/env python3 -I
"""Summarize a lag-sampler run.

Usage:
  python3 -I lag-analyze.py <data_dir> <out_dir>

Reads <data_dir>/samples.jsonl and <data_dir>/stops.json (written by
lag-sampler.py) and writes to <out_dir>:
  staleness-per-vehicle.csv   position staleness and fix gaps per transit vehicle
  divergence.csv              datasource divergence per matched sample
  arrivals.csv                observed arrivals with the arrival predictions
                              made 1, 3 and 6 minutes earlier
and prints a plain-text summary to stdout.

Definitions follow GLOSSARY.md. Position staleness = wall time of the fetch
minus receiveTime (JSON API) or vehicle.timestamp (GTFS-RT feed). Observed
arrival = first position fix within ARRIVAL_RADIUS_M of a bus stop that the
JSON API listed among the transit vehicle's upcoming stops.
"""
import csv
import json
import math
import os
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/New_York")
ARRIVAL_RADIUS_M = 30
LOOKBACKS = (60, 180, 360)
LOOKBACK_TOL = 6  # seconds; samples are 10 s apart


def haversine_m(lat1, lng1, lat2, lng2):
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def pct(values, p):
    if not values:
        return float("nan")
    s = sorted(values)
    k = (len(s) - 1) * p
    lo, hi = math.floor(k), math.ceil(k)
    if lo == hi:
        return s[lo]
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def fmt_t(epoch):
    return datetime.fromtimestamp(epoch, TZ).strftime("%H:%M:%S")


def eta_minutes_to_epoch(minutes_past_midnight, ref_epoch):
    """nextStopETA is minutes past local midnight; anchor on the sample's local day."""
    day = datetime.fromtimestamp(ref_epoch, TZ).replace(hour=0, minute=0, second=0, microsecond=0)
    return (day + timedelta(minutes=minutes_past_midnight)).timestamp()


def load(data_dir):
    samples = []
    with open(os.path.join(data_dir, "samples.jsonl")) as f:
        for line in f:
            line = line.strip()
            if line:
                samples.append(json.loads(line))
    with open(os.path.join(data_dir, "stops.json")) as f:
        stops = {s["id"]: (s["lat"], s["lng"], s["name"]) for s in json.load(f)["get_stops"]}
    return samples, stops


def main():
    data_dir, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    samples, stops = load(data_dir)
    good = [s for s in samples if "vehicles" in s.get("json", {}) and "vehicles" in s.get("rt", {})]
    t0, t1 = samples[0]["wall"], samples[-1]["wall"]
    print(f"samples: {len(samples)} ticks, {len(good)} with both sources, "
          f"{fmt_t(t0)}-{fmt_t(t1)} local ({(t1 - t0) / 60:.1f} min)")
    errs = [(s["tick"], s["json"].get("error") or s["rt"].get("error")) for s in samples if s not in good]
    if errs:
        print(f"fetch errors: {errs[:10]}")

    # ---- clock check: HTTP Date header vs wall ----
    offs = []
    for s in good:
        d = s["json"].get("date")
        if d:
            srv = datetime.strptime(d, "%a, %d %b %Y %H:%M:%S %Z").replace(tzinfo=ZoneInfo("UTC")).timestamp()
            offs.append(s["wall"] - srv)
    if offs:
        print(f"wall minus JSON API Date header: median {statistics.median(offs):+.1f} s "
              f"(header has 1 s resolution)")

    # ---- position staleness, JSON API ----
    by_veh = defaultdict(list)  # equipmentID -> [(wall, receiveTime_s, record)]
    for s in good:
        for v in s["json"]["vehicles"]:
            by_veh[v["equipmentID"]].append((s["wall"], v["receiveTime"] / 1000.0, v))
    rt_by_veh = defaultdict(list)
    for s in good:
        for v in s["rt"]["vehicles"]:
            rt_by_veh[v["vehicle_id"]].append((s["wall"], float(v["timestamp"]), v))

    all_stale, all_rt_stale, all_gaps = [], [], []
    rows = []
    stopped = []
    for eq in sorted(by_veh, key=lambda x: int(x) if x.isdigit() else 0):
        obs = by_veh[eq]
        stale = [w - r for w, r, _ in obs]
        all_stale.extend(stale)
        fixes = sorted({r for _, r, _ in obs})
        gaps = [b - a for a, b in zip(fixes, fixes[1:])]
        all_gaps.extend(gaps)
        rt_obs = rt_by_veh.get(eq, [])
        rt_stale = [w - r for w, r, _ in rt_obs]
        all_rt_stale.extend(rt_stale)
        last_seen_wall = obs[-1][0]
        last_fix = max(r for _, r, _ in obs)
        in_service = all(v.get("inService") == 1 for _, _, v in obs)
        trail = last_seen_wall - last_fix
        rows.append({
            "equipmentID": eq,
            "ticks_present": len(obs),
            "first_seen": fmt_t(obs[0][0]),
            "last_seen": fmt_t(last_seen_wall),
            "distinct_fixes": len(fixes),
            "fix_interval_median_s": round(statistics.median(gaps), 1) if gaps else "",
            "staleness_median_s": round(statistics.median(stale), 1),
            "staleness_p90_s": round(pct(stale, 0.9), 1),
            "staleness_max_s": round(max(stale), 1),
            "gaps_gt_60s": sum(g > 60 for g in gaps),
            "gaps_gt_300s": sum(g > 300 for g in gaps),
            "longest_gap_s": round(max(gaps), 1) if gaps else "",
            "rt_staleness_median_s": round(statistics.median(rt_stale), 1) if rt_stale else "",
            "rt_staleness_p90_s": round(pct(rt_stale, 0.9), 1) if rt_stale else "",
            "rt_staleness_max_s": round(max(rt_stale), 1) if rt_stale else "",
            "always_inService": in_service,
            "last_fix_before_last_seen_s": round(trail, 1),
        })
        if trail > 300 or (t1 - last_seen_wall > 60):
            stopped.append((eq, fmt_t(last_fix), fmt_t(last_seen_wall), round(trail), in_service))
    with open(os.path.join(out_dir, "staleness-per-vehicle.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    print("\n== position staleness (JSON API receiveTime age at fetch), all vehicles pooled ==")
    print(f"n={len(all_stale)} median {statistics.median(all_stale):.1f} s, p90 {pct(all_stale, .9):.1f} s, "
          f"p99 {pct(all_stale, .99):.1f} s, max {max(all_stale):.1f} s")
    print(f"share > 60 s: {sum(x > 60 for x in all_stale) / len(all_stale):.1%}; "
          f"share > 300 s: {sum(x > 300 for x in all_stale) / len(all_stale):.1%}")
    print(f"fix intervals (gap between distinct receiveTime per vehicle): n={len(all_gaps)} "
          f"median {statistics.median(all_gaps):.0f} s, p90 {pct(all_gaps, .9):.0f} s, max {max(all_gaps):.0f} s; "
          f"gaps > 60 s: {sum(g > 60 for g in all_gaps)}, > 300 s: {sum(g > 300 for g in all_gaps)}")
    print("\n== position staleness (GTFS-RT vehicle.timestamp age at fetch), pooled ==")
    print(f"n={len(all_rt_stale)} median {statistics.median(all_rt_stale):.1f} s, p90 {pct(all_rt_stale, .9):.1f} s, "
          f"max {max(all_rt_stale):.1f} s")
    hdr_age = [s["wall"] - s["rt"]["header_timestamp"] for s in good if s["rt"].get("header_timestamp")]
    lm_age = []
    for s in good:
        lm = s["rt"].get("last_modified")
        if lm:
            lm_e = datetime.strptime(lm, "%a, %d %b %Y %H:%M:%S %Z").replace(tzinfo=ZoneInfo("UTC")).timestamp()
            lm_age.append(s["wall"] - lm_e)
    if hdr_age:
        print(f"GTFS-RT header.timestamp age: median {statistics.median(hdr_age):.1f} s, p90 {pct(hdr_age, .9):.1f} s, "
              f"max {max(hdr_age):.1f} s; S3 Last-Modified age: median {statistics.median(lm_age):.1f} s, "
              f"max {max(lm_age):.1f} s")
    etags = [s["rt"].get("etag") for s in good]
    distinct = len({e for e in etags if e})
    print(f"distinct GTFS-RT files fetched: {distinct} of {len(etags)} fetches "
          f"(~one new file per {(t1 - t0) / max(distinct - 1, 1):.0f} s)")

    print("\n== per-vehicle staleness (JSON API) ==")
    print("eq   ticks fixes  int_med  st_med  st_p90  st_max  gaps>60 gaps>300 longest  rt_med rt_p90 rt_max")
    for r in rows:
        print(f"{r['equipmentID']:<4} {r['ticks_present']:>5} {r['distinct_fixes']:>5} {str(r['fix_interval_median_s']):>8} "
              f"{r['staleness_median_s']:>7} {r['staleness_p90_s']:>7} {r['staleness_max_s']:>7} {r['gaps_gt_60s']:>8} "
              f"{r['gaps_gt_300s']:>8} {str(r['longest_gap_s']):>7}  {str(r['rt_staleness_median_s']):>6} "
              f"{str(r['rt_staleness_p90_s']):>6} {str(r['rt_staleness_max_s']):>6}")

    print("\n== vehicles whose fixes stopped or that left the feed ==")
    if stopped:
        for eq, lf, ls, trail, ins in stopped:
            print(f"  {eq}: last fix {lf}, last seen {ls}, fix trailed last appearance by {trail} s, inService always 1: {ins}")
    else:
        print("  none: every vehicle's newest fix was < 300 s old when last served, and every vehicle was served until the end")

    # ---- datasource divergence ----
    div_rows = []
    match_counts = {"equipmentID=vehicle.id": 0, "scheduleNumber=label": 0, "tripID=trip_id": 0, "json_vehicles": 0}
    for s in good:
        rt_by_id = {v["vehicle_id"]: v for v in s["rt"]["vehicles"]}
        rt_by_label = {v["label"]: v for v in s["rt"]["vehicles"]}
        rt_by_trip = {v["trip_id"]: v for v in s["rt"]["vehicles"]}
        for v in s["json"]["vehicles"]:
            match_counts["json_vehicles"] += 1
            a = rt_by_id.get(v["equipmentID"])
            b = rt_by_label.get(v["scheduleNumber"])
            c = rt_by_trip.get(str(v["tripID"]))
            match_counts["equipmentID=vehicle.id"] += a is not None
            match_counts["scheduleNumber=label"] += b is not None
            match_counts["tripID=trip_id"] += c is not None
            r = a or b or c
            if not r:
                continue
            d = haversine_m(v["lat"], v["lng"], r["lat"], r["lng"])
            dt = v["receiveTime"] / 1000.0 - r["timestamp"]
            div_rows.append({
                "tick": s["tick"], "wall": fmt_t(s["wall"]), "equipmentID": v["equipmentID"],
                "json_receiveTime": fmt_t(v["receiveTime"] / 1000.0), "rt_timestamp": fmt_t(r["timestamp"]),
                "json_minus_rt_s": round(dt, 1), "distance_m": round(d, 1),
                "same_label": v["scheduleNumber"] == r["label"], "same_trip": str(v["tripID"]) == r["trip_id"],
            })
    with open(os.path.join(out_dir, "divergence.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(div_rows[0].keys()))
        w.writeheader()
        w.writerows(div_rows)
    print("\n== datasource divergence (JSON API vs GTFS-RT, same fetch tick) ==")
    print(f"match keys: {match_counts}")
    dist = [r["distance_m"] for r in div_rows]
    dts = [r["json_minus_rt_s"] for r in div_rows]
    print(f"n={len(div_rows)} distance: median {statistics.median(dist):.0f} m, p90 {pct(dist, .9):.0f} m, max {max(dist):.0f} m")
    print(f"timestamp JSON minus RT: median {statistics.median(dts):+.0f} s, p10 {pct(dts, .1):+.0f} s, "
          f"p90 {pct(dts, .9):+.0f} s, min {min(dts):+.0f} s, max {max(dts):+.0f} s; "
          f"JSON newer in {sum(x > 0 for x in dts) / len(dts):.0%} of rows, equal in {sum(x == 0 for x in dts) / len(dts):.0%}")
    same = [r["distance_m"] for r in div_rows if r["json_minus_rt_s"] == 0]
    if same:
        print(f"when timestamps are equal (same fix, n={len(same)}): distance median {statistics.median(same):.0f} m, "
              f"p90 {pct(same, .9):.0f} m, max {max(same):.0f} m  <- map-matching offset only")
    print(f"label mismatches: {sum(not r['same_label'] for r in div_rows)}, trip mismatches: {sum(not r['same_trip'] for r in div_rows)}")
    # Same fix matched across ticks: for every distinct GTFS-RT fix, find the JSON fix with the same time.
    cross = []
    for eq, rt_obs in rt_by_veh.items():
        json_fix = {}
        for _, r, v in by_veh.get(eq, []):
            json_fix.setdefault(r, v)
        seen = set()
        for _, r, v in rt_obs:
            if r in seen:
                continue
            seen.add(r)
            j = json_fix.get(r)
            if j:
                cross.append(haversine_m(j["lat"], j["lng"], v["lat"], v["lng"]))
    if cross:
        print(f"same fix time matched across ticks (n={len(cross)} distinct fixes): distance median {statistics.median(cross):.1f} m, "
              f"p90 {pct(cross, .9):.1f} m, max {max(cross):.1f} m")
    # How much newer is the JSON API's newest fix than the GTFS-RT fix for the same vehicle, per tick?
    ahead = [r["json_minus_rt_s"] for r in div_rows]
    print(f"JSON fix newer than RT fix by: mean {statistics.mean(ahead):+.1f} s, p50 {statistics.median(ahead):+.0f} s, p90 {pct(ahead, .9):+.0f} s")

    # ---- prediction error ----
    # For each vehicle and each distinct fix, check distance to its lastStopID, nextStopID
    # and the stops in `next`. First fix within radius of stop S = observed arrival at S.
    arrivals = []
    for eq, obs in by_veh.items():
        seen_fix = set()
        arrived = set()
        for wall, rt_s, v in obs:
            if rt_s in seen_fix:
                continue
            seen_fix.add(rt_s)
            cand = {v.get("nextStopID"), v.get("lastStopID")} | {n["stopID"] for n in v.get("next", [])}
            for sid in cand:
                if sid in arrived or sid not in stops:
                    continue
                slat, slng, sname = stops[sid]
                d = haversine_m(v["lat"], v["lng"], slat, slng)
                if d <= ARRIVAL_RADIUS_M:
                    arrived.add(sid)
                    arrivals.append((eq, sid, sname, rt_s, wall, d, v.get("atStop"), v.get("nextStopID") == sid))
    print(f"\n== observed arrivals (first fix within {ARRIVAL_RADIUS_M} m of an upcoming/last stop): {len(arrivals)} ==")

    arr_rows = []
    err_by_lb = defaultdict(list)       # all arrivals
    err_by_lb_trip = defaultdict(list)  # arrivals that are not a terminal layover
    err_by_lb_lay = defaultdict(list)
    for eq, sid, sname, arr_s, arr_wall, d, at_stop, was_next in arrivals:
        # Terminal layover: within 90 s after the arrival fix the JSON API shows the vehicle
        # between trips (seq null / lastStopID 0) or already assigned to a later trip.
        layover = any(
            (v.get("seq") is None or v.get("lastStopID") == 0)
            for w, _, v in by_veh[eq] if arr_wall <= w <= arr_wall + 90
        )
        row = {"equipmentID": eq, "stopID": sid, "stop": sname, "observed_arrival": fmt_t(arr_s),
               "fix_distance_m": round(d, 1), "atStop_at_arrival": at_stop, "was_nextStop_at_arrival": was_next,
               "terminal_layover": layover}
        for lb in LOOKBACKS:
            target = arr_s - lb
            # nearest sample for this vehicle to the target wall time
            best = min(by_veh[eq], key=lambda o: abs(o[0] - target))
            w, _, v = best
            row[f"pred_{lb}s"] = ""
            row[f"err_{lb}s"] = ""
            if abs(w - target) > LOOKBACK_TOL:
                continue
            pred_epoch = None
            src = ""
            if v.get("nextStopID") == sid and v.get("nextStopETA") is not None:
                pred_epoch = eta_minutes_to_epoch(v["nextStopETA"], w)
                src = "nextStopETA"
            else:
                for n in v.get("next", []):
                    if n["stopID"] == sid and n.get("minutes") is not None:
                        pred_epoch = w + n["minutes"] * 60
                        src = "minutesToNextStops"
                        break
            if pred_epoch is None:
                row[f"pred_{lb}s"] = "(stop not listed)"
                continue
            err = pred_epoch - arr_s  # + means predicted later than observed arrival
            row[f"pred_{lb}s"] = f"{fmt_t(pred_epoch)} via {src}"
            row[f"err_{lb}s"] = round(err)
            err_by_lb[lb].append(err)
            (err_by_lb_lay if layover else err_by_lb_trip)[lb].append(err)
        arr_rows.append(row)
    if arr_rows:
        with open(os.path.join(out_dir, "arrivals.csv"), "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(arr_rows[0].keys()))
            w.writeheader()
            w.writerows(arr_rows)
    print("prediction error = predicted arrival minus observed arrival (+ = vendor said later than the bus actually got there)")
    n_lay = sum(1 for r in arr_rows if r["terminal_layover"])
    print(f"arrivals: {len(arr_rows)} total, {n_lay} at a terminal layover, {len(arr_rows) - n_lay} in-trip")
    for label, table in (("all", err_by_lb), ("in-trip", err_by_lb_trip), ("terminal layover", err_by_lb_lay)):
        print(f"  [{label}]")
        for lb in LOOKBACKS:
            e = table[lb]
            if not e:
                print(f"    {lb // 60} min before: no data")
                continue
            print(f"    {lb // 60} min before: n={len(e)} median {statistics.median(e):+.0f} s, mean {statistics.mean(e):+.0f} s, "
                  f"p10 {pct(e, .1):+.0f} s, p90 {pct(e, .9):+.0f} s, |err|>60 s in {sum(abs(x) > 60 for x in e) / len(e):.0%}, "
                  f"|err|>180 s in {sum(abs(x) > 180 for x in e) / len(e):.0%}")
    at_stop_vals = [a[6] for a in arrivals]
    print(f"atStop flag set at the arrival fix: {sum(1 for x in at_stop_vals if x == 1)} of {len(at_stop_vals)}")

    # how long does nextStopETA keep pointing at a stop after the vehicle is within radius?
    # (contiguous run only: stop at the first tick where nextStopID is something else)
    def hold_run(eq, sid, arr_wall):
        run = []
        for w, _, v in by_veh[eq]:
            if w < arr_wall:
                continue
            if v.get("nextStopID") != sid:
                break
            run.append((w, v))
        return run

    late_hold = []
    for eq, sid, sname, arr_s, arr_wall, d, at_stop, was_next in arrivals:
        after = hold_run(eq, sid, arr_wall)
        if after:
            late_hold.append(after[-1][0] - arr_wall)
    if late_hold:
        print(f"after the arrival fix, nextStopID still named that stop for: median {statistics.median(late_hold):.0f} s, "
              f"p90 {pct(late_hold, .9):.0f} s, max {max(late_hold):.0f} s (n={len(late_hold)})")
    # what did nextStopETA claim at the moment of the arrival fix?
    at_arrival_err = []
    for eq, sid, sname, arr_s, arr_wall, d, at_stop, was_next in arrivals:
        for w, _, v in by_veh[eq]:
            if w == arr_wall and v.get("nextStopID") == sid and v.get("nextStopETA") is not None:
                at_arrival_err.append(eta_minutes_to_epoch(v["nextStopETA"], w) - arr_s)
    if at_arrival_err:
        print(f"nextStopETA at the arrival fix itself (n={len(at_arrival_err)}): median {statistics.median(at_arrival_err):+.0f} s, "
              f"p90 {pct(at_arrival_err, .9):+.0f} s, max {max(at_arrival_err):+.0f} s ahead of the observed arrival")

    # Diagnose the "bus is at the stop but the site says N minutes" cases: arrivals where the
    # JSON API kept naming the stop as nextStopID for > 60 s after the fix within radius.
    print("\n== arrivals where nextStopID kept naming the stop > 60 s after the bus was within radius ==")
    print("eq   stop                                   arrived  held_s  seq  atStop pct  onSched  ETA(time)  schedule  status")
    held_rows = []
    for eq, sid, sname, arr_s, arr_wall, d, at_stop, was_next in arrivals:
        after = hold_run(eq, sid, arr_wall)
        if not after or after[-1][0] - arr_wall <= 60:
            continue
        w, v = after[0]
        n0 = (v.get("next") or [{}])[0]
        held = after[-1][0] - arr_wall
        held_rows.append((eq, sname, arr_s, held, v.get("seq"), v.get("atStop"), v.get("nextStopPctProg"),
                          v.get("onSchedule"), n0.get("time"), n0.get("schedule"), n0.get("status")))
        print(f"{eq:<4} {sname[:38]:<38} {fmt_t(arr_s)} {held:>6.0f} {str(v.get('seq')):>4} {str(v.get('atStop')):>6} "
              f"{str(round(v.get('nextStopPctProg') or 0)):>4} {str(v.get('onSchedule')):>7}  {str(n0.get('time')):<9} "
              f"{str(n0.get('schedule')):<9} {str(n0.get('status'))}")
    if held_rows:
        early = sum(1 for r in held_rows if (r[7] or 0) > 0)
        first = sum(1 for r in held_rows if r[4] in (0, 1))
        print(f"{len(held_rows)} such arrivals; onSchedule > 0 (running early) in {early}; seq <= 1 (start of trip) in {first}")


if __name__ == "__main__":
    main()
