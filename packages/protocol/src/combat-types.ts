// ============================================================================
// Server -> Client Payloads
// ============================================================================

export interface CombatInitPayload {
  fightId: number;
  fightType: number;
  mapId: number;
  teams: CombatTeamPayload[];
  turnDuration: number;
  spectatorsAllowed: boolean;
}

export interface CombatTeamPayload {
  id: number;
  startCells: number[];
}

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

export interface CombatLeavePayload {
  fighterId: number;
  reason: number;
}

export interface CombatStartPayload {
  turnSequence: number[];
  round: number;
}

export interface CombatEndPayload {
  winnerId: number;
  duration: number;
  rewards: CombatRewardPayload[];
  challenges: CombatChallengeResultPayload[];
}

export interface CombatRewardPayload {
  fighterId: number;
  xp: number;
  kamas: number;
  items: CombatItemDropPayload[];
}

export interface CombatItemDropPayload {
  id: number;
  quantity: number;
}

export interface CombatChallengeResultPayload {
  id: number;
  success: boolean;
  bonus: number;
}

export interface CombatTurnStartPayload {
  fighterId: number;
  duration: number;
  round: number;
}

export interface CombatTurnEndPayload {
  fighterId: number;
}

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

export interface CombatMovementPayload {
  fighterId: number;
  path: number[];
  mpCost: number;
}

export interface CombatSpellPayload {
  casterId: number;
  spellId: number;
  spellLevel: number;
  targetCellId: number;
  critical: boolean;
  criticalFailure: boolean;
  effects: CombatSpellEffectPayload[];
}

export interface CombatSpellEffectPayload {
  targetId: number;
  targetCellId: number;
  type: number;
  value: number;
  element: number;
}

export interface CombatPlacementPayload {
  team: number;
  cells: number[];
}

export interface CombatTimelinePayload {
  sequence: number[];
}

export interface CombatStatsPayload {
  fighterId: number;
  hp: number;
  maxHp: number;
  ap: number;
  maxAp: number;
  mp: number;
  maxMp: number;
}

export interface CombatReadyPayload {
  fighterId: number;
  ready: boolean;
}

export interface CombatChallengePayload {
  challengerId: number;
  challengerName: string;
  targetId: number;
}

// ============================================================================
// Client -> Server Payloads
// ============================================================================

export interface CombatChallengeRequestPayload {
  targetId: number;
}

export interface CombatChallengeResponsePayload {
  challengerId: number;
  accept: boolean;
}

export interface CombatReadyRequestPayload {
  ready: boolean;
}

export interface CombatMoveRequestPayload {
  path: number[];
}

export interface CombatCastRequestPayload {
  spellId: number;
  targetCellId: number;
}

export interface CombatPlacementRequestPayload {
  cellId: number;
}

export interface CombatSpectateRequestPayload {
  fightId: number;
}
