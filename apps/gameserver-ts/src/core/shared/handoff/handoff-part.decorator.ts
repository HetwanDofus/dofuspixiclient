// @HandoffPart() — marks an @Injectable as a Serializable participant in the
// blue/green handoff protocol. HandoffCoordinator discovers these at init via
// DiscoveryService (same pattern as @MessageHandler). Providers never import
// HandoffCoordinator, so no DI cycle.
//
//   @Injectable()
//   @HandoffPart()
//   export class FightActorRegistry implements Serializable<FightState[]> {
//     readonly name = "fight.actors";
//     serialize() { ... }
//     restore(state) { ... }
//   }

import { SetMetadata } from "@nestjs/common";

export const HANDOFF_PART_METADATA = "dofus:handoffPart";

export const HandoffPart = (): ClassDecorator =>
  SetMetadata(HANDOFF_PART_METADATA, true);
