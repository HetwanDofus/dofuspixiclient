import { type Actor, createActor } from "xstate";

import { loginMachine } from "./login.machine";
import { mapTransitionMachine } from "./map-transition.machine";
import { spellCastMachine } from "./spell-cast.machine";

/**
 * Process-wide actor instances for the orchestration machines. The fightActor
 * lives in stores/fight-store.ts so it can directly drive the store.
 */
export const loginActor: Actor<typeof loginMachine> = createActor(loginMachine);
export const mapTransitionActor: Actor<typeof mapTransitionMachine> =
  createActor(mapTransitionMachine);
export const spellCastActor: Actor<typeof spellCastMachine> =
  createActor(spellCastMachine);

loginActor.start();
mapTransitionActor.start();
spellCastActor.start();
