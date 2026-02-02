import { ServerMessageType, type ServerMessage, type ServerMessageTypeValue } from './protocol';

export type MessageHandlerFn<T = unknown> = (payload: T, message: ServerMessage<T>) => void;

export class MessageHandler {
  private handlers: Map<ServerMessageTypeValue, MessageHandlerFn[]> = new Map();
  private globalHandlers: MessageHandlerFn[] = [];

  on<T = unknown>(type: ServerMessageTypeValue, handler: MessageHandlerFn<T>): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, []);
    }

    this.handlers.get(type)!.push(handler as MessageHandlerFn);

    return () => this.off(type, handler);
  }

  off<T = unknown>(type: ServerMessageTypeValue, handler: MessageHandlerFn<T>): void {
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
        console.error('Handler error:', e);
      }
    }

    const handlers = this.handlers.get(message.type);

    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(message.payload, message);
        } catch (e) {
          console.error('Handler error:', e);
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
  handler.on(ServerMessageType.ERROR, (payload) => console.error('Server error:', payload));
  handler.on(ServerMessageType.PONG, (payload) => {
    const latency = Date.now() - ((payload as { time: number }).time || 0);
    console.log(`Pong: ${latency}ms`);
  });
  return handler;
}
