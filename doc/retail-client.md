# The retail 1.29 client

Several things this project needs exist **only** inside a retail Dofus 1.29
client: the original reads them from its own files, so they never travel over
the wire and no server emulator dump carries them. That is why
[assets.md](assets.md) lists so much as "cannot be regenerated".

One is present on this machine:

```
/Users/hugoperier/Projects/Lab/DofusManager/Client-Dofus-1-29/Client
```

220 MB. Point the importers at your own copy if it lives elsewhere.

## What is in it

| Path | Size | Contents | Used by |
|---|---|---|---|
| `data/maps/<id>_<date>X.swf` | 37 MB, 9 209 files | Per-map `backgroundNum`, `bOutdoor`, `ambianceId`, `musicId`, `capabilities`, and the authentic 1.29 `mapData` | `just import-map-swf` (background, outdoor, music, ambiance — `capabilities` and `mapData` still unused) |
| `clips/gfx/g*.swf`, `o*.swf` | 41 MB | Ground and object tiles | asset-pipeline `tiles.ground`, `tiles.objects` |
| `clips/sprites/<id>.swf` | 51 MB, 905 files | Character, monster and NPC sprites | asset-pipeline `sprites` |
| `clips/spells/*.swf` | 3.6 MB, 263 files | Spell animations | asset-pipeline `spells` |
| `clips/items/*.swf` | 21 MB, 111 files | Item icons | asset-pipeline `items` |
| `clips/artworks`, `emblems`, `emotes`, `smileys`, `auras`, `alignments`, `jobs`, `challenges`, `gifts` | ~9 MB | The remaining pipeline categories | asset-pipeline |
| `clips/cinematics` | 4.8 MB | Intro / class cinematics | nothing yet |
| `data/docs` | 3.8 MB, 772 files | In-game documents and lore | `document_templates` (empty) |
| `data/tutorials` | 228 KB, 57 files | Tutorial steps | tutorial tables (partly seeded by migrations) |
| `audio/musics.swf`, `audio/effects.swf` | 15 MB | Music and sound effects, packed as `DefineSound` MP3s named by their `ExportAssets` symbol | already extracted into `public/assets/sound` — see [audio.md](audio.md) |
| `assets/sources/client-code` (in this repo) | — | The decompiled AS2 client | Reference for exact 1.29 behaviour |

Note the lang SWFs (`spells_fr_1254.swf` and friends) are **not** in the
client directory — they are downloaded separately. The published bundles under
`apps/electrobun/public/assets/langs` already cover them.

## How far the world diverges from 1.29

The world currently runs on the StarLoco dump, which targets 1.39.8. Comparing
the client's own `mapData` against it over 400 maps (deciphering the SWF
payload with the dump's per-map `key`):

| | |
|---|---|
| Cell payloads identical | 373 |
| **Cell payloads different** | **19** (~5%) |
| Could not decipher | 6 |
| Map absent from the 1.29 client | 2 |

And in the large: the database holds 9 358 maps, the 1.29 client 9 209 — about
150 of them are post-1.29 content that a 1.29 project should arguably not
expose at all.

So the dump is a good approximation, not a correct one. The ~5% that differ are
maps whose walkability and tile ids do not match the art the client draws.

## Reading a map SWF

`scripts/import-map-swf.ts` is a small AS2 interpreter: each map SWF is a
zlib-compressed movie whose first frame is a run of `<name> = <value>`
assignments. It walks the tag table for `DoAction`/`DoInitAction`, then
evaluates the constant pool, `Push`, `SetVariable` and `SetMember` opcodes.
All 9 209 files parse.

The same approach reads any of the other SWFs above; that parser is the reason
the whole client is now usable as a data source rather than an opaque blob.

## The AS2 source is the tie-breaker

`assets/sources/client-code/` holds the decompiled 1.29 client. When a
question is "what did the original actually do here?", it answers definitively
— it is how the background was tracked down
(`dofus/managers/MapsServersManager.as` → `oData.backgroundNum`, loaded from
the map SWF) rather than guessed at.
