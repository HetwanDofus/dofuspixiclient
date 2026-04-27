/**
 * Spell 607 — Esquive (Dodge).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/607/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no projectile, no caster-anchored
 * content, no dual-timeline — just a single 126-frame animation that plays
 * at the target cell. The animation is a flat `anim1` entry in animations[]
 * with no librarySymbols[], so no attachMovie calls exist anywhere.
 *
 * Library symbols: none. The spell is a single authored sprite timeline
 * (DefineSprite_11) placed directly on the main timeline.
 *
 * DefineSprite_11 timeline:
 *   - frame_1  (index 0):  SOMA.playSound("dodge_607")
 *   - frame_55 (index 54): SOMA.playSound("dodge_607b")
 *   - frame_103 (index 102): SOMA.playSound("dodge_607c")
 *   - frame_124 (index 123): _parent.removeMovieClip() → spell complete
 *
 * signalHit is fired at frame_1 (index 0) since the dodge animation
 * begins immediately at the target cell — there is no explicit "impact
 * frame" in the AS, so the first frame (when the sound plays) is the
 * canonical hit moment.
 *
 * Main timeline: implicitly places anim1 (DefineSprite_11) on the stage;
 * we register it as a symbol and attach it from onSpellStart.
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
  width: 55.2,
  height: 36.15,
  offsetX: -20.55,
  offsetY: -70.05,
};

export class Spell607 extends RuntimeSpell {
  readonly spellId = 607;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 / DefineSprite_11 — main dodge animation ----------
    // 126-frame authored timeline placed on the main stage.
    // Textures are under "anim1" (no lib_ prefix — this is an
    // animations[] entry, not a librarySymbols[] entry).
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 126,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS DefineSprite_11/frame_1/DoAction.as
            // SOMA.playSound("dodge_607");
            this.soundCallback?.("dodge_607");
            this.runtime.signalHit();
          },
        ],
        [
          54,
          (_clip) => {
            // AS DefineSprite_11/frame_55/DoAction.as
            // SOMA.playSound("dodge_607b");
            this.soundCallback?.("dodge_607b");
          },
        ],
        [
          102,
          (_clip) => {
            // AS DefineSprite_11/frame_103/DoAction.as
            // SOMA.playSound("dodge_607c");
            this.soundCallback?.("dodge_607c");
          },
        ],
        [
          123,
          (clip) => {
            // AS DefineSprite_11/frame_124/DoAction.as
            // _parent.removeMovieClip();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture callbacks so frame scripts can play sounds.
    this.soundCallback = callbacks.playSound;

    // Attach the main animation at the target cell (root is at
    // targetCell origin for displayType=11).
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
