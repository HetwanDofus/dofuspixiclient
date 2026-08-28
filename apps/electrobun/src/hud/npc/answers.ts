import type { NpcDialogAnswer } from "@/game/stores/npc-dialog-store";
import { dialogLang } from "@/game/lang/dialog-lang";

/** Answer id 1.29 uses for "close the window", never a real answer. */
export const LEAVE_ID = -1;

/**
 * Canonical `QuestionViewer.layoutContent`
 * (`assets/sources/client-code/dofus/graphics/gapi/controls/QuestionViewer.as:40-62`).
 *
 * A follow-up question with nothing to answer gets a single synthesised entry
 * — `CONTINUE_TO_SPEAK`, "Terminer la discussion.", id -1 — which closes the
 * window. The *opening* question does not: an NPC whose whole script is one
 * line shows no button at all, and the player dismisses it with the cross.
 * That asymmetry is not an oversight in 1.29; it is what makes a one-line NPC
 * read as a remark rather than as a conversation.
 *
 * Lives outside `NpcDialog.tsx` so that file exports nothing but its
 * component — a second export there costs React Fast Refresh, and this window
 * is exactly the kind of thing one tunes with the game running.
 */
export function visibleAnswers(
  answers: NpcDialogAnswer[],
  isFirstQuestion: boolean
): NpcDialogAnswer[] {
  if (isFirstQuestion || answers.length > 0) {
    return answers;
  }

  return [
    {
      id: LEAVE_ID,
      label: dialogLang()?.continueLabel ?? "Terminer la discussion.",
      disabled: false,
    },
  ];
}
