/**
 * Spell 903 — Flèche Enflammée / Jet de flamme (Cra fire arrow variant).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/903/scripts/scripts/
 *
 * displayType=11 (TargetCell). There are no `move`/`shoot`/`duplicate` symbols,
 * no `cellFrom`/`cellTo` world-absolute positioning, no caster-anchored logic.
 * The spell is a single animated composite (`anim1`, 75 frames) placed at the
 * target cell. This matches the TargetCell pattern.
 *
 * Structure:
 *   - `anim1` (DefineSprite_11, 75 frames) — main impact animation.
 *       frame_1:  scale self to `50 + level*5` percent.
 *       frame_13: `this.end()` → signalHit (damage popup).
 *       frame_73: `this._parent.removeMovieClip()` → spell complete.
 *
 *   - Inside anim1, there are authored child placements (DefineSprite_8,
 *     DefineSprite_7, DefineSprite_2) that are baked into the composite
 *     `anim1` frames. The only runtime-significant scripts on them are:
 *
 *     DefineSprite_8 (flame puff, placed 3× at depths 1, 8, 15):
 *       Each placed instance has an onClipEvent(load) that seeds scale from
 *       `10 + 3 * level` and optionally calls gotoAndPlay(6) or gotoAndPlay(9)
 *       to stagger the phase. These are authored children of anim1's timeline
 *       (not dynamically attached via attachMovie), so they are baked into the
 *       composite SVG frames. No dynamic attachment is needed.
 *
 *     DefineSprite_7 (smoke wisp, placed inside DefineSprite_8):
 *       frame_1 DoAction seeds _Y/_X/_yscale offsets.
 *       Its placed child (PlaceObject2_6_6) onLoad sets _xscale = random(100).
 *       Also baked into the composite.
 *
 *     DefineSprite_2 (fade-out helper):
 *       frame_1 DoAction: `_alpha = _alpha - 25` — baked.
 *
 *   Since manifest.json has an empty `librarySymbols` array and only a single
 *   `animations` entry (`anim1`), ALL visual content is baked into the `anim1`
 *   composite frames. We register `anim1` as the sole SymbolDefinition, using
 *   `textures.getFrames("anim1")` (NO `lib_` prefix — it's in `animations[]`,
 *   not `librarySymbols[]`).
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
 * Main timeline: SOMA.playSound("jet_903") on frame_1 (no stop, single frame).
 */

import type {
  SpellCallbacks,
  SpellContext,
  SpellTextureProvider,
  SymbolDefinition,
} from "@dofus/spell-runtime";
import {
  RuntimeSpell,
  SpellDisplayType,
  calculateAnchor,
} from "@dofus/spell-runtime";

const ANIM1_BOUNDS = {
  width: 197.95,
  height: 102.2,
  offsetX: 7.1,
  offsetY: -52.55,
};

export class Spell903 extends RuntimeSpell {
  readonly spellId = 903;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — main impact animation (DefineSprite_11, 75 frames) ----
    // Textures are the composite baked SVG frames from animations[0] ("anim1").
    // No lib_ prefix — this symbol is in animations[], not librarySymbols[].
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 75,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,

      frameScripts: new Map([
        [
          // AS: DefineSprite_11/frame_1/DoAction.as
          // t = 50 + _parent.level * 5;
          // _xscale = t; _yscale = t;
          0,
          (clip) => {
            const level = (clip.parent?.vars.level as number) ?? 1;
            const t = 50 + level * 5;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
          },
        ],
        [
          // AS: DefineSprite_11/frame_13/DoAction.as
          // this.end() → signalHit (damage popup at target)
          12,
          () => {
            this.runtime.signalHit();
          },
        ],
        [
          // AS: DefineSprite_11/frame_73/DoAction.as
          // this._parent.removeMovieClip(); → spell complete
          72,
          (clip) => {
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: scripts/frame_1/DoAction.as
    // SOMA.playSound("jet_903");
    callbacks.playSound("jet_903");

    // Attach anim1 at the root (target cell anchor, depth 1).
    // This mirrors the implicit main-timeline placement of DefineSprite_11.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
