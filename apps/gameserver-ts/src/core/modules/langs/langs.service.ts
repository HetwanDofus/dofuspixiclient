import type { GameEnv } from "@shared/config/env.schema";
import {
  DofusLang,
  MemoryStorage,
  type Locale,
  type ServerNamespace,
  type Spell,
  type SpellsBundle,
} from "@dofus/dofus-lang";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Namespaces the gameserver needs resolved for message-building. Keep this
 * list tight — each namespace adds a few MB to the warm-up cost and the
 * locale multiplier compounds if we ever run multi-locale. Adding a new
 * namespace requires a preload entry here so it's hydrated before the first
 * request hits the handler that needs it.
 */
const SERVER_PRELOAD: ReadonlyArray<ServerNamespace> = ["spells"];

/**
 * Thin wrapper around `@dofus/dofus-lang`'s `DofusLang` that wires it for the
 * Node/Bun runtime:
 *
 *  - `basePath` is a `file://` URL so Bun's `fetch` reads bundles directly
 *    off disk without a loopback HTTP hop.
 *  - Storage is in-memory (`MemoryStorage`) — the DB/SQLite backend targets
 *    the browser; the server already has its own Postgres + RAM footprint.
 *  - `preload()` warms every namespace in `SERVER_PRELOAD` at boot so the
 *    first request that needs a translation hits a synchronous cache.
 *
 * Exposed as a Nest provider so handlers inject it via DI. The typed
 * accessors (`getSpell`, `getItem`, …) return `undefined` when an id is
 * missing; callers fall back to DB-stored names to avoid empty strings.
 */
@Injectable()
export class LangsService implements OnModuleInit {
  private readonly logger = new Logger(LangsService.name);
  private lang!: DofusLang;
  private spellsBundle: SpellsBundle | null = null;

  constructor(
    private readonly config: ConfigService<GameEnv, true>
  ) {}

  async onModuleInit(): Promise<void> {
    const dir = this.config.get("LANGS_DIR", { infer: true });
    const locale = this.config.get("DEFAULT_LOCALE", { infer: true }) as Locale;

    // `file://` URLs need a trailing slash on the directory to resolve
    // `fetch(new URL("foo.json", base))` correctly. Normalize here.
    const base = `file://${dir.replace(/\/+$/, "")}`;

    this.lang = new DofusLang({
      basePath: base,
      storage: new MemoryStorage(),
    });
    await this.lang.setLocale(locale);

    const t0 = performance.now();
    await this.lang.preload([...SERVER_PRELOAD]);
    // Resolve + cache the normalized bundles once so every subsequent
    // lookup is a single Map.get — no promise allocation, no microtask
    // hop. Critical for the enter-game path where a level-200 character
    // iterates 2036 learned spells in one `buildSpellList` call.
    this.spellsBundle = await this.lang.spells();
    const elapsed = Math.round(performance.now() - t0);
    this.logger.log(
      `langs ready: locale=${locale} namespaces=${SERVER_PRELOAD.join(",")} ` +
        `spellsBundle=${this.spellsBundle?.spells.size ?? 0} in ${elapsed}ms`
    );
  }

  /**
   * Synchronous spell lookup — hits the pre-warmed normalized bundle. Use
   * this on hot paths (spell list build, chat message formatting) where
   * paying per-call promise overhead adds up.
   */
  getSpellSync(id: number): Spell | undefined {
    return this.spellsBundle?.spells.get(id);
  }

  /**
   * Look up a spell's localized name+description. Returns `undefined` if the
   * id isn't in the current locale's bundle — caller should fall back to the
   * template name stored in Postgres.
   */
  async getSpell(id: number): Promise<Spell | undefined> {
    return this.lang.getSpell(id);
  }
}
