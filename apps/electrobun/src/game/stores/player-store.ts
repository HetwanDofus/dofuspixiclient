import { ExternalStore } from "./game-store";

export interface PlayerState {
  isAuthorized: boolean;
  /**
   * Local player's canonical sprite id. Set once on character-selection
   * (mirrors `currentCharacter.spriteId` in GameSession). Read by
   * inbound handlers that need to discriminate "me" vs "anyone else"
   * — e.g. registerJoin forwards this into FIGHT_INIT so the fight
   * machine can route TURN_START into the `myTurn` substate.
   */
  spriteId: string | null;
}

// `isAuthorized` defaults to `true` because the BG / BL
// (AuthorizedInterfaceOpen/Close) opcode handlers from
// Basics.as:156-162 aren't wired in the new dofus1-net stack yet —
// without that, a hard `false` would lock every admin out of
// `/console`. Flip this back to `false` once a BG/BL handler exists
// and calls `setAuthorized` on receipt.
const initialState: PlayerState = {
  isAuthorized: true,
  spriteId: null,
};

export const playerStore = new ExternalStore<PlayerState>(initialState);

export function setAuthorized(isAuthorized: boolean): void {
  playerStore.setState({ isAuthorized });
}

export function setLocalSpriteId(spriteId: string | null): void {
  playerStore.setState({ spriteId });
}
