/**
 * Spell 508 — Many (Sadida vine/nature spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/508/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile symbols (move/shoot/duplicate),
 * no caster-relative anchoring, and no WorldAbsolute dual-anchoring. The entire animation
 * is a single authored composite timeline (anim1, 174 frames) that plays at the target cell.
 * The library symbols (sprite5, sprite12, sprite15) are placed inside the main DefineSprite_18
 * composite and drive per-tick rotation/oscillation effects.
 *
 * Library symbols:
 *   - sprite5 (characterId=5) — directlyDynamic. A spinning rune/glyph element.
 *     PlaceObject2_4_2 (depth 2 in sprite5 frame 0): onLoad seeds vr=3.3; onEnterFrame
 *     rotates by vr each frame, then decays vr by 0.96 after temps > 84.
 *     Note: sprite5 is placed inside sprite12 at multiple depths with different initial
 *     rotation matrices. Each placed instance shares the same symbol def but gets
 *     independent vars.
 *   - sprite12 (characterId=12) — directlyDynamic. A composite rotating ring/wheel.
 *     Contains sprite5 children placed at depths 1,12,23,34 with 90° rotation steps.
 *     PlaceObject2_8_45 (depth 45 in sprite12 frame 0): onEnterFrame rotates by +1°/frame.
 *     PlaceObject2_11_53 (depth 53 in sprite12 frame 0): onLoad seeds i=0, vr=10, temps2=0;
 *     onEnterFrame: every 4th frame rotate by -vr, decay vr by 0.96 after temps2 > 21.
 *   - sprite15 (characterId=15) — directlyDynamic (used as staggered looping sub-anim).
 *     DefineSprite_14 (characterId=14, the inner content of sprite15): frame_13 does
 *     gotoAndPlay(1) — it's a 13-frame looping animation.
 *     PlaceObject2_14_5 onLoad: gotoAndPlay(3) → phase offset instance A.
 *     PlaceObject2_14_3 onLoad: gotoAndPlay(2) → phase offset instance B.
 *     PlaceObject2_14_7 onLoad: gotoAndPlay(4) → phase offset instance C.
 *     sprite15 itself is placed inside DefineSprite_18 at depth 55, frames 39-153,
 *     with scale growing then shrinking and alpha ramping up.
 *
 * Main timeline (DefineSprite_18, 174 frames):
 *   frame_43:  SOMA.playSound("many_508")
 *   frame_154: SOMA.playSound("many_load2")
 *   frame_172: _parent.removeMovieClip() → spell complete
 *
 * signalHit is fired at frame_43 (the impact sound frame), which is when the vine
 * attack visually strikes. This is the canonical hit timing for TargetCell spells.
 *
 * The pre-rendered anim1 composite SVGs bake the static PlaceObject2 tween data.
 * The CLIPACTIONRECORD scripts drive runtime-only rotation/oscillation on top of that,
 * so we must attach live clips for sprite12 (with its sprite5 children) and sprite15.
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

// --- Bounds from manifest librarySymbols[] ---
const SPRITE5_BOUNDS = {
  width: 143.45,
  height: 143.95,
  offsetX: -49.75,
  offsetY: -93.95,
};

const SPRITE12_BOUNDS = {
  width: 187.9,
  height: 187.9,
  offsetX: -93.95,
  offsetY: -93.85,
};

const SPRITE15_BOUNDS = {
  width: 135.2,
  height: 130.65,
  offsetX: -69,
  offsetY: -65.3,
};

// --- Main composite timeline bounds from manifest animations[] ---
const ANIM1_BOUNDS = {
  width: 156.7,
  height: 151.35,
  offsetX: -79.05,
  offsetY: -98.55,
};

export class Spell508 extends RuntimeSpell {
  readonly spellId = 508;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite5Sym!: SymbolDefinition;
  private sprite12Sym!: SymbolDefinition;
  private sprite15Sym!: SymbolDefinition;
  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite5Anchor = calculateAnchor(SPRITE5_BOUNDS);
    const sprite12Anchor = calculateAnchor(SPRITE12_BOUNDS);
    const sprite15Anchor = calculateAnchor(SPRITE15_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- sprite5 — spinning rune element with rotation decay ----
    // AS: DefineSprite_5/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(load).as
    //   vr = 3.3
    // AS: DefineSprite_5/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation = _rotation + vr
    //   if(temps++ > 84) { vr *= 0.96 }
    this.sprite5Sym = {
      name: "sprite5",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite5"),
      anchorX: sprite5Anchor.x,
      anchorY: sprite5Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_5/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.vr = 3.3;
        clip.vars.temps = 0;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_5/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let vr = clip.vars.vr as number;
        let temps = clip.vars.temps as number;
        clip.rotation += (vr * Math.PI) / 180;
        if (temps++ > 84) {
          vr *= 0.96;
        }
        clip.vars.vr = vr;
        clip.vars.temps = temps;
      },
    };

    // ---- sprite12 — composite rotating ring containing sprite5 children ----
    // PlaceObject2_8_45 (depth 45): onEnterFrame rotates +1°/frame (a static inner shape)
    // PlaceObject2_11_53 (depth 53): onLoad seeds i,vr,temps2; onEnterFrame oscillates
    //
    // sprite12 also contains 4 instances of sprite5 at depths 1,12,23,34 with
    // rotation matrices at 0°, 90°, 180°, 270° respectively (from placements[] matrix
    // rotateSkew0/1: depth1=identity, depth12=skew(1,-1)≈90°, depth23=(-1,-1)=180°,
    // depth34=skew(-1,1)≈270°).
    //
    // AS: DefineSprite_12/frame_1/PlaceObject2_8_45/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation = _rotation + 1
    //
    // AS: DefineSprite_12/frame_1/PlaceObject2_11_53/CLIPACTIONRECORD onClipEvent(load).as
    //   i = 0; vr = 10; temps2 = 0
    //
    // AS: DefineSprite_12/frame_1/PlaceObject2_11_53/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   if(i++ % 4 == 1) {
    //     _rotation = _rotation - vr
    //     if(temps2++ > 21) { vr *= 0.96 }
    //   }
    this.sprite12Sym = {
      name: "sprite12",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite12"),
      anchorX: sprite12Anchor.x,
      anchorY: sprite12Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_12 frame_1 — place sprite5 at 4 rotations (depths 1,12,23,34)
            // Placement matrix rotations derived from placements[].matrix rotateSkew fields:
            // depth 1:  scaleX=1, skew=0 → 0°
            // depth 12: scaleX=0, skew0=1, skew1=-1 → ~90° (rotated CCW)
            // depth 23: scaleX=-1, skew=0 → 180°
            // depth 34: scaleX=0, skew0=-1, skew1=1 → ~270°

            // depth 1 — 0° rotation
            const s5_d1 = clip.attach(this.sprite5Sym, "sprite5_d1", 1, ctx, {
              x: 0,
              y: 0.1,
              rotation: 0,
            });
            s5_d1.scaleX = 1;
            s5_d1.scaleY = 1;

            // depth 12 — 90° rotation (matrix: scaleX=0, rotateSkew0=1, rotateSkew1=-1, scaleY=0)
            // atan2(rotateSkew0, scaleX) = atan2(1, 0) = π/2
            const s5_d12 = clip.attach(this.sprite5Sym, "sprite5_d12", 12, ctx, {
              x: 0,
              y: 0.1,
              rotation: Math.PI / 2,
            });
            s5_d12.scaleX = 1;
            s5_d12.scaleY = 1;

            // depth 23 — 180° rotation (matrix: scaleX=-1, rotateSkew0=0, rotateSkew1=0, scaleY=-1)
            const s5_d23 = clip.attach(this.sprite5Sym, "sprite5_d23", 23, ctx, {
              x: 0,
              y: 0.1,
              rotation: Math.PI,
            });
            s5_d23.scaleX = 1;
            s5_d23.scaleY = 1;

            // depth 34 — 270° rotation (matrix: scaleX=0, rotateSkew0=-1, rotateSkew1=1, scaleY=0)
            // atan2(-1, 0) = -π/2, which is equivalent to 270° / -90°
            const s5_d34 = clip.attach(this.sprite5Sym, "sprite5_d34", 34, ctx, {
              x: 0,
              y: 0.1,
              rotation: -Math.PI / 2,
            });
            s5_d34.scaleX = 1;
            s5_d34.scaleY = 1;

            // PlaceObject2_8_45 — inner static shape, rotates +1°/frame
            // We model it as a container clip with onEnterFrame.
            // Since there's no separate library symbol for this static shape (it's baked
            // into lib_sprite12_0.svg), we use a frameless sub-clip with just the handler.
            const innerRotSym: SymbolDefinition = {
              name: "innerRot45",
              totalFrames: 1,
              frames: [],
              anchorX: 0.5,
              anchorY: 0.5,
              onEnterFrame: (innerClip) => {
                // AS: DefineSprite_12/frame_1/PlaceObject2_8_45/CLIPACTIONRECORD onClipEvent(enterFrame).as
                // _rotation = _rotation + 1
                innerClip.rotation += (1 * Math.PI) / 180;
              },
            };
            this.registry.register(innerRotSym);
            clip.attach(innerRotSym, "innerRot_45", 45, ctx);

            // PlaceObject2_11_53 — oscillating element, fires every 4th frame
            const oscSym: SymbolDefinition = {
              name: "osc53",
              totalFrames: 1,
              frames: [],
              anchorX: 0.5,
              anchorY: 0.5,
              onLoad: (oscClip) => {
                // AS: DefineSprite_12/frame_1/PlaceObject2_11_53/CLIPACTIONRECORD onClipEvent(load).as
                oscClip.vars.i = 0;
                oscClip.vars.vr = 10;
                oscClip.vars.temps2 = 0;
              },
              onEnterFrame: (oscClip) => {
                // AS: DefineSprite_12/frame_1/PlaceObject2_11_53/CLIPACTIONRECORD onClipEvent(enterFrame).as
                let i = oscClip.vars.i as number;
                let vr = oscClip.vars.vr as number;
                let temps2 = oscClip.vars.temps2 as number;
                if (i++ % 4 === 1) {
                  oscClip.rotation -= (vr * Math.PI) / 180;
                  if (temps2++ > 21) {
                    vr *= 0.96;
                  }
                  oscClip.vars.temps2 = temps2;
                  oscClip.vars.vr = vr;
                }
                oscClip.vars.i = i;
              },
            };
            this.registry.register(oscSym);
            clip.attach(oscSym, "osc_53", 53, ctx);
          },
        ],
      ]),
    };

    // ---- sprite15 — looping sub-animation with staggered phase offsets ----
    // sprite15 contains DefineSprite_14 placed at 3 instances with different start frames.
    // DefineSprite_14 is a 13-frame looping animation (frame_13: gotoAndPlay(1)).
    //
    // PlaceObject2_14_5 onLoad: gotoAndPlay(3) → start at frame 3
    // PlaceObject2_14_3 onLoad: gotoAndPlay(2) → start at frame 2
    // PlaceObject2_14_7 onLoad: gotoAndPlay(4) → start at frame 4
    //
    // We model DefineSprite_14 as a 13-frame looping symbol (uses lib_sprite15 textures
    // since it's contained within sprite15 and the exporter bundles it there).
    // Each instance gets a different start frame via its onLoad.

    // DefineSprite_14 inner looping symbol (13 frames, loops at frame 13 back to 1)
    const sprite14Sym: SymbolDefinition = {
      name: "sprite14",
      totalFrames: 13,
      frames: textures.getFrames("lib_sprite15"),
      anchorX: sprite15Anchor.x,
      anchorY: sprite15Anchor.y,
      frameScripts: new Map([
        [
          12,
          (clip) => {
            // AS: DefineSprite_14/frame_13/DoAction.as — gotoAndPlay(1)
            clip.gotoAndPlay(0);
          },
        ],
      ]),
    };
    this.registry.register(sprite14Sym);

    // sprite15 — wrapper that places 3 phase-offset instances of sprite14
    // AS: DefineSprite_15/frame_1/PlaceObject2_14_5/CLIPACTIONRECORD onClipEvent(load).as → gotoAndPlay(3)
    // AS: DefineSprite_15/frame_1/PlaceObject2_14_3/CLIPACTIONRECORD onClipEvent(load).as → gotoAndPlay(2)
    // AS: DefineSprite_15/frame_1/PlaceObject2_14_7/CLIPACTIONRECORD onClipEvent(load).as → gotoAndPlay(4)
    this.sprite15Sym = {
      name: "sprite15",
      totalFrames: 1,
      frames: [],
      anchorX: sprite15Anchor.x,
      anchorY: sprite15Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_15 frame_1 places sprite14 at depths 3,5,7 with phase offsets

            // depth 3 — PlaceObject2_14_3 onLoad: gotoAndPlay(2)
            const inst3 = clip.attach(sprite14Sym, "s14_d3", 3, ctx);
            inst3.gotoAndPlay(1); // gotoAndPlay(2) → 0-based index 1

            // depth 5 — PlaceObject2_14_5 onLoad: gotoAndPlay(3)
            const inst5 = clip.attach(sprite14Sym, "s14_d5", 5, ctx);
            inst5.gotoAndPlay(2); // gotoAndPlay(3) → 0-based index 2

            // depth 7 — PlaceObject2_14_7 onLoad: gotoAndPlay(4)
            const inst7 = clip.attach(sprite14Sym, "s14_d7", 7, ctx);
            inst7.gotoAndPlay(3); // gotoAndPlay(4) → 0-based index 3
          },
        ],
      ]),
    };

    // ---- anim1 — main 174-frame composite timeline (DefineSprite_18) ----
    // frame_43:  SOMA.playSound("many_508") + signalHit
    // frame_154: SOMA.playSound("many_load2")
    // frame_172: _parent.removeMovieClip() → complete
    //
    // sprite12 is placed at depth 1 of DefineSprite_18 starting at frame 0 (placement frame 0).
    // sprite15 is placed at depth 55 of DefineSprite_18 starting at frame 39 (placement frame 39).
    // The main anim1 frames contain the authored SVG content (shape tweens, color transforms).
    // We overlay the dynamic clips on top.
    //
    // Sounds are stored in manifest.sounds: frame 42 ("many_508"), frame 153 ("many_load2").
    // These are 0-based frame indices (frame_43 = index 42, frame_154 = index 153).

    // We need a reference to callbacks for sounds fired from frameScripts.
    // Capture via onSpellStart below.
    let soundCb: ((id: string) => void) | undefined;

    this.anim1Sym = {
      name: "anim1",
      totalFrames: 174,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // DefineSprite_18 frame_1 — place sprite12 at depth 1
            // Canonical placement: scaleX=0.529, scaleY=0.297, translateX=-0.95, translateY=-50.8
            const s12 = clip.attach(this.sprite12Sym, "sprite12_d1", 1, ctx, {
              x: -0.95,
              y: -50.8,
            });
            s12.scaleX = 0.5289306640625;
            s12.scaleY = 0.29718017578125;
          },
        ],
        [
          38,
          (clip, ctx) => {
            // DefineSprite_18 frame 39 (0-based: 38) — place sprite15 at depth 55
            // Canonical placement: scaleX=0.547, scaleY=0.547, translateX=1, translateY=-22.95, alphaMult=36/256
            const s15 = clip.attach(this.sprite15Sym, "sprite15_d55", 55, ctx, {
              x: 1,
              y: -22.95,
            });
            s15.scaleX = 0.5468292236328125;
            s15.scaleY = 0.5468292236328125;
            s15.alpha = 36 / 256;
          },
        ],
        [
          42,
          (clip) => {
            // AS: DefineSprite_18/frame_43/DoAction.as — SOMA.playSound("many_508")
            // Also the canonical hit frame.
            soundCb?.("many_508");
            this.runtime.signalHit();
          },
        ],
        [
          153,
          (clip) => {
            // AS: DefineSprite_18/frame_154/DoAction.as — SOMA.playSound("many_load2")
            soundCb?.("many_load2");
          },
        ],
        [
          171,
          (clip) => {
            // AS: DefineSprite_18/frame_172/DoAction.as — _parent.removeMovieClip()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // Store soundCb setter so onSpellStart can populate it.
    // We use a closure trick: the frameScripts above close over `soundCb`.
    // onSpellStart assigns to it after init.
    (this as unknown as { _setSoundCb: (cb: (id: string) => void) => void })
      ._setSoundCb = (cb) => {
      soundCb = cb;
    };

    this.registry.register(this.sprite5Sym);
    this.registry.register(this.sprite12Sym);
    this.registry.register(this.sprite15Sym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Wire the sound callback for use inside frameScripts.
    (this as unknown as { _setSoundCb: (cb: (id: string) => void) => void })
      ._setSoundCb(callbacks.playSound);

    // Attach the main composite timeline at root.
    // This mirrors the SWF's top-level DefineSprite_18 placement on the main timeline.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
