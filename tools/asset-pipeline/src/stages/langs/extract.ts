import { mkdir, readdir } from "node:fs/promises";
import { basename, dirname } from "node:path";

import { logger } from "../../logger.ts";
import { distLangsBundlePath, langsSourceDir } from "../../paths.ts";
import { runPhp } from "../extract/php-runner.ts";

export interface LangSwfFile {
  namespace: string;
  locale: string;
  version: string;
  path: string;
}

export interface LangBundleEntry {
  namespace: string;
  locale: string;
  bundlePath: string;
  entryCount: number;
  mode: string;
}

export interface LangExtractOptions {
  /** Only process a single namespace (e.g. "lang"). */
  filterNamespace?: string;
  /** Only process a single locale (e.g. "fr"). */
  filterLocale?: string;
}

export interface LangExtractResult {
  bundles: LangBundleEntry[];
  skipped: number;
  failed: number;
  durationMs: number;
}

const LANG_FILE_REGEX = /^([a-zA-Z]+)_([a-z]{2})_(\d+)\.swf$/;

/**
 * Enumerate `<namespace>_<locale>_<version>.swf` files under the langs source
 * directory. The version suffix is dropped from the bundle name — we always
 * take the highest version if multiples are present.
 */
export async function discoverLangSwfs(sourceDir: string): Promise<LangSwfFile[]> {
  const files = await readdir(sourceDir);
  const byKey = new Map<string, LangSwfFile>();

  for (const f of files) {
    const m = f.match(LANG_FILE_REGEX);
    if (!m) continue;
    const namespace = m[1]!;
    const locale = m[2]!;
    const version = m[3]!;
    const key = `${namespace}:${locale}`;
    const existing = byKey.get(key);
    if (!existing || Number(version) > Number(existing.version)) {
      byKey.set(key, {
        namespace,
        locale,
        version,
        path: `${sourceDir}/${f}`,
      });
    }
  }

  return [...byKey.values()].sort((a, b) =>
    a.namespace.localeCompare(b.namespace) || a.locale.localeCompare(b.locale)
  );
}

export async function extractLangs(
  opts: LangExtractOptions = {}
): Promise<LangExtractResult> {
  const sourceDir = langsSourceDir();
  const start = performance.now();

  const swfs = await discoverLangSwfs(sourceDir);
  const bundles: LangBundleEntry[] = [];
  let skipped = 0;
  let failed = 0;

  for (const swf of swfs) {
    if (opts.filterNamespace && swf.namespace !== opts.filterNamespace) {
      skipped++;
      continue;
    }
    if (opts.filterLocale && swf.locale !== opts.filterLocale) {
      skipped++;
      continue;
    }

    const bundlePath = distLangsBundlePath(swf.locale, swf.namespace);
    await mkdir(dirname(bundlePath), { recursive: true });

    try {
      await runPhp({
        binName: "extract-langs",
        args: ["--input", swf.path, "--output", bundlePath],
        captureStdout: true,
      });

      const data = await Bun.file(bundlePath).json();
      bundles.push({
        namespace: swf.namespace,
        locale: swf.locale,
        bundlePath,
        entryCount: data.entryCount ?? data.count ?? 0,
        mode: data.mode ?? "as2-walk",
      });
    } catch (err) {
      failed++;
      logger.warn(
        {
          namespace: swf.namespace,
          locale: swf.locale,
          source: basename(swf.path),
          err: (err as Error).message,
        },
        "extract:langs failed"
      );
    }
  }

  return {
    bundles,
    skipped,
    failed,
    durationMs: Math.round(performance.now() - start),
  };
}
