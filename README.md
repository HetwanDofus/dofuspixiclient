# Dofus Web Client

Browser-based client for Dofus 1.29 built with PixiJS, Vello (WASM), and Bun.

## Architecture

```
TypeScript (game logic) ──> PixiJS (WebGPU renderer)
                                │
Rust/WASM ──> Vello/wgpu ──> GPUTexture (shared with PixiJS)
                                │
Bun server ──> WebSocket ──> PostgreSQL
```

- **PixiJS + WebGPU** — 2D rendering with shared GPU textures from Vello
- **Vello WASM** — Vector `.dofasset` renderer compiled to WebAssembly
- **Electrobun** — Desktop wrapper (optional, also runs in any WebGPU browser)
- **Bun server** — Three processes: a WebSocket gateway plus `authd` and
  `gamed` NestJS cores, over Kysely/PostgreSQL
- **Turbo monorepo** — Shared packages for grid math and protocol encoding
- **Shared renderer** — [`vello-dofasset-format`](https://github.com/HetwanDofus/vello-dofasset-format)

## Prerequisites

- [Bun 1.3+](https://bun.sh/)
- [git-lfs](https://git-lfs.com) — `assets/**` is LFS-tracked
- [Rust 1.85+](https://rustup.rs) with `wasm32-unknown-unknown`, and
  [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/)
- Docker (PostgreSQL, and optionally the whole server stack)

`just` ships as a dependency — use `bunx just <recipe>` after `bun install`.

The client also needs the renderer repository
([`vello-dofasset-format`](https://github.com/HetwanDofus/vello-dofasset-format))
checked out **next to** this one, under the name `dofus-vello-custom-format`
(a symlink is fine). Override with `VELLO_ROOT`.

## Quick Start

```bash
git lfs pull && git submodule update --init --recursive
bun install

just wasm      # build the Vello WASM renderer
just db        # postgres container + migrations + dev seed (dev / dev)

# the world — maps have no in-repo source, import them once:
curl -LO https://raw.githubusercontent.com/StarLoco/StarLoco-Game/master/game.sql
just import-maps game.sql
SPAWN_MAP_ID=7365 just db-seed

just gateway   # terminal 1 — WS front door on :8080
just gamed     # terminal 2 — game core
just authd     # terminal 3 — auth core

just client-web  # terminal 4 — http://localhost:5173 (needs WebGPU)
```

**[Full setup guide, architecture notes and troubleshooting are in `doc/`.](doc/README.md)**

## Commands

| Command | Description |
|---------|-------------|
| `just install` | Install JS/TS dependencies |
| `just wasm` | Build Vello WASM renderer |
| `just db` | Start PostgreSQL, migrate, seed a dev account |
| `just db-migrate` / `just db-status` | Run / list migrations |
| `just db-seed` | Seed one server, account, and character |
| `just import-maps <game.sql>` | Import the world from a StarLoco dump |
| `just gateway` / `just gamed` / `just authd` | The three server processes |
| `just docker-up` / `just docker-down` | Whole server stack in containers |
| `just client-web` | Client in a WebGPU browser (Vite, :5173) |
| `just client` | Electrobun desktop client |
| `just client-hmr` | Electrobun + HMR |
| `just build` | Production build |

### Asset Pipeline

| Command | Description |
|---------|-------------|
| `just tiles-spritesheet` | Extract tiles + generate spritesheets |
| `just sprites-spritesheet` | Extract sprites + generate spritesheets |
| `just extract-tiles` | Extract tiles from SWF to SVG |
| `just extract-sprites` | Extract sprites from SWF to SVG |
| `just extract-items` | Extract item icons |
| `just review-tiles` | Interactive tile classifier gallery |
| `just ui-builder` | Launch UI panel builder |
| `just clean` | Remove all generated assets |

## Project Structure

```
apps/
  electrobun/         # The client — React HUD, PixiJS scene, Electrobun shell
    src/
      game/           # Game client, network handlers, stores, spell scripts
      lib/            # Battlefield rendering, Vello integration, frame atlas
      hud/            # UI components (banner, chat, inventory)
      window/         # Electrobun main process + the mainview entry
  gameserver-ts/      # gateway + core (NestJS on Bun)
    src/
      gateway/        # WS front door, session registry, upstream routing
      core/           # features/ (message slices), modules/, shared/
    migrations/       # Kysely migrations
    scripts/          # dev-seed.ts

packages/
  grid/               # Shared isometric grid math
  proto/              # Generated protobuf wire protocol
  dofus-lang/         # Extracted lang bundle loader
  dofasset-format/    # TypeScript .dofasset reader
  spell-runtime/      # Spell animation runtime
  uds-transport/      # gateway ↔ core frame codec

tools/
  asset-pipeline/     # Unified extract → compile → publish pipeline
  assets-exporter/    # SWF tile/sprite extraction (PHP)
  combat-exporter/    # SWF spell extraction (PHP)
  tile-classifier/    # Visual tile review tool
  ui-builder/         # Interactive UI panel designer
```

## Configuration

`apps/gameserver-ts/.env` (loaded automatically by Bun) — copy
`.env.example`:

```bash
DATABASE_URL=postgres://dofus:dofus@localhost:5432/dofus
GATEWAY_PORT=8080
CORE_SOCK=/tmp/dofus-gamed.sock
AUTH_SOCK=/tmp/dofus-authd.sock
```

`LANGS_DIR` overrides where the server reads lang bundles from; it defaults to
the in-tree `assets/dist/langs`.

## Docker

```bash
docker compose up -d              # postgres → migrate → authd + gamed → gateway
docker compose up -d postgres     # or just the database for local dev
```

One image serves all three server roles; they share a `/sockets` volume for
the gateway ↔ core Unix domain sockets.

## Rendering

The client shares a single WebGPU device between Vello and PixiJS:

1. **Vello WASM** creates a `GPUTexture` atlas
2. Frames are rendered into atlas slots via `queueFrame()`
3. **PixiJS** reads the same `GPUTexture` via `ExternalSource` — no CPU copy
4. Frame atlas uses LRU eviction for memory management

This enables 300-400 animated actors at 60fps in the browser.

## Shared Renderer

Both this project and the [Godot desktop client](https://github.com/HetwanDofus/dofusgodotclient) use the same `.dofasset` vector format via the shared [`vello-dofasset-format`](https://github.com/HetwanDofus/vello-dofasset-format) renderer:

- **Web**: compiled to WASM, renders via WebGPU
- **Desktop**: compiled as native Rust GDExtension, renders via Vulkan/Metal
