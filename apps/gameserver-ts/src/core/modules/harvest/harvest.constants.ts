/**
 * The frame an interactive object is drawn on, and the events that move it.
 *
 * The four states are the ones StarLoco's `Skills.lua` names against the
 * official server's own behaviour: a resource goes `LOCKED` while someone
 * works on it, `IN_USE` once it has been taken (the stump, the empty vein),
 * and `READYING` when it comes back. `READY` is the resting state and is
 * what a client that has just loaded the map assumes.
 */
export const InteractiveFrame = {
  Ready: 0,
  Locked: 2,
  InUse: 3,
  Readying: 5,
} as const;

export type InteractiveFrameValue =
  (typeof InteractiveFrame)[keyof typeof InteractiveFrame];

/** Scheduler channel a due respawn fires on. */
export const HARVEST_RESPAWN = "harvest.respawn";

export interface HarvestRespawnPayload {
  mapId: number;
  cellId: number;
}

export function respawnJobId(mapId: number, cellId: number): string {
  return `harvest:${mapId}:${cellId}`;
}

/**
 * How long a reservation may sit before another character may take the
 * resource anyway.
 *
 * A reservation is released explicitly on every path the service knows
 * about — completion, interruption, disconnection — so this only covers the
 * one it cannot: the process dying between the reservation and the reward.
 * The longest legitimate action is 12 s; anything past a minute is a
 * casualty, not a slow player.
 */
export const RESERVATION_GRACE_MS = 60_000;

/**
 * Why a harvest was refused, in words the player can act on.
 *
 * QA-123 is explicit: "Tout refus doit terminer l'action et produire une
 * raison exploitable par le client ; aucune branche ne doit rester
 * silencieuse." A refusal that only reaches the server log is the failure
 * this table exists to prevent — a player who clicks "Couper" and sees
 * nothing at all cannot tell a missing tool from a broken game.
 */
export const HARVEST_DENIAL_MESSAGES: Record<string, string> = {
  "not-in-world": "Vous ne pouvez pas récolter pour le moment.",
  "in-fight": "Impossible de récolter pendant un combat.",
  "already-harvesting": "Vous êtes déjà en train de récolter.",
  "no-resource-here": "Il n'y a rien à récolter ici.",
  "skill-not-runnable": "Cette action n'est pas encore disponible.",
  "job-not-learned": "Vous ne connaissez pas le métier nécessaire.",
  "job-level-too-low":
    "Votre niveau dans ce métier est insuffisant pour cette ressource.",
  "no-tool-equipped": "Vous devez équiper l'outil du métier.",
  "no-energy": "Vous êtes trop fatigué pour récolter.",
  "too-heavy": "Vous êtes trop chargé pour récolter.",
  "resource-taken": "Quelqu'un récolte déjà cette ressource.",
};
