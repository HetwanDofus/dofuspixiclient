/**
 * Combat network payload interfaces.
 * Defines the structure of messages between client and server.
 */

// ============================================================================
// Server -> Client Payloads
// ============================================================================

/**
 * Combat initialization data.
 * Sent when a fight is created.
 */
export interface CombatInitPayload {
  fightId: number;
  fightType: number;
  mapId: number;
  teams: CombatTeamPayload[];
  turnDuration: number;
  spectatorsAllowed: boolean;
}

/**
 * Team data for combat initialization.
 */
export interface CombatTeamPayload {
  id: number;
  startCells: number[];
}

/**
 * Fighter data.
 * Sent when a fighter joins or updates.
 */
export interface CombatFighterPayload {
  id: number;
  name: string;
  level: number;
  team: number;
  cellId: number;
  direction: number;
  look: string;
  hp: number;
  maxHp: number;
  ap: number;
  maxAp: number;
  mp: number;
  maxMp: number;
  initiative: number;
  isPlayer: boolean;
  entityType: number;
}

/**
 * Fighter leaves combat.
 */
export interface CombatLeavePayload {
  fighterId: number;
  reason: number;
}

/**
 * Combat start data.
 */
export interface CombatStartPayload {
  turnSequence: number[];
  round: number;
}

/**
 * Combat end data.
 */
export interface CombatEndPayload {
  winnerId: number;
  duration: number;
  rewards: CombatRewardPayload[];
  challenges: CombatChallengeResultPayload[];
}

/**
 * Reward data per fighter.
 */
export interface CombatRewardPayload {
  fighterId: number;
  xp: number;
  kamas: number;
  items: CombatItemDropPayload[];
}

/**
 * Item drop data.
 */
export interface CombatItemDropPayload {
  id: number;
  quantity: number;
}

/**
 * Challenge result data.
 */
export interface CombatChallengeResultPayload {
  id: number;
  success: boolean;
  bonus: number;
}

/**
 * Turn start data.
 */
export interface CombatTurnStartPayload {
  fighterId: number;
  duration: number;
  round: number;
}

/**
 * Turn end data.
 */
export interface CombatTurnEndPayload {
  fighterId: number;
}

/**
 * Effect applied/removed.
 */
export interface CombatEffectPayload {
  targetId: number;
  type: number;
  value: number;
  param1: number;
  param2: number;
  duration: number;
  sourceId: number;
  spellId: number;
  removed: boolean;
}

/**
 * Fighter movement.
 */
export interface CombatMovementPayload {
  fighterId: number;
  path: number[];
  mpCost: number;
}

/**
 * Spell cast data.
 */
export interface CombatSpellPayload {
  casterId: number;
  spellId: number;
  spellLevel: number;
  targetCellId: number;
  critical: boolean;
  criticalFailure: boolean;
  effects: CombatSpellEffectPayload[];
}

/**
 * Individual spell effect result.
 */
export interface CombatSpellEffectPayload {
  targetId: number;
  targetCellId: number;
  type: number;
  value: number;
  element: number;
}

/**
 * Placement cells update.
 */
export interface CombatPlacementPayload {
  team: number;
  cells: number[];
}

/**
 * Turn order timeline.
 */
export interface CombatTimelinePayload {
  sequence: number[];
}

/**
 * Fighter stats update.
 */
export interface CombatStatsPayload {
  fighterId: number;
  hp: number;
  maxHp: number;
  ap: number;
  maxAp: number;
  mp: number;
  maxMp: number;
}

/**
 * Fighter ready status.
 */
export interface CombatReadyPayload {
  fighterId: number;
  ready: boolean;
}

/**
 * Challenge notification.
 */
export interface CombatChallengePayload {
  challengerId: number;
  challengerName: string;
  targetId: number;
}

// ============================================================================
// Client -> Server Payloads
// ============================================================================

/**
 * Challenge request.
 */
export interface CombatChallengeRequestPayload {
  targetId: number;
}

/**
 * Accept/refuse challenge.
 */
export interface CombatChallengeResponsePayload {
  challengerId: number;
  accept: boolean;
}

/**
 * Set ready status.
 */
export interface CombatReadyRequestPayload {
  ready: boolean;
}

/**
 * Movement request.
 */
export interface CombatMoveRequestPayload {
  path: number[];
}

/**
 * Spell cast request.
 */
export interface CombatCastRequestPayload {
  spellId: number;
  targetCellId: number;
}

/**
 * Placement position request.
 */
export interface CombatPlacementRequestPayload {
  cellId: number;
}

/**
 * Spectate request.
 */
export interface CombatSpectateRequestPayload {
  fightId: number;
}
