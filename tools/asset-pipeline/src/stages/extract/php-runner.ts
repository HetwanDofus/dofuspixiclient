import { spawn } from "node:child_process";

import { logger } from "../../logger.ts";
import { paths } from "../../paths.ts";

export interface PhpRunOptions {
  /** Name of the bin under tools/assets-exporter/bin (e.g. "extract-items"). */
  binName: string;
  /** Extra CLI args passed after the bin path. */
  args: string[];
  /** If true, capture stdout instead of streaming to the logger. */
  captureStdout?: boolean;
}

export interface PhpRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export async function runPhp(opts: PhpRunOptions): Promise<PhpRunResult> {
  const binPath = `${paths.assetsExporter}/bin/${opts.binName}`;
  const start = performance.now();

  return new Promise((resolveP, rejectP) => {
    const proc = spawn("php", [binPath, ...opts.args], {
      cwd: paths.assetsExporter,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      if (!opts.captureStdout) {
        for (const line of text.split("\n")) {
          if (line.trim().length > 0) logger.info({ php: opts.binName }, line);
        }
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      for (const line of text.split("\n")) {
        if (line.trim().length > 0) logger.warn({ php: opts.binName }, line);
      }
    });

    proc.on("error", rejectP);

    proc.on("close", (code) => {
      const durationMs = Math.round(performance.now() - start);
      const exitCode = code ?? -1;
      if (exitCode !== 0) {
        rejectP(
          new Error(
            `php ${opts.binName} exited with code ${exitCode} after ${durationMs}ms`
          )
        );
        return;
      }
      resolveP({ exitCode, stdout, stderr, durationMs });
    });
  });
}
