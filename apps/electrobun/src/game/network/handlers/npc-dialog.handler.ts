import type { MessageHandler } from "@/game/network/message-handler";
import { type DialogLangData, loadDialogLang } from "@/game/lang/dialog-lang";
import { decodeEffectPattern } from "@/game/lang/effects-lang";
import {
  closeNpcDialog,
  type NpcDialogAnswer,
  openNpcDialog,
  setNpcDialogQuestion,
} from "@/game/stores/npc-dialog-store";
import { createLogger } from "@/utils/logger";

const log = createLogger("NpcDialog");

/**
 * DC / DQ / DV — the NPC conversation window.
 *
 * The server ships ids, this resolves them against the `dialog` bundle. That
 * split is canonical (`dofus.aks.Dialog.onQuestion` builds a `Question` out of
 * an id plus two id lists, and `Question` does every lookup client-side), and
 * it is why a 1.5 MB bundle never crosses the wire.
 */
export class NpcDialogHandler {
  constructor(private readonly messageHandler: MessageHandler) {
    this.register();
  }

  private register(): void {
    this.messageHandler.on("dialogCreate", (payload) => {
      if (!payload.success) {
        // The NPC has no tree, or is not on our map any more. Nothing opens.
        closeNpcDialog();
        return;
      }

      // Canonical `NpcDialog.setNpcCharacteristics`: `customArtwork` wins over
      // the sprite gfx when the template sets one, and only for the portrait.
      const portraitGfx =
        payload.customArtwork > 0 ? payload.customArtwork : payload.gfxId;

      openNpcDialog({
        name: payload.name,
        portraitGfx,
        colors: [payload.color1, payload.color2, payload.color3],
      });

      // Warm the bundle while the window paints its portrait, so the first
      // question does not wait on a 1.5 MB fetch.
      void loadDialogLang();
    });

    this.messageHandler.on("dialogQuestion", (payload) => {
      void loadDialogLang().then((lang) => {
        setNpcDialogQuestion({
          questionId: payload.questionId,
          text: questionText(lang, payload.questionId, payload.params),
          answers: buildAnswers(
            lang,
            payload.responseIds,
            payload.unavailableResponseIds
          ),
        });
      });
    });

    this.messageHandler.on("dialogLeave", () => {
      closeNpcDialog();
    });
  }
}

function questionText(
  lang: DialogLangData,
  questionId: number,
  params: string[]
): string {
  const raw = lang.questions.get(questionId);

  if (raw === undefined) {
    log.warn(`no bundle text for question ${questionId}`);
    return "";
  }

  // `#N` substitution, Ankama's own pattern language — the same decoder the
  // effect descriptions use.
  return params.length > 0 ? decodeEffectPattern(raw, params) : raw;
}

/**
 * One entry per answer, in the server's order, which is the dump's order,
 * which is display order.
 *
 * A greyed answer is still listed: 1.29 keeps an action it cannot offer
 * visible rather than hiding it, and hiding these would silently amputate
 * trees — 245 of the reachable answers do something (hand over an item, start
 * a quest) that this server does not implement yet. The player can see the
 * branch exists, which is the point.
 *
 * An answer with **no text** is a different case and is dropped. 44 of the 901
 * reachable answers name a bundle entry that does not exist — Snori Nairb's
 * 23016 has neither text nor an action row, it is a dangling id in the dump —
 * and there is nothing to grey out: an unreadable row teaches the player
 * nothing and offers them a choice they cannot make.
 */
export function buildAnswers(
  lang: DialogLangData,
  responseIds: number[],
  unavailable: number[]
): NpcDialogAnswer[] {
  const blocked = new Set(unavailable);
  const out: NpcDialogAnswer[] = [];

  for (const id of responseIds) {
    const label = lang.responses.get(id) ?? "";

    if (label.trim() === "") {
      log.warn(`answer ${id} has no bundle text — dropping it`);
      continue;
    }

    out.push({ id, label, disabled: blocked.has(id) });
  }

  return out;
}
