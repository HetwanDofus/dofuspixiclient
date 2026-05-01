/**
 * Spell 1212 — Souillure (Pandawa).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1212/scripts/scripts/
 *
 * displayType=11 (TargetCell). Single animation anchored at the target cell.
 * No projectile motion, no caster reference — the entire anim1 composite
 * plays at the target. No `move` / `shoot` / `duplicate` symbols.
 *
 * Library symbols:
 *   - sprite16 (characterId=16, kind="clipEvent", directlyDynamic=true) —
 *     dark ink/slime particle. onLoad seeds _alpha [30,70], random rotation
 *     [0,360) deg, scale t [30,110] and vt=1. onEnterFrame pulses scale
 *     (t += vt; vt *= 0.98).
 *     Canonical: DefineSprite_16/frame_1/PlaceObject2_12_1/CLIPACTIONRECORD
 *
 *   - sprite15 (DefineSprite_15) — inner composite sprite whose frame_1
 *     seeds random alpha, rotation, and scale on itself, and whose frame_19
 *     stops. It hosts sprite16 placements injected by DefineSprite_17's
 *     frame_12 (deduced from placements[].parentSpriteId=17 and the broader
 *     structure — see below).
 *
 *   - sprite17 (DefineSprite_17) — the outermost animation shell (186-frame
 *     container matching anim1). Placed on root via onSpellStart.
 *     frame_118: starts fading (_alpha -= 1.67 per tick via onEnterFrame).
 *     frame_178: _parent.removeMovieClip() → runtime.complete().
 *
 *   - sprite8 (DefineSprite_8) — drift particle. frame_1/DoAction.as:
 *     seeds vx=_X/25, vy=_Y/25, random scale [50,100]%, random alpha [70,100],
 *     jumps to a random frame, then drifts with 0.98 friction per tick.
 *
 * Main timeline: SOMA.playSound("panda_souillure") only (frame_1/DoAction.as).
 *
 * The anim1 composite (186 frames, isComposite=true) provides the pre-rendered
 * background artwork. The live runtime clips (sprite16 particles) are layered
 * on top at runtime.
 *
 * Placement analysis from manifest.librarySymbols[0] (sprite16):
 *   All 4 placements have parentSpriteId=17, frame=12, kind="place".
 *   They are attached at depth 1, 11, 21, 31 with slight translate offsets
 *   and scaleY=0.5. This means DefineSprite_17's frameScripts[11] (frame_12)
 *   attaches four sprite16 instances with those transforms.
 *
 * signalHit: fired at the logical impact moment. Given the anim plays at
 * target cell and there's no explicit "end()" call in canonical AS, we fire
 * at the first frame that the particles are placed (frame 12 of sprite17,
 * i.e. frameScripts index 11) — this is canonical for target-cell spells.
 *
 * complete: fired from sprite17 frameScripts[177] (AS frame_178:
 * _parent.removeMovieClip()).
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

// Bounds from manifest.librarySymbols[0] (sprite16)
const SPRITE16_BOUNDS = {
  width: 114.5,
  height: 61.55,
  offsetX: -32.1,
  offsetY: -30.75,
};

// Bounds for anim1 (main animation, used as the outer sprite17 shell)
const ANIM1_BOUNDS = {
  width: 145.5,
  height: 161.1,
  offsetX: -60.6,
  offsetY: -141.45,
};

export class Spell1212 extends RuntimeSpell {
  readonly spellId = 1212;
  readonly displayType = SpellDisplayType.TargetCell;

  // Stored so onSpellStart can attach them
  private sprite17Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite16Anchor = calculateAnchor(SPRITE16_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- sprite16 — dark ink/slime particle (clipEvent, directlyDynamic) ----
    // AS: DefineSprite_16/frame_1/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(load).as
    //   _alpha = 30 + random(40);
    //   _rotation = random(360);
    //   t = 30 + random(80);
    //   vt = 1;
    //
    // AS: DefineSprite_16/frame_1/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _xscale = t;
    //   _yscale = t;
    //   t += vt;
    //   vt *= 0.98;
    const sprite16Sym: SymbolDefinition = {
      name: "sprite16",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite16"),
      anchorX: sprite16Anchor.x,
      anchorY: sprite16Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_16/frame_1/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.alpha = (30 + Math.floor(Math.random() * 40)) / 100;
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        const t = 30 + Math.floor(Math.random() * 80);
        clip.vars.t = t;
        clip.vars.vt = 1;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_16/frame_1/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let t = clip.vars.t as number;
        let vt = clip.vars.vt as number;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        t += vt;
        vt *= 0.98;
        clip.vars.t = t;
        clip.vars.vt = vt;
      },
    };

    // ---- sprite8 — drift particle (DefineSprite_8) -----------------------
    // AS: DefineSprite_8/frame_1/DoAction.as
    //   vx = _X / 25;
    //   vy = _Y / 25;
    //   t = 50 + random(50);
    //   _xscale = t; _yscale = t;
    //   _alpha = 70 + random(30);
    //   gotoAndStop(random(_totalframes - 1) + 2);
    //   onEnterFrame: _X += vx; _Y += vy; vx *= 0.98; vy *= 0.98;
    //
    // sprite8 is a sub-sprite within sprite15 / sprite17 composite. Since it
    // appears as part of the pre-rendered anim1 composite (isComposite=true)
    // and has no separate librarySymbols entry, it is baked into the composite
    // frames. We register it as a container-only symbol for any runtime
    // attach scenarios, but its visual is carried by the composite.
    //
    // NOTE: DefineSprite_8 has no placements[] entry in manifest.librarySymbols,
    // meaning it is not directly attached via attachMovie in the scripts we need
    // to port at the harness level — it is part of the authored timeline of
    // DefineSprite_15 and its behavior is captured in the composite. We do not
    // need to register it separately for this spell's runtime.

    // ---- sprite15 — inner composite (DefineSprite_15) --------------------
    // AS: DefineSprite_15/frame_1/DoAction.as
    //   _alpha = 30 + random(40);
    //   _rotation = random(360);
    //   t = 20 + random(60);
    //   _xscale = t; _yscale = t;
    //
    // AS: DefineSprite_15/frame_19/DoAction.as
    //   stop();
    //
    // sprite15 is part of the authored composite inside sprite17 and is
    // rendered into anim1's composite frames. It is placed by the SWF's
    // authored timeline, not by an attachMovie call. We do not need to register
    // it as a separate runtime symbol — its visual is captured in anim1.

    // ---- sprite17 — outer animation shell (DefineSprite_17) --------------
    // This is the main timeline container (matches anim1, 186 frames).
    // frame_118 (index 117): starts alpha fade via onEnterFrame (_alpha -= 1.67)
    // frame_178 (index 177): _parent.removeMovieClip() → complete()
    //
    // Placements from manifest.librarySymbols[0].placements (all parentSpriteId=17,
    // frame=12 → frameScripts index 11):
    //   depth 1:  matrix { scaleX:1, scaleY:0.5, tx:0,    ty:0    }
    //   depth 11: matrix { scaleX:1, scaleY:0.5, tx:-3.5, ty:4.25 }
    //   depth 21: matrix { scaleX:1, scaleY:0.5, tx:-9.5, ty:0    }
    //   depth 31: matrix { scaleX:1, scaleY:0.5, tx:2.5,  ty:2.25 }
    //
    // AS: DefineSprite_17/frame_118/DoAction.as
    //   this.onEnterFrame = function() { _alpha = _alpha - 1.67; };
    //
    // AS: DefineSprite_17/frame_178/DoAction.as
    //   _parent.removeMovieClip(); stop();
    this.sprite17Sym = {
      name: "sprite17",
      totalFrames: 186,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          11,
          (clip, ctx) => {
            // AS: sprite16 placements at frame 12 of DefineSprite_17.
            // Four instances at depths 1, 11, 21, 31 with scaleY=0.5 and
            // their respective translate offsets.

            // Attach instance at depth 1, matrix: tx=0, ty=0, scaleX=1, scaleY=0.5
            const p1 = clip.attach(sprite16Sym, "sprite16_d1", 1, ctx, {
              x: 0,
              y: 0,
            });
            p1.scaleX = 1;
            p1.scaleY = 0.5;

            // Attach instance at depth 11, matrix: tx=-3.5, ty=4.25, scaleX=1, scaleY=0.5
            const p2 = clip.attach(sprite16Sym, "sprite16_d11", 11, ctx, {
              x: -3.5,
              y: 4.25,
            });
            p2.scaleX = 1;
            p2.scaleY = 0.5;

            // Attach instance at depth 21, matrix: tx=-9.5, ty=0, scaleX=1, scaleY=0.5
            const p3 = clip.attach(sprite16Sym, "sprite16_d21", 21, ctx, {
              x: -9.5,
              y: 0,
            });
            p3.scaleX = 1;
            p3.scaleY = 0.5;

            // Attach instance at depth 31, matrix: tx=2.5, ty=2.25, scaleX=1, scaleY=0.5
            const p4 = clip.attach(sprite16Sym, "sprite16_d31", 31, ctx, {
              x: 2.5,
              y: 2.25,
            });
            p4.scaleX = 1;
            p4.scaleY = 0.5;

            // Signal hit when particles are first placed at the target
            this.runtime.signalHit();
          },
        ],
        [
          117,
          (clip) => {
            // AS: DefineSprite_17/frame_118/DoAction.as
            //   this.onEnterFrame = function() { _alpha = _alpha - 1.67; };
            clip.onEnterFrame = (self) => {
              // AS: _alpha = _alpha - 1.67  (Flash 0-100 → TS 0-1: delta = 1.67/100)
              self.alpha = self.alpha - 1.67 / 100;
            };
          },
        ],
        [
          177,
          (clip) => {
            // AS: DefineSprite_17/frame_178/DoAction.as
            //   _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite16Sym);
    this.registry.register(this.sprite17Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: scripts/frame_1/DoAction.as
    //   SOMA.playSound("panda_souillure");
    callbacks.playSound("panda_souillure");

    // Attach the main animation shell (sprite17) at depth 1 on root.
    this.root.attach(this.sprite17Sym, "sprite17", 1, context);
  }
}
