import { createLogger } from "@/utils/logger";

import {
  type DofusMessage,
  type ServerPayloadCase,
  type ServerPayloadValue,
} from "./protocol";

const log = createLogger("MessageHandler");

export type MessageHandlerFn<C extends ServerPayloadCase = ServerPayloadCase> =
  (payload: ServerPayloadValue<C>, message: DofusMessage) => void;

export class MessageHandler {
  private handlers: Map<string, MessageHandlerFn[]> = new Map();
  private globalHandlers: ((message: DofusMessage) => void)[] = [];

  on<C extends ServerPayloadCase>(
    caseName: C,
    handler: MessageHandlerFn<C>
  ): () => void {
    const list = this.handlers.get(caseName) ?? [];
    list.push(handler as unknown as MessageHandlerFn);
    this.handlers.set(caseName, list);

    return () => this.off(caseName, handler);
  }

  off<C extends ServerPayloadCase>(
    caseName: C,
    handler: MessageHandlerFn<C>
  ): void {
    const list = this.handlers.get(caseName);
    if (!list) return;
    const idx = list.indexOf(handler as unknown as MessageHandlerFn);
    if (idx !== -1) list.splice(idx, 1);
  }

  onAny(handler: (message: DofusMessage) => void): () => void {
    this.globalHandlers.push(handler);
    return () => {
      const idx = this.globalHandlers.indexOf(handler);
      if (idx !== -1) this.globalHandlers.splice(idx, 1);
    };
  }

  handle(message: DofusMessage): void {
    for (const handler of this.globalHandlers) {
      try {
        handler(message);
      } catch (e) {
        log.error("Global handler error:", e);
      }
    }

    const caseName = message.payload.case;
    if (!caseName) return;

    const list = this.handlers.get(caseName);
    if (!list) {
      log.debug(`No handler for ${caseName}`);
      return;
    }

    const value = message.payload.value;
    for (const handler of list) {
      try {
        handler(value, message);
      } catch (e) {
        log.error(`Handler error (${caseName}):`, e);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
    this.globalHandlers = [];
  }
}

export function createMessageHandler(): MessageHandler {
  const handler = new MessageHandler();
  handler.on("basicsPing", () => log.debug("Ping received"));
  handler.on("serverDisconnect", (payload) =>
    log.warn("Server disconnect:", payload)
  );
  return handler;
}
