# Getting started

From a fresh clone to a character standing in the world. Every step below was
run on macOS (Apple Silicon); the versions are the ones that were verified.

## 1. Prerequisites

| Tool | Verified version | Why |
|---|---|---|
| [Bun](https://bun.sh) | 1.3.14 | Runtime + package manager for everything TypeScript |
| [git-lfs](https://git-lfs.com) | 3.7.1 | `assets/**` is LFS-tracked; **without it you get 130-byte pointer files** |
| [Rust](https://rustup.rs) + `wasm32-unknown-unknown` | 1.97 (needs ≥ 1.85 — the crates are edition 2024) | Builds the Vello renderer |
| [wasm-pack](https://rustwasm.github.io/wasm-pack/) | 0.15 | Packages the renderer for the browser |
| Docker | 29.x | PostgreSQL, and optionally the whole server stack |

`just` does not need a separate install — it ships as the `rust-just`
dependency, so `bunx just <recipe>` works after `bun install`.

## 2. The sibling renderer checkout

The client imports the Vello renderer from a **separate repository**,
[`vello-dofasset-format`](https://github.com/HetwanDofus/vello-dofasset-format),
which must sit next to this one. Its own `package.json` calls itself
`dofus-vello-custom-format`, and that is the name the tooling looks for:

```
DofusRetroCustom/
├── dofuspixiclient/            # this repository
└── dofus-vello-custom-format/  # the renderer (symlink is fine if your
                                # checkout is named vello-dofasset-format)
```

Set `VELLO_ROOT` to override the location.

## 3. Fetch everything

```bash
git lfs install --local
git lfs pull                    # ~30 MB of SWF-derived sources
git submodule update --init --recursive
bun install
```

## 4. Build the WASM renderer

```bash
bunx just wasm                  # wasm-pack build --target web --release
```

Produces `packages/vello-wasm/pkg/` in the renderer checkout. The client
resolves the `vello-wasm` import to that directory. First build takes a few
minutes (it compiles wgpu and a patched Vello).

## 5. Database

```bash
bunx just db                    # docker compose up postgres + migrate + seed
```

That expands to three steps you can also run individually:

- `just db-up` — starts the `postgres:17-alpine` container (user/password/db
  all `dofus`) and waits for it to accept connections.
- `just db-migrate` — links `assets/dist/langs` to the published bundles (see
  [assets.md](assets.md)) and runs the 40 Kysely migrations. Migration 0039
  reads the spells lang bundle and seeds 2 091 spells / 10 632 levels.
- `just db-seed` — writes the rows the migrations deliberately leave empty:
  one game server, one account (`dev` / `dev`), one character, and — only if
  the spawn map is missing entirely — a blank placeholder map. See
  [data-seeding.md](data-seeding.md).

### The world

The `maps` table has no in-repo source. Import it from StarLoco's published
game database, then seed a character onto a map with scenery:

```bash
curl -LO https://raw.githubusercontent.com/StarLoco/StarLoco-Game/master/game.sql
just import-maps game.sql          # 9 358 maps, 265 subareas
SPAWN_MAP_ID=7365 just db-seed     # Cité d'Astrub
```

Skipping this still gets you into the game — on a blank placeholder map.
[data-seeding.md](data-seeding.md) explains both, and why map 10300 renders
empty even with the real data.

Connection settings live in `apps/gameserver-ts/.env` (copy from
`.env.example`); Bun loads it automatically.

## 6. Run the server

The gameserver is **three processes**, one terminal each:

```bash
bunx just gateway    # WS front door on :8080 — never restarts
bunx just gamed      # game logic core, watch mode
bunx just authd      # login / server-list core, watch mode
```

`gateway` talks to the two cores over Unix domain sockets
(`/tmp/dofus-gamed.sock`, `/tmp/dofus-authd.sock`), so editing a slice
restarts only that core while WebSocket clients stay connected.

Health check:

```bash
curl -s localhost:8080/health
# {"sessions":0,"upstreams":[{"role":"auth","active":"/tmp/dofus-authd.sock",...
```

### Or run the whole stack in containers

```bash
bunx just docker-up   # postgres → migrate → authd + gamed → gateway
```

One image, three roles; `authd`/`gamed`/`gateway` share a `/sockets` volume
for the domain sockets. Still run `just db-seed` afterwards for the account.

## 7. Run the client

```bash
bunx just client-web   # Vite dev server on http://localhost:5173
```

Open it in a **WebGPU-capable browser** (Chrome 113+, `navigator.gpu` must be
truthy). Log in with `dev` / `dev`, pick `Server #1`, pick the character.

`just client` builds the Electrobun desktop app instead. Be aware that
`vite build` copies `publicDir` — that is the 5.8 GB asset tree — so the
browser path above is much faster for day-to-day work.

## 8. Verify

```bash
cd apps/gameserver-ts && bun test src/          # 170 unit tests
cd apps/gameserver-ts && bun run test:integration  # 13, testcontainers
cd apps/gameserver-ts && bun run typecheck
cd apps/electrobun    && bun test               # 84 tests
cd apps/electrobun    && bun run check-types
```

A green login → server → character → world run logs this in the browser
console:

```
[AuthHandler] Login OK
[AuthHandler] Server selected, ticket acquired
[GameClient] Pivoting to gamed at ws://127.0.0.1:8080/game
[CharacterHandler] Character selected: Dev (id=1)
[MapHandler] gameMapData: map 7365 (479 cells, 15x17, bg=0)
[BattlefieldBootstrap] Vello WASM renderer initialized (zero-copy GPU sharing)
[MapHandler] Rendered 479 cells, culled 0 cells
[VelloRenderer] loaded asset 100000 (132 anims, 6188 frames)
```
