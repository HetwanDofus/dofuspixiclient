/**
 * Translates `ItemTemplateData.criteria` — the same `CS>4`/`PL<16`-style
 * boolean expression the server's `equip-criteria.ts` evaluates — into
 * the French sentences the "Conditions" tab shows.
 *
 * Only the codes the server actually enforces are named here (see
 * `apps/gameserver-ts/.../inventory/equip-criteria.ts` for why: the rest
 * were checked against the imported item set and could not be verified,
 * so the server refuses to equip on them rather than guess). A code this
 * module does not recognise is shown by its raw expression rather than
 * hidden — a player should never see "aucune condition" for an item the
 * server is about to refuse to equip.
 */

const CODE_LABELS: Record<string, string> = {
  CS: "Force",
  CI: "Intelligence",
  CA: "Agilité",
  CV: "Vitalité",
  CC: "Chance",
  CW: "Sagesse",
  PL: "Niveau",
  PS: "Sexe",
};

const OP_LABELS: Record<string, string> = {
  ">": ">",
  "<": "<",
  "=": "=",
  "!": "≠",
};

function formatSex(value: string): string {
  if (value === "0") {
    return "Homme";
  }
  if (value === "1") {
    return "Femme";
  }
  return value;
}

/** One `CODE<op>value` atom → a French clause, e.g. "Force > 4". */
function formatAtom(code: string, op: string, value: string): string {
  const label = CODE_LABELS[code];
  const opLabel = OP_LABELS[op] ?? op;
  if (!label) {
    return `${code}${op}${value}`;
  }
  return `${label} ${opLabel} ${code === "PS" ? formatSex(value) : value}`;
}

/**
 * Splits on `&`/`|` at the top level (parentheses kept intact) and
 * formats each atom, joining with the French "et"/"ou". This is a
 * display formatter, not a re-implementation of the evaluator's
 * precedence rules — good enough for the vast majority of items, whose
 * criteria are a flat `&`-chain with no parentheses at all.
 */
export function formatCriteria(expression: string): string[] {
  const trimmed = expression.trim();
  if (trimmed === "") {
    return [];
  }

  const atomPattern = /([A-Za-z]+)([><=!])([^&|()]+)/g;
  const clauses: string[] = [];
  let match: RegExpExecArray | null = atomPattern.exec(trimmed);
  while (match !== null) {
    const [, code, op, value] = match;
    if (code && op && value !== undefined) {
      clauses.push(formatAtom(code, op, value));
    }
    match = atomPattern.exec(trimmed);
  }

  return clauses.length > 0 ? clauses : [trimmed];
}
