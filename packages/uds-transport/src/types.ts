import type { GatewayFrame } from "@dofus/proto/gateway/v1/gateway_frame_pb";

export type Logger = {
  warn: (ctx: Record<string, unknown>, msg: string) => void;
  error: (ctx: Record<string, unknown>, msg: string) => void;
};

export type FramedSocket = {
  send: (frame: GatewayFrame) => void;
  close: () => void;
  readonly closed: boolean;
};

export type ConnectionHandlers = {
  onFrame: (frame: GatewayFrame) => void;
  onClose: () => void;
};

export type ServerOptions = {
  path: string;
  logger?: Logger;
  onConnection: (socket: FramedSocket) => ConnectionHandlers;
};

export type ClientOptions = {
  path: string;
  logger?: Logger;
  onFrame: (frame: GatewayFrame) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  reconnectMs?: number;
};
