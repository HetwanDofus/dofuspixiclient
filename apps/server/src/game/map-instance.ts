import type { ClientSession } from "../ws/client-session.ts";
import { encodeServerMessage } from "../protocol/codec.ts";
import {
  type ActorAddPayload,
  type ActorRemovePayload,
  type MountData,
  ServerMessageType,
} from "../protocol/types.ts";

interface MapActor {
  id: number;
  type: number;
  cellId: number;
  direction: number;
  name: string;
  look: string;
  session: ClientSession;
  linkedChildren?: Array<{ gfxId: number; childIndex: number }>;
  mount?: MountData;
}

export class MapInstance {
  readonly mapId: number;
  private actors = new Map<number, MapActor>();

  constructor(mapId: number) {
    this.mapId = mapId;
  }

  get topic(): string {
    return `map:${this.mapId}`;
  }

  addActor(
    session: ClientSession,
    characterId: number,
    name: string,
    cellId: number,
    direction: number,
    look: string,
    linkedChildren?: Array<{ gfxId: number; childIndex: number }>,
    mount?: MountData
  ): void {
    this.actors.set(characterId, {
      id: characterId,
      type: 0,
      cellId,
      direction,
      name,
      look,
      session,
      linkedChildren,
      mount,
    });

    // Subscribe to map topic
    session.ws.subscribe(this.topic);

    // Broadcast ACTOR_ADD to others on this map
    const addPayload: ActorAddPayload = {
      id: characterId,
      type: 0,
      cellId,
      direction,
      name,
      look,
      linkedChildren,
      mount,
    };
    const msg = encodeServerMessage(ServerMessageType.ACTOR_ADD, addPayload);
    session.ws.publish(this.topic, msg);
  }

  removeActor(characterId: number): void {
    const actor = this.actors.get(characterId);
    if (!actor) return;

    // Broadcast ACTOR_REMOVE before unsubscribing
    const removePayload: ActorRemovePayload = { id: characterId };
    const msg = encodeServerMessage(
      ServerMessageType.ACTOR_REMOVE,
      removePayload
    );
    actor.session.ws.publish(this.topic, msg);

    actor.session.ws.unsubscribe(this.topic);
    this.actors.delete(characterId);
  }

  updateActorCell(
    characterId: number,
    cellId: number,
    direction: number
  ): void {
    const actor = this.actors.get(characterId);
    if (actor) {
      actor.cellId = cellId;
      actor.direction = direction;
    }
  }

  getActors(): ActorAddPayload[] {
    const result: ActorAddPayload[] = [];
    for (const actor of this.actors.values()) {
      result.push({
        id: actor.id,
        type: actor.type,
        cellId: actor.cellId,
        direction: actor.direction,
        name: actor.name,
        look: actor.look,
        linkedChildren: actor.linkedChildren,
        mount: actor.mount,
      });
    }
    return result;
  }

  updateActorLook(characterId: number, look: string): void {
    const actor = this.actors.get(characterId);
    if (actor) {
      actor.look = look;
    }
  }

  broadcast(data: Uint8Array, sender?: ClientSession): void {
    if (sender) {
      sender.ws.publish(this.topic, data);
    } else {
      // Broadcast to all — use any actor's session to publish
      for (const actor of this.actors.values()) {
        actor.session.ws.publish(this.topic, data);
        // Also send to the publishing actor themselves
        actor.session.ws.send(data);
        break;
      }
    }
  }

  /** Broadcast to all actors including sender */
  broadcastToAll(data: Uint8Array): void {
    for (const actor of this.actors.values()) {
      actor.session.ws.send(data);
    }
  }

  get actorCount(): number {
    return this.actors.size;
  }

  isEmpty(): boolean {
    return this.actors.size === 0;
  }
}
