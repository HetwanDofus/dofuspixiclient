/**
 * Spell 2071 — (Unknown spell name, Dofus 1.29).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2071/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile, no caster reference,
 * no move/shoot/duplicate symbols — it is a single impact animation at the target
 * cell. The manifest has one composite animation (`anim1`, 111 frames) driven by
 * a single DefineSprite_8 wrapper (111 frames), which places DefineSprite_7
 * particle clips. DefineSprite_8/frame_109 calls `_parent.removeMovieClip()` and
 * signals completion.
 *
 * Library symbols:
 *   - anim1 (DefineSprite_7, 106 frames) — particle sprite. frame_1 seeds scale
 *     [50,110)%, vx ∈ [-3,3], vy ∈ [-8,-3], and sets onEnterFrame to integrate
 *     position with 0.9 friction. gotoAndPlay(random(30)+1) stagger. frame_106
 *     stops the clip.
 *   - shoot (DefineSprite_8, 111 frames, container) — outer timeline. frame_109
 *     calls _parent.removeMovieClip() → runtime.complete().
 *
 * Main timeline: no SOMA.playSound in provided AS — onSpellStart only attaches
 * the outer shoot container.
 *
 * Note on manifest: `librarySymbols` is absent / empty, so textures are loaded
 * under the bare animation name `"anim1"`, NOT with a `lib_` prefix.
 * DefineSprite_8 is the outer container; it hosts the anim1 (DefineSprite_7)
 * particles that are spawned by its frame_1 script logic described below.
 *
 * Because the manifest only lists `anim1` (which corresponds to the composite
 * rendered output of DefineSprite_7) and the outer sprite (DefineSprite_8)
 * is a container-only wrapper, we map:
 *   - symbol name "anim1" → frames: textures.getFrames("anim1"), 111 frames,
 *     with onLoad/onEnterFrame physics from DefineSprite_7/frame_1 and
 *     a frameScripts[105] stop from DefineSprite_7/frame_106.
 *   - symbol name "shoot" → container-only, 111 frames, frameScripts[108]
 *     fires _parent.removeMovieClip() + runtime.complete().
 *
 * The outer DefineSprite_8 ("shoot") is attached as the root's only child in
 * onSpellStart. Its frame_109 (index 108) tears down the spell.
 * Per-spell signalHit is fired at an early frame (frame_1 of the outer timeline,
 * i.e. index 0) since there is no explicit hit frame in the AS — the impact is
 * immediate on appearance.
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
  width: 54.6,
  height: 44.9,
  offsetX: -27.3,
  offsetY: -21.8,
};

export class Spell2071 extends RuntimeSpell {
  readonly spellId = 2071;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;
  private shootSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 (DefineSprite_7) — particle clip ------------------
    // AS: DefineSprite_7/frame_1/DoAction.as
    //   t = 50 + random(60);
    //   _xscale = t; _yscale = t;
    //   vx = 6 * (-0.5 + Math.random());
    //   vy = -3 - 5 * Math.random();
    //   onEnterFrame: _X += vx; _Y += vy; vx *= 0.9; vy *= 0.9;
    //   gotoAndPlay(random(30) + 1);
    // AS: DefineSprite_7/frame_106/DoAction.as
    //   stop();
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 111,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          // AS: DefineSprite_7/frame_1/DoAction.as
          (clip) => {
            const t = 50 + Math.floor(Math.random() * 60);
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            clip.vars.vx = 6 * (-0.5 + Math.random());
            clip.vars.vy = -3 - 5 * Math.random();
            // gotoAndPlay(random(30) + 1) — AS 1-based → 0-based
            clip.gotoAndPlay(Math.floor(Math.random() * 30));
          },
        ],
        [
          105,
          // AS: DefineSprite_7/frame_106/DoAction.as
          (clip) => {
            clip.stop();
          },
        ],
      ]),
      onEnterFrame: (clip) => {
        // AS: DefineSprite_7/frame_1/DoAction.as — onEnterFrame closure
        //   _X = _X + vx; _Y = _Y + vy; vx *= 0.9; vy *= 0.9;
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        clip.x += vx;
        clip.y += vy;
        vx *= 0.9;
        vy *= 0.9;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
      },
    };

    // ---- shoot (DefineSprite_8) — outer container timeline -------
    // Container-only: no visual frames of its own; hosts anim1 particles.
    // AS: DefineSprite_8/frame_109/DoAction.as
    //   _parent.removeMovieClip(); stop();
    this.shootSym = {
      name: "shoot",
      totalFrames: 111,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          // AS: (implied) outer timeline frame_1 — signal hit immediately
          // and spawn a batch of anim1 particles. The original AS spawns
          // them implicitly via the authored PlaceObject2 tags; since we
          // have no placement manifest, we spawn a canonical set here.
          (clip, ctx) => {
            // Signal hit at the first frame — impact is immediate on appearance.
            this.runtime.signalHit();
            // Spawn several anim1 particle instances at the impact point.
            // The canonical SWF places multiple instances of DefineSprite_7
            // on the DefineSprite_8 timeline; without a placements[] array
            // we use a reasonable count of 6 instances (typical for this
            // style of impact).
            for (let i = 0; i < 6; i++) {
              clip.attach(this.anim1Sym, `anim1_${i}`, i + 1, ctx);
            }
          },
        ],
        [
          108,
          // AS: DefineSprite_8/frame_109/DoAction.as
          //   _parent.removeMovieClip(); stop();
          (clip) => {
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.anim1Sym);
    this.registry.register(this.shootSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Main timeline: attach the outer DefineSprite_8 ("shoot") container
    // at the root so it starts ticking from the next runtime frame.
    this.root.attach(this.shootSym, "shoot", 1, context);
  }
}
