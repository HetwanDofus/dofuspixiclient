/**
 * Spell 511 — Ronce (Feca thorn aura / bramble).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/511/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell is a single impact animation at the
 * target cell. DefineSprite_9 is the outer composite timeline (150 frames,
 * exported as "anim1"). It plays sounds on frames 1, 4, and 7, then stops and
 * removes its parent at frame 148.
 *
 * Library symbols:
 *   - lib_sprite8 — single-frame thorn sprite (kind: "clipEvent", directlyDynamic: true).
 *     onLoad: gotoAndPlay(random(45)) — jump to a random frame offset in the
 *     animation; _alpha = 150 (capped above 1.0 in Flash, maps to 1.0 in TS).
 *     onEnterFrame: _alpha -= 1.3 per tick (fades the thorn out over ~115 frames).
 *
 * The outer DefineSprite_9 timeline places sprite8 instances at several frames
 * (3, 9, 12, 18, 24, 36, 51) with varying scales and positions. These are
 * authored placements captured in manifest.librarySymbols[0].placements[].
 * Each placement is attached from the anim1 symbol's frameScripts at the
 * corresponding (0-based) frame index.
 *
 * Main timeline (DefineSprite_9):
 *   frame_1  (0): SOMA.playSound("ronce")
 *   frame_4  (3): SOMA.playSound("ronce")
 *   frame_7  (6): SOMA.playSound("ronce")
 *   frame_148 (147): stop(); removeMovieClip(_parent) → this.runtime.complete()
 *
 * signalHit is fired at the first impact frame (frame 0, the first "ronce" sound,
 * which is the canonical impact moment for a TargetCell spell).
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
  width: 36.75,
  height: 150.4,
  offsetX: -23.95,
  offsetY: -64.75,
};

const ANIM1_BOUNDS = {
  width: 56.4,
  height: 130.25,
  offsetX: -30.7,
  offsetY: -83.3,
};

export class Spell511 extends RuntimeSpell {
  readonly spellId = 511;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite8Sym!: SymbolDefinition;
  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite8Anchor = calculateAnchor(SPRITE8_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- lib_sprite8 — fading thorn particle ----------------------
    // directlyDynamic: true — drives per-tick alpha decay via clipEvents.
    // AS: scripts/DefineSprite_8/frame_1/PlaceObject2_7_1/CLIPACTIONRECORD onClipEvent(load).as
    //   gotoAndPlay(random(45));
    //   _alpha = 150;
    //
    // AS: scripts/DefineSprite_8/frame_1/PlaceObject2_7_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _alpha = _alpha - 1.3;
    this.sprite8Sym = {
      name: "sprite8",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite8"),
      anchorX: sprite8Anchor.x,
      anchorY: sprite8Anchor.y,

      onLoad: (clip) => {
        // AS: gotoAndPlay(random(45)) → 0-based: gotoAndPlay(random(45) - 1)
        // random(45) in AS gives [0..44]; gotoAndPlay(0) is frame_1.
        // We convert: gotoAndPlay(AS_frame - 1) but since random(45) is
        // already 0-based in Flash (random(45) returns 0..44, gotoAndPlay
        // with that value in AS means frame random(45), which is 1-based),
        // the correct 0-based equivalent is: Math.floor(Math.random()*45)
        // maps to frames 0..44. We clamp to totalFrames.
        // AS: gotoAndPlay(random(45)) where random(45) ∈ [0,44].
        // In Flash, gotoAndPlay(0) == gotoAndPlay(1) (both go to frame 1).
        // 0-based: just use Math.floor(Math.random() * 45) directly.
        clip.gotoAndPlay(Math.floor(Math.random() * 45));

        // AS: _alpha = 150 → Flash clamps to 100 in practice, maps to 1.0 in TS.
        clip.alpha = 1.0;
        // Store the running alpha in vars for enterFrame decay.
        clip.vars.alpha = 100.0;
      },

      onEnterFrame: (clip) => {
        // AS: _alpha = _alpha - 1.3
        // Track the Flash-unit alpha (0-100) in vars for precision.
        let a = clip.vars.alpha as number;
        a -= 1.3;
        clip.vars.alpha = a;
        clip.alpha = Math.max(0, a) / 100;
        if (a <= 0) {
          clip.remove();
        }
      },
    };

    // ---- anim1 — outer composite timeline (DefineSprite_9) --------
    // 150 frames total. Plays sounds at frames 1, 4, 7. Places sprite8
    // instances at frames 3, 9, 12, 18, 24, 36, 51 (0-based: 2,8,11,17,23,35,50).
    // At frame 148 (0-based: 147): stop(); removeMovieClip(_parent).
    //
    // Placements from manifest.librarySymbols[0].placements[]:
    //   frame 3  depth 1  scale ~0.800 tx=-10.25  ty=-21.55
    //   frame 9  depth 3  scale ~0.800 tx= 12.20  ty=-31.50
    //   frame 12 depth 5  scale ~0.469 tx=  6.85  ty= -6.90
    //   frame 18 depth 7  scale ~0.383 tx=-19.55  ty=-19.05
    //   frame 24 depth 9  scale ~0.285 tx= 19.50  ty=-14.45
    //   frame 36 depth 11 scale ~0.285 tx=-23.85  ty= -7.65
    //   frame 51 depth 13 scale ~0.193 tx=-17.10  ty=  3.55
    //
    // Sounds (from manifest and AS scripts):
    //   frame_1 (0): playSound("ronce")    — AS DefineSprite_9/frame_1/DoAction.as
    //   frame_4 (3): playSound("ronce")    — AS DefineSprite_9/frame_4/DoAction.as
    //   frame_7 (6): playSound("ronce")    — AS DefineSprite_9/frame_7/DoAction.as
    //   frame_148 (147): stop(); removeMovieClip(_parent)
    //                    — AS DefineSprite_9/frame_148/DoAction.as
    const sprite8SymRef = () => this.sprite8Sym;
    const runtimeRef = () => this.runtime;

    // Capture sound callback for use inside frameScripts.
    let _playSound: ((id: string) => void) | null = null;
    const getPlaySound = () => _playSound;

    this.anim1Sym = {
      name: "anim1",
      totalFrames: 150,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          // frame_1 (0-based: 0): SOMA.playSound("ronce"); signalHit at first impact.
          // AS: scripts/DefineSprite_9/frame_1/DoAction.as
          0,
          (_clip, _ctx) => {
            const ps = getPlaySound();
            if (ps) {
              ps("ronce");
            }
            runtimeRef().signalHit();
          },
        ],
        [
          // frame_4 (0-based: 3): SOMA.playSound("ronce")
          // AS: scripts/DefineSprite_9/frame_4/DoAction.as
          3,
          (clip, ctx) => {
            const ps = getPlaySound();
            if (ps) {
              ps("ronce");
            }
            // Placement at parent frame 3, depth 1, scale ~0.800, tx=-10.25, ty=-21.55
            const s8 = sprite8SymRef();
            const c = clip.attach(s8, "sprite8_d1", 1, ctx);
            c.x = -10.25;
            c.y = -21.55;
            c.scaleX = 0.7998504638671875;
            c.scaleY = 0.7998504638671875;
          },
        ],
        [
          // frame_7 (0-based: 6): SOMA.playSound("ronce")
          // AS: scripts/DefineSprite_9/frame_7/DoAction.as
          6,
          (_clip, _ctx) => {
            const ps = getPlaySound();
            if (ps) {
              ps("ronce");
            }
          },
        ],
        [
          // Placement at parent frame 9 (0-based: 8), depth 3, scale ~0.800
          8,
          (clip, ctx) => {
            const s8 = sprite8SymRef();
            const c = clip.attach(s8, "sprite8_d3", 3, ctx);
            c.x = 12.2;
            c.y = -31.5;
            c.scaleX = 0.7998504638671875;
            c.scaleY = 0.7998504638671875;
          },
        ],
        [
          // Placement at parent frame 12 (0-based: 11), depth 5, scale ~0.469
          11,
          (clip, ctx) => {
            const s8 = sprite8SymRef();
            const c = clip.attach(s8, "sprite8_d5", 5, ctx);
            c.x = 6.85;
            c.y = -6.9;
            c.scaleX = 0.4688873291015625;
            c.scaleY = 0.4688873291015625;
          },
        ],
        [
          // Placement at parent frame 18 (0-based: 17), depth 7, scale ~0.383
          17,
          (clip, ctx) => {
            const s8 = sprite8SymRef();
            const c = clip.attach(s8, "sprite8_d7", 7, ctx);
            c.x = -19.55;
            c.y = -19.05;
            c.scaleX = 0.382720947265625;
            c.scaleY = 0.382720947265625;
          },
        ],
        [
          // Placement at parent frame 24 (0-based: 23), depth 9, scale ~0.285
          23,
          (clip, ctx) => {
            const s8 = sprite8SymRef();
            const c = clip.attach(s8, "sprite8_d9", 9, ctx);
            c.x = 19.5;
            c.y = -14.45;
            c.scaleX = 0.285064697265625;
            c.scaleY = 0.285064697265625;
          },
        ],
        [
          // Placement at parent frame 36 (0-based: 35), depth 11, scale ~0.285
          35,
          (clip, ctx) => {
            const s8 = sprite8SymRef();
            const c = clip.attach(s8, "sprite8_d11", 11, ctx);
            c.x = -23.85;
            c.y = -7.65;
            c.scaleX = 0.285064697265625;
            c.scaleY = 0.285064697265625;
          },
        ],
        [
          // Placement at parent frame 51 (0-based: 50), depth 13, scale ~0.193
          50,
          (clip, ctx) => {
            const s8 = sprite8SymRef();
            const c = clip.attach(s8, "sprite8_d13", 13, ctx);
            c.x = -17.1;
            c.y = 3.55;
            c.scaleX = 0.193206787109375;
            c.scaleY = 0.193206787109375;
          },
        ],
        [
          // frame_148 (0-based: 147): stop(); removeMovieClip(_parent)
          // AS: scripts/DefineSprite_9/frame_148/DoAction.as
          147,
          (clip) => {
            clip.stop();
            clip.remove();
            runtimeRef().complete();
          },
        ],
      ]),
    };

    // Patch in the sound callback accessor so frame scripts can call it.
    // We use a closure over _playSound which is set in onSpellStart.
    // Re-bind the frameScripts reference to capture the closure correctly.
    // (The closure already captures _playSound via getPlaySound().)

    this.registry.register(this.sprite8Sym);
    this.registry.register(this.anim1Sym);

    // Store a reference so onSpellStart can bind the sound callback.
    this._playSoundSetter = (fn: (id: string) => void) => {
      _playSound = fn;
    };
  }

  private _playSoundSetter?: (fn: (id: string) => void) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Bind the sound callback so frameScripts can play sounds.
    if (this._playSoundSetter) {
      this._playSoundSetter(callbacks.playSound);
    }

    // Main timeline frame_1: place anim1 at root (TargetCell anchor = target cell).
    // The harness has positioned the container at target — attach anim1 at (0,0).
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
