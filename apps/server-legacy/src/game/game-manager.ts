import type { ClientSession } from "../ws/client-session.ts";
import { MapInstance } from "./map-instance.ts";

const mapInstances = new Map<number, MapInstance>();
const onlineCharacters = new Map<number, ClientSession>();

export function getOrCreateMapInstance(mapId: number): MapInstance {
  let instance = mapInstances.get(mapId);
  if (!instance) {
    instance = new MapInstance(mapId);
    mapInstances.set(mapId, instance);
  }
  return instance;
}

export function getMapInstance(mapId: number): MapInstance | undefined {
  return mapInstances.get(mapId);
}

export function cleanupEmptyMap(mapId: number): void {
  const instance = mapInstances.get(mapId);
  if (instance?.isEmpty()) {
    mapInstances.delete(mapId);
  }
}

export function registerOnlineCharacter(
  characterId: number,
  session: ClientSession
): void {
  onlineCharacters.set(characterId, session);
}

export function unregisterOnlineCharacter(characterId: number): void {
  onlineCharacters.delete(characterId);
}

export function isCharacterOnline(characterId: number): boolean {
  return onlineCharacters.has(characterId);
}

export function getOnlineCharacterSession(
  characterId: number
): ClientSession | undefined {
  return onlineCharacters.get(characterId);
}

export function getOnlineCount(): number {
  return onlineCharacters.size;
}

export function getMapInstanceCount(): number {
  return mapInstances.size;
}
