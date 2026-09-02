# Assets

## Two different things live under "assets"

| Path | What | In git? |
|---|---|---|
| `assets/sources/` | Inputs the pipeline reads | Partly — see below |
| `assets/cache/`, `assets/dist/` | Pipeline intermediates and outputs | No (gitignored) |
| `apps/electrobun/public/assets/` | **Published** outputs the client serves | Yes — ~5.8 GB, 103 k files |

That last row is the important one: a clone already contains everything the
client needs at runtime (dofassets, spritesheets, item icons, sounds, lang
bundles, world-map tiles). You only need the pipeline if you want to
*regenerate* them.

## What the pipeline needs, and what is missing

`tools/asset-pipeline` runs four stages per category — `run` (extract from
SWF), `atlas`, `compile` (to `.dofasset`), `publish` (copy into
`apps/electrobun/public/assets`). `just pipeline-list` prints the registry.

Every category's `source` points at retail Dofus 1.29 SWFs under
`assets/sources/` — `clips/sprites/*.swf`, `clips/gfx/{g,o}*.swf`,
`clips/spells/*.swf`, `langs/spells_fr_1254.swf`, and so on. **None of those
SWFs are tracked.** Until 2026-09-01 that was not even deliberate: the
`*.sw?` line in `.gitignore` — boilerplate meant for vim swap files —
swallowed `*.swf` along with them, silently, so `git add` did nothing and
`git status` stayed clean. The pattern is now `*.swp` / `*.swo`; whether to
actually commit ~100 MB of SWF through git-lfs is still an open call.

What a fresh clone gets from `assets/sources/` is the decompiled ActionScript
(`client-code/`), an FLA library (`fla/`), the sprite manifest
(`clips/sprites/sprites.xml`), and one StarLoco table dump
(`starloco/sorts.sql`).

So: `just sprites-build`, `just tiles-build`, `just pipeline-langs` and
friends cannot run on a fresh clone. Copy the SWFs from a retail 1.29 client
into `assets/sources/clips/` to use them — see
[retail-client.md](retail-client.md). The extract stages also shell out to PHP
(`tools/assets-exporter`, `tools/combat-exporter`), which is a further
prerequisite.

Sounds are the exception: `apps/electrobun/public/assets/sound` holds plain
mp3s named after their SWF export symbol, which is also how the lang bundle
addresses them, so no compile step stands between the source and the runtime
file. See [audio.md](audio.md).

## Lang bundles: `assets/dist/langs`

Both migration 0039 and the running gameserver read
`assets/dist/langs/<locale>/<namespace>.json` — the pipeline's *output*
directory. On a fresh clone that directory does not exist, and migration 0039
fails with:

```
ENOENT: ... /assets/dist/langs/fr/spells.json @ "0039_seed_spell_data_from_lang"
```

The published copy of those exact bundles *is* committed, under
`apps/electrobun/public/assets/langs`. `just langs-link` symlinks one to the
other, and `just db-migrate` depends on it, so this is handled automatically.
`just clean-assets` deletes the link along with the rest of `assets/dist`;
re-run `just db-migrate` (or `just langs-link`) to restore it.

The gameserver preloads only the `spells` namespace (`SERVER_PRELOAD` in
`src/core/modules/langs/langs.service.ts`) — 2 091 spells, ~70 ms at boot.
Override the directory with `LANGS_DIR` if you deploy the bundles elsewhere;
the Docker image does exactly that.

### The spells bundle shape

`{ schema, data: { S: { "<spellId>": Spell } } }`, where each spell has
`n`/`d` (name, description), `i` (icon info block) and `l1`…`l6` — packed
21-slot arrays per level. The slot layout is documented at the top of
`apps/gameserver-ts/migrations/0039_seed_spell_data_from_lang.ts`; note that
slot 19 is the *critical* effect list and slot 20 the normal one, which is the
opposite of how several emulator dumps label them.

## The Vello renderer

`packages/vello-wasm` in the sibling `dofus-vello-custom-format` checkout,
built with `just wasm`. It vendors a patched `wgpu` (`patches/wgpu`) and needs
Rust ≥ 1.85 (edition 2024). Output lands in `pkg/`, which the client aliases
as the `vello-wasm` import.

Vite serves that directory through `/@fs/`, which is gated by
`server.fs.allow`. Because Vite checks the *resolved* path, a symlinked
renderer checkout has to be allow-listed by its realpath — `vite.config.ts`
calls `realpathSync` for this. Without it the dev server answers `403` for
`vello_wasm_bg.wasm` and the battlefield renderer never initialises.
