# Consolidation-branch baseline (2026-07-06)

Honest-measurement rules (kickoff Phase 4): present rate = DevTools
compositor `DrawFrame` intervals over ≥20 s (`traces/analyze_trace.py`),
NEVER the in-page rAF counter. GPU memory = the patched-wgpu ledger
(`window.__gpuLedger()`, hard budget enforced) + `ps` RSS of the GPU
process. Setup: Docker AraknemuHorizon (auth :14444, game :15555),
account test/test, map 34, vite :5199, dedicated Chrome
(`--remote-debugging-port=9222`, fresh profile).

## Measured (small dev window, 2560-wide viewport, 120 Hz display)

| Scenario | Present rate | Frame intervals | Notes |
|---|---|---|---|
| Idle in-world, 0 crowd | **120.0 fps** | p50 8.32 / p95 9.26 / p99 9.33 / max 9.44 ms; 0 > 16.7 ms | traces/trace-idle-0crowd |
| 300 unique crowd, walking (slab) | **119.9 fps** | p50 8.32 / p95 9.26 / p99 9.33 / max 28.4 ms; 1 frame > 16.7 ms in 33 s | traces/trace-300crowd |

Crowd internals at 300 (fresh spawn → warm): slots ~1600, overflow 0,
`fast=true` every frame, buildMs 0.3-0.9, sublibMB plateau ~200-207,
cacheSize grows with (look|frame) coverage (~47 k @ 2 min — watch in the
soak).

GPU ledger at 300 crowd: **~1050 MB live** (512 MB pre-sized
sub_library + ~350 MB vello working buffers + ~160 MB textures), flat
over minutes, allocation rate 0 after warmup, **0 budget refusals**
(hard budget 3072 MB). Spawn storm (0→300): paced by the wc3-style
bake pump — bakesDeferred 236→0 over ~3 s, memory flat.

GPU-process RSS: 287→291 MB over 105 s at 300 crowd (small window,
pre-resize sampler; full-res soak still owed).

## Owed (Phase 4 gate — run after the parity waves settle)

- Full-window-resolution versions of every scenario (the 2026-07-06
  crash regime — small-window numbers do not transfer).
- 30-min soak: ledger plateau, evict≈0, zero refusals, per-label
  breakdown; GPU-process RSS flat.
- Map-switch ×10, zoom sweep at 300, 400-crowd creature mode, spawn
  storm at full res.
- Known open cause to fix first: strip-renderer residue (302 strip
  slots held for crowd bots — `strip.players=302` in the stress
  snapshot; retire at spawn, keep strip code as the CPU-tier path).

## Context for later comparison

Between baseline and the parity waves, the render changed materially
(all committed on `consolidation`): canonical zone tint + getColorIndex,
side-map rendering removed (one fullscreen pass + ~7 RTs gone),
bake density == display zoom, canonical 742×556 stage fit + centring,
per-actor scale, settled static poses, canonical stroke floor
(scale-keyed fragment caches — IDB format bumped v2). Final Phase-4
numbers must be measured on the post-wave build; this baseline is the
"before" reference.
