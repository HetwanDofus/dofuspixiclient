export {
  ClientMessageType,
  type ClientMessageTypeValue,
  ServerMessageType,
  type ServerMessageTypeValue,
  type BaseMessage,
  type ClientMessage,
  type ServerMessage,
  type LoginPayload,
  type CharacterSelectPayload,
  type CharacterMovePayload,
  type MapLoadPayload,
  type MapChangePayload,
  type ChatMessagePayload,
  type ActorAddPayload,
  type ActorMovePayload,
  type ActorRemovePayload,
  type CharacterInfoPayload,
  type CharacterStatsPayload,
  type BoostStatPayload,
  type MapDataPayload,
  type MapActorsPayload,
  type AuthSuccessPayload,
  type AdjacentMapEntry,
  type AdjacentMapsPayload,
  encodeClientMessage,
  decodeServerMessage,
} from "@dofus/protocol";

import {
  ClientMessageType,
  type ClientMessageTypeValue,
  decodeServerMessage,
  encodeClientMessage,
} from "@dofus/protocol";
import type {
  CharacterMovePayload,
  ChatMessagePayload,
  LoginPayload,
  MapLoadPayload,
} from "@dofus/protocol";

export function encodeMessage<T>(type: ClientMessageTypeValue, payload: T): Uint8Array {
  return encodeClientMessage(type, payload);
}

export function decodeMessage(data: ArrayBuffer | Uint8Array) {
  return decodeServerMessage(data);
}

export function createPingMessage(): Uint8Array {
  return encodeClientMessage(ClientMessageType.PING, { time: Date.now() });
}

export function createLoginMessage(username: string, password: string, version: string): Uint8Array {
  return encodeClientMessage<LoginPayload>(ClientMessageType.AUTH_LOGIN, { username, password, version });
}

export function createMoveMessage(path: number[]): Uint8Array {
  return encodeClientMessage<CharacterMovePayload>(ClientMessageType.CHARACTER_MOVE, { path });
}

export function createMapLoadMessage(mapId: number): Uint8Array {
  return encodeClientMessage<MapLoadPayload>(ClientMessageType.MAP_LOAD, { mapId });
}

export function createChatMessage(channel: number, content: string): Uint8Array {
  return encodeClientMessage<ChatMessagePayload>(ClientMessageType.CHAT_MESSAGE, { channel, content });
}
