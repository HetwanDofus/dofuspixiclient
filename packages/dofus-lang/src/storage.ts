/**
 * Persistent bundle cache backed by `bun:sqlite`.
 *
 * SQLite used as a K/V blob store wins on both axes we care about here:
 *
 *   - Performance: synchronous native API, single file I/O, WAL journal,
 *     compressed blob storage — the fastest option available in a Bun
 *     runtime for our bundle sizes (items_fr is ~3 MB parsed, tens of MB
 *     across locales).
 *   - Stability: one process-local file, no eviction pressure, no promise
 *     chains to await per read.
 *
 * The store is dead simple — one table of `(key TEXT PRIMARY KEY, value BLOB)`
 * — with `value` being a UTF-8 JSON payload. Every read/write is synchronous.
 */

import { Database } from "bun:sqlite";

import type { LangBundle } from "./index.ts";

export interface LangStorage {
  /** Read a cached bundle, or `undefined` on miss. */
  get(key: string): LangBundle | undefined;
  /** Persist a bundle. */
  put(key: string, bundle: LangBundle): void;
  /** Wipe the entire cache. */
  clear(): void;
  /** Close underlying resources. */
  close(): void;
}

/** SQLite-backed storage. The file path controls persistence. */
export class BunSqliteStorage implements LangStorage {
  private readonly db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true });
    // Pragmas tuned for write-heavy cache workloads on small files.
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS lang_bundles (" +
        "  key   TEXT PRIMARY KEY," +
        "  value BLOB NOT NULL," +
        "  updated_at INTEGER NOT NULL" +
        ")"
    );
  }

  get(key: string): LangBundle | undefined {
    const row = this.db
      .query<{ value: Uint8Array }, [string]>(
        "SELECT value FROM lang_bundles WHERE key = ?"
      )
      .get(key);
    if (!row) return undefined;
    try {
      return JSON.parse(new TextDecoder().decode(row.value)) as LangBundle;
    } catch {
      return undefined;
    }
  }

  put(key: string, bundle: LangBundle): void {
    const bytes = new TextEncoder().encode(JSON.stringify(bundle));
    this.db
      .query(
        "INSERT INTO lang_bundles(key, value, updated_at) VALUES (?, ?, ?) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
      )
      .run(key, bytes, Date.now());
  }

  clear(): void {
    this.db.exec("DELETE FROM lang_bundles");
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Zero-persistence in-memory fallback. Useful for tests where you want to
 * assert behaviour without touching disk — not used by default, since the
 * runtime is always Bun.
 */
export class MemoryStorage implements LangStorage {
  private readonly map = new Map<string, LangBundle>();

  get(key: string): LangBundle | undefined {
    return this.map.get(key);
  }

  put(key: string, bundle: LangBundle): void {
    this.map.set(key, bundle);
  }

  clear(): void {
    this.map.clear();
  }

  close(): void {
    this.map.clear();
  }
}

/**
 * Default storage — always `bun:sqlite`. Pass a file path for persistence;
 * defaults to `:memory:` so callers that don't care about persistence can
 * still benefit from the native synchronous K/V cache.
 */
export function defaultStorage(path: string = ":memory:"): LangStorage {
  return new BunSqliteStorage(path);
}
