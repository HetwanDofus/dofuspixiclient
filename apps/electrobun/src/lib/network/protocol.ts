export {
  ClientMessageType,
  type ClientMessageTypeValue,
  type ClientPayloadMap,
  ServerMessageType,
  type ServerMessageTypeValue,
  type ServerPayloadMap,
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
  type ActorUpdatePayload,
  type ErrorPayload,
  type PingPayload,
  type PongPayload,
  type InventoryItem,
  type InventoryListPayload,
  type InventoryWeightPayload,
  type ItemAddPayload,
  type ItemRemovePayload,
  type ItemQuantityPayload,
  type ItemMovePayload,
  type ItemMoveRequestPayload,
  type ItemUseRequestPayload,
  type ItemDropRequestPayload,
  type ItemDestroyRequestPayload,
  type ItemEffect,
  type ItemTemplate,
  EquipmentPosition,
  type EquipmentPositionValue,
  ItemCategory,
  ItemEffectId,
  ItemSuperType,
  encodeClientMessage,
  decodeServerMessage,
} from "@dofus/protocol";

import {
  type ClientMessageTypeValue,
  encodeClientMessage,
  decodeServerMessage,
} from "@dofus/protocol";

export function encodeMessage<T>(type: ClientMessageTypeValue, payload: T): Uint8Array {
  return encodeClientMessage(type, payload as never);
}

export function decodeMessage(data: ArrayBuffer | Uint8Array) {
  return decodeServerMessage(data);
}
