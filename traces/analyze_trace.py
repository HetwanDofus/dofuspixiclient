#!/usr/bin/env python3
"""Analyze a Chrome trace for honest present rate.

Uses GPU-process presentation events. Preference order:
1. 'DrawFrame' events on the compositor (viz) — one per presented frame.
2. 'Graphics.Pipeline' / 'PipelineReporter' fallbacks.

Reports: count, window, fps, frame-interval p50/p95/p99/max, and count of
intervals > 16.7ms and > 33ms (after 2s warmup trim).

Usage: python3 traces/analyze_trace.py traces/trace-XYZ.json.gz
"""
import gzip, json, sys

path = sys.argv[1]
opener = gzip.open if path.endswith('.gz') else open
with opener(path, 'rt') as f:
    data = json.load(f)
events = data['traceEvents'] if isinstance(data, dict) else data

candidates = {}
for e in events:
    n = e.get('name', '')
    if n in ('DrawFrame', 'Display::DrawAndSwap', 'Graphics.Pipeline.DrawAndSwap',
             'BufferSwapped', 'vsync before draw', 'PipelineReporter'):
        candidates.setdefault(n, []).append(e)

for name, evs in sorted(candidates.items(), key=lambda kv: -len(kv[1])):
    print(f"# candidate event: {name}  count={len(evs)}", file=sys.stderr)

def analyze(name, evs):
    ts = sorted(e['ts'] for e in evs)
    if len(ts) < 20:
        return None
    # trim first 2 s (warmup / trace start)
    t0 = ts[0] + 2_000_000
    ts = [t for t in ts if t >= t0]
    if len(ts) < 20:
        return None
    window_s = (ts[-1] - ts[0]) / 1e6
    n = len(ts)
    fps = (n - 1) / window_s
    iv = [(b - a) / 1000.0 for a, b in zip(ts, ts[1:])]
    iv_sorted = sorted(iv)
    def pct(p):
        return iv_sorted[min(len(iv_sorted) - 1, int(len(iv_sorted) * p))]
    over_167 = sum(1 for x in iv if x > 16.7)
    over_33 = sum(1 for x in iv if x > 33.0)
    return dict(event=name, frames=n, window_s=round(window_s, 2), fps=round(fps, 1),
                p50=round(pct(0.50), 2), p95=round(pct(0.95), 2), p99=round(pct(0.99), 2),
                max=round(iv_sorted[-1], 2), over16_7=over_167, over33=over_33,
                over16_7_per10s=round(over_167 / (window_s / 10), 2))

for name in ('DrawFrame', 'Display::DrawAndSwap', 'Graphics.Pipeline.DrawAndSwap', 'PipelineReporter'):
    if name in candidates:
        r = analyze(name, candidates[name])
        if r:
            print(json.dumps(r, indent=1))
            break
else:
    print("NO presentation events found", file=sys.stderr)
