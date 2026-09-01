import { NpcDialogRepository } from "@modules/npcs/npc-dialog.repository";
import { Injectable, Logger } from "@nestjs/common";

/**
 * What picking an answer does, once its action rows have been read.
 *
 * `branch`    — go to `nextQuestion`.
 * `end`       — close the dialog.
 * `open-bank` — open the account bank, then close.
 * `learn-job` — grant the job, then branch on the outcome.
 * `blocked`   — listed but greyed: the answer fires an effect this server
 *               does not implement yet (give an item, start a quest,
 *               teleport…).
 */
export type NpcDialogOutcome =
  | { kind: "branch"; nextQuestion: number }
  | { kind: "end" }
  /** Open the account bank, then close the conversation. */
  | { kind: "open-bank" }
  /** Teach a job, then branch on whether the slot rules allowed it. */
  | {
      kind: "learn-job";
      jobId: number;
      onSuccess: number | null;
      onFailure: number | null;
    }
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

/**
 * "Consulter son coffre personnel" — open the account bank.
 *
 * The dump gives it type `-1` and it occurs exactly **once** in the whole
 * table, on answer 259 of the banker's question 318, alongside a
 * navigate-to-`DV`. Its `nom` column names it outright, which is the only
 * reason the negative id is legible at all.
 */
const ACTION_OPEN_BANK = -1;

/**
 * "Apprendre le métier de …" — 40 answers carry it, one per teachable job.
 *
 * `args` is four comma-separated numbers. Only the first is unambiguous: it
 * is the job id, and it matches `jobs.json`'s `J` on all 40 rows. The third
 * and fourth are question ids, and the twelve answers that *also* carry an
 * explicit navigate row disagree about which of the two it points at — 851
 * navigates to `args[2]`, 853 to `args[3]`. Rather than pick a winner, the
 * navigation here is derived from the pair itself: `args[2]` when the job was
 * granted, `args[3]` when the slot rules refused it, which is the only
 * reading under which both of those rows make sense. `args[1]` is not used
 * by anything and is not interpreted.
 */
const ACTION_LEARN_JOB = 6;

/**
 * A placeholder row. 23 of the 37 type-0 rows carry empty args and do
 * nothing at all — "Refuser", "Apprendre le métier", "Livrer …". The other
 * 14 carry a `mapId,cellId` pair and are teleports, which this server does
 * not perform; only the empty ones are treated as a no-op.
 */
const ACTION_NONE = 0;

/** The effect types this server knows how to carry out. */
const IMPLEMENTED_EFFECTS = new Set<number>([
  ACTION_OPEN_BANK,
  ACTION_LEARN_JOB,
]);

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
 * An answer is navigation plus a set of effects. The rule is deliberately
 * strict about the effects: an answer is followed only when *every* effect
 * it carries is one this server can actually perform. 181 answers carry
 * several actions, and one that both branches and hands over an item
 * would, if followed, silently skip the item — a wrong dialog is worse
 * than a greyed one.
 *
 * What changed when the bank arrived is only which effects qualify. The
 * rule used to be "navigation and nothing else", which greyed the
 * banker's own answer because it carries `open-bank` *and* a navigate.
 * Now an implemented effect is allowed to travel with its navigation, and
 * everything still unimplemented is greyed exactly as before.
 *
 * Within navigation, `args` is either the next question id or the literal
 * `DV`. `DV` is by far the common case: 4 046 of the 4 904 navigate rows
 * end the conversation rather than continuing it.
 */
export function classify(
  actions: readonly { type: number; args: string }[]
): NpcDialogOutcome {
  if (actions.length === 0) {
    return { kind: "end" };
  }

  const navigations = actions.filter((a) => a.type === ACTION_NAVIGATE);
  const effects = actions.filter(
    (a) =>
      a.type !== ACTION_NAVIGATE &&
      !(a.type === ACTION_NONE && a.args.trim() === "")
  );

  if (effects.some((effect) => !IMPLEMENTED_EFFECTS.has(effect.type))) {
    return { kind: "blocked" };
  }

  // Two navigate rows on one answer would mean two next questions; there
  // is no reading of that which is safe to guess at.
  if (navigations.length > 1) {
    return { kind: "blocked" };
  }

  // An effect wins over the navigation that accompanies it: the banker's
  // answer navigates to `DV`, and opening the bank already ends the
  // conversation.
  if (effects.some((effect) => effect.type === ACTION_OPEN_BANK)) {
    return { kind: "open-bank" };
  }

  const learnJob = effects.find((effect) => effect.type === ACTION_LEARN_JOB);

  if (learnJob) {
    const args = learnJob.args.split(",").map((a) => Number.parseInt(a, 10));
    const jobId = args[0];

    if (jobId === undefined || !Number.isFinite(jobId) || jobId <= 0) {
      return { kind: "blocked" };
    }

    return {
      kind: "learn-job",
      jobId,
      onSuccess: questionOrNull(args[2]),
      onFailure: questionOrNull(args[3]),
    };
  }

  const args = navigations[0]?.args.trim();

  if (args === undefined || args === ARGS_LEAVE) {
    return { kind: "end" };
  }

  const next = Number.parseInt(args, 10);

  // A navigate row pointing at nothing (`-1`, or empty) is how the dump
  // spells "no follow-up" outside `DV`; ending is the only sane reading.
  return Number.isFinite(next) && next > 0
    ? { kind: "branch", nextQuestion: next }
    : { kind: "end" };
}

/** A question id, or `null` where the dump wrote nothing usable. */
function questionOrNull(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : null;
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
