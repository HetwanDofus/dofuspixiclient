import {
  CLIENT_NAMESPACES,
  DEFAULT_LOCALE,
  type Locale,
  type Namespace,
} from "./namespaces.ts";
import { defaultStorage, type LangStorage } from "./storage.ts";
import {
  normalizeAlignmentBundle,
  normalizeClassesBundle,
  normalizeCraftsBundle,
  normalizeDialogBundle,
  normalizeDungeonsBundle,
  normalizeEffectsBundle,
  normalizeGuildsBundle,
  normalizeHousesBundle,
  normalizeInteractiveObjectsBundle,
  normalizeItemSetsBundle,
  normalizeItemStatsBundle,
  normalizeItemsBundle,
  normalizeJobsBundle,
  normalizeMapsBundle,
  normalizeMonstersBundle,
  normalizeNamesBundle,
  normalizeNpcBundle,
  normalizePvpBundle,
  normalizeQuestsBundle,
  normalizeRidesBundle,
  normalizeScriptsBundle,
  normalizeServersBundle,
  normalizeSkillsBundle,
  normalizeSpeakingItemsBundle,
  normalizeSpellsBundle,
  normalizeStatesBundle,
  normalizeSubtitlesBundle,
  normalizeTimezonesBundle,
  normalizeTitlesBundle,
  normalizeUiStringsBundle,
  type AlignmentBundle,
  type ClassesBundle,
  type CraftsBundle,
  type DialogBundle,
  type Dungeon,
  type DungeonsBundle,
  type EffectsBundle,
  type FightState,
  type GuildsBundle,
  type HousesBundle,
  type InteractiveObjectsBundle,
  type Item,
  type ItemSetsBundle,
  type ItemsBundle,
  type JobsBundle,
  type MapsBundle,
  type Monster,
  type MonstersBundle,
  type NamesBundle,
  type NpcBundle,
  type PvpBundle,
  type Quest,
  type QuestsBundle,
  type Ride,
  type RidesBundle,
  type ServersBundle,
  type SkillsBundle,
  type SpeakingItemsBundle,
  type Spell,
  type SpellsBundle,
  type StatesBundle,
  type StringTableBundle,
  type SubtitlesBundle,
  type TimezonesBundle,
  type TitlesBundle,
  type UiStringsBundle,
} from "./schemas/index.ts";

export type {
  ClientNamespace,
  Locale,
  Namespace,
  ServerNamespace,
} from "./namespaces.ts";
export {
  CLIENT_NAMESPACES,
  SERVER_NAMESPACES,
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
} from "./namespaces.ts";
export * from "./schemas/index.ts";

/**
 * Raw bundle shape produced by the asset-pipeline's AS2-walking extractor.
 * The walker mirrors the live globals after running the SWF's bytecode, so
 * each namespace has its own tree shape (see packages/dofus-lang/src/schemas).
 */
export interface LangBundle {
  schema: string;
  data: Record<string, unknown>;
  stats?: {
    poolSize?: number;
    topLevelKeys?: string[];
    unknownOpcodes?: Record<string, number>;
  };
}

export interface LoadOptions {
  /** Base URL to fetch bundles from — defaults to `/assets/langs`. */
  basePath?: string;
  /** Cache-busting token appended as `?v=<token>` so stale cache entries refresh. */
  version?: string;
  /**
   * Persistent storage backend. Defaults to `bun:sqlite` in Bun runtimes
   * (fast native blob K/V) and an in-memory Map elsewhere. Pass a custom
   * `LangStorage` to swap in another backing store.
   */
  storage?: LangStorage;
  /** SQLite file path — used only when the default Bun-SQLite backend is picked. */
  sqlitePath?: string;
}

function bundleKey(locale: Locale, namespace: Namespace, version?: string): string {
  return `${locale}/${namespace}${version ? `@${version}` : ""}`;
}

/**
 * Interpolate Dofus-native placeholders into a translation template:
 *
 *   "%1 a atteint le niveau %2" + [Charlie, 42]   → "Charlie a atteint le niveau 42"
 *   "Salut, {name} !"           + { name: "Iop" } → "Salut, Iop !"
 */
export function interpolate(
  template: string,
  params?: readonly (string | number)[] | Record<string, unknown>
): string {
  if (!params) return template;

  let result = template;
  if (Array.isArray(params)) {
    for (let i = 0; i < params.length; i++) {
      result = result.replaceAll(`%${i + 1}`, String(params[i]));
    }
  } else if (typeof params === "object") {
    const obj = params as Record<string, unknown>;
    result = result.replace(/\{(\w+)\}/g, (match, key) =>
      key in obj ? String(obj[key as keyof typeof obj]) : match
    );
  }
  return result;
}

/** Walk a dotted or segmented path into a tree. Returns `undefined` on miss. */
export function getByPath(
  root: unknown,
  path: string | readonly (string | number)[]
): unknown {
  const segments = Array.isArray(path) ? path : String(path).split(".");
  let cur: unknown = root;
  for (const seg of segments) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[String(seg)];
  }
  return cur;
}

/**
 * Lightweight i18n runtime. Namespaces are fetched lazily on first access
 * and cached in IndexedDB so the second cold load skips the network entirely.
 *
 * Each namespace carries its own schema (items has `I.u[id] = Item`, spells
 * `S[id] = Spell`, lang is flat `KEY = "value"`). Typed accessors —
 * `getItem`, `getSpell`, `getMonster`, `uiString` — normalize the raw short
 * keys into the readable shapes defined in `packages/dofus-lang/src/schemas`.
 *
 * For anything a typed accessor doesn't cover, `getRaw(ns, path)` walks the
 * raw tree (e.g. `getRaw("items", "I.us.0")` → `"Amulette"`).
 */
export class DofusLang {
  private locale: Locale = DEFAULT_LOCALE;
  private readonly basePath: string;
  private readonly version: string | undefined;
  private readonly mem = new Map<string, LangBundle>();
  private readonly pending = new Map<string, Promise<LangBundle | null>>();
  private readonly storage: LangStorage;

  /**
   * Normalized caches — one entry per (locale, namespace). Values are
   * whatever the per-namespace normalizer returns, boxed as `unknown` here
   * and narrowed by the typed accessor methods below.
   */
  private readonly normalizedCache = new Map<string, unknown>();
  /**
   * In-flight normalize promises, keyed the same way as `normalizedCache`.
   * Lets N concurrent typed-accessor calls share a single normalize pass.
   */
  private readonly pendingNormalized = new Map<string, Promise<unknown>>();

  constructor(opts: LoadOptions = {}) {
    this.basePath = (opts.basePath ?? "/assets/langs").replace(/\/+$/, "");
    this.version = opts.version;
    this.storage = opts.storage ?? defaultStorage(opts.sqlitePath);
  }

  getLocale(): Locale {
    return this.locale;
  }

  async setLocale(locale: Locale): Promise<void> {
    this.locale = locale;
    this.mem.clear();
    this.normalizedCache.clear();
  }

  async preload(namespaces: Namespace[]): Promise<void> {
    await Promise.all(namespaces.map((ns) => this.loadNamespace(ns)));
  }

  /** Raw bundle fetch. Prefer typed accessors when the namespace has one. */
  async loadNamespace(namespace: Namespace): Promise<LangBundle | null> {
    const key = bundleKey(this.locale, namespace, this.version);
    const cached = this.mem.get(key);
    if (cached) return cached;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const promise = this.fetchWithCache(namespace, key);
    this.pending.set(key, promise);
    try {
      return await promise;
    } finally {
      this.pending.delete(key);
    }
  }

  /** Walk a dotted path inside a namespace's raw tree. */
  async getRaw(
    namespace: Namespace,
    path: string | readonly (string | number)[]
  ): Promise<unknown> {
    const bundle = await this.loadNamespace(namespace);
    return bundle ? getByPath(bundle.data, path) : undefined;
  }

  // ── Typed accessors ─────────────────────────────────────────────────────

  /**
   * Generic normalised-bundle fetch. Caller supplies the namespace + the
   * normaliser; the result gets cached per (locale, namespace) and the
   * typed accessor methods below are all built on top of this.
   *
   * Dedupes two ways:
   *   - Resolved results are cached in `normalizedCache` (fast path).
   *   - In-flight normalizations go through `pendingNormalized` so N
   *     concurrent `getSpell()` calls (2036 on a level-200 Dofus character)
   *     all await the SAME promise instead of each re-running a 2091-entry
   *     Map build — the difference is 22 s vs 11 ms on that call site.
   */
  private typedBundle<T>(
    namespace: Namespace,
    normalize: (data: unknown) => T | null
  ): Promise<T | null> {
    const cacheKey = `${this.locale}:${namespace}`;
    if (this.normalizedCache.has(cacheKey)) {
      return Promise.resolve(
        this.normalizedCache.get(cacheKey) as T | null
      );
    }
    const pending = this.pendingNormalized.get(cacheKey) as
      | Promise<T | null>
      | undefined;
    if (pending) return pending;

    const promise = (async () => {
      const raw = await this.loadNamespace(namespace);
      const out = raw ? normalize(raw.data) : null;
      this.normalizedCache.set(cacheKey, out);
      return out;
    })();
    this.pendingNormalized.set(cacheKey, promise);
    promise.finally(() => {
      this.pendingNormalized.delete(cacheKey);
    });
    return promise;
  }

  items(): Promise<ItemsBundle | null> {
    return this.typedBundle("items", normalizeItemsBundle);
  }
  async getItem(id: number): Promise<Item | undefined> {
    return (await this.items())?.items.get(id);
  }

  spells(): Promise<SpellsBundle | null> {
    return this.typedBundle("spells", normalizeSpellsBundle);
  }
  async getSpell(id: number): Promise<Spell | undefined> {
    return (await this.spells())?.spells.get(id);
  }
  /**
   * Sync `spells()` that returns the cached normalized bundle or `null` if
   * it hasn't been resolved yet. Callers that iterate large spellbooks
   * (a level-200 Dofus character has 2036 learned spells) should use this
   * + `await preload(["spells"])` up front to avoid per-call promise
   * overhead — 2036 awaited no-op promises still pay N microtasks.
   */
  spellsSync(): SpellsBundle | null {
    const cacheKey = `${this.locale}:spells`;
    return (this.normalizedCache.get(cacheKey) as SpellsBundle | null) ?? null;
  }

  monsters(): Promise<MonstersBundle | null> {
    return this.typedBundle("monsters", normalizeMonstersBundle);
  }
  async getMonster(id: number): Promise<Monster | undefined> {
    return (await this.monsters())?.monsters.get(id);
  }

  effects(): Promise<EffectsBundle | null> {
    return this.typedBundle("effects", normalizeEffectsBundle);
  }
  itemSets(): Promise<ItemSetsBundle | null> {
    return this.typedBundle("itemsets", normalizeItemSetsBundle);
  }
  jobs(): Promise<JobsBundle | null> {
    return this.typedBundle("jobs", normalizeJobsBundle);
  }

  // ── Extended namespaces ────────────────────────────────────────────────

  classes(): Promise<ClassesBundle | null> {
    return this.typedBundle("classes", normalizeClassesBundle);
  }
  npcs(): Promise<NpcBundle | null> {
    return this.typedBundle("npc", normalizeNpcBundle);
  }
  dialog(): Promise<DialogBundle | null> {
    return this.typedBundle("dialog", normalizeDialogBundle);
  }
  maps(): Promise<MapsBundle | null> {
    return this.typedBundle("maps", normalizeMapsBundle);
  }
  houses(): Promise<HousesBundle | null> {
    return this.typedBundle("houses", normalizeHousesBundle);
  }
  interactiveObjects(): Promise<InteractiveObjectsBundle | null> {
    return this.typedBundle("interactiveobjects", normalizeInteractiveObjectsBundle);
  }
  quests(): Promise<QuestsBundle | null> {
    return this.typedBundle("quests", normalizeQuestsBundle);
  }
  async getQuest(id: number): Promise<Quest | undefined> {
    return (await this.quests())?.quests.get(id);
  }
  dungeons(): Promise<DungeonsBundle | null> {
    return this.typedBundle("dungeons", normalizeDungeonsBundle);
  }
  async getDungeon(id: number): Promise<Dungeon | undefined> {
    return (await this.dungeons())?.dungeons.get(id);
  }
  rides(): Promise<RidesBundle | null> {
    return this.typedBundle("rides", normalizeRidesBundle);
  }
  async getRide(id: number): Promise<Ride | undefined> {
    return (await this.rides())?.rides.get(id);
  }
  skills(): Promise<SkillsBundle | null> {
    return this.typedBundle("skills", normalizeSkillsBundle);
  }
  speakingItems(): Promise<SpeakingItemsBundle | null> {
    return this.typedBundle("speakingitems", normalizeSpeakingItemsBundle);
  }
  states(): Promise<StatesBundle | null> {
    return this.typedBundle("states", normalizeStatesBundle);
  }
  async getState(id: number): Promise<FightState | undefined> {
    return (await this.states())?.states.get(id);
  }
  titles(): Promise<TitlesBundle | null> {
    return this.typedBundle("titles", normalizeTitlesBundle);
  }
  alignment(): Promise<AlignmentBundle | null> {
    return this.typedBundle("alignment", normalizeAlignmentBundle);
  }
  crafts(): Promise<CraftsBundle | null> {
    return this.typedBundle("crafts", normalizeCraftsBundle);
  }
  guilds(): Promise<GuildsBundle | null> {
    return this.typedBundle("guilds", normalizeGuildsBundle);
  }
  pvp(): Promise<PvpBundle | null> {
    return this.typedBundle("pvp", normalizePvpBundle);
  }
  servers(): Promise<ServersBundle | null> {
    return this.typedBundle("servers", normalizeServersBundle);
  }
  itemStats(): Promise<StringTableBundle | null> {
    return this.typedBundle("itemstats", normalizeItemStatsBundle);
  }
  subtitles(): Promise<SubtitlesBundle | null> {
    return this.typedBundle("subtitles", normalizeSubtitlesBundle);
  }
  scripts(): Promise<StringTableBundle | null> {
    return this.typedBundle("scripts", normalizeScriptsBundle);
  }
  names(): Promise<NamesBundle | null> {
    return this.typedBundle("names", normalizeNamesBundle);
  }
  timezones(): Promise<TimezonesBundle | null> {
    return this.typedBundle("timezones", normalizeTimezonesBundle);
  }

  /**
   * Flat UI-string namespace lookup. Covers `lang`, `hints`, `kb`,
   * `shortcuts`, `emotes`, `ranks`, `audio`, `ttg`, `fightChallenge` —
   * everything shipped as `CONSTANT_NAME = "template"`.
   */
  async uiString(
    namespace: Namespace,
    key: string,
    params?: readonly (string | number)[] | Record<string, unknown>
  ): Promise<string | undefined> {
    const bundle = await this.typedBundle<UiStringsBundle>(
      namespace,
      normalizeUiStringsBundle
    );
    const template = bundle?.strings.get(key);
    return template !== undefined ? interpolate(template, params) : undefined;
  }

  /** Clear the persistent cache — call after a release bump or version change. */
  clearCache(): void {
    this.storage.clear();
    this.mem.clear();
    this.normalizedCache.clear();
  }

  /** Release underlying resources (closes the SQLite handle when applicable). */
  close(): void {
    this.storage.close();
  }

  private async fetchWithCache(
    namespace: Namespace,
    key: string
  ): Promise<LangBundle | null> {
    const cached = this.storage.get(key);
    if (cached) {
      this.mem.set(key, cached);
      return cached;
    }

    const url = `${this.basePath}/${this.locale}/${namespace}.json${
      this.version ? `?v=${encodeURIComponent(this.version)}` : ""
    }`;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const bundle = (await res.json()) as LangBundle;
      this.mem.set(key, bundle);
      this.storage.put(key, bundle);
      return bundle;
    } catch {
      return null;
    }
  }
}

export { BunSqliteStorage, MemoryStorage, defaultStorage, type LangStorage } from "./storage.ts";

/** Which namespaces ship to the client as static bundles. */
export const BROWSER_BUNDLED_NAMESPACES: ReadonlySet<Namespace> = new Set(
  CLIENT_NAMESPACES
);
