import { ExternalStore } from "./game-store";

export interface NpcDialogAnswer {
  id: number;
  label: string;
  /** Listed but not clickable — its reply action is not implemented. */
  disabled: boolean;
}

export interface NpcDialogState {
  open: boolean;
  npcName: string;
  /**
   * The artwork to draw, already resolved: `customArtwork` when the template
   * overrides it, the sprite gfx otherwise. 0 when the NPC has neither.
   */
  portraitGfx: number;
  colors: readonly [number, number, number];
  /** 0 while the DC frame has landed but its first DQ has not. */
  questionId: number;
  text: string;
  answers: NpcDialogAnswer[];
  /**
   * Canonical `NpcDialog._bFirstQuestion`. It gates the synthesised
   * "Terminer la discussion." entry: a *follow-up* question with no answers
   * gets one, the opening question does not.
   */
  isFirstQuestion: boolean;
}

const closed: NpcDialogState = {
  open: false,
  npcName: "",
  portraitGfx: 0,
  colors: [-1, -1, -1],
  questionId: 0,
  text: "",
  answers: [],
  isFirstQuestion: true,
};

export const npcDialogStore = new ExternalStore<NpcDialogState>(closed);

export function openNpcDialog(npc: {
  name: string;
  portraitGfx: number;
  colors: readonly [number, number, number];
}): void {
  npcDialogStore.replaceState({
    ...closed,
    open: true,
    npcName: npc.name,
    portraitGfx: npc.portraitGfx,
    colors: npc.colors,
  });
}

export function setNpcDialogQuestion(question: {
  questionId: number;
  text: string;
  answers: NpcDialogAnswer[];
}): void {
  const state = npcDialogStore.getSnapshot();

  // A question can only arrive inside an open dialog. Ignoring a stray one
  // stops a late frame from re-opening a window the player just closed.
  if (!state.open) {
    return;
  }

  npcDialogStore.replaceState({ ...state, ...question });
}

/**
 * Canonical `NpcDialog.response`: picking an answer clears the first-question
 * flag before the next question arrives.
 */
export function markNpcDialogAnswered(): void {
  const state = npcDialogStore.getSnapshot();
  if (state.open && state.isFirstQuestion) {
    npcDialogStore.replaceState({ ...state, isFirstQuestion: false });
  }
}

export function closeNpcDialog(): void {
  if (npcDialogStore.getSnapshot().open) {
    npcDialogStore.replaceState(closed);
  }
}
