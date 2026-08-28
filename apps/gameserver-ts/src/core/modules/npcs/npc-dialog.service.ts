import { NpcDialogRepository } from "@modules/npcs/npc-dialog.repository";
import { Injectable, Logger } from "@nestjs/common";

/**
 * What picking an answer does, once its action rows have been read.
 *
 * `branch` — go to `nextQuestion`.
 * `end`    — close the dialog.
 * `blocked`— listed but greyed: the answer fires an effect this server does
 *            not implement yet (give an item, start a quest, teleport…).
 */
export type NpcDialogOutcome =
  | { kind: "branch"; nextQuestion: number }
  | { kind: "end" }
  | { kind: "blocked" };

export interface NpcDialogQuestion {
  id: number;
  /** Answer ids in display order. */
  responseIds: number[];
  /** `#N` substitution values for the lang-bundle text. */
  parameters: string[];
}

/** The reply action that carries navigation. Every other type is an effect. */
const ACTION_NAVIGATE = 1;

/** `npc_reponses_actions.args` for a navigate action that ends the dialog. */
const ARGS_LEAVE = "DV";

/**
 * The NPC dialog graph, held in memory.
 *
 * It is static content: `npc_dialog_questions` and
 * `npc_dialog_response_actions` are written by `just import-content` and by
 * nothing else, so this loads both tables once and answers from maps. About
 * 11 000 small rows — a few hundred kilobytes.
 *
 * The text is deliberately absent. In 1.29 a question's id *is* its key into
 * the `dialog` lang bundle (`D.q[id]` for the question, `D.a[id]` for an
 * answer — `Question.initialize` calls `api.lang.getDialogQuestionText(id)`),
 * so the server ships ids and the client resolves them against the bundle it
 * already has. Nothing here needs to know what an NPC actually says.
 */
@Injectable()
export class NpcDialogService {
  private readonly logger = new Logger(NpcDialogService.name);

  private readonly questions = new Map<number, NpcDialogQuestion>();
  private readonly outcomes = new Map<number, NpcDialogOutcome>();
  private loaded: Promise<void> | null = null;

  constructor(private readonly repo: NpcDialogRepository) {}

  async question(id: number): Promise<NpcDialogQuestion | undefined> {
    await this.load();
    return this.questions.get(id);
  }

  /**
   * What answer `responseId` does. An answer with no action row at all is
   * terminal — 30 of the reachable ones are, and the canonical client shows
   * them as ordinary answers that simply close the window.
   */
  async outcome(responseId: number): Promise<NpcDialogOutcome> {
    await this.load();
    return this.outcomes.get(responseId) ?? { kind: "end" };
  }

  /** The subset of a question's answers the client must grey out. */
  async unavailable(responseIds: readonly number[]): Promise<number[]> {
    await this.load();
    const out: number[] = [];
    for (const id of responseIds) {
      if ((this.outcomes.get(id) ?? { kind: "end" }).kind === "blocked") {
        out.push(id);
      }
    }
    return out;
  }

  private load(): Promise<void> {
    // Latched, not guarded by a boolean: two dialogs opening in the same tick
    // must share the one in-flight read rather than both issuing it.
    this.loaded ??= this.doLoad();
    return this.loaded;
  }

  private async doLoad(): Promise<void> {
    const [questions, actions] = await Promise.all([
      this.repo.allQuestions(),
      this.repo.allResponseActions(),
    ]);

    for (const row of questions) {
      this.questions.set(row.id, {
        id: row.id,
        responseIds: toNumbers(row.responseIds),
        parameters: toStrings(row.parameters),
      });
    }

    const byResponse = new Map<number, { type: number; args: string }[]>();
    for (const row of actions) {
      const list = byResponse.get(row.responseId);
      if (list) {
        list.push({ type: row.type, args: row.args });
      } else {
        byResponse.set(row.responseId, [{ type: row.type, args: row.args }]);
      }
    }

    for (const [responseId, list] of byResponse) {
      this.outcomes.set(responseId, classify(list));
    }

    this.logger.log(
      `dialog graph: ${this.questions.size} questions, ` +
        `${this.outcomes.size} answers`
    );
  }
}

/**
 * Turns an answer's action rows into what the server will actually do.
 *
 * The rule is deliberately strict: an answer is followed only when navigation
 * is *all* it does. 181 answers carry several actions, and one that both
 * branches and hands over an item would, if followed, silently skip the item —
 * a wrong dialog is worse than a greyed one. So anything beyond a lone
 * `ACTION_NAVIGATE` is blocked.
 *
 * Within navigation, `args` is either the next question id or the literal
 * `DV`. `DV` is by far the common case: 4 046 of the 4 904 navigate rows end
 * the conversation rather than continuing it.
 */
export function classify(
  actions: readonly { type: number; args: string }[]
): NpcDialogOutcome {
  if (actions.length === 0) {
    return { kind: "end" };
  }

  if (actions.length > 1 || actions[0]?.type !== ACTION_NAVIGATE) {
    return { kind: "blocked" };
  }

  const args = actions[0].args.trim();

  if (args === ARGS_LEAVE) {
    return { kind: "end" };
  }

  const next = Number.parseInt(args, 10);

  // A navigate row pointing at nothing (`-1`, or empty) is how the dump spells
  // "no follow-up" outside `DV`; ending is the only sane reading.
  return Number.isFinite(next) && next > 0
    ? { kind: "branch", nextQuestion: next }
    : { kind: "end" };
}

function toNumbers(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((v): v is number => typeof v === "number")
    : [];
}

function toStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}
