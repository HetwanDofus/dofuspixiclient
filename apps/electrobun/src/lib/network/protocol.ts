import { encode, decode } from '@msgpack/msgpack';

export const ClientMessageType = {
  AUTH_LOGIN: 0x01,
  AUTH_LOGOUT: 0x02,
  CHARACTER_SELECT: 0x10,
  CHARACTER_MOVE: 0x11,
  CHARACTER_ACTION: 0x12,
  MAP_LOAD: 0x20,
  MAP_CHANGE: 0x21,
  CHAT_MESSAGE: 0x30,
  CHAT_WHISPER: 0x31,
  INTERACT_OBJECT: 0x50,
  INTERACT_NPC: 0x51,

  // Combat client messages
  COMBAT_CHALLENGE: 0x60,
  COMBAT_ACCEPT: 0x61,
  COMBAT_REFUSE: 0x62,
  COMBAT_READY: 0x63,
  COMBAT_MOVE: 0x64,
  COMBAT_CAST: 0x65,
  COMBAT_PASS: 0x66,
  COMBAT_FORFEIT: 0x67,
  COMBAT_SPECTATE: 0x68,
  COMBAT_PLACEMENT: 0x69,

  PING: 0xFF,
} as const;

export type ClientMessageTypeValue = typeof ClientMessageType[keyof typeof ClientMessageType];

export const ServerMessageType = {
  AUTH_SUCCESS: 0x01,
  AUTH_FAILURE: 0x02,
  AUTH_KICKED: 0x03,
  CHARACTER_INFO: 0x10,
  CHARACTER_STATS: 0x11,
  CHARACTER_POSITION: 0x12,
  MAP_DATA: 0x20,
  MAP_ACTORS: 0x21,
  MAP_UPDATE: 0x22,
  ACTOR_ADD: 0x30,
  ACTOR_REMOVE: 0x31,
  ACTOR_MOVE: 0x32,
  ACTOR_UPDATE: 0x33,
  CHAT_MESSAGE: 0x40,
  CHAT_SYSTEM: 0x41,
  INTERACT_RESPONSE: 0x60,
  INTERACT_DIALOG: 0x61,

  // Combat server messages
  COMBAT_INIT: 0x70,
  COMBAT_JOIN: 0x71,
  COMBAT_LEAVE: 0x72,
  COMBAT_START: 0x73,
  COMBAT_END: 0x74,
  COMBAT_TURN_START: 0x75,
  COMBAT_TURN_END: 0x76,
  COMBAT_EFFECT: 0x77,
  COMBAT_MOVEMENT: 0x78,
  COMBAT_SPELL: 0x79,
  COMBAT_PLACEMENT: 0x7A,
  COMBAT_TIMELINE: 0x7B,
  COMBAT_STATS: 0x7C,
  COMBAT_READY: 0x7D,
  COMBAT_CHALLENGE: 0x7E,

  ERROR: 0xFE,
  PONG: 0xFF,
} as const;

export type ServerMessageTypeValue = typeof ServerMessageType[keyof typeof ServerMessageType];

export interface BaseMessage {
  type: number;
  timestamp?: number;
}

export interface ClientMessage<T = unknown> extends BaseMessage {
  type: ClientMessageTypeValue;
  payload: T;
}

export interface ServerMessage<T = unknown> extends BaseMessage {
  type: ServerMessageTypeValue;
  payload: T;
}

export interface LoginPayload {
  username: string;
  password: string;
  version: string;
}

export interface CharacterMovePayload {
  path: number[];
}

export interface MapLoadPayload {
  mapId: number;
}

export interface ChatMessagePayload {
  channel: number;
  content: string;
}

export interface ActorAddPayload {
  id: number;
  type: number;
  cellId: number;
  direction: number;
  name?: string;
  look?: string;
}

export interface ActorMovePayload {
  id: number;
  path: number[];
}

export interface ActorRemovePayload {
  id: number;
}

export function encodeMessage<T>(type: ClientMessageTypeValue, payload: T): Uint8Array {
  return encode({ type, payload, timestamp: Date.now() });
}

export function decodeMessage(data: ArrayBuffer | Uint8Array): ServerMessage {
  const buffer = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  return decode(buffer) as ServerMessage;
}

export function createPingMessage(): Uint8Array {
  return encodeMessage(ClientMessageType.PING, { time: Date.now() });
}

export function createLoginMessage(username: string, password: string, version: string): Uint8Array {
  return encodeMessage<LoginPayload>(ClientMessageType.AUTH_LOGIN, { username, password, version });
}

export function createMoveMessage(path: number[]): Uint8Array {
  return encodeMessage<CharacterMovePayload>(ClientMessageType.CHARACTER_MOVE, { path });
}

export function createMapLoadMessage(mapId: number): Uint8Array {
  return encodeMessage<MapLoadPayload>(ClientMessageType.MAP_LOAD, { mapId });
}

export function createChatMessage(channel: number, content: string): Uint8Array {
  return encodeMessage<ChatMessagePayload>(ClientMessageType.CHAT_MESSAGE, { channel, content });
}
