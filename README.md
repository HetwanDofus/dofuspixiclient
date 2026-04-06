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
- **Bun server** — Game server with Elysia WebSocket and Kysely/PostgreSQL
- **Turbo monorepo** — Shared packages for grid math and protocol encoding
- **Shared renderer** — [`vello-dofasset-format`](https://github.com/HetwanDofus/vello-dofasset-format)

## Prerequisites

- [Bun 1.3+](https://bun.sh/)
- [Rust + wasm-pack](https://rustwasm.github.io/wasm-pack/installer/)
- [PostgreSQL 15+](https://www.postgresql.org/download/)
- [just](https://github.com/casey/just) (command runner)

## Quick Start

```bash
# Full setup: install deps, create DB, run migrations, build WASM
just setup

# Start the server (with watch mode)
just server

# In another terminal — start the client
just client
```

## Commands

| Command | Description |
|---------|-------------|
| `just setup` | Install deps + create DB + build WASM |
| `just install` | Install JS/TS dependencies |
| `just db` | Create database and run migrations |
| `just db-create` | Create PostgreSQL user and database |
| `just db-migrate` | Run database migrations |
| `just wasm` | Build Vello WASM renderer |
| `just server` | Start game server (dev, watch mode) |
| `just client` | Start Electrobun client |
| `just client-hmr` | Start client with HMR |
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
  electrobun/         # Desktop client (PixiJS + Electrobun)
    src/
      lib/
        ank/battlefield/  # Map rendering, tile layers, grid, transitions
        render/           # Vello integration, frame atlas, picking
        game/             # Game client, network, state
        hud/              # UI components (banner, chat, inventory)
        ecs/              # Entity Component System (Becsy)
  server/             # Game server (Bun + Elysia)
    src/
      handlers/       # Message handlers (movement, map, combat)
      db/             # Database schema, migrations, queries
      ws/             # WebSocket server

packages/
  grid/               # Shared isometric grid math
  protocol/           # Binary message protocol (encode/decode)

tools/
  assets-exporter/    # SWF tile/sprite extraction (PHP)
  svg-spritesheet/    # SVG to .dofasset compiler
  tile-classifier/    # Visual tile review tool
  ui-builder/         # Interactive UI panel designer
```

## Configuration

Database connection via environment variables:

```bash
export PG_HOST=localhost
export PG_PORT=5432
export PG_DATABASE=dofus
export PG_USER=dofus
export PG_PASSWORD=dofus
```

Or use defaults (all `dofus`).

## Docker

```bash
# Start PostgreSQL + game server
docker compose up -d

# Or just the database for local dev
docker compose up -d postgres
```

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
