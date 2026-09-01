export interface ImportedDialogQuestion {
  id: number;
  responseIds: number[];
  parameters: string[];
  cond: string;
  ifFalse: number;
}

export interface ImportedDialogAction {
  responseId: number;
  type: number;
  args: string;
}

export interface DialogGraphFilterResult {
  questions: ImportedDialogQuestion[];
  actions: ImportedDialogAction[];
  rejectedQuestions: number;
  rejectedResponses: number;
  rejectedDeadBranches: number;
}

const ACTION_NAVIGATE = 1;
const ACTION_LEARN_JOB = 6;

/**
 * Restrict a StarLoco 1.39 dialog graph to ids the retail 1.29 bundle can
 * actually render.
 *
 * Filtering only the missing node is insufficient: an answer that navigates
 * to it would remain clickable and open an empty window. Such answers are
 * removed from their parent too. Learning actions are slightly different:
 * their optional success/failure branches are downgraded to `0` when the
 * question is unavailable, so the useful learning effect remains and the
 * conversation honestly ends afterwards.
 */
export function filterDialogGraph(input: {
  questions: readonly ImportedDialogQuestion[];
  actions: readonly ImportedDialogAction[];
  questionTexts: Readonly<Record<string, string>>;
  responseTexts: Readonly<Record<string, string>>;
}): DialogGraphFilterResult {
  const displayableQuestions = new Set(
    input.questions
      .filter((question) => hasText(input.questionTexts, question.id))
      .map((question) => question.id)
  );

  const byResponse = new Map<number, ImportedDialogAction[]>();
  for (const action of input.actions) {
    const actions = byResponse.get(action.responseId) ?? [];
    actions.push(action);
    byResponse.set(action.responseId, actions);
  }

  let rejectedResponses = 0;
  let rejectedDeadBranches = 0;
  const keptResponses = new Set<number>();

  const questions = input.questions
    .filter((question) => displayableQuestions.has(question.id))
    .map((question) => {
      const responseIds = question.responseIds.filter((responseId) => {
        if (!hasText(input.responseTexts, responseId)) {
          rejectedResponses++;
          return false;
        }

        const dead = (byResponse.get(responseId) ?? []).some(
          (action) =>
            action.type === ACTION_NAVIGATE &&
            isQuestionId(action.args) &&
            !displayableQuestions.has(Number.parseInt(action.args, 10))
        );

        if (dead) {
          rejectedResponses++;
          rejectedDeadBranches++;
          return false;
        }

        keptResponses.add(responseId);
        return true;
      });

      return {
        ...question,
        responseIds,
        ifFalse: displayableQuestions.has(question.ifFalse)
          ? question.ifFalse
          : 0,
      };
    });

  const actions = input.actions
    .filter((action) => keptResponses.has(action.responseId))
    .map((action) =>
      action.type === ACTION_LEARN_JOB
        ? {
            ...action,
            args: sanitiseLearnBranches(action.args, displayableQuestions),
          }
        : action
    );

  return {
    questions,
    actions,
    rejectedQuestions: input.questions.length - questions.length,
    rejectedResponses,
    rejectedDeadBranches,
  };
}

function hasText(texts: Readonly<Record<string, string>>, id: number): boolean {
  const value = texts[String(id)];
  return typeof value === "string" && value.trim().length > 0;
}

function isQuestionId(args: string): boolean {
  const value = args.trim();
  if (value === "" || value === "DV") {
    return false;
  }

  const id = Number.parseInt(value, 10);
  return Number.isFinite(id) && id > 0;
}

function sanitiseLearnBranches(
  args: string,
  displayableQuestions: ReadonlySet<number>
): string {
  const values = args.split(",");

  for (const index of [2, 3]) {
    const id = Number.parseInt(values[index] ?? "", 10);
    if (Number.isFinite(id) && id > 0 && !displayableQuestions.has(id)) {
      values[index] = "0";
    }
  }

  return values.join(",");
}
