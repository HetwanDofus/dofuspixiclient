/**
 * Spell 2008 — (Unknown name, likely a Cra/Osa fire/impact spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2008/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single authored sprite
 * (DefineSprite_32) that positions itself at `_parent.cellTo` on frame_1,
 * plays a 67-frame timeline, and removes its parent (the outer mc) on frame_67.
 * There is no projectile motion, no caster reference, no `move`/`shoot`
 * library symbols — this is a straight impact-at-target animation.
 *
 * The `animations[]` entry `shoot` (84 frames, DefineSprite_18_shoot) is a
 * separate authored composite whose frame_70 calls `stop()`. It provides the
 * visual frames for DefineSprite_32. Since it appears only in `animations[]`
 * (not in `librarySymbols[]`), textures are fetched without the `lib_` prefix.
 *
 * Library symbols: none (librarySymbols[] is absent/empty in manifest).
 *
 * Main timeline (frame_2/DoAction.as): stop() — the main SWF halts on frame 2.
 * The canonical sounds are embedded in DefineSprite_32's timeline:
 *   - frame_1:  SOMA.playSound("licrounch_1003")
 *   - frame_25: SOMA.playSound("explosion")
 *
 * DefineSprite_32 timeline actions:
 *   - frame_1  (DoAction.as):   SOMA.playSound("licrounch_1003")
 *   - frame_1  (DoAction_2.as): _X = _parent.cellTo.x; _Y = _parent.cellTo.y
 *   - frame_25 (DoAction.as):   SOMA.playSound("explosion")
 *   - frame_25 (DoAction_2.as): this.end() → signalHit
 *   - frame_67 (DoAction.as):   _parent.removeMovieClip() → complete
 *
 * DefineSprite_18_shoot (the visual content symbol):
 *   - frame_70 (DoAction.as):   stop()
 *
 * Since DefineSprite_32 is the outer-mc-level sprite (the harness places it
 * as the root's child at TargetCell), we model it as the `shoot` symbol
 * registered under the name "shoot" with textures from `textures.getFrames("shoot")`.
 * The runtime attaches it from onSpellStart.
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

const SHOOT_BOUNDS = {
  width: 204.8,
  height: 129.6,
  offsetX: -102.35,
  offsetY: -68.1,
};

export class Spell2008 extends RuntimeSpell {
  readonly spellId = 2008;
  readonly displayType = SpellDisplayType.TargetCell;

  private shootSym!: SymbolDefinition;
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- shoot (DefineSprite_32) — 67-frame impact at target ----
    // Visual frames come from DefineSprite_18_shoot (animations[] entry "shoot",
    // 84 frames); DefineSprite_18_shoot/frame_70/DoAction.as: stop().
    // DefineSprite_32 hosts the timeline scripts and positions itself at cellTo.
    //
    // We model this as a single symbol named "shoot" whose frame textures are
    // the authored "shoot" animation frames (no lib_ prefix — not in librarySymbols).
    // The totalFrames is 67 (the outer sprite's authored length, which drives
    // completion). The inner stop() at frame 70 of the visual content is
    // subsumed by the outer sprite's own timeline completing at frame 67.
    this.shootSym = {
      name: "shoot",
      totalFrames: 67,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_32/frame_1/DoAction.as: SOMA.playSound("licrounch_1003")
            this.soundCallback?.("licrounch_1003");

            // AS DefineSprite_32/frame_1/DoAction_2.as:
            //   _X = _parent.cellTo.x;
            //   _Y = _parent.cellTo.y;
            // For displayType=11 (TargetCell), the root container is already
            // anchored at cellTo in world coords. The sprite positions itself
            // at cellTo in world absolute terms, which inside the container
            // local space means (0, 0). However the canonical AS reads
            // _parent.cellTo directly, so we do the same here.
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            if (cellTo) {
              // container anchor is already at cellTo, so local (0,0) is correct.
              // We still set explicitly to mirror canonical _X/_Y assignment.
              clip.x = 0;
              clip.y = 0;
            }
          },
        ],
        [
          24,
          (clip) => {
            // AS DefineSprite_32/frame_25/DoAction.as: SOMA.playSound("explosion")
            this.soundCallback?.("explosion");

            // AS DefineSprite_32/frame_25/DoAction_2.as: this.end() → signalHit
            void clip; // clip reference kept for consistency
            this.runtime.signalHit();
          },
        ],
        [
          66,
          (clip) => {
            // AS DefineSprite_32/frame_67/DoAction.as: _parent.removeMovieClip()
            // The outer mc is the root; signal completion and remove.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback so frame scripts can fire sounds.
    this.soundCallback = callbacks.playSound;

    // Main timeline: frame_2/DoAction.as → stop(). The outer SWF halts on
    // frame 2 after having placed the DefineSprite_32 child. We attach it here.
    this.root.attach(this.shootSym, "shoot", 1, context);
  }
}
