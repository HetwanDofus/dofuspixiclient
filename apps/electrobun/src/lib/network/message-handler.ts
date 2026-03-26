import {
  ServerMessageType,
  type ServerMessage,
  type ServerMessageTypeValue,
  type ServerPayloadMap,
  type PongPayload,
} from './protocol';
import { createLogger } from '@/utils/logger';

const log = createLogger("MessageHandler");

export type MessageHandlerFn<T = unknown> = (payload: T, message: ServerMessage<T>) => void;

export class MessageHandler {
  private handlers: Map<ServerMessageTypeValue, MessageHandlerFn[]> = new Map();
  private globalHandlers: MessageHandlerFn[] = [];

  on<T extends ServerMessageTypeValue>(
    type: T,
    handler: MessageHandlerFn<ServerPayloadMap[T]>,
  ): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, []);
    }

    this.handlers.get(type)!.push(handler as MessageHandlerFn);

    return () => this.off(type, handler);
  }

  off<T extends ServerMessageTypeValue>(
    type: T,
    handler: MessageHandlerFn<ServerPayloadMap[T]>,
  ): void {
    const handlers = this.handlers.get(type);

    if (handlers) {
      const index = handlers.indexOf(handler as MessageHandlerFn);

      if (index !== -1) {
        handlers.splice(index, 1);
      }
    }
  }

  onAny(handler: MessageHandlerFn): () => void {
    this.globalHandlers.push(handler);

    return () => {
      const index = this.globalHandlers.indexOf(handler);

      if (index !== -1) {
        this.globalHandlers.splice(index, 1);
      }
    };
  }

  handle(message: ServerMessage): void {
    for (const handler of this.globalHandlers) {
      try {
        handler(message.payload, message);
      } catch (e) {
        log.error('Handler error:', e);
      }
    }

    const handlers = this.handlers.get(message.type);

    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(message.payload, message);
        } catch (e) {
          log.error('Handler error:', e);
        }
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
  handler.on(ServerMessageType.ERROR, (payload) => log.error('Server error:', payload));
  handler.on(ServerMessageType.PONG, (payload: PongPayload) => {
    const latency = Date.now() - (payload.time || 0);
    log.debug(`Pong: ${latency}ms`);
  });
  return handler;
}
