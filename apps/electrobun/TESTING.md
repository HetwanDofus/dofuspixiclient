# Testing

The electrobun app uses **Bun's built-in test runner** for unit tests. No extra
dependencies — `bun test` just works.

## Layout

- Test files live beside the code they test: `foo.ts` → `foo.spec.ts`.
- `*.spec.ts` suffix for unit tests; `*.e2e.spec.ts` reserved for future
  end-to-end tests through the Electrobun runtime.
- Spec files are excluded from the Vite bundle — they only exist to be run by
  `bun test`.

## Commands

```bash
# Run everything
bun run test

# Watch mode (re-runs on change)
bun test --watch

# Single file
bun test src/lib/pathfinding/combat-pathfinding.spec.ts

# Filter by name
bun test -t "routes around"
```

Also available:

```bash
bun run check-types   # tsc --noEmit
bun run lint          # biome check src
```

## What's covered today

| Module                                    | Spec                                           | Tests |
|-------------------------------------------|------------------------------------------------|------:|
| `pathfinding/combat-pathfinding.ts`       | A* correctness, MP budget, occupancy mutations |    10 |
| `assets/look-parser.ts`                   | Look-string parsing, accessory equality        |     9 |
| `scene/scene.ts`                          | Actor add/remove/tick, capability queries      |     9 |
| `stores/game-store.ts` (ExternalStore)    | Partial merge, notify, subscribe/unsubscribe   |     7 |
| `stores/hud-store.ts`                     | togglePanel/toggleWorldMap/closeAllPanels      |     9 |
| `stores/inventory-store.ts`               | List/delta handlers, filters, listeners, clear |    11 |
| `machines/loginMachine.ts`                | State transitions, LOGOUT reset, invalid event no-ops | 7 |
| `machines/mapTransitionMachine.ts`        | Generation guards, stale-response ignore, mid-flight re-enter, RESET | 8 |
| `scene/overlays.spec.ts`                  | GridOverlay/CellHighlighter/DebugOverlay as Rendered actors          | 5 |
| `scene/tile-actor.ts`                     | TileActor brands, zIndex derivation, scene bucket, dispose safety    | 6 |
| `scene/fighter-actor.ts` (contract clone) | Rendered/Positioned/Hoverable/Tickable brands via live ActiveFighter | 6 |
| `scene/scene.ts` (rendering API)          | queryRenderedSorted, renderSnapshot, stability, immutability         | 6 |

93 tests. Zero flakes. Run in ~3s.

## What's not covered yet (and why it'd be worth it)

- **`network/message-handler.ts`** — pub/sub over typed message bus. Useful once
  the protobuf migration lands (Phase 5a) since types change.
- **`machines/combatMachine`, `machines/connectionMachine`, `machines/spellCastMachine`** — XState machines not yet covered. Same pattern as login/mapTransition specs applies.
- **`scene` capability wrappers** — once Phase 4 ports the renderers onto
  Actors, each new Actor type gets a spec.
- **`assets/look-parser`** has a latent behavior quirk: non-numeric colors
  become `NaN` (no `|| 0` fallback unlike gfxId). Documented in the spec; fix
  or accept as intentional in a follow-up.

## Known caveats

- `Array.prototype.at()` is **ES2022** — `apps/electrobun/tsconfig.json` targets
  **ES2020**. Use positive-index `arr[arr.length - 1]` in specs, not `arr.at(-1)`.
- Bun's test runner respects the same module resolution as the app: `@/*`
  imports work. No jest `moduleNameMapper` needed.
