/**
 * IndexedDB persistence for the Vello sub-scene cache.
 *
 * What we store: serialized `body_subscene_cache` blobs from vello-wasm,
 * one row per (bundle, content_hash). The format is the "VSC1" wire
 * format defined in `rust/vello-wasm/src/scene_cache.rs` — fully
 * resolution-independent (sub-scenes encode at twip identity, the
 * runtime applies the scale factor at render time).
 *
 * Cache key shape:
 *   `${SCENE_FORMAT_VERSION}|${bundleName}|${bundleContentHash}`
 *
 * The format-version prefix means any incompatible change to either
 * the Rust wire format OR the JS contract auto-invalidates the on-disk
 * cache without explicit cleanup. The content hash means an SWF asset
 * update auto-invalidates its row (different hash → different key).
 *
 * Storage budget: the renderer pool sits at ~150 MB body sub-scenes
 * across the 24-character roster, so the IDB cap defaults to 256 MB
 * (with LRU eviction on overflow). One blob per bundle keeps writes
 * atomic — partial writes can't corrupt other bundles.
 */

import { createLogger } from "@/utils/logger";

const log = createLogger("SceneCacheIDB");

/** Bumped any time the Rust wire format OR the JS contract changes
 *  in an incompatible way. Bumped to 2 when the Rust wire format
 *  moved from `VSC1` (body-only) to `VSC2` (cache-id tagged: body,
 *  tile, accessory). Pre-bump rows are auto-invalidated because the
 *  composite IDB key prefixes the format version. */
export const SCENE_FORMAT_VERSION = 2;

/** Cache type tag — mirrors `scene_cache.rs::CacheId`. Persisted as
 *  part of the IDB composite key so the same DB can hold all the
 *  cache types without collisions.
 *
 *  - `body`: per-frame/band `body_subscene_cache` (class-atlas path).
 *  - `tile`: map tile subscenes.
 *  - `acc`: accessory strip subscenes (`acc_subscenes`).
 *  - `bodyscene`: COMPOSED per-variant body atlas scenes
 *    (`body_scene_cache`) — the cache the per-variant SPAWN path
 *    actually reads. Blob holds entries for every baked resolution
 *    (scale_q is inside each entry's key), so one row per bundle. */
export type SceneCacheKind = "body" | "tile" | "acc" | "bodyscene";

const DB_NAME = "dofus-scene-cache";
const DB_VERSION = 1;
const STORE_NAME = "subscenes";
/** Default LRU cap (bytes). Keeps tail-end variants on disk for
 *  returning sessions without growing unboundedly when content hashes
 *  churn across SWF updates. */
const DEFAULT_CACHE_CAP_BYTES = 256 * 1024 * 1024;

interface SubsceneRow {
  /** Composite key — `${version}|${bundle}|${hash}`. */
  key: string;
  bundleName: string;
  contentHash: string;
  formatVersion: number;
  bytes: Uint8Array;
  createdAt: number;
  /** Last read wall-clock — used for LRU eviction. Updated lazily on
   *  hit so the read path stays cheap (one update per row at boot,
   *  not per access). */
  lastAccessedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function compositeKey(
  bundleName: string,
  contentHash: string,
  kind: SceneCacheKind = "body",
  formatVersion: number = SCENE_FORMAT_VERSION,
): string {
  // Format `v<N>|<kind>|<bundle>|<hash>`. The kind segment must be
  // present on every row written under SCENE_FORMAT_VERSION ≥ 2.
  // Pre-v2 rows lacked it and are auto-invalidated by the version
  // bump (different prefix → never matched).
  return `${formatVersion}|${kind}|${bundleName}|${contentHash}`;
}

/** Open (or create) the database. Cached promise so concurrent callers
 *  share one IDB handle. */
function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB not available"));
  }
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // Store keyed by `key` (composite); other fields searchable
        // via indices for diagnostic queries.
        const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex("bundleName", "bundleName", { unique: false });
        store.createIndex("lastAccessedAt", "lastAccessedAt", {
          unique: false,
        });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IDB open failed"));
    req.onblocked = () =>
      log.warn("IDB open blocked — another tab holds the DB open");
  });
  return dbPromise;
}

/**
 * Read a previously-persisted scene blob for (bundle, contentHash).
 * Returns `null` on miss, parse error, or unavailable IDB — caller
 * always falls back to a fresh bake.
 *
 * Also bumps `lastAccessedAt` on a hit (best-effort, ignores write
 * errors) so LRU eviction prefers entries actually used by the current
 * roster over stale ones.
 */
export async function getSubsceneBlob(
  bundleName: string,
  contentHash: string,
  kind: SceneCacheKind = "body",
): Promise<Uint8Array | null> {
  let db: IDBDatabase;
  try {
    db = await getDb();
  } catch (e) {
    log.warn("getSubsceneBlob: IDB unavailable", e);
    return null;
  }
  const key = compositeKey(bundleName, contentHash, kind);
  return new Promise<Uint8Array | null>((resolve) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(key);
    getReq.onsuccess = () => {
      const row = getReq.result as SubsceneRow | undefined;
      if (!row) {
        resolve(null);
        return;
      }
      // Bump access timestamp (LRU). Best-effort; if the put fails the
      // read still succeeds for this caller.
      try {
        row.lastAccessedAt = Date.now();
        store.put(row);
      } catch {}
      resolve(row.bytes);
    };
    getReq.onerror = () => {
      log.warn(`getSubsceneBlob: IDB get failed for '${key}'`, getReq.error);
      resolve(null);
    };
  });
}

/**
 * Persist a scene blob. Best-effort: a write failure is logged and
 * silently swallowed (in-memory cache stays valid for this session).
 *
 * Enforces the LRU cap AFTER inserting — overshooting briefly is fine
 * and keeps the write path one transaction.
 */
export async function putSubsceneBlob(
  bundleName: string,
  contentHash: string,
  bytes: Uint8Array,
  kind: SceneCacheKind = "body",
  capBytes: number = DEFAULT_CACHE_CAP_BYTES,
): Promise<void> {
  let db: IDBDatabase;
  try {
    db = await getDb();
  } catch (e) {
    log.warn("putSubsceneBlob: IDB unavailable", e);
    return;
  }
  const key = compositeKey(bundleName, contentHash, kind);
  const now = Date.now();
  const row: SubsceneRow = {
    key,
    bundleName,
    contentHash,
    formatVersion: SCENE_FORMAT_VERSION,
    bytes,
    createdAt: now,
    lastAccessedAt: now,
  };
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      log.warn(`putSubsceneBlob: IDB put failed for '${key}'`, tx.error);
      resolve();
    };
  });
  // LRU eviction pass — fire-and-forget so the bake write returns
  // promptly. Eviction errors are non-fatal.
  void evictIfOverCap(capBytes).catch((e) =>
    log.warn("evictIfOverCap failed", e),
  );
}

/**
 * Total bytes currently held in the store. Cheap-ish: walks every row
 * but only reads the `bytes.length` field. Call from diagnostics, not
 * the hot path.
 */
export async function getTotalBytes(): Promise<number> {
  let db: IDBDatabase;
  try {
    db = await getDb();
  } catch {
    return 0;
  }
  return new Promise<number>((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.openCursor();
    let total = 0;
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(total);
        return;
      }
      const row = cursor.value as SubsceneRow;
      total += row.bytes.byteLength;
      cursor.continue();
    };
    req.onerror = () => resolve(0);
  });
}

/**
 * LRU eviction: while total bytes > cap, drop oldest-by-lastAccessedAt
 * rows. Walks the lastAccessedAt index so eviction order is correct
 * even if rows were inserted out of access order.
 */
async function evictIfOverCap(capBytes: number): Promise<void> {
  const total = await getTotalBytes();
  if (total <= capBytes) return;
  const db = await getDb();
  let used = total;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("lastAccessedAt");
    const cursorReq = index.openCursor(null, "next"); // ascending = oldest first
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor || used <= capBytes) {
        resolve();
        return;
      }
      const row = cursor.value as SubsceneRow;
      used -= row.bytes.byteLength;
      cursor.delete();
      cursor.continue();
    };
    cursorReq.onerror = () => {
      log.warn("evictIfOverCap: cursor error", cursorReq.error);
      resolve();
    };
  });
}

/**
 * Hydrate ALL three sub-scene caches (body, tile, accessory) for one
 * bundle. Each cache type has its own IDB row keyed by
 * `(formatVersion, kind, bundle, contentHash)`. Returns the count
 * of entries loaded per kind so the caller can log a digest.
 *
 * Failure for any single cache kind is non-fatal: we log + fall
 * back to fresh bakes for that kind only. Other kinds proceed
 * independently.
 *
 * Why this exists: every SWF bundle (character sprite, world tile,
 * accessory) potentially has cached sub-scenes for all three. The
 * body cache is populated by class-atlas bakes; tile cache by tile
 * frame bakes; acc cache by accessory strip bakes. On a returning
 * session we want every one of them hot before the first bake fires.
 */
export interface HydrateResult {
  bodyLoaded: number;
  tileLoaded: number;
  accLoaded: number;
  /** Composed per-variant body atlas scenes (`body_scene_cache`) —
   *  the cache the spawn path reads. This is the one that warms a
   *  cold map entry. */
  bodySceneLoaded: number;
}

export async function hydrateBundleSubsceneCaches(
  bundleName: string,
  contentHash: string,
  loaders: {
    loadBody: (bytes: Uint8Array) => number;
    loadTile: (bytes: Uint8Array) => number;
    loadAcc: (bytes: Uint8Array) => number;
    loadBodyScene: (bytes: Uint8Array) => number;
  },
): Promise<HydrateResult> {
  const result: HydrateResult = {
    bodyLoaded: 0,
    tileLoaded: 0,
    accLoaded: 0,
    bodySceneLoaded: 0,
  };
  const [bodyBlob, tileBlob, accBlob, bodySceneBlob] = await Promise.all([
    getSubsceneBlob(bundleName, contentHash, "body"),
    getSubsceneBlob(bundleName, contentHash, "tile"),
    getSubsceneBlob(bundleName, contentHash, "acc"),
    getSubsceneBlob(bundleName, contentHash, "bodyscene"),
  ]);
  if (bodyBlob) {
    try {
      result.bodyLoaded = loaders.loadBody(bodyBlob);
    } catch (e) {
      log.warn(`hydrate ${bundleName} body failed`, e);
    }
  }
  if (tileBlob) {
    try {
      result.tileLoaded = loaders.loadTile(tileBlob);
    } catch (e) {
      log.warn(`hydrate ${bundleName} tile failed`, e);
    }
  }
  if (accBlob) {
    try {
      result.accLoaded = loaders.loadAcc(accBlob);
    } catch (e) {
      log.warn(`hydrate ${bundleName} acc failed`, e);
    }
  }
  if (bodySceneBlob) {
    try {
      result.bodySceneLoaded = loaders.loadBodyScene(bodySceneBlob);
    } catch (e) {
      log.warn(`hydrate ${bundleName} bodyscene failed`, e);
    }
  }
  return result;
}

/**
 * Persist ALL three sub-scene caches (body, tile, accessory) for one
 * bundle. Each `serializeX` callback returns either bytes to persist
 * or null (empty cache / encode error → skip). Persisting empty
 * caches would just waste IDB transactions, so we skip nulls and
 * zero-byte returns.
 *
 * Returns the count of cache kinds actually written. Errors are
 * logged and swallowed — partial persistence is fine; the next flush
 * will retry.
 */
export interface PersistResult {
  bodyWritten: boolean;
  tileWritten: boolean;
  accWritten: boolean;
  bodySceneWritten: boolean;
}

export async function persistBundleSubsceneCaches(
  bundleName: string,
  contentHash: string,
  serializers: {
    serializeBody: () => Uint8Array | null;
    serializeTile: () => Uint8Array | null;
    serializeAcc: () => Uint8Array | null;
    serializeBodyScene: () => Uint8Array | null;
  },
): Promise<PersistResult> {
  const result: PersistResult = {
    bodyWritten: false,
    tileWritten: false,
    accWritten: false,
    bodySceneWritten: false,
  };
  const bodyBytes = serializers.serializeBody();
  const tileBytes = serializers.serializeTile();
  const accBytes = serializers.serializeAcc();
  const bodySceneBytes = serializers.serializeBodyScene();
  const writes: Promise<void>[] = [];
  if (bodyBytes && bodyBytes.length > 0) {
    writes.push(
      putSubsceneBlob(bundleName, contentHash, bodyBytes, "body").then(() => {
        result.bodyWritten = true;
      }),
    );
  }
  if (tileBytes && tileBytes.length > 0) {
    writes.push(
      putSubsceneBlob(bundleName, contentHash, tileBytes, "tile").then(() => {
        result.tileWritten = true;
      }),
    );
  }
  if (accBytes && accBytes.length > 0) {
    writes.push(
      putSubsceneBlob(bundleName, contentHash, accBytes, "acc").then(() => {
        result.accWritten = true;
      }),
    );
  }
  if (bodySceneBytes && bodySceneBytes.length > 0) {
    writes.push(
      putSubsceneBlob(bundleName, contentHash, bodySceneBytes, "bodyscene").then(
        () => {
          result.bodySceneWritten = true;
        },
      ),
    );
  }
  await Promise.all(writes);
  return result;
}

/**
 * Hex-encoded SHA-256 of a byte slice. Used to derive content hashes
 * for SWF bundles — invariant under any bake parameters, only changes
 * when the source asset changes.
 */
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < view.length; i++) {
    hex += view[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/** Drop everything in the store. Used by hot-reload / test harness. */
export async function clearAll(): Promise<void> {
  let db: IDBDatabase;
  try {
    db = await getDb();
  } catch {
    return;
  }
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/** Diagnostic-only — entry count + total bytes + per-format-version
 *  breakdown. Call from stress-test or HUD overlays. */
export async function getStats(): Promise<{
  entryCount: number;
  totalBytes: number;
  byFormatVersion: Record<number, number>;
}> {
  let db: IDBDatabase;
  try {
    db = await getDb();
  } catch {
    return { entryCount: 0, totalBytes: 0, byFormatVersion: {} };
  }
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.openCursor();
    let count = 0;
    let total = 0;
    const byVer: Record<number, number> = {};
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve({ entryCount: count, totalBytes: total, byFormatVersion: byVer });
        return;
      }
      const row = cursor.value as SubsceneRow;
      count++;
      total += row.bytes.byteLength;
      byVer[row.formatVersion] = (byVer[row.formatVersion] ?? 0) + 1;
      cursor.continue();
    };
    req.onerror = () =>
      resolve({ entryCount: count, totalBytes: total, byFormatVersion: byVer });
  });
}
