# Troubleshooting

Every failure encountered bringing this up from a clean machine, in the order
they appear.

### `assets/sources` files are ~130 bytes of `oid sha256:…`

git-lfs is not installed, so you have pointer files. Install it, then:

```bash
git lfs install --local && git lfs pull
```

### Migration fails: `ENOENT ... assets/dist/langs/fr/spells.json`

`assets/dist/` is the asset-pipeline's output directory and does not exist on
a fresh clone. Run `just langs-link` (or just use `just db-migrate`, which
depends on it) to symlink it to the published bundles under
`apps/electrobun/public/assets/langs`. Details in [assets.md](assets.md).

### `wasm-pack build` fails on `edition2024`

The renderer crates are Rust edition 2024, which needs ≥ 1.85:
`rustup update stable && rustup target add wasm32-unknown-unknown`.

### `Vello WASM failed to initialize — 403 Forbidden fetching vello_wasm_bg.wasm`

Vite's `server.fs.allow` is checked against the *resolved* path. If your
renderer checkout is a symlink (e.g. `dofus-vello-custom-format` →
`vello-dofasset-format`), the realpath must be allow-listed.
`vite.config.ts` does this with `realpathSync`; if you moved the checkout, set
`VELLO_ROOT`.

### Client shows "invalid credentials" with a password you know is right

The account row stores an argon2 hash of the **PBKDF2-derived key**, not of
the password. Re-seed with `just db-seed` rather than writing `pwd_hash` by
hand. See [architecture.md](architecture.md).

### Login works, but the server list is empty

`game_servers` has no row, or its `state` is not `1`. `just db-seed` fixes it.

### Character list shows a character that cannot be selected

Missing `player_stats` row — `select-character` INNER JOINs it.

### `enter-game: map not found id=10300` in the gamed log

The `maps` table is empty. Import the world with `just import-maps game.sql`
(see [data-seeding.md](data-seeding.md)); `just db-seed` otherwise falls back
to a blank placeholder map.

### Maps have black gaps between the tiles

The map's background image is missing: `maps.background` is 0. Only about 29%
of cells carry a per-cell ground tile — the rest are covered by the background
in the retail client, and by nothing without it.

```bash
just import-map-swf /path/to/Client/data/maps
```

That reads the number out of each map's SWF. 5 368 of the 9 358 maps have a
background; the rest are fully tiled and correctly have none.

### The character stands in an empty black viewport

Two different causes:

1. **You are on the placeholder map** — its cells carry no art at all. Import
   the real world.
2. **You are on a real map that has no per-cell ground tiles**, such as the
   default spawn 10300 "Pitons rocheux". Those maps draw their scenery from a
   background image, and nothing populates `maps.background` in this project.
   Start elsewhere: `SPAWN_MAP_ID=7365 just db-seed`.

Either way the HUD, minimap, pathfinding and FPS counter work — only the
scenery is missing. `just db-seed` warns when the spawn map will look empty.

### The map renders but the character is nowhere to be seen

Cell ids start at the *top corner* of the isometric diamond, which is usually
above the viewport. `just db-seed` picks the walkable cell nearest the map
centre for this reason; a hand-written `players.cell_id` can easily land
off-screen.

### Walking off the edge of a map does nothing

`map_neighbors` is empty. Run `just import-maps game.sql`, which derives the
links (see [data-seeding.md](data-seeding.md)). Note the table is *only*
written by the importer — a database that predates it has no links at all.

### Walking off a map lands you inside a house

Fixed in the importer's election rule — see [data-seeding.md](data-seeding.md).
The short version: several maps share one world position, and picking the one
with the most walkable edge cells picks the *house*, not the street. If you
hit this again on some position, the fix is an explicit override rather than
another heuristic.

### The character crosses to the next map but is then stuck

Fixed, but worth knowing why: both halves of the edge transition assumed the
outermost row of the diamond was where players walk. In real 1.29 map data
that row is blocked decoration and every walkable border cell sits on a
**short (odd) row**. So `detectExitDirection` recognised almost no exits
(21 maps out of 400 against 141 after the fix), and `oppositeEdgeCell` landed
arrivals on the blocked outer row, where the character had no walkable
neighbour at all. `resolveLandingCell` now snaps the arrival to the nearest
walkable cell on that edge.

If a character is still stranded, move it by hand:

```sql
UPDATE players SET cell_id = <a walkable cell> WHERE name = 'Dev';
```

### The gateway stops forwarding after a core restart

`curl localhost:8080/health` shows the game upstream with
`"buffering": true` and a non-zero `buffered` count long after `gamed` came
back — the client stays connected and renders, but nothing reaches the server.
`docker compose restart gateway` clears it. Seen after
`docker compose up -d --build gamed`; the buffer is meant to drain when the
core reconnects, so this looks like a gap in the handoff logic rather than
intended behaviour.

### Imported maps decode to nonsense

StarLoco stores some `mapData` in the clear and some hex-ciphered under the
row's `key`, and the two cannot be told apart by character set. The importer
discriminates on payload length against the expected cell count
`(height - 1) × (2·width - 1) + width` — note that is 479 for a 15×17 map, not
`width × height × 2`.

### Integration tests fail with "a beforeEach/afterEach hook timed out"

Bun's default hook timeout is 5 s, and the testcontainers Postgres plus 40
migrations take longer. The `test:integration` script passes
`--timeout 180000`; if you invoke `bun test` directly, pass it yourself.

### `docker compose build` fails with "lockfile had changes, but lockfile is frozen"

Every workspace manifest must be copied before `bun install --frozen-lockfile`.
If you add a workspace, add its `package.json` `COPY` line to the `Dockerfile`.

### Containers crash with `z.url is not a function`

`zod` v4 is resolved through `apps/gameserver-ts/node_modules`, not the
hoisted root copy. Cherry-picking only `/app/node_modules` out of a builder
stage silently downgrades it to v3 — which is why the `Dockerfile` is a single
stage.

### `just client` takes forever

`vite build` copies `publicDir`, and that is a 5.8 GB asset tree. Use
`just client-web` (Vite dev server) for iteration.

### The client renders nothing and the console mentions WebGPU

`navigator.gpu` must exist. Headless Chrome does not expose WebGPU by default
even with `--enable-unsafe-webgpu`; use a real browser window.
