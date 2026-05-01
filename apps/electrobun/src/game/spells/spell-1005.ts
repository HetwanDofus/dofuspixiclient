/**
 * Spell 1005 — Crockette (Osamodas).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1005/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile, no caster reference,
 * no `move`/`shoot`/`duplicate` symbols. It is a single composite animation
 * (`anim1`, 156 frames) that plays at the target cell. No librarySymbols entries
 * exist in the manifest — all content is a single pre-composed `animations[]` entry.
 *
 * The manifest lists two DefineSprite numbers:
 *   - DefineSprite_24 (outer shell):
 *       frame_100 → `this.end()` → signalHit
 *       frame_154 → `_parent.removeMovieClip(); stop();` → complete
 *   - DefineSprite_23 (inner animated layer, placed inside DefineSprite_24):
 *       frame_1  → `gotoAndPlay(random(90) + 2); t = 10+random(60); _alpha=30+random(70); _xscale=_yscale=t`
 *       frame_91 → `SOMA.playSound("crockette_1005")`
 *       frame_148 → `stop()`
 *
 * The outermost authored sprite is DefineSprite_24 (the one that calls
 * `_parent.removeMovieClip()`). Since `librarySymbols` is empty and the full
 * animation is flattened into `animations[0].name = "anim1"`, the canonical
 * pattern is: register `anim1` as the single symbol, attach it from
 * `onSpellStart`, wire frame scripts to match the DoAction scripts.
 *
 * The merged composite `anim1` carries the baked frame sequence for the visual,
 * so we use `textures.getFrames("anim1")` (no `lib_` prefix — it is in
 * `animations[]`, not `librarySymbols[]`).
 *
 * Sound: manifest says the sound fires at frame 90 (0-indexed), which corresponds
 * to AS `DefineSprite_23/frame_91/DoAction.as` (1-indexed). We play the sound
 * from `onSpellStart` since the outer container drives the sound on its
 * inner sub-sprite's frame_91, which the composite bakes into the visible
 * playthrough. However, to be fully canonical we also emit it from the frame
 * script at frame 90 (0-based) of the anim1 symbol.
 *
 * Frame numbering note: anim1 has 156 frames (frameCount=156). The scripts
 * reference frames on the inner sprites which may differ from the outer
 * container. Based on the manifest, the outer DefineSprite_24 fires at frames
 * 100 and 154 (1-based AS), i.e. indices 99 and 153 (0-based). These are the
 * canonical signalHit and complete frames respectively.
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
  width: 266.6,
  height: 268.05,
  offsetX: -133.85,
  offsetY: -162,
};

export class Spell1005 extends RuntimeSpell {
  readonly spellId = 1005;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // anim1 — the composite 156-frame Crockette animation.
    // Corresponds to the outer DefineSprite_24 shell, which itself
    // contains the inner DefineSprite_23 layer. The combat-exporter
    // has flattened both into the single `anim1` frame sequence.
    //
    // Frame scripts ported from:
    //   DefineSprite_23/frame_1/DoAction.as   → frameScripts[0]
    //   DefineSprite_23/frame_91/DoAction.as  → frameScripts[90]
    //   DefineSprite_23/frame_148/DoAction.as → frameScripts[147]
    //   DefineSprite_24/frame_100/DoAction.as → frameScripts[99]  (signalHit)
    //   DefineSprite_24/frame_154/DoAction.as → frameScripts[153] (complete)
    //
    // Note: DefineSprite_23/frame_1 uses gotoAndPlay(random(90)+2),
    // random alpha and scale. These affect the inner layer's playback
    // offset and appearance. Since the composite is already rasterized
    // we apply the random scale and alpha to the anim1 clip itself
    // to preserve the AS intent of visual variation per cast.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 156,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, _ctx) => {
            // AS DefineSprite_23/frame_1/DoAction.as:
            //   gotoAndPlay(random(90) + 2);
            //   t = 10 + random(60);
            //   _alpha = 30 + random(70);
            //   _xscale = t;
            //   _yscale = t;
            const jumpFrame = Math.floor(Math.random() * 90) + 1; // gotoAndPlay(random(90)+2) → 0-based index
            const t = 10 + Math.floor(Math.random() * 60);
            const alpha = 30 + Math.floor(Math.random() * 70);
            clip.alpha = alpha / 100;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            clip.gotoAndPlay(jumpFrame);
          },
        ],
        [
          90,
          (_clip, _ctx) => {
            // AS DefineSprite_23/frame_91/DoAction.as:
            //   SOMA.playSound("crockette_1005");
            // Sound callback only available in onSpellStart; we store
            // it on instance to call from here.
            if (this._playSoundCallback) {
              this._playSoundCallback("crockette_1005");
            }
          },
        ],
        [
          99,
          (_clip, _ctx) => {
            // AS DefineSprite_24/frame_100/DoAction.as:
            //   this.end();
            // Canonical hit signal — damage popup at target.
            this.runtime.signalHit();
          },
        ],
        [
          147,
          (clip, _ctx) => {
            // AS DefineSprite_23/frame_148/DoAction.as:
            //   stop();
            clip.stop();
          },
        ],
        [
          153,
          (clip, _ctx) => {
            // AS DefineSprite_24/frame_154/DoAction.as:
            //   _parent.removeMovieClip();
            //   stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.anim1Sym);
  }

  /** Stored sound callback so frame scripts can play sounds. */
  private _playSoundCallback: ((id: string) => void) | null = null;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture the sound callback so frame scripts can invoke it.
    this._playSoundCallback = callbacks.playSound;

    // Attach the composite anim1 at depth 1 on the root (target cell).
    // This mirrors the main-timeline implicit placement of DefineSprite_24
    // at the target cell.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
