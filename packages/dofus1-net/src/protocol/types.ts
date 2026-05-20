// Shared shapes referenced by multiple message files.
//
// The per-message class files (e.g. `CharacterEntry` in
// `messages/account/characters.ts`, `GameServerEntry` in
// `messages/account/servers.ts`) are the source of truth — they own
// the wire-format decorator metadata. Re-export them here as types
// so consumers can `import type { CharacterEntry } from "@dofus/dofus1-net"`
// without depending on the message-class module path.

export type { CharacterEntry } from "../messages/account/characters";
export type { GameServerEntry } from "../messages/account/servers";
