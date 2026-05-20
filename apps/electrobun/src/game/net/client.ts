// `NetClient` wraps a single `dofus1-net.Client` instance with a
// class-based subscribe/send API:
//
//   client.on(HC, (hc) => { ... })     // hc: HC
//   client.send(AkOut, { keyId: 5 })   // payload typed to AkOut shape
//
// dofus1-net's underlying `Client` exposes a def-based API
// (`on(def, h)` / `send(def, payload)`); we resolve the def from the
// decorated class via `opcodeOf` + `getMessageByOpcode` and forward.
//
// In addition to the rebinding API, `NetClient` adds:
//   - Frame-level tracing (raw inbound + outbound) for step-5 debug.
//   - A `Stage` enum that `Bootstrap` advances across the handshake.
//   - A typed `onClose` that surfaces "expected" closes (auth pivot).

import {
  buildOutboundFrame,
  Client,
  type ClientEvents,
  type DispatchResult,
  getMessageByOpcode,
  type InboundDef,
  opcodeOf,
  type WireClass,
} from "@dofus/dofus1-net";

import { createLogger } from "@/utils/logger";

import { type CloseInfo, NET_TRACE_FRAMES, traceTrim } from "./tcp";

const log = createLogger("net.client");

export type Stage =
  | "idle"
  | "auth-connecting"
  | "authenticating"
  | "queued"
  | "server-selecting"
  | "pivoting"
  | "game-connecting"
  | "game-authenticating"
  | "characters-list"
  | "loading-character"
  | "in-game"
  | "disconnected";

type StageListener = (stage: Stage) => void;
type CloseListener = (info: CloseInfo) => void;
type FrameListener = (raw: string, direction: "in" | "out") => void;
type Unsub = () => void;

/** Class shape we accept for `on()` / `send()`. The decorator stamps
 *  `[Symbol.for("dofus1net.schema")]` onto the class; we reach it via
 *  `opcodeOf` at runtime. The bare `new () => T` is intentional — it
 *  lets TS bind `T` directly to the instance type (`HC`, `Al`, etc.)
 *  via the no-arg constructor signature every @WireIn / @WireOut class
 *  produces. Adding a constraint like `T extends object` or a
 *  variadic `...args: any[]` ctor breaks inference (T falls back to
 *  `object` / `unknown`) and callers see `any` for the handler arg. */

interface PersistedSub {
  opcode: string;
  handler: (p: unknown) => void;
  /** Unsubscribe handle bound to the CURRENT inner Client. Replaced on
   *  every `connect()` so the caller's outer `unsub` always points at
   *  the live subscription. */
  innerUnsub: () => void;
}

export class NetClient {
  private inner: Client = new Client();
  private stage: Stage = "idle";
  private stageListeners = new Set<StageListener>();
  private closeListeners = new Set<CloseListener>();
  private frameListeners = new Set<FrameListener>();
  /** Subscriptions persisted across `connect()` — re-bound to the new
   *  inner Client every time so callers can register once and survive
   *  the auth→game pivot. */
  private persistedSubs = new Set<PersistedSub>();
  /** Set to `true` immediately before we call `inner.disconnect()` so
   *  the close event carries `expected: true` up to bootstrap. */
  private expectingClose = false;

  /** Current bootstrap stage (e.g. "characters-list"). */
  getStage(): Stage {
    return this.stage;
  }

  setStage(next: Stage): void {
    if (next === this.stage) {
      return;
    }
    log.info(`stage: ${this.stage} → ${next}`);
    this.stage = next;
    for (const cb of this.stageListeners) {
      cb(next);
    }
  }

  onStage(cb: StageListener): Unsub {
    this.stageListeners.add(cb);
    return () => this.stageListeners.delete(cb);
  }

  onClose(cb: CloseListener): Unsub {
    this.closeListeners.add(cb);
    return () => this.closeListeners.delete(cb);
  }

  /** Tap raw frames (post-decrypt for inbound, pre-encrypt for outbound). */
  onRawFrame(cb: FrameListener): Unsub {
    this.frameListeners.add(cb);
    return () => this.frameListeners.delete(cb);
  }

  /** Direct access to the crypto context for AT/AK key install. */
  get crypto() {
    return this.inner.crypto;
  }

  async connect(opts: { host: string; port: number }): Promise<void> {
    // Replace the underlying Client — its `handlers` map and socket
    // belong to the previous connection. We immediately re-apply every
    // persisted subscription against the fresh instance so callers
    // who registered via `on()` keep firing across reconnects.
    this.inner = new Client();
    for (const sub of this.persistedSubs) {
      const def = getMessageByOpcode(sub.opcode) as
        | InboundDef<unknown>
        | undefined;
      if (def) {
        sub.innerUnsub = this.inner.on(def, sub.handler);
      }
    }
    const events: ClientEvents = {
      onAnyFrame: (result: DispatchResult) => {
        const raw = result.opcode + (result.body ?? "");
        if (NET_TRACE_FRAMES) {
          log.info(`← ${traceTrim(raw)}`);
        }
        for (const cb of this.frameListeners) {
          cb(raw, "in");
        }
        if (result.parseError) {
          log.warn(
            `parse error ${result.opcode}: ${String(result.parseError)}`,
          );
        } else if (!result.def) {
          log.debug(`unhandled opcode ${result.opcode}`);
        }
      },
      onClose: (info: { byPeer: boolean; error?: unknown }) => {
        const expected = this.expectingClose;
        this.expectingClose = false;
        log.info(
          `socket closed (byPeer=${info.byPeer} expected=${expected}${info.error ? ` error=${String(info.error)}` : ""})`,
        );
        for (const cb of this.closeListeners) {
          cb({ byPeer: info.byPeer, expected, error: info.error });
        }
      },
    };
    this.inner.setEvents(events);
    await this.inner.connect(opts);
  }

  disconnect(opts: { expected: boolean } = { expected: false }): void {
    if (!this.inner.isConnected()) {
      return;
    }
    this.expectingClose = opts.expected;
    this.inner.disconnect();
  }

  isConnected(): boolean {
    return this.inner.isConnected();
  }

  on<T>(cls: new () => T, handler: (payload: T) => void): Unsub {
    const opcode = opcodeOf(cls as unknown as WireClass);
    if (!opcode) {
      throw new Error(
        `NetClient.on: class ${(cls as { name?: string }).name ?? "?"} has no @WireIn schema`,
      );
    }
    const def = getMessageByOpcode(opcode);
    if (!def) {
      throw new Error(`NetClient.on: opcode ${opcode} not registered`);
    }
    const wrapped = (p: unknown): void => handler(p as T);
    const sub: PersistedSub = {
      opcode,
      handler: wrapped,
      innerUnsub: this.inner.on(def as InboundDef<unknown>, wrapped),
    };
    this.persistedSubs.add(sub);
    return () => {
      sub.innerUnsub();
      this.persistedSubs.delete(sub);
    };
  }

  /** Subscribe once — auto-unsubscribes after the first message. */
  once<T>(cls: new () => T, handler: (payload: T) => void): Unsub {
    let unsub: Unsub | null = null;
    unsub = this.on(cls, (p) => {
      unsub?.();
      handler(p);
    });
    return () => unsub?.();
  }

  send<T>(cls: new () => T, payload: Partial<T>): void {
    const inst = new cls();
    Object.assign(inst as object, payload);
    const frame = buildOutboundFrame(inst as object);
    if (NET_TRACE_FRAMES) {
      log.info(`→ ${traceTrim(frame)}`);
    }
    for (const cb of this.frameListeners) {
      cb(frame, "out");
    }
    // We've already serialized — `sendRaw` handles crypto + framing.
    this.inner.sendRaw(frame);
  }

  sendRaw(frame: string): void {
    if (NET_TRACE_FRAMES) {
      log.info(`→ ${traceTrim(frame)} (raw)`);
    }
    for (const cb of this.frameListeners) {
      cb(frame, "out");
    }
    this.inner.sendRaw(frame);
  }
}
