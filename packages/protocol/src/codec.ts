import { decode, encode } from "@msgpack/msgpack";

import type {
  ClientMessage,
  ClientMessageTypeValue,
  ClientPayloadMap,
  ServerMessage,
  ServerMessageTypeValue,
  ServerPayloadMap,
} from "./types.ts";

export function encodeClientMessage<T extends ClientMessageTypeValue>(
  type: T,
  payload: ClientPayloadMap[T]
): Uint8Array {
  return encode({ type, payload, timestamp: Date.now() });
}

export function decodeClientMessage(
  data: ArrayBuffer | Uint8Array
): ClientMessage {
  const buffer = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  return decode(buffer) as ClientMessage;
}

export function encodeServerMessage<T extends ServerMessageTypeValue>(
  type: T,
  payload: ServerPayloadMap[T]
): Uint8Array {
  return encode({ type, payload, timestamp: Date.now() }) as Uint8Array;
}

export function decodeServerMessage(
  data: ArrayBuffer | Uint8Array
): ServerMessage {
  const buffer = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  return decode(buffer) as ServerMessage;
}
