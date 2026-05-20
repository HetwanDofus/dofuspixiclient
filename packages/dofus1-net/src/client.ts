// High-level Client. Owns the TCP socket, runs the dispatcher on
// every received frame, and routes parsed payloads to per-opcode
// handlers.
//
// Typing strategy: handlers and sends take a `MessageDef` reference
// directly, so the payload type is derived from the def's generic.
// No string-keyed maps to maintain.

import type { InboundDef, MessageDef, OutboundDef } from "./registry";
import { type DispatchResult, dispatch } from "./dispatcher";
import { Crypto } from "./transport/crypto";
import {
  openTcpSocket,
  type TcpSocketHandle,
  type TcpSocketOptions,
} from "./transport/tcp-socket";

/**
 * Pluggable transport factory. Defaults to `openTcpSocket`
 * (Bun.connect-based) — replace via `Client.setTransportFactory` when
 * running in a browser / webview where raw TCP isn't available (e.g.
 * electrobun forwards through an RPC bridge to its Bun main process).
 */
export type TransportFactory = (
  opts: TcpSocketOptions,
) => Promise<TcpSocketHandle>;

let transportFactory: TransportFactory = openTcpSocket;

/** Install a custom transport. Affects every `Client.connect()` call
 *  made afterwards. Call this once at app boot before any session
 *  attempts to connect. */
export function setTransportFactory(factory: TransportFactory): void {
  transportFactory = factory;
}

export interface ConnectOptions extends TcpSocketOptions {}

export interface ClientEvents {
  /** Called for every frame, before per-opcode dispatch. Use sparingly. */
  onAnyFrame?(result: DispatchResult): void;
  /** Called when the registry has no def for an opcode. */
  onUnknownOpcode?(result: DispatchResult): void;
  /** Called when a registered parser threw. */
  onParseError?(result: DispatchResult): void;
  /** Socket-level close. */
  onClose?(info: { byPeer: boolean; error?: unknown }): void;
}

type AnyHandler = (payload: unknown, ctx: { errorFlag: boolean }) => void;

export class Client {
  private socket: TcpSocketHandle | null = null;
  private handlers = new Map<string, Set<AnyHandler>>();
  private events: ClientEvents = {};
  /** XOR-cipher context. No-op while no key has been installed. */
  readonly crypto = new Crypto();

  setEvents(events: ClientEvents): void {
    this.events = events;
  }

  async connect(opts: ConnectOptions): Promise<void> {
    if (this.socket) {
      throw new Error("Client.connect: already connected");
    }
    const socket = await transportFactory(opts);
    socket.onFrame((frame) => this.onFrame(frame));
    socket.onClose((info) => {
      this.socket = null;
      this.events.onClose?.(info);
    });
    this.socket = socket;
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
  }

  isConnected(): boolean {
    return this.socket !== null;
  }

  /**
   * Subscribe to an inbound message. Returns the unsubscribe fn.
   * Multiple handlers per opcode are supported; they run in
   * registration order.
   */
  on<T>(
    def: InboundDef<T>,
    handler: (payload: T, ctx: { errorFlag: boolean }) => void
  ): () => void {
    const bucket = this.handlers.get(def.opcode) ?? new Set<AnyHandler>();
    const wrapped: AnyHandler = (payload, ctx) => handler(payload as T, ctx);
    bucket.add(wrapped);
    this.handlers.set(def.opcode, bucket);
    return () => {
      bucket.delete(wrapped);
    };
  }

  /** Send an outbound message. Payload type comes from the def. */
  send<T>(def: OutboundDef<T>, payload: T): void {
    if (!this.socket) {
      throw new Error(`Client.send(${def.opcode}): not connected`);
    }
    const body = def.serialize(payload);
    this.socket.send(this.crypto.prepareData(def.opcode + body));
  }

  /** Send a raw frame. Escape hatch — prefer `send(def, payload)`. */
  sendRaw(frame: string): void {
    if (!this.socket) {
      throw new Error("Client.sendRaw: not connected");
    }
    this.socket.send(this.crypto.prepareData(frame));
  }

  private onFrame(frame: string): void {
    const decrypted = this.crypto.unprepareData(frame);
    const result = dispatch(decrypted);
    this.events.onAnyFrame?.(result);
    if (result.parseError) {
      this.events.onParseError?.(result);
      return;
    }
    if (!result.def) {
      this.events.onUnknownOpcode?.(result);
      return;
    }
    const handlers = this.handlers.get(result.opcode);
    if (!handlers || handlers.size === 0) {
      return;
    }
    const ctx = { errorFlag: result.errorFlag };
    for (const h of handlers) {
      h(result.payload, ctx);
    }
  }
}

// Internal helper for tests — avoid exporting in package public surface.
export type { MessageDef };
