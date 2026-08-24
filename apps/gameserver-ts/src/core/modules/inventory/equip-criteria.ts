/**
 * Evaluates `item_templates.criteria` — the boolean expression retail 1.29
 * attaches to an item to gate who can wear it, e.g. `CS>4`, `CS>42&CI>6`,
 * `Sc=2&(PB=4|PB=22|PB=170)`.
 *
 * Grammar, read off the ~6 000 expressions in the imported item set:
 * `<CODE><op><value>` atoms (`CODE` a run of letters, `op` one of
 * `> < = !`, `!` meaning "not equal"), combined with `&` (and) / `|` (or),
 * grouped with parentheses. Standard precedence — `&` binds tighter than
 * `|` — which only matters for the handful of expressions that mix both
 * without parenthesising every clause.
 *
 * **Only six characteristics, level and sex are evaluated**, because only
 * those are verifiable against data actually in this repo:
 *
 *   - `CS/CI/CA/CV/CC/CW` — strength/intelligence/agility/vitality/chance/
 *     wisdom, checked against *total* (base + equipment) — confirmed
 *     against dozens of weapon thresholds (`CS>4` on a level-1 sword,
 *     `CS>80&CV>40&CA>40` on a level-40 one).
 *   - `PL` — level, confirmed against consumables (`PL<16`, `PL>59`).
 *   - `PS` — sex, confirmed unambiguously by "Chapeau du Marié" (`PS=0`)
 *     paired with "Chapeau de la Mariée" (`PS=1`).
 *
 * Everything else — `PB`, `PZ`, `Ps`/`Pa` (lower-case, a *different* code
 * from `PS`), `PO`, `PJ`/`Pj`, `MK`, `BI`… — is **not** supported and is
 * deliberately not guessed at. `PB` looked like "classe" (breed) at first
 * read, but checking its values against item names across all twelve
 * classes disproves that: the single most common value, `PB=86`, is
 * spread evenly across Iop/Osamodas/Sram/Ecaflip/… gear, so it is not a
 * breed id in this data. Rather than ship a wrong rule that silently
 * blocks or allows the wrong players, an item whose criteria uses an
 * unsupported code always fails to equip — see `equip-rules.ts` and the
 * plan's fail-closed decision. `onUnsupported` exists so a caller can log
 * the exact expression and surface it later (~200 items outside the
 * supported set, mostly quest/job/guild gated gear).
 */

export interface CriteriaContext {
  strength: number;
  intelligence: number;
  agility: number;
  vitality: number;
  chance: number;
  wisdom: number;
  level: number;
  /** `players.sex`: 0 or 1. */
  sex: number;
}

type Node =
  | { kind: "and"; left: Node; right: Node }
  | { kind: "or"; left: Node; right: Node }
  | { kind: "cmp"; code: string; op: string; rawValue: string };

class UnsupportedCriterion extends Error {
  constructor(readonly code: string) {
    super(`unsupported item criterion code: ${code}`);
  }
}

class Parser {
  private pos = 0;

  constructor(private readonly src: string) {}

  parse(): Node {
    return this.parseOr();
  }

  private parseOr(): Node {
    let node = this.parseAnd();
    while (this.peek() === "|") {
      this.pos++;
      node = { kind: "or", left: node, right: this.parseAnd() };
    }
    return node;
  }

  private parseAnd(): Node {
    let node = this.parseAtom();
    while (this.peek() === "&") {
      this.pos++;
      node = { kind: "and", left: node, right: this.parseAtom() };
    }
    return node;
  }

  private parseAtom(): Node {
    if (this.peek() === "(") {
      this.pos++;
      const inner = this.parseOr();
      if (this.peek() === ")") {
        this.pos++;
      }
      return inner;
    }
    return this.parseComparison();
  }

  private parseComparison(): Node {
    const codeMatch = /^[A-Za-z]+/.exec(this.src.slice(this.pos));
    const code = codeMatch?.[0] ?? "";
    this.pos += code.length;

    const op = this.src[this.pos] ?? "";
    this.pos += 1;

    const start = this.pos;
    while (
      this.pos < this.src.length &&
      !"&|)".includes(this.src.charAt(this.pos))
    ) {
      this.pos++;
    }
    const rawValue = this.src.slice(start, this.pos);

    return { kind: "cmp", code, op, rawValue };
  }

  private peek(): string | undefined {
    return this.src[this.pos];
  }
}

const STAT_CODES: Record<string, keyof CriteriaContext> = {
  CS: "strength",
  CI: "intelligence",
  CA: "agility",
  CV: "vitality",
  CC: "chance",
  CW: "wisdom",
  PL: "level",
  PS: "sex",
};

function evalComparison(
  node: Extract<Node, { kind: "cmp" }>,
  ctx: CriteriaContext
): boolean {
  const field = STAT_CODES[node.code];
  if (!field) {
    throw new UnsupportedCriterion(node.code);
  }

  const value = Number.parseInt(node.rawValue, 10);
  if (!Number.isFinite(value)) {
    throw new UnsupportedCriterion(node.code);
  }

  const actual = ctx[field];
  switch (node.op) {
    case ">":
      return actual > value;
    case "<":
      return actual < value;
    case "=":
      return actual === value;
    case "!":
      return actual !== value;
    default:
      throw new UnsupportedCriterion(node.code);
  }
}

function evalNode(node: Node, ctx: CriteriaContext): boolean {
  switch (node.kind) {
    case "and":
      return evalNode(node.left, ctx) && evalNode(node.right, ctx);
    case "or":
      return evalNode(node.left, ctx) || evalNode(node.right, ctx);
    case "cmp":
      return evalComparison(node, ctx);
  }
}

/**
 * Evaluates one `item_templates.criteria` string. An empty string has no
 * restriction and always passes. Any parse failure or unsupported code
 * fails the whole expression closed, regardless of where in the boolean
 * tree it sits — a satisfied `CS>50` next to an unsupported `PB=86` under
 * `&` must not equip the item just because the half we understand passed.
 */
export function evaluateCriteria(
  expression: string,
  ctx: CriteriaContext,
  onUnsupported?: (code: string, expression: string) => void
): boolean {
  const trimmed = expression.trim();
  if (trimmed === "") {
    return true;
  }

  try {
    return evalNode(new Parser(trimmed).parse(), ctx);
  } catch (err) {
    if (err instanceof UnsupportedCriterion) {
      onUnsupported?.(err.code, expression);
    }
    return false;
  }
}
