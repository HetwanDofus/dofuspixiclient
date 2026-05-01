/**
 * Spell 1003 — Licrounch (Osamodas bite attack).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1003/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no move/shoot/duplicate/projectile
 * structure — it is a single composite animation anchored at the target cell.
 * No `_parent.cellFrom` / `_parent.cellTo` referencing in the main timeline.
 * No ballistic arc, no beam. The outer DefineSprite_8 is the main container;
 * it plays at the target, calls signalHit at frame 133, and completes at
 * frame 169 via `_parent.removeMovieClip()`.
 *
 * Library symbols:
 *   - sprite6 (characterId 6) — directlyDynamic clipEvent symbol. A small
 *     sprite with alpha=0 on load that randomly flickers up (v=1 triggers
 *     _alpha += 30 per frame up to 100). Placed 13 times inside DefineSprite_8
 *     at frame 0 with varied offsets and alpha multipliers. Each instance runs
 *     the same onLoad/onEnterFrame handlers but has independent var state.
 *
 *   - sprite8 (DefineSprite_8) — the outer container timeline (171 frames):
 *       frame_1: SOMA.playSound("licrounch_1003")
 *       frame_133: this.end() → signalHit; PlaceObject2_7_27 onEnterFrame
 *                  starts fading _parent._alpha by 5 per frame
 *       frame_169: _parent.removeMovieClip() → complete
 *
 *   - sprite5 (DefineSprite_5) — inner sub-sprite. frame_1: gotoAndPlay(random(5)).
 *     This randomises the start frame of the anim1/anim29 composite animation.
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("licrounch_1003"); stop().
 * Sound is also played inside DefineSprite_8/frame_1 — canonical duplicate; we
 * play it once from onSpellStart.
 *
 * The composite animations `anim1` and `anim29` are the pre-rendered SVG
 * sequences that form the visual backbone of the spell (Licrounch bite).
 * They are attached as the `anim1` symbol driving the main content of
 * DefineSprite_8. The 13 sprite6 instances provide the dynamic alpha-flicker
 * particle layer scattered around the bite impact.
 *
 * PlaceObject2_7_27 is placed inside DefineSprite_8 at frame 133 and has
 * an onEnterFrame that decays _parent._alpha by 5 each tick — this fades the
 * whole outer clip out over the remaining frames.
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

// Bounds from manifest.json librarySymbols[0] (sprite6)
const SPRITE6_BOUNDS = {
  width: 46.15,
  height: 30.75,
  offsetX: -26.4,
  offsetY: -3.25,
};

// Bounds for the outer container (anim1 composite animation)
// from manifest.json animations[0]
const ANIM1_BOUNDS = {
  width: 131.55,
  height: 59.25,
  offsetX: -37.75,
  offsetY: -36.45,
};

// 13 placements of sprite6 inside DefineSprite_8 at frame 0
// Each entry: { x, y, alphaMult } extracted from manifest placements[]
const SPRITE6_PLACEMENTS = [
  { depth: 1,  x: -10.45, y:   0.6,  alphaMult: 77 },
  { depth: 3,  x:   2.05, y:  -6.3,  alphaMult: 77 },
  { depth: 5,  x:  12.75, y:  -0.45, alphaMult: 77 },
  { depth: 7,  x: -11.1,  y: -12.3,  alphaMult: 77 },
  { depth: 9,  x:  15.15, y: -13.55, alphaMult: 77 },
  { depth: 11, x:   3.35, y: -19.5,  alphaMult: 38 },
  { depth: 13, x: -23.5,  y:  -5.15, alphaMult: 38 },
  { depth: 15, x:   1.1,  y:   6.4,  alphaMult: 38 },
  { depth: 17, x:  26.25, y:  -7.15, alphaMult: 38 },
  { depth: 19, x: -23.3,  y:   7.95, alphaMult: 38 },
  { depth: 21, x:  25.05, y:   6.5,  alphaMult: 38 },
  { depth: 23, x:  28.55, y: -20.8,  alphaMult: 38 },
  { depth: 25, x: -21.1,  y: -19.45, alphaMult: 38 },
];

export class Spell1003 extends RuntimeSpell {
  readonly spellId = 1003;
  readonly displayType = SpellDisplayType.TargetCell;

  // sprite6 symbol ref needed in sprite8's frameScripts
  private sprite6Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite6Anchor = calculateAnchor(SPRITE6_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- sprite6 — alpha-flicker particle -------------------------
    // directlyDynamic: true — has its own CLIPACTIONRECORD handlers.
    //
    // AS DefineSprite_6/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as:
    //   _alpha = 0;
    //
    // AS DefineSprite_6/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as:
    //   if (random(15) == 1) { v = 1; }
    //   if (_alpha < 100 & v == 1) { _alpha = _alpha + 30; }
    this.sprite6Sym = {
      name: "sprite6",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite6"),
      anchorX: sprite6Anchor.x,
      anchorY: sprite6Anchor.y,

      onLoad: (clip) => {
        // AS: DefineSprite_6/.../CLIPACTIONRECORD onClipEvent(load).as
        // _alpha = 0;
        clip.alpha = 0;
        clip.vars.v = 0;
      },

      onEnterFrame: (clip) => {
        // AS: DefineSprite_6/.../CLIPACTIONRECORD onClipEvent(enterFrame).as
        // if (random(15) == 1) { v = 1; }
        // if (_alpha < 100 & v == 1) { _alpha = _alpha + 30; }
        if (Math.floor(Math.random() * 15) === 1) {
          clip.vars.v = 1;
        }
        const v = clip.vars.v as number;
        if (clip.alpha < 1 && v === 1) {
          // AS _alpha += 30 in 0-100 space → 30/100 = 0.3 in 0-1 space
          clip.alpha = Math.min(1, clip.alpha + 30 / 100);
        }
      },
    };

    // ---- anim1 — the main composite animation container -----------
    // DefineSprite_8 in canonical AS. 171-frame timeline.
    // frame_1: SOMA.playSound("licrounch_1003")
    // frame_133: this.end() → signalHit; also a PlaceObject2_7_27 placed
    //            at depth 27 that has onEnterFrame: _parent._alpha -= 5
    // frame_169: _parent.removeMovieClip(); stop()
    //
    // The "anim1" composite SVG frames ARE the visual content of this sprite.
    // We use the anim1 frames for rendering and drive the script events via
    // frameScripts.
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 171,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,

      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_8/frame_1/DoAction.as:
            // SOMA.playSound("licrounch_1003");
            // Sound is played from onSpellStart; here we attach the 13
            // sprite6 particle instances as per the manifest placements[].
            // All 13 placements have frame=0 (0-indexed) and parentSpriteId=8.
            for (const p of SPRITE6_PLACEMENTS) {
              const child = clip.attach(
                this.sprite6Sym,
                `sprite6_d${p.depth}`,
                p.depth,
                ctx,
                { x: p.x, y: p.y },
              );
              // Apply the canonical scaleX/Y = 0.539764... from placement matrix
              child.scaleX = 0.539764404296875;
              child.scaleY = 0.539764404296875;
              // Apply alphaMult from colorTransform: alphaMult/256
              child.alpha = p.alphaMult / 256;
            }
          },
        ],

        [
          132,
          (clip, ctx) => {
            // AS DefineSprite_8/frame_133/DoAction.as: this.end()
            // → signal hit (damage popup) at the target cell.
            this.runtime.signalHit();

            // AS DefineSprite_8/frame_133/PlaceObject2_7_27 places a clip
            // at depth 27 whose onClipEvent(enterFrame) does:
            //   _parent._alpha -= 5;
            // We model this as an inline fade clip attached here that
            // modifies its parent (the anim1 clip) each tick.
            const fadeSym: SymbolDefinition = {
              name: "fader27",
              totalFrames: 1,
              frames: [],
              anchorX: 0.5,
              anchorY: 0.5,
              onEnterFrame: (fader) => {
                // AS DefineSprite_8/frame_133/PlaceObject2_7_27/
                //   CLIPACTIONRECORD onClipEvent(enterFrame).as:
                //   _parent._alpha -= 5;
                const parent = fader.parent;
                if (parent) {
                  parent.alpha = Math.max(0, parent.alpha - 5 / 100);
                }
              },
            };
            // Register and attach the ephemeral fader symbol
            this.registry.register(fadeSym);
            clip.attach(fadeSym, "fader27", 27, ctx);
          },
        ],

        [
          168,
          (clip) => {
            // AS DefineSprite_8/frame_169/DoAction.as:
            // _parent.removeMovieClip(); stop();
            // _parent here is the root (the outer mc attached from onSpellStart).
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite6Sym);
    this.registry.register(anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS frame_1/DoAction.as: SOMA.playSound("licrounch_1003");
    callbacks.playSound("licrounch_1003");

    // Attach the main animation (DefineSprite_8 / anim1) at the root.
    // The harness has positioned the container at the target cell.
    // frame_1 frameScripts[0] will fire immediately and attach all
    // 13 sprite6 instances.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
