/**
 * Spell 314 — (Iop/Sacrier impact effect, likely "Fléau" or similar).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/314/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile motion, no
 * caster-side anchoring, no dual timelines — it is a single impact animation
 * at the target cell. The manifest has no librarySymbols[] (empty), so all
 * content comes from the single `animations: ["anim1"]` entry.
 *
 * AS layout:
 *   - DefineSprite_17 — the inner looping sprite (the "anim1" visual).
 *       frame_1/DoAction.as: installs an onEnterFrame that accelerates
 *       playback by incrementing a speed counter `t` every 20 frames,
 *       jumping forward `f = currentFrame + t` each tick.
 *       This is the canonical Dofus 1.29 "speed-ramp" pattern used on
 *       many impact composites.
 *
 *   - DefineSprite_18 — composite container holding six pre-placed
 *       DefineSprite_17 instances at depths 1, 7, 13, 19, 25, 31.
 *       Each instance has a CLIPACTIONRECORD onClipEvent(load) that calls
 *       gotoAndPlay(random(20)) or gotoAndPlay(random(30)) to stagger
 *       their playheads so the six copies don't all animate in lockstep.
 *       There are no authored frame scripts on DefineSprite_18 itself.
 *
 *   - DefineSprite_20 — 82-frame outer wrapper/container.
 *       frame_82/DoAction.as: _parent.removeMovieClip() → signals completion.
 *
 * The manifest's single `animations: [{name: "anim1", frameCount: 84}]`
 * entry corresponds to the baked composite of DefineSprite_20 (the full
 * 82-frame outer wrapper with its children). We register it as the "anim1"
 * symbol consumed by onSpellStart.
 *
 * Because librarySymbols[] is empty in the manifest, there is NO lib_ prefix
 * anywhere — all textures come from `textures.getFrames("anim1")`.
 *
 * signalHit: fired at the mid-point of the animation (frame 12, canonical
 * impact flash). Since there is no authored hit-frame marker in the AS, we
 * use the first "acceleration starts" window (~frame 12) as the conventional
 * hit signal for this pattern.
 *
 * Actually, reviewing the AS more carefully: there is no explicit `this.end()`
 * or signalHit marker in any of the scripts. The canonical approach for a
 * simple impact-at-target spell with no explicit hit marker is to signal hit
 * on frame 1 (immediate) since the entire animation is the impact. We follow
 * that convention.
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
  width: 193.45,
  height: 186.35,
  offsetX: -95.55,
  offsetY: -149.35,
};

export class Spell314 extends RuntimeSpell {
  readonly spellId = 314;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 84-frame outer composite (DefineSprite_20 baked) ----
    // The manifest bakes the full DefineSprite_20 hierarchy into "anim1"
    // (84 frames, which covers the 82-frame authored timeline plus
    // trailing padding). We model this as a single animated symbol.
    //
    // AS DefineSprite_20/frame_82/DoAction.as:
    //   _parent.removeMovieClip()
    // → fire complete() at frame index 81 (0-based).
    //
    // The inner DefineSprite_17 speed-ramp logic and the six staggered
    // DefineSprite_18 children are baked into the per-frame SVG textures
    // by the exporter — we do not need to replicate the runtime AS logic
    // because the visual output is already composited into the anim1 frames.
    // We only need to replicate the LIFECYCLE signals (signalHit, complete).
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 84,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // Frame 1 — animation starts; signal hit immediately since
            // this is an impact-at-target spell with no explicit hit-frame
            // marker in the canonical AS.
            // AS: no explicit hit signal — conventional: signal on first frame.
            this.runtime.signalHit();
          },
        ],
        [
          81,
          (clip) => {
            // AS DefineSprite_20/frame_82/DoAction.as:
            //   _parent.removeMovieClip()
            // This is the outer mc removal → spell complete.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Main timeline frame_1: no SOMA.playSound in the canonical AS scripts
    // provided. Attach the anim1 composite at the root.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
