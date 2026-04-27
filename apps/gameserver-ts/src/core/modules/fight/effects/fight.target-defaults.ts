import { TargetMask } from "./fight.target-mask";

/**
 * Default target mask per effect ID. Used by the seed migration to
 * synthesize a targetMask when the canonical lang JSON doesn't carry
 * one. Values come from the existing handler decorators in
 * effects/handlers/*.handler.ts — keep this table in sync when adding
 * new handlers.
 *
 * Effect IDs not listed here default to TargetMask.None (= no filter)
 * so unfamiliar effects still apply unconditionally, matching the
 * pre-mask runtime behavior.
 */
const DEFAULTS: Record<number, number> = {
  // movement.handler.ts
  4: TargetMask.AnyFighter, // teleport — applied to a fighter (usually self)
  5: TargetMask.Enemy, // push back
  6: TargetMask.Enemy, // pull forward
  8: TargetMask.AnyFighter, // swap places

  // ap-mp.handler.ts
  77: TargetMask.Enemy, // steal MP
  84: TargetMask.Enemy, // steal AP
  101: TargetMask.Enemy, // remove AP
  127: TargetMask.Enemy, // remove MP

  // heal.handler.ts (also covers res orientation)
  81: TargetMask.AlliesAndSelf,
  108: TargetMask.AlliesAndSelf,
  143: TargetMask.AlliesAndSelf,

  // life-steal.handler.ts
  91: TargetMask.Enemy,
  92: TargetMask.Enemy,
  93: TargetMask.Enemy,
  94: TargetMask.Enemy,
  95: TargetMask.Enemy,

  // damage.handler.ts (elemental damage)
  96: TargetMask.Enemy,
  97: TargetMask.Enemy,
  98: TargetMask.Enemy,
  99: TargetMask.Enemy,
  100: TargetMask.Enemy,

  // pct-life.handler.ts
  85: TargetMask.Enemy,
  86: TargetMask.Enemy,
  87: TargetMask.Enemy,
  88: TargetMask.Enemy,
  89: TargetMask.Enemy,
  90: TargetMask.AlliesAndSelf, // pct heal

  // special.handler.ts
  82: TargetMask.Enemy, // life steal
  105: TargetMask.AlliesAndSelf, // damage reduction
  107: TargetMask.AlliesAndSelf, // reflect
  109: TargetMask.SelfOnly, // self-damage
  110: TargetMask.AlliesAndSelf, // max life
  132: TargetMask.AnyFighter, // dispel
  141: TargetMask.Enemy, // instant death
  142: TargetMask.Enemy, // fixed damage
  144: TargetMask.Enemy,
  265: TargetMask.AlliesAndSelf,
  780: TargetMask.AlliesAndSelf, // revive

  // resistance.handler.ts (all buffs)
  183: TargetMask.AlliesAndSelf,
  184: TargetMask.AlliesAndSelf,
  210: TargetMask.AlliesAndSelf,
  211: TargetMask.AlliesAndSelf,
  212: TargetMask.AlliesAndSelf,
  213: TargetMask.AlliesAndSelf,
  214: TargetMask.AlliesAndSelf,
  215: TargetMask.AlliesAndSelf,
  216: TargetMask.AlliesAndSelf,
  217: TargetMask.AlliesAndSelf,
  218: TargetMask.AlliesAndSelf,
  219: TargetMask.AlliesAndSelf,

  // stat-steal.handler.ts (debuff cast on enemy)
  266: TargetMask.Enemy,
  267: TargetMask.Enemy,
  268: TargetMask.Enemy,
  269: TargetMask.Enemy,
  270: TargetMask.Enemy,
  271: TargetMask.Enemy,
  320: TargetMask.Enemy,

  // state.handler.ts
  140: TargetMask.Enemy, // skip turn
  150: TargetMask.SelfOnly, // invisibility (most invis spells are self/ally)
  781: TargetMask.AnyFighter, // roll min
  782: TargetMask.AnyFighter, // roll max
  950: TargetMask.AnyFighter, // set state
  951: TargetMask.AnyFighter, // clear state

  // summon.handler.ts
  185: TargetMask.EmptyOnly,

  // trap-glyph.handler.ts
  400: TargetMask.EmptyOnly, // trap
  401: TargetMask.EmptyOnly, // glyph
};

export function defaultTargetMaskForEffect(effectId: number): number {
  return DEFAULTS[effectId] ?? TargetMask.None;
}
