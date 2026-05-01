/**
 * Spell 803 — Vlad (self-buff / target-cell impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/803/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no `move`/`shoot`/`duplicate` symbol,
 * no caster-relative or world-absolute positioning — the single composite
 * animation plays at the target cell. The outer sprite (DefineSprite_9)
 * is a 219-frame authored timeline whose frame_1 fires sounds, frame_13
 * fires a second sound (canonical hit), and frame_217 removes itself and
 * signals completion.
 *
 * Library symbols:
 *   - sprite8 (characterId 8, kind: "clipEvent", directlyDynamic: true) —
 *     a single-frame sprite placed multiple times inside the DefineSprite_9
 *     timeline at various frames / depths / scales. Each instance runs:
 *       onLoad:  gotoAndPlay(random(45)); _alpha = 150  — staggered random start + bright
 *       onEnterFrame: _alpha -= 0.6  — slow fade-out over ~250 frames
 *     The placements[] array defines 9 attach events across frames 3, 9, 12,
 *     18, 24, 36, 42, 45, 51 at depths 1, 3, 5, 7, 9, 11, 13, 15, 17.
 *
 * Main timeline (DefineSprite_9):
 *   frame_1:  SOMA.playSound("gonfle"); SOMA.playSound("vlad_803")
 *   frame_13: SOMA.playSound("vlad_803")  — also canonical signalHit frame
 *   frame_217: stop(); _parent.removeMovieClip()  — spell complete
 *
 * The outer anim1 (219 frames) is the composite pre-rendered background;
 * the sprite8 instances are the dynamic overlaid particles.
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

const SPRITE8_BOUNDS = {
  width: 38.05,
  height: 150.4,
  offsetX: -23.95,
  offsetY: -64.75,
};

export class Spell803 extends RuntimeSpell {
  readonly spellId = 803;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite8Sym!: SymbolDefinition;
  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite8Anchor = calculateAnchor(SPRITE8_BOUNDS);

    // ---- sprite8 — fading particle placed many times on the outer timeline ----
    // Canonical CLIPACTIONRECORD handlers:
    //   onLoad:  gotoAndPlay(random(45)); _alpha = 150
    //   onEnterFrame: _alpha = _alpha - 0.6
    // AS: scripts/DefineSprite_8/frame_1/PlaceObject2_7_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: scripts/DefineSprite_8/frame_1/PlaceObject2_7_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.sprite8Sym = {
      name: "sprite8",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite8"),
      anchorX: sprite8Anchor.x,
      anchorY: sprite8Anchor.y,
      onLoad: (clip) => {
        // AS onClipEvent(load): gotoAndPlay(random(45)); _alpha = 150;
        // random(45) = random integer in [0, 44] → 0-based frame index
        clip.gotoAndPlay(Math.floor(Math.random() * 45));
        // AS _alpha = 150 is out of the [0,100] range — Flash clamps to 100.
        // Treat as fully opaque (1.0).
        clip.alpha = 1.0;
        // Store current alpha value for per-frame decay
        clip.vars.alpha = 100;
      },
      onEnterFrame: (clip) => {
        // AS onClipEvent(enterFrame): _alpha = _alpha - 0.6;
        // Track in vars so we have precise float arithmetic
        const alpha = clip.vars.alpha as number;
        const next = alpha - 0.6;
        clip.vars.alpha = next;
        clip.alpha = Math.max(0, next) / 100;
      },
    };

    // ---- anim1 — the main 219-frame composite background timeline ----
    // DefineSprite_9 hosts the authored animation frames plus the
    // sprite8 placements. We model it as the "anim1" symbol driven by
    // the outer container so frame scripts can fire at the canonical frames.
    //
    // The placements[] in manifest.librarySymbols tell us to attach
    // sprite8 instances at the following (frame, depth, x, y, scale) combos:
    //   frame  3, depth  1: x=-10.2,  y=-25.7,  scale=1.0
    //   frame  9, depth  3: x= 17.8,  y=-38.1,  scale=1.0
    //   frame 12, depth  5: x= 11.1,  y= -7.35, scale=0.5862
    //   frame 18, depth  7: x=-21.85, y=-22.55, scale=0.4785
    //   frame 24, depth  9: x= 21.95, y= -5.1,  scale=0.3564
    //   frame 36, depth 11: x=-27.25, y= -8.3,  scale=0.3564
    //   frame 42, depth 13: x= 22.55, y=-18.15, scale=0.2631
    //   frame 45, depth 15: x= 30.4,  y= -6.25, scale=0.2416
    //   frame 51, depth 17: x=-18.8,  y=  5.75, scale=0.2416
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 219,
      frames: textures.getFrames("anim1"),
      anchorX: calculateAnchor({ width: 83.3, height: 166.75, offsetX: -37.55, offsetY: -106.8 }).x,
      anchorY: calculateAnchor({ width: 83.3, height: 166.75, offsetX: -37.55, offsetY: -106.8 }).y,
      frameScripts: new Map([
        [
          // AS: DefineSprite_9/frame_1/DoAction.as — sounds fired from onSpellStart
          // (sounds are handled in onSpellStart, but the placement at frame 0
          //  triggers after onSpellStart; no attach needed here)
          // No frame_1 attach for sprite8.
          // Nothing extra to do at frame 0 beyond onSpellStart sound.
          // (frameScripts[0] is intentionally omitted — sounds fired via onSpellStart)
          // frame 3 (0-based: 2) — place sprite8 at depth 1
          2,
          (clip, ctx) => {
            // Placement: frame 3, depth 1, x=-10.2, y=-25.7, scaleX=scaleY=1.0
            // AS: PlaceObject2 places sprite8 at this frame
            const child = clip.attach(this.sprite8Sym, "s8_d1", 1, ctx, {
              x: -10.2,
              y: -25.7,
            });
            child.scaleX = 1.0;
            child.scaleY = 1.0;
          },
        ],
        [
          // frame 9 (0-based: 8) — place sprite8 at depth 3
          8,
          (clip, ctx) => {
            // Placement: frame 9, depth 3, x=17.8, y=-38.1, scaleX=scaleY=1.0
            const child = clip.attach(this.sprite8Sym, "s8_d3", 3, ctx, {
              x: 17.8,
              y: -38.1,
            });
            child.scaleX = 1.0;
            child.scaleY = 1.0;
          },
        ],
        [
          // frame 12 (0-based: 11) — place sprite8 at depth 5
          11,
          (clip, ctx) => {
            // Placement: frame 12, depth 5, x=11.1, y=-7.35, scale=0.586212
            const child = clip.attach(this.sprite8Sym, "s8_d5", 5, ctx, {
              x: 11.1,
              y: -7.35,
            });
            child.scaleX = 0.586212158203125;
            child.scaleY = 0.586212158203125;
          },
        ],
        [
          // frame 13 (0-based: 12) — AS DefineSprite_9/frame_13/DoAction.as
          // SOMA.playSound("vlad_803") + signalHit (canonical impact frame)
          12,
          (_clip) => {
            // AS: DefineSprite_9/frame_13/DoAction.as — SOMA.playSound("vlad_803")
            // Sound was registered at frame 12 in manifest.sounds and fired
            // via the sound system. signalHit fires here as the canonical
            // damage-popup frame for this impact-at-target spell.
            this.runtime.signalHit();
          },
        ],
        [
          // frame 18 (0-based: 17) — place sprite8 at depth 7
          17,
          (clip, ctx) => {
            // Placement: frame 18, depth 7, x=-21.85, y=-22.55, scale=0.478485
            const child = clip.attach(this.sprite8Sym, "s8_d7", 7, ctx, {
              x: -21.85,
              y: -22.55,
            });
            child.scaleX = 0.478485107421875;
            child.scaleY = 0.478485107421875;
          },
        ],
        [
          // frame 24 (0-based: 23) — place sprite8 at depth 9
          23,
          (clip, ctx) => {
            // Placement: frame 24, depth 9, x=21.95, y=-5.1, scale=0.356399
            const child = clip.attach(this.sprite8Sym, "s8_d9", 9, ctx, {
              x: 21.95,
              y: -5.1,
            });
            child.scaleX = 0.3563995361328125;
            child.scaleY = 0.3563995361328125;
          },
        ],
        [
          // frame 36 (0-based: 35) — place sprite8 at depth 11
          35,
          (clip, ctx) => {
            // Placement: frame 36, depth 11, x=-27.25, y=-8.3, scale=0.356399
            const child = clip.attach(this.sprite8Sym, "s8_d11", 11, ctx, {
              x: -27.25,
              y: -8.3,
            });
            child.scaleX = 0.3563995361328125;
            child.scaleY = 0.3563995361328125;
          },
        ],
        [
          // frame 42 (0-based: 41) — place sprite8 at depth 13
          41,
          (clip, ctx) => {
            // Placement: frame 42, depth 13, x=22.55, y=-18.15, scale=0.263107
            const child = clip.attach(this.sprite8Sym, "s8_d13", 13, ctx, {
              x: 22.55,
              y: -18.15,
            });
            child.scaleX = 0.2631072998046875;
            child.scaleY = 0.2631072998046875;
          },
        ],
        [
          // frame 45 (0-based: 44) — place sprite8 at depth 15
          44,
          (clip, ctx) => {
            // Placement: frame 45, depth 15, x=30.4, y=-6.25, scale=0.241561
            const child = clip.attach(this.sprite8Sym, "s8_d15", 15, ctx, {
              x: 30.4,
              y: -6.25,
            });
            child.scaleX = 0.2415618896484375;
            child.scaleY = 0.2415618896484375;
          },
        ],
        [
          // frame 51 (0-based: 50) — place sprite8 at depth 17
          50,
          (clip, ctx) => {
            // Placement: frame 51, depth 17, x=-18.8, y=5.75, scale=0.241561
            const child = clip.attach(this.sprite8Sym, "s8_d17", 17, ctx, {
              x: -18.8,
              y: 5.75,
            });
            child.scaleX = 0.2415618896484375;
            child.scaleY = 0.2415618896484375;
          },
        ],
        [
          // frame 217 (0-based: 216) — AS DefineSprite_9/frame_217/DoAction.as
          // stop(); _parent.removeMovieClip();
          216,
          (clip) => {
            // AS: DefineSprite_9/frame_217/DoAction.as — stop(); _parent.removeMovieClip();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite8Sym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: DefineSprite_9/frame_1/DoAction.as — SOMA.playSound("gonfle"); SOMA.playSound("vlad_803");
    callbacks.playSound("gonfle");
    callbacks.playSound("vlad_803");

    // Attach the main anim1 composite to the root so its timeline starts ticking.
    // This mirrors the outer SWF placing DefineSprite_9 on the main stage.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
