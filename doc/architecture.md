# Architecture

A browser client for Dofus 1.29: PixiJS for the 2D scene, a Rust/WASM Vello
renderer for the vector art, and a Bun/NestJS server speaking a protobuf
re-encoding of the original 1.29 protocol.

## Processes

```
browser (PixiJS + Vello WASM)
      │  WebSocket /auth or /game   (protobuf ClientMessage / DofusMessage)
      ▼
  gateway            :8080          Bun.serve + Hono. Owns the sockets.
      │  length-prefixed frames over Unix domain sockets
      ├──────────────► authd        MODE=auth  → /tmp/dofus-authd.sock
      └──────────────► gamed        MODE=game  → /tmp/dofus-gamed.sock
                          │
                          ▼
                     PostgreSQL     Kysely + node-postgres
```

The split exists for zero-downtime deploys: the **gateway never restarts**, so
a core restart buffers client messages for a few hundred milliseconds and
flushes them — clients never see a disconnect. `just gamed` and `just authd`
run in watch mode for exactly this reason. `src/core/handoff/` implements the
blue/green snapshot-and-restore between an old and a new core.

Both cores are the same entrypoint (`src/core/main.ts`); `MODE` selects the
feature modules (`AuthModule` vs `GameModule + LangsModule`) and which socket
gets bound.

## Repository layout

```
apps/
  gameserver-ts/     gateway + core (NestJS on Bun), migrations, seed script
  electrobun/        the client — React HUD, PixiJS scene, Electrobun shell
packages/
  grid/              isometric grid maths: distance, areas, line of sight
  proto/             generated protobuf (buf) for the wire protocol
  dofus-lang/        loads + normalises the extracted lang bundles
  dofasset-format/   TypeScript reader for the .dofasset vector format
  spell-runtime/     AS2-equivalent spell animation runtime
  uds-transport/     the gateway ↔ core frame codec
  dofus1-registry/   component registry and documentation site
tools/
  asset-pipeline/    extract → atlas → compile → publish, per asset category
  combat-exporter/   SWF spell extraction (PHP + Arakne)
  assets-exporter/   SWF tile/sprite extraction (PHP)
  ui-builder/        interactive HUD panel designer (:4200)
```

Note `apps/electrobun` is the *whole* client, desktop shell included — the
browser and Electrobun targets share one `src/`.

## Client → server → client, one round trip

1. The React HUD calls `GameClient.login()`
   (`apps/electrobun/src/game/game-client.ts`), which stretches the password
   (see below) and sends `AccountSendIdentity`.
2. `connection.ts` serialises a `ClientMessage` and writes it to the socket.
3. The gateway decodes just enough to know the session, then forwards the
   frame to the core for that role.
4. NestJS routes on the protobuf oneof case — `@MessageHandler(Schema)`, see
   `src/core/shared/gateway-adapter/ws-router.ts`.
5. The handler hits a repository (Kysely) and calls
   `GatewayFrameService.broadcast()` with a `DofusMessage`.
6. The gateway writes the bytes back to the WebSocket; the client's
   `MessageHandler` dispatches to the matching handler.

## Login

Auth is *not* the original 1.29 scheme. The raw password never leaves the
browser:

```
key = base64( PBKDF2-SHA256( password,
                             salt = sha256("dofus:" + lowercase(username)),
                             600_000 iterations, 32 bytes ) )
```

`AccountSendIdentity.encrypted_password` carries that key, and
`accounts.pwd_hash` stores an argon2 hash **of the key**, verified with
`Bun.password.verify`. Hashing the plaintext password will never
authenticate. The parameters live in
`apps/electrobun/src/game/auth/pbkdf2.ts` and are mirrored by
`apps/gameserver-ts/scripts/dev-seed.ts`.

After login the client asks for the server list, selects one, receives a
ticket, and **re-connects to `/game`** with it — one gateway, two upstream
roles.

## Rendering

The client shares a single WebGPU device between Vello and PixiJS:

1. The Vello WASM module creates a `GPUTexture` atlas (16384×8192, LRU slots).
2. `.dofasset` frames are rasterised into atlas slots on demand.
3. PixiJS binds the same `GPUTexture` through `ExternalSource` — no CPU copy.

`.dofasset` is a compact binary vector format: body parts are defined once,
and animation is a per-frame list of transforms over those cached parts. It
replaced parsing SVG atlases at runtime (~26 ms per SVG). The same Rust crate
compiles to WASM here and to a native GDExtension for the Godot client.

## The grid

Isometric, and the cell numbering is not intuitive: a cell's neighbours are
`±width` and `±(width-1)`, **not** `±1`. Two cells with consecutive ids sit on
the same visual row and are *two* steps apart. `packages/grid/src/area.ts`
owns the canonical `fightDistance` (a BFS over real adjacency);
`fastDistance` in the fight module is a deliberately cheaper Chebyshev
approximation used only by the monster AI heuristic.
