/**
 * Spell 2102 — Liche (Sacrieur / Osamodas dark impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2102/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single authored sprite
 * (DefineSprite_34, internally named "shoot" via DefineSprite_18_shoot)
 * that positions itself at `_parent.cellTo` on frame_1, plays through
 * an 84-frame animation, signals hit at frame 25, and removes the
 * parent (completing the spell) at frame 67.
 *
 * There are NO library symbols in the manifest (librarySymbols is absent /
 * empty). The single `animations[]` entry is "shoot" — a 84-frame
 * authored timeline with two key frame scripts:
 *   - frame_25: SOMA.playSound("explosion") + this.end() → signalHit
 *   - frame_67: _parent.removeMovieClip() → complete
 *   - frame_70 (DefineSprite_18_shoot): stop()
 *
 * The outer main timeline (frame_2/DoAction.as) just calls stop().
 * The initial sound "licrounch_1003" fires at frame_1 of DefineSprite_34.
 * Positioning (_X = _parent.cellTo.x / _Y = _parent.cellTo.y) is
 * handled by the TargetCell anchor — the harness places the container
 * at the target cell so local (0,0) IS cellTo. We still apply it
 * explicitly in frameScripts[0] for correctness.
 *
 * Library symbols: none (no librarySymbols[] in manifest).
 *
 * Main timeline: frame_2 → stop(). Handled by RuntimeSpell / harness.
 *
 * Sounds:
 *   - frame_1  (frameScripts[0])  : "licrounch_1003"
 *   - frame_25 (frameScripts[24]) : "explosion"
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

export class Spell2102 extends RuntimeSpell {
  readonly spellId = 2102;
  readonly displayType = SpellDisplayType.TargetCell;

  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- shoot — 84-frame impact animation at target cell --------
    // Corresponds to DefineSprite_34 (and inner DefineSprite_18_shoot).
    //
    // frame_1/DoAction.as    : SOMA.playSound("licrounch_1003")
    // frame_1/DoAction_2.as  : _X = _parent.cellTo.x; _Y = _parent.cellTo.y
    //                          (container already at target for TargetCell,
    //                           so position is effectively (0,0), but set
    //                           explicitly for canonical correctness)
    // frame_25/DoAction.as   : SOMA.playSound("explosion")
    // frame_25/DoAction_2.as : this.end() → signalHit
    // frame_67/DoAction.as   : _parent.removeMovieClip() → complete
    // DefineSprite_18_shoot/frame_70/DoAction.as : stop()
    //   (frame_70 is inside the inner sprite; the outer DefineSprite_34
    //    only has 84 authored frames. We honour stop() at frame 70
    //    of the shoot clip's own timeline.)
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 84,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_34/frame_1/DoAction.as
            this.soundCallback?.("licrounch_1003");

            // AS DefineSprite_34/frame_1/DoAction_2.as
            // For TargetCell, container origin is already at cellTo.
            // Apply explicitly for 1:1 canonical fidelity.
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            if (cellTo) {
              clip.x = cellTo.x - (ctx.cellTo.x);
              clip.y = cellTo.y - (ctx.cellTo.y);
            } else {
              clip.x = 0;
              clip.y = 0;
            }
          },
        ],
        [
          24,
          (_clip) => {
            // AS DefineSprite_34/frame_25/DoAction.as
            this.soundCallback?.("explosion");

            // AS DefineSprite_34/frame_25/DoAction_2.as : this.end()
            this.runtime.signalHit();
          },
        ],
        [
          66,
          (clip) => {
            // AS DefineSprite_34/frame_67/DoAction.as
            // _parent.removeMovieClip() — outer mc removal → spell complete.
            clip.remove();
            this.runtime.complete();
          },
        ],
        [
          69,
          (clip) => {
            // AS DefineSprite_18_shoot/frame_70/DoAction.as : stop()
            clip.stop();
          },
        ],
      ]),
    };

    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback so frameScripts can play sounds.
    this.soundCallback = callbacks.playSound;

    // Attach the shoot sprite at the root (depth 1).
    // For TargetCell, root is already positioned at cellTo so the
    // shoot clip at (0,0) renders at the target.
    const shootSym = this.registry.resolve("shoot");
    if (shootSym) {
      this.root.attach(shootSym, "shoot", 1, context);
    }
  }
}
