# Live-Connection Debugging Runbook

> Step 5 of the AraknemuHorizon vertical. Steps 1-4 (bootstrap, handlers,
> GM/GA, proto tear-out) are committed; this is the iteration phase.

## Pre-flight

- AraknemuHorizon emulator: `/Users/grandnainconnu/Work/personal/dofus/dofus1.29/emulators/AraknemuHorizon`
- Default auth host/port wired into `App.tsx`: `127.0.0.1:5555` —
  override here if the emulator binds elsewhere.
- Frame tracing is **on** by default (`NET_TRACE_FRAMES` in
  `src/game/net/tcp.ts`). Every send / receive is logged at debug
  level via `createLogger("net.client")` with truncation at 160 chars.
- The dev console (`bun run dev` in `apps/electrobun`) ships every
  `console.debug` so the trace is captured without code changes.

## The 30-second smoke test

```sh
# Terminal 1: emulator
cd /Users/grandnainconnu/Work/personal/dofus/dofus1.29/emulators/AraknemuHorizon
# (start AraknemuHorizon per its README)

# Terminal 2: client
cd /Users/grandnainconnu/Work/personal/dofus/dofus1.29/dofus-client-recode/dofuswebclient2/apps/electrobun
bun run dev
```

Expected log timeline:
1. `[net.tcp] connect → 127.0.0.1:5555`
2. `[net.client] ← HC<hash>`
3. `[net.client] → user\n<encryptedPw>`
4. `[net.client] ← Al1` (success) or `← AlE<code>` (rejected)
5. `[net.client] ← AK<keyId><hex>` → `→ Ak<keyId>`
6. `[net.client] ← Ax<servers>` → `SERVERS_RECEIVED` event
7. (user clicks server) `[net.client] → AX<serverId>`
8. `[net.client] ← AX<ip><port><ticket>` → pivot
9. `[net.bootstrap] stage: pivoting → game-connecting`
10. `[net.client] ← HG` → `→ AT<ticket>`
11. `[net.client] ← AT<keyId><hex>` → `→ Ak<keyId>`
12. `[net.client] → AL` → `← AL<chars>`
13. (user clicks char) `[net.client] → AS<id>` → `← AS<...>`
14. `[net.client] → GC1` → `← GC1` → loginActor reaches `inGame`.

## Diagnostic recipes

### Unhandled opcode
```
[net.client] unhandled opcode XY
```
The dispatcher has no def for opcode `XY`. Action:
1. Find the AS2 source: `assets/sources/client-code/dofus/aks/DataProcessor.as`
   — case statements key off the opcode.
2. Locate the handler implementation in the same directory tree
   (e.g. `Items.as#onWeight`).
3. Add a message file under `packages/dofus1-net/src/messages/<area>/`.
4. Register it in `packages/dofus1-net/src/index.ts`.

### Parse error
```
[net.client] parse error XY: Error: ...
```
Body doesn't match what the parser expects. Action:
1. Look at the raw inbound frame in the trace immediately before the
   error: `[net.client] ← <opcode><body>`.
2. Cross-check against the AS2 handler — separators, field count,
   special chars (`*`, `^`, etc.).
3. Update the message file's `parse` (or `@F.*` decorators) to match.

### Wrong shape (no error, but data is off)
Reading the parsed payload at the handler shows fields in the wrong
positions or with junk values. Action:
1. Print the raw body from the trace.
2. Compare field-by-field with AS2.
3. Most likely culprit: `bodyOffset` mismatched (server prepends a
   marker char the AS2 dispatcher strips via `substr(N)`).

## Quirks to watch for

- **Frame terminator**. Canonical 1.29 sends `\x00`; some emulators
  use `\n`. If `FrameReader` accumulates without splitting, drop the
  terminator config in `transport/framing.ts`.
- **`Af` login frame separator**. We send `login\npassword`. If the
  server rejects with no `Al` arriving, try `login;password`.
- **No `AK` install**. Some emulators run plain-text — `Client.crypto`
  stays idle. Verify nothing in bootstrap *requires* an AK.
- **`Ax` arriving before `Al`**. The bootstrap should drive `AUTH_SUCCESS`
  on `Ax`, not `Al`, to be defensive. Already wired this way (see
  `GameSession.login`).
- **`AS` payload missing fields**. Some emulators ship 6 fields; our
  parser defaults the rest to safe values (`-1` for colours).

## When to declare the vertical done

- Launch AraknemuHorizon
- `bun run dev` in `apps/electrobun`
- Enter credentials, click connect
- See: server list → pick → character list → pick → spawn on map → can
  walk one cell
- No unhandled opcodes in the console for at least the first 30 seconds
  of play

When that's true, the next batch of work picks up the in-game wiring
that `GameSession` currently stubs (battlefield attach, fight commands,
item ops).
