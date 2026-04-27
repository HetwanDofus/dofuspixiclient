# gameserver-ts

Two-process TypeScript gameserver targeting zero-downtime deploys.

## Layout

```
gateway (stable)    ◄──UDS──►    core (Nest, restartable)
  Bun.serve + WS                   FightActors, MapTickLoops
  Session registry                 Slices, sagas, domain
  Handoff buffer                   HandoffCoordinator
```

- **gateway** owns WS connections. Never restarts on deploys.
- **core** owns all game logic. Restarts via blue/green state handoff.
- **transport** between them: length-prefixed frames over Unix domain socket.

## Running (dev)

```
bun run dev:gateway   # terminal 1 — does not watch
bun run dev:core      # terminal 2 — watches, auto-restart
```

Editing a slice in `core/` restarts core only. Gateway buffers client messages
during the ~hundreds-of-ms gap, then flushes. WS clients never disconnect.

## Deploy (prod, zero-downtime)

```
1. Start core v2 (standby, binds /tmp/core-v2.sock)
2. Supervisor → gateway: "handoff to v2"
3. Gateway: drain → snapshot v1 → restore v2 → flip → shutdown v1
4. Client-visible stall ≈ 200–400ms on in-flight actions. No disconnects.
```

See `src/core/handoff/handoff.coordinator.ts` for the snapshot/restore flow and
`src/gateway/core-router.ts` for the gateway orchestration.

## Notes

- Frame codec is length-prefixed JSON for the scaffold. Replace with proto
  (`proto/gateway_frame.proto`) once codegen is wired.
- One example slice is implemented end-to-end: `CastSpell` — shows the full
  path from WS message → gateway → core router → slice handler → fight actor
  → domain resolution → domain event → saga.
- `@nestjs/event-emitter` is used as the in-process bus. `DomainEventBus`
  wraps it with cluster-scope routing (stub for future NATS integration).
