# 1. Arrival predictions are never earlier than the schedule

Observed: 2026-10-26, from the monitoring record.

## Finding

The feed vendor's arrival predictions never put a bus ahead of its scheduled time, in either the JSON API's `get_vehicles` (`minutesToNextStops`) or `get_stop_etas`. Buses do run early, so for an early bus the prediction riders see is the scheduled time, not when the bus will come.

After an early bus passes a bus stop, the feed vendor also keeps predicting that stop at its scheduled time for a while. On 2026-10-26 a bus on route 10 reached E High St at Stewart St at 9:55:38p and the stop was still predicted for 9:58p after it had left.

## Evidence

From 9:50p to 9:57p on 2026-10-26 (end of evening service), local recording:

| | count | earlier than scheduled |
| --- | --- | --- |
| `get_vehicles` arrival predictions | 356 | 0 |
| `get_stop_etas` arrival predictions | 604 | 0 |
| observed arrivals | 54 | 29 more than 2 minutes early |

None of the arrival predictions made for those 29 early arrivals, before each bus arrived, was earlier than the scheduled time.

This is one short sample, at the time of day when buses most often run early. It needs to be checked against days of the monitoring record:

```sql
-- arrival predictions earlier than scheduled, by source
SELECT source, count(*), sum(predicted_at < scheduled_at) FROM arrival_predictions GROUP BY source;

-- early observed arrivals, and whether any prediction made before them was early
WITH arr AS (
  SELECT schedule_number, pattern_stop_id, scheduled_at, min(arrived_at) AS arrived_at
  FROM observed_arrivals GROUP BY 1, 2, 3
)
SELECT count(DISTINCT arr.schedule_number || ':' || arr.pattern_stop_id || ':' || arr.scheduled_at),
       sum(p.predicted_at < arr.scheduled_at)
FROM arr JOIN arrival_predictions p USING (schedule_number, pattern_stop_id, scheduled_at)
WHERE arr.arrived_at < arr.scheduled_at - 120000 AND p.made_at < arr.arrived_at;
```

## What riders see on the vendor site

From the vendor site's page code (`catpublic.etaspot.net`):

- A bus stop's arrivals list shows one transit vehicle per bus route, as minutes away ("Arriving" under 2 minutes, or "At Stop"). There is no clock time.
- A transit vehicle's next stops show minutes away, or the scheduled time with a status that reads "On Time" or the predicted time when late. There is no wording or color for early.
- A stop leaves a vehicle's list only when the feed vendor stops serving minutes for it.

So for an early bus a rider is told "6 min" or "On Time" while it is 2 to 4 minutes away, and can see "Arriving" for a bus that has already left. Because a bus stop shows one vehicle per bus route, that entry also hides the next bus on the route.

## Not yet measured

- How long a stop stays predicted after the bus has left it. Observed departures (`observed_departures`) and the times each scheduled call was last predicted would give this; the second is not recorded yet.
- Whether buses hold at timepoints when early, which would make the scheduled time right at timepoints and wrong between them.
