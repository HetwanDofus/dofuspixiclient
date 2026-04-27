/**
 * The canonical list of Dofus 1.29 i18n namespaces. Mirrors the set emitted
 * by the asset-pipeline's `pipeline langs` command (one SWF per
 * namespace × locale). Namespaces marked `client` ship in bundles served
 * directly to the browser; `server` namespaces are loaded from the game
 * server's Postgres `i18n.<namespace>` tables and streamed on demand.
 *
 * The placement is a product decision (who owns the data), not a shape one
 * — both use identical `<namespace>_<locale>.json` bundle format.
 */

export const CLIENT_NAMESPACES = [
  "lang",
  "hints",
  "kb",
  "shortcuts",
  "emotes",
  "ranks",
  "maps",
  "audio",
  "ttg",
  "fightChallenge",
] as const;

export const SERVER_NAMESPACES = [
  "items",
  "itemstats",
  "itemsets",
  "spells",
  "effects",
  "monsters",
  "npc",
  "dialog",
  "quests",
  "dungeons",
  "crafts",
  "rides",
  "states",
  "speakingitems",
  "jobs",
  "alignment",
  "classes",
  "guilds",
  "pvp",
  "houses",
  "interactiveobjects",
  "skills",
  "titles",
  "subtitles",
  "timezones",
  "names",
  "servers",
  "scripts",
] as const;

export type ClientNamespace = (typeof CLIENT_NAMESPACES)[number];
export type ServerNamespace = (typeof SERVER_NAMESPACES)[number];
export type Namespace = ClientNamespace | ServerNamespace;

export const SUPPORTED_LOCALES = ["fr", "en", "de", "es", "it", "nl", "pt"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "fr";
