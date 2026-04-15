export type ActorId = number;

let nextActorId = 1;
export function freshActorId(): ActorId {
  return nextActorId++;
}

export abstract class Actor {
  abstract readonly id: ActorId;
  abstract dispose(): void;
}
