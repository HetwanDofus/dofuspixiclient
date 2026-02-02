import type { ConnectionConfig, ConnectionState } from '@/types';
import { decodeMessage, type ServerMessage } from './protocol';

export type ConnectionEvent =
  | { type: 'connected' }
  | { type: 'disconnected'; code: number; reason: string }
  | { type: 'error'; error: Error }
  | { type: 'message'; message: ServerMessage }
  | { type: 'reconnecting'; attempt: number };

export type ConnectionEventListener = (event: ConnectionEvent) => void;

const DEFAULT_CONFIG: Required<ConnectionConfig> = {
  url: 'ws://localhost:8080',
  reconnectInterval: 3000,
  maxReconnectAttempts: 5,
};

export class Connection {
  private config: Required<ConnectionConfig>;
  private socket: WebSocket | null = null;
  private state: ConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners: Set<ConnectionEventListener> = new Set();
  private messageQueue: Uint8Array[] = [];

  constructor(config: ConnectionConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  getState(): ConnectionState {
    return this.state;
  }

  isConnected(): boolean {
    return this.state === 'connected' && this.socket?.readyState === WebSocket.OPEN;
  }

  addEventListener(listener: ConnectionEventListener): void {
    this.listeners.add(listener);
  }

  removeEventListener(listener: ConnectionEventListener): void {
    this.listeners.delete(listener);
  }

  private emit(event: ConnectionEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.error('Connection listener error:', e);
      }
    }
  }

  connect(): void {
    if (this.state === 'connecting' || this.state === 'connected') {
      return;
    }

    this.state = 'connecting';
    this.clearReconnectTimer();

    try {
      this.socket = new WebSocket(this.config.url);
      this.socket.binaryType = 'arraybuffer';
      this.socket.onopen = this.handleOpen.bind(this);
      this.socket.onclose = this.handleClose.bind(this);
      this.socket.onerror = this.handleError.bind(this);
      this.socket.onmessage = this.handleMessage.bind(this);
    } catch (error) {
      this.state = 'disconnected';
      this.emit({ type: 'error', error: error as Error });
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.clearReconnectTimer();
    this.reconnectAttempts = this.config.maxReconnectAttempts;
    if (this.socket) {
      this.socket.close(1000, 'Client disconnect');
      this.socket = null;
    }
    this.state = 'disconnected';
  }

  send(data: Uint8Array): boolean {
    if (!this.isConnected()) {
      this.messageQueue.push(data);
      return false;
    }
    try {
      this.socket!.send(data);
      return true;
    } catch {
      return false;
    }
  }

  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0 && this.isConnected()) {
      this.send(this.messageQueue.shift()!);
    }
  }

  private handleOpen(): void {
    this.state = 'connected';
    this.reconnectAttempts = 0;
    this.emit({ type: 'connected' });
    this.flushMessageQueue();
  }

  private handleClose(event: CloseEvent): void {
    this.socket = null;
    this.state = 'disconnected';
    this.emit({ type: 'disconnected', code: event.code, reason: event.reason });

    if (event.code !== 1000) {
      this.scheduleReconnect();
    }
  }

  private handleError(): void {
    this.emit({ type: 'error', error: new Error('WebSocket error') });
  }

  private handleMessage(event: MessageEvent): void {
    try {
      this.emit({ type: 'message', message: decodeMessage(event.data as ArrayBuffer) });
    } catch (e) {
      console.error('Failed to decode message:', e);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      return;
    }
    this.clearReconnectTimer();
    this.state = 'reconnecting';
    this.reconnectAttempts++;
    this.emit({ type: 'reconnecting', attempt: this.reconnectAttempts });
    this.reconnectTimer = setTimeout(() => this.connect(), this.config.reconnectInterval);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  destroy(): void {
    this.disconnect();
    this.listeners.clear();
    this.messageQueue = [];
  }
}
