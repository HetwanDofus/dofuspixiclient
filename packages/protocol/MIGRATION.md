# `@dofus/protocol` → `@dofus/proto` migration

## Status

`@dofus/proto` (buf-generated TS from `/proto/*.proto`) is **already generated** and ready.
`@dofus/protocol` (hand-written msgpack codec + type maps) is the **legacy wire format**
that both client and server still speak.

This migration is a **coordinated client + server cutover** — flipping the client
alone produces a non-functional app. Do not merge the client half without the
server half also landing.

## Audit (electrobun app)

- **9 files** in `apps/electrobun/src/lib` touch the wire format.
- **28 call sites** use `encodeClientMessage(ClientMessageType.X, {...})` or reference
  `ClientMessageType.*` / `ServerMessageType.*`.
- 1 file (`network/connection.ts`) owns the actual decode via `decodeMessage`.

### Affected files

```
src/lib/network/protocol.ts              # re-exports from @dofus/protocol — DELETE
src/lib/network/connection.ts            # decodeMessage / encodeServerMessage
src/lib/network/message-handler.ts       # dispatch on ServerMessageType
src/lib/network/handlers/auth.handler.ts
src/lib/network/handlers/character.handler.ts
src/lib/network/handlers/combat.handler.ts
src/lib/network/handlers/inventory.handler.ts
src/lib/network/handlers/map.handler.ts
src/lib/game/game-client.ts              # outbound encodeClientMessage call sites
```

### Shape change

Legacy envelope (msgpack):

```ts
{ type: 0x11, payload: { path: [...] }, timestamp: 172... }
```

Proto envelope (`dofus.ClientMessage`):

```ts
ClientMessage {
  payload: {
    case: "account_send_ticket" | "game_create" | "character_move" | ...,
    value: AccountSendTicket | GameCreateRequest | CharacterMove | ...
  }
}
```

The proto-generated `ClientMessage` and `ServerMessage` are `oneof` discriminated
unions. The `case` string (snake_case proto field name) replaces the numeric
`ClientMessageType`/`ServerMessageType` enums.

## Migration steps (per-phase, in order)

### A. Server-side first
Server emits proto-encoded frames and parses proto frames. This must land before
the client flips. Blocks client-side work.

### B. Introduce a new `network/codec.ts` in the app
- `encode(msg: ClientMessage): Uint8Array` using `toBinary()` from `@bufbuild/protobuf`
- `decode(buf: Uint8Array): ServerMessage` using `fromBinary()`
- Kept parallel to the legacy `@dofus/protocol` codec during transition.

### C. Rewrite `network/connection.ts`
Replace `decodeMessage` import with the new codec. Switch the socket frame
payload type.

### D. Rewrite `network/message-handler.ts`
Dispatch on `ServerMessage.payload.case` (proto oneof tag) instead of the
numeric `ServerMessageType`. Prefer `ts-pattern`:

```ts
match(msg.payload)
  .with({ case: "auth_success" }, ({ value }) => this.fire("AUTH_SUCCESS", value))
  .with({ case: "map_data" },     ({ value }) => this.fire("MAP_DATA", value))
  ...
  .exhaustive();
```

### E. Rewrite per-domain handlers
Each `handlers/*.handler.ts` re-registers against the new tag strings. Field
names within payloads shift from camelCase (current hand-written) to whatever
the proto schema declares (often snake_case in .proto, but `protobuf-es` emits
camelCase in TS types — verify on a per-file basis).

### F. Rewrite outbound commands in `game/game-client.ts`
Every `encodeClientMessage(ClientMessageType.X, payload)` becomes a proto
`ClientMessage` construction:

```ts
const msg: ClientMessage = create(ClientMessageSchema, {
  payload: { case: "character_move", value: { path } },
});
this.connection.send(toBinary(ClientMessageSchema, msg));
```

### G. Delete `@dofus/protocol`
Once no file imports from `@dofus/protocol`, drop the package from the
workspace, drop `@msgpack/msgpack` from `apps/electrobun/package.json`, and
delete `packages/protocol/`.

## Tag-name mapping (partial — needs verification against proto)

Use this as a starting cross-reference. The proto oneof field names (left) are
what the client dispatches on; the legacy `ClientMessageType` hex values (right)
are what's being retired.

| Proto case (client→server)   | Legacy `ClientMessageType` |
|------------------------------|----------------------------|
| `account_send_ticket`        | `AUTH_LOGIN (0x01)`        |
| `account_select_character`   | `CHARACTER_SELECT (0x10)`  |
| `game_set_position`          | `CHARACTER_MOVE (0x11)`    |
| `game_get_map_data`          | `MAP_LOAD (0x20)`          |
| `item_move`                  | `ITEM_MOVE (0x80)`         |
| `item_use`                   | `ITEM_USE (0x81)`          |
| `item_drop`                  | `ITEM_DROP (0x82)`         |
| `item_destroy`               | `ITEM_DESTROY (0x83)`      |
| `chat_send_message`          | `CHAT_MESSAGE (0x30)`      |
| ... (full mapping TBD)       |                            |

⚠ This mapping is a best-guess skeleton. Do **not** rely on it without
cross-checking each `.proto` message against the legacy payload shape — field
names inside the message may not match.

## Risks

1. **Server ownership** — Go server (`apps/gameserver/`) also needs to switch.
   Without that, client-only migration breaks the app.
2. **Field-name drift** — legacy payloads have been hand-shaped for years;
   proto field names may not be 1:1. Expect adapter shims in each handler
   for the first pass.
3. **Binary size / perf** — proto is smaller than msgpack in most cases, but
   large payloads (full map data) should be benchmarked. `fzstd` compression
   on top may become unnecessary.
4. **Versioning** — proto buf adds proper field numbering; add a version
   negotiation handshake before the first message so old clients get a clear
   error instead of garbage.

## Not doing in this session

This document is the deliverable for Phase 5a in the electrobun app. The actual
wire cutover requires the Go server to switch to proto in lockstep, which is
out of scope for the electrobun rewrite pass.
