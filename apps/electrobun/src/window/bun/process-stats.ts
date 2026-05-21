/**
 * Bun-side process-tree resource monitor.
 *
 * Polls `ps -A` every `POLL_INTERVAL_MS` and writes a TSV row per
 * tick containing aggregated RSS + CPU for every process descended
 * from this Bun process (the Electrobun host). On macOS the CEF
 * runtime spawns several helper processes (renderer, GPU, network,
 * utility) — without aggregating across them you only see the
 * Bun-side overhead and miss the lion's share of memory.
 *
 * The log lives at `~/Desktop/electrobun-process-stats-<epoch>.log`
 * so the user can tail/grep it the same way they do
 * `~/Desktop/log.txt`. Per-session timestamped filename so back-to-
 * back stress runs don't clobber each other.
 *
 * Columns (TSV):
 *   timestamp     ISO8601, sample wall clock
 *   uptimeS       seconds since the logger started
 *   procCount     number of processes in our tree
 *   totalRssMB    sum of RSS across the tree
 *   mainRssMB     this Bun process alone
 *   gpuRssMB      sum of any descendant whose `comm` contains "GPU"
 *   helperRssMB   sum of any descendant whose `comm` contains
 *                 "Helper" or "CEF" (renderer + utility + plugin)
 *   totalCpuPct   sum of `%CPU` across the tree (each process is
 *                 0..100, so total can exceed 100 on multi-core)
 *   detail        comma-joined `pid:basename:rssMB:cpu%` per process
 *
 * Writes are append-only; truncation is one-line per tick so even at
 * 1 Hz over an hour we generate ~360 KB. Cheap.
 *
 * Safety: every poll is wrapped in a try/catch. If `ps` fails for
 * any reason we silently skip the tick — the logger MUST NOT crash
 * the host process.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const POLL_INTERVAL_MS = 2000;

interface ProcSample {
  pid: number;
  ppid: number;
  rssKB: number;
  pcpu: number;
  comm: string;
}

/**
 * Run `ps -A` once and parse out every process on the system. We
 * filter to our descendants in `descendantsOf`. macOS BSD ps's `-o
 * <col>=` form ("with empty header") gives us a header-less table
 * that's easy to regex.
 */
function readPsTable(): ProcSample[] {
  const result = spawnSync(
    "ps",
    ["-A", "-o", "pid=,ppid=,rss=,pcpu=,comm="],
    { encoding: "utf8" },
  );
  if (result.status !== 0 || !result.stdout) return [];
  const out: ProcSample[] = [];
  for (const rawLine of result.stdout.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    // pid  ppid  rss  pcpu  comm(may contain spaces)
    const m = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(.+)$/);
    if (!m) continue;
    out.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      rssKB: Number(m[3]),
      pcpu: Number(m[4]),
      comm: m[5] ?? "",
    });
  }
  return out;
}

/** BFS-collect every descendant of `rootPid` from a ps snapshot,
 *  including `rootPid` itself. */
function descendantsOf(rootPid: number, all: ProcSample[]): ProcSample[] {
  const byPpid = new Map<number, ProcSample[]>();
  for (const p of all) {
    const arr = byPpid.get(p.ppid);
    if (arr) arr.push(p);
    else byPpid.set(p.ppid, [p]);
  }
  const out: ProcSample[] = [];
  const root = all.find((p) => p.pid === rootPid);
  if (root) out.push(root);
  const queue: number[] = [rootPid];
  while (queue.length > 0) {
    const pid = queue.shift() as number;
    const children = byPpid.get(pid);
    if (!children) continue;
    for (const c of children) {
      out.push(c);
      queue.push(c.pid);
    }
  }
  return out;
}

/**
 * Best-effort categorisation of a process based on its `comm`.
 * macOS CEF spawns processes named e.g.:
 *   `<App> Helper (GPU)`
 *   `<App> Helper (Renderer)`
 *   `<App> Helper (Plugin)`
 *   `<App> Helper`
 *   `CEFNetworkServiceProcess`
 *   `<App> Helper (Alerts)`
 * We bucket "anything containing GPU" → gpu, everything else with
 * "Helper" / "CEF" / "Renderer" → helper, anything else → other.
 */
function categorize(comm: string): "gpu" | "helper" | "other" {
  const lower = comm.toLowerCase();
  if (lower.includes("gpu")) return "gpu";
  if (
    lower.includes("helper") ||
    lower.includes("cef") ||
    lower.includes("renderer") ||
    lower.includes("network service") ||
    lower.includes("utility")
  ) {
    return "helper";
  }
  return "other";
}

let logPath: string | null = null;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let startedAt = 0;

/**
 * Start the poller. Called once at app boot. Subsequent calls are
 * no-ops so hot-reload doesn't double-instrument.
 */
export function startProcessStatsLogger(): void {
  if (intervalHandle !== null) return;
  startedAt = Date.now();
  const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, "-");
  logPath = join(homedir(), "Desktop", `electrobun-process-stats-${stamp}.log`);
  try {
    writeFileSync(
      logPath,
      [
        "# Electrobun process-tree resource monitor",
        `# Started: ${new Date(startedAt).toISOString()}`,
        `# Root PID: ${process.pid}`,
        `# Poll interval: ${POLL_INTERVAL_MS} ms`,
        "#",
        [
          "timestamp",
          "uptimeS",
          "procCount",
          "totalRssMB",
          "mainRssMB",
          "gpuRssMB",
          "helperRssMB",
          "totalCpuPct",
          "detail",
        ].join("\t"),
        "",
      ].join("\n"),
    );
  } catch (e) {
    // If we can't write at all, abandon ship rather than spinning.
    console.warn(`[process-stats] cannot write to ${logPath}:`, e);
    logPath = null;
    return;
  }
  console.log(`[process-stats] logging to ${logPath} every ${POLL_INTERVAL_MS} ms`);
  intervalHandle = setInterval(pollAndWrite, POLL_INTERVAL_MS);
}

export function stopProcessStatsLogger(): void {
  if (intervalHandle !== null) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

function pollAndWrite(): void {
  if (!logPath) return;
  try {
    const ps = readPsTable();
    if (ps.length === 0) return;
    const tree = descendantsOf(process.pid, ps);

    let totalRssMB = 0;
    let totalCpu = 0;
    let mainRssMB = 0;
    let gpuRssMB = 0;
    let helperRssMB = 0;
    const detail: string[] = [];

    for (const p of tree) {
      const rssMB = p.rssKB / 1024;
      totalRssMB += rssMB;
      totalCpu += p.pcpu;
      if (p.pid === process.pid) mainRssMB = rssMB;
      const cat = categorize(p.comm);
      if (cat === "gpu") gpuRssMB += rssMB;
      else if (cat === "helper") helperRssMB += rssMB;
      // Detail entry: pid:basename(comm):rssMB:cpu% — basename so we
      // don't blow the line width on absolute paths.
      const short = basename(p.comm).slice(0, 40);
      detail.push(`${p.pid}:${short}:${rssMB.toFixed(0)}:${p.pcpu.toFixed(1)}`);
    }

    const row =
      [
        new Date().toISOString(),
        ((Date.now() - startedAt) / 1000).toFixed(1),
        String(tree.length),
        totalRssMB.toFixed(1),
        mainRssMB.toFixed(1),
        gpuRssMB.toFixed(1),
        helperRssMB.toFixed(1),
        totalCpu.toFixed(1),
        detail.join(","),
      ].join("\t") + "\n";

    appendFileSync(logPath, row);
  } catch (e) {
    // Never crash the host. Worst case we miss a tick.
    console.warn("[process-stats] poll failed (continuing):", e);
  }
}
