import { createLogger } from "@/utils/logger";

const log = createLogger("DialogLang");

const LOCALE = "fr";
const DIALOG_BUNDLE_URL = `/assets/langs/${LOCALE}/dialog.json`;
const UI_BUNDLE_URL = `/assets/langs/${LOCALE}/lang.json`;

/**
 * Everything an NPC actually says.
 *
 * The server never sends a line of dialogue — it sends question and answer
 * ids, and those ids *are* the keys into this bundle. Canonical
 * `dofus.datacenter.Question.initialize`
 * (`assets/sources/client-code/dofus/datacenter/Question.as:24-40`) does the
 * same: `api.lang.getDialogQuestionText(id)` for the question,
 * `getDialogResponseText(id)` per answer, then `PatternDecoder.getDescription`
 * to fold the `#N` parameters in.
 *
 * Same fetch-once-and-latch shape as `npc-lang.ts`, and the same reason: the
 * extracted bundle is what retail shipped, so the French is the canonical
 * French rather than something re-translated.
 */
export interface DialogLangData {
  questions: Map<number, string>;
  responses: Map<number, string>;
  /**
   * `lang.json` `CONTINUE_TO_SPEAK` — "Terminer la discussion.". Canonical
   * `QuestionViewer.layoutContent` synthesises an answer with this label when
   * a follow-up question has none of its own.
   */
  continueLabel: string;
}

const FALLBACK_CONTINUE = "Terminer la discussion.";

type DialogBundle = {
  data?: { D?: { q?: Record<string, string>; a?: Record<string, string> } };
};

type UiBundle = { data?: Record<string, unknown> };

let latched: DialogLangData | null = null;
let loading: Promise<DialogLangData> | null = null;

function toMap(table: Record<string, string> | undefined): Map<number, string> {
  const out = new Map<number, string>();

  for (const [key, value] of Object.entries(table ?? {})) {
    const id = Number.parseInt(key, 10);
    // Empty strings are in the bundle for ~400 questions the dump never
    // reaches; keeping them costs nothing and telling them apart from a
    // missing id is worth more than the bytes.
    if (Number.isFinite(id)) {
      out.set(id, value);
    }
  }

  return out;
}

export function loadDialogLang(): Promise<DialogLangData> {
  if (latched) {
    return Promise.resolve(latched);
  }

  loading ??= Promise.all([
    fetch(DIALOG_BUNDLE_URL).then((r) => r.json()),
    // The one string the dialog window needs from outside its own bundle. A
    // failure here must not cost us the dialogue itself, so it falls back
    // rather than rejecting.
    fetch(UI_BUNDLE_URL)
      .then((r) => r.json())
      .catch(() => ({}) as UiBundle),
  ])
    .then(([dialogJson, uiJson]) => {
      const d = (dialogJson as DialogBundle).data?.D;
      const continueLabel = (uiJson as UiBundle).data?.CONTINUE_TO_SPEAK;

      latched = {
        questions: toMap(d?.q),
        responses: toMap(d?.a),
        continueLabel:
          typeof continueLabel === "string" && continueLabel !== ""
            ? continueLabel
            : FALLBACK_CONTINUE,
      };
      return latched;
    })
    .catch((err) => {
      log.error("failed to load the dialog bundle:", err);
      // Latch empty. The window still opens and still closes; it just has
      // nothing to read out. Degraded, never wedged.
      latched = {
        questions: new Map(),
        responses: new Map(),
        continueLabel: FALLBACK_CONTINUE,
      };
      return latched;
    });

  return loading;
}

/** What has been loaded so far, or null. For synchronous render paths. */
export function dialogLang(): DialogLangData | null {
  return latched;
}
