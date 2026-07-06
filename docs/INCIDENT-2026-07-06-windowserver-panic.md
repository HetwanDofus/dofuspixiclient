# Incident 2026-07-06: kernel panic during unattended 300-crowd full-res run

Evidence: `~/Desktop/crash-1.txt` (kernel panic log), `~/Desktop/crash2.txt`
(bug_type 409 WATCHDOG stackshot, captured 12:04:58 +0200, Mac16,5 / M4 Max
48GB, macOS 26.5.1).

## Chain (all from the capture)

1. **Chrome GPU process (pid 2420) at 3.73 GiB resident, uptime 3100 s** —
   this is the *dedicated debug Chrome instance* launched at 11:12 for the
   consolidation-branch baseline (same pid sampled at **302 MB** right after
   boot). It was left running a **300 fully-unique animated bot crowd at
   full window resolution (canvas 3793×1945)** unattended after ~11:35.
2. The GPU helper is down to **one thread, stuck in `TH_WAIT, TH_UNINT`** —
   dying, but wedged in an uninterruptible kernel wait inside the GPU
   driver. Its 3.7 GiB and the AGX channel were never released.
3. **WindowServer `ws_main_thread` also `TH_WAIT, TH_UNINT`** → cannot
   check in → watchdogd induces a WindowServer crash ("39 seconds since
   last crashed by watchdogd"), restarted WindowServer blocks on the same
   wedged channel → second induced crash → kernel panic:
   `userspace watchdog timeout: no successful checkins from WindowServer
   (2 induced crashes) in 120 seconds` (crash-1.txt).

Identical mechanism to the 2026-06-19 post-mortem
(`CPU_RENDER_FEASIBILITY.md`) — that incident's Chrome GPU process hit
8.6 GB. The proximate bugs fixed then closed *those* floods; the class
remains open until Phase 1 (allocation accountant + rate watchdog) lands.

## What we know about the growth (from the session's own telemetry,
## sampled ~2 min into the crowd run, before the session ended)

- `__crowdSlabStats().cacheSize` (look/layout cache) grew 1,077 → **47,375
  in ~2 min** (fully-unique roster turning/animating; the cache is keyed
  per (layout|frame)).
- `sublibMB` 6.5 → **207 and climbing** toward the 384 MB
  `SLAB_SUBLIB_RESET_BYTES` reset; every reset triggers a synchronous
  re-bake storm (bakes are now inline on the main thread).
- `rust.createdTexMB` **26.3 GB cumulative texture churn** through the
  deferred-destroy path in those first minutes (live 160 MB — churn, not
  residency, but it hammers the Metal allocator).
- Strip-renderer residue: 302 strip slots still held for crowd-managed
  bots (open P1 from CROWD_PERF_HEADTOHEAD.md).
- GPU resident was FLAT (287→291 MB over 105 s) at small window; the
  3.73 GiB accumulated only during the long unattended full-res run —
  full resolution multiplies every texture in the pipeline.

The stackshot has no Metal allocation backtraces, so the specific
allocation site cannot be pinned post-mortem. Pinning + preventing it is
exactly Phase 1 of `docs/KICKOFF-consolidation.md`:

1. **Allocation accountant** in the patched wgpu — hard byte budget, over
   budget = the allocation FAILS (bake error + telemetry), never the host.
2. **Allocation-rate watchdog** — floods become stutters, not host kills.
3. **30-min soak gate** with the ledger: resident plateau, evict≈0, no
   refusals, per-label breakdown; run at FULL window resolution (this
   incident's regime), not the small dev window.

## Operational rules until Phase 1 lands

- Never leave a large crowd running unattended.
- Despawn bots (`despawnTestPlayers()`) before stepping away from a
  session; kill the debug Chrome instance when done measuring.
- Full-resolution soak is the acceptance regime — small-window numbers
  do not transfer.
