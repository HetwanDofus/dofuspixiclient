export const ClientMessageType = {
  AUTH_LOGIN: 0x01,
  AUTH_LOGOUT: 0x02,
  CHARACTER_SELECT: 0x10,
  CHARACTER_MOVE: 0x11,
  CHARACTER_MOVE_END: 0x12,
  CHARACTER_ACTION: 0x13,
  MAP_LOAD: 0x20,
  MAP_CHANGE: 0x21,
  CHAT_MESSAGE: 0x30,
  CHAT_WHISPER: 0x31,
  INTERACT_OBJECT: 0x50,
  INTERACT_NPC: 0x51,
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
  CHARACTER_BOOST_STAT: 0x70,
  DEBUG_GIVE_CAPITAL: 0xd0,
  PING: 0xff,
} as const;

export type ClientMessageTypeValue =
  (typeof ClientMessageType)[keyof typeof ClientMessageType];

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
  MAP_ADJACENT: 0x23,
  ACTOR_ADD: 0x30,
  ACTOR_REMOVE: 0x31,
  ACTOR_MOVE: 0x32,
  ACTOR_UPDATE: 0x33,
  CHAT_MESSAGE: 0x40,
  CHAT_SYSTEM: 0x41,
  INTERACT_RESPONSE: 0x60,
  INTERACT_DIALOG: 0x61,
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
  COMBAT_PLACEMENT: 0x7a,
  COMBAT_TIMELINE: 0x7b,
  COMBAT_STATS: 0x7c,
  COMBAT_READY: 0x7d,
  COMBAT_CHALLENGE: 0x7e,
  ERROR: 0xfe,
  PONG: 0xff,
} as const;

export type ServerMessageTypeValue =
  (typeof ServerMessageType)[keyof typeof ServerMessageType];

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

export interface CharacterSelectPayload {
  characterId: number;
}

export interface CharacterMovePayload {
  path: number[];
}

export interface MapLoadPayload {
  mapId: number;
}

export interface MapChangePayload {
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

export interface CharacterInfoPayload {
  id: number;
  name: string;
  class: number;
  sex: number;
  color1: number;
  color2: number;
  color3: number;
  gfx: number;
  level: number;
  mapId: number;
  cellId: number;
  direction: number;
}

export interface MapDataPayload {
  mapId: number;
  width: number;
  height: number;
  background: number;
  compressed: Uint8Array;
  encoding: "gzip";
}

export interface MapActorsPayload {
  actors: ActorAddPayload[];
}

export interface AuthSuccessPayload {
  characters: Array<{
    id: number;
    name: string;
    class: number;
    sex: number;
    gfx: number;
    level: number;
    mapId: number;
    cellId: number;
  }>;
}

export interface CharacterStatsPayload {
  vitality: { base: number; items: number; boost: number };
  wisdom: { base: number; items: number; boost: number };
  strength: { base: number; items: number; boost: number };
  chance: { base: number; items: number; boost: number };
  agility: { base: number; items: number; boost: number };
  intelligence: { base: number; items: number; boost: number };
  hp: number;
  maxHp: number;
  ap: number;
  mp: number;
  energy: number;
  maxEnergy: number;
  bonusPoints: number;
  bonusPointsSpell: number;
  xp: number;
  xpLow: number;
  xpHigh: number;
  level: number;
  kama: number;
  initiative: number;
  discernment: number;
  range: number;
  summonLimit: number;
}

export interface BoostStatPayload {
  statId: number; // 0=vita, 1=wisdom, 2=strength, 3=chance, 4=agility, 5=intel
}

export interface AdjacentMapEntry {
  mapId: number;
  dx: number;
  dy: number;
  width: number;
  height: number;
  background: number;
  compressed: Uint8Array;
  encoding: "gzip";
}

export interface AdjacentMapsPayload {
  maps: AdjacentMapEntry[];
}
