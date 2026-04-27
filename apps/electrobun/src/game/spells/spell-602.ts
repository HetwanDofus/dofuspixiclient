/**
 * Spell 602 — Dodge (Ecaflip dodge/roll effect).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/602/scripts/scripts/
 *
 * displayType=11 (TargetCell). No projectile motion, no caster reference —
 * the animation plays at the target cell. The main timeline is a single
 * `SOMA.playSound("dodge_602")` with no explicit child attaches; all content
 * is driven by the single composite `anim1` animation which is the top-level
 * authored timeline (243 frames, `stopFrame=240`).
 *
 * The manifest has NO `librarySymbols[]` entries — all symbols appear only in
 * the `animations[]` list. The canonical AS scripts refer to several
 * DefineSprite_N symbols that are authored sub-sprites placed statically on
 * the timeline (not via attachMovie), so we treat `anim1` as the primary
 * rendered timeline.
 *
 * Library symbols from AS analysis:
 *   - DefineSprite_9  — small scale-randomised particle. onLoad seeds t ∈
 *                       [80,130], applies _xscale/_yscale = t.
 *   - DefineSprite_10 — rotating/pulsing ring sprite. onLoad seeds rotation
 *                       ∈ [−90, 270] deg, alpha ∈ [40, 90], phase i.
 *                       onEnterFrame: _xscale = 100 * sin(i += 0.16).
 *   - DefineSprite_3  — bouncing particle. onLoad: v = 0.
 *                       onEnterFrame: gravity bounce with vx/vy.
 *   - DefineSprite_13 — spiral particle (lemniscate path). onLoad seeds
 *                       st, i, p, v2, rotation, alpha=120, _parent._alpha=10,
 *                       v. onEnterFrame: oscillates position + alpha, fades
 *                       parent out and removes when Y < -100.
 *   - DefineSprite_14 — outer 241-frame timeline. frame_157: this.end()
 *                       → signalHit. frame_241: _parent.removeMovieClip()
 *                       → complete.
 *   - DefineSprite_12 — random alpha flicker sprite. onEnterFrame: _alpha =
 *                       random(170).
 *
 * Main timeline: SOMA.playSound("dodge_602"); (frame_1/DoAction.as).
 *
 * Since there are no librarySymbols[] entries, all textures are fetched
 * without the "lib_" prefix, using bare animation names.
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

// Bounds from manifest animations[0] (anim1 is the sole composite animation)
const ANIM1_BOUNDS = {
  width: 46.35,
  height: 29.35,
  offsetX: -22.6,
  offsetY: -15.1,
};

export class Spell602 extends RuntimeSpell {
  readonly spellId = 602;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- DefineSprite_9 — scale-randomised particle --------------
    // AS: DefineSprite_9/frame_1/PlaceObject2_8_1/CLIPACTIONRECORD onClipEvent(load).as
    const sprite9Sym: SymbolDefinition = {
      name: "sprite_9",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: t = 80 + random(50); _xscale = t; _yscale = t;
        const t = 80 + Math.floor(Math.random() * 50);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
      },
    };

    // ---- DefineSprite_10 — rotating/pulsing ring sprite ----------
    // AS: DefineSprite_10/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: DefineSprite_10/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    const sprite10Sym: SymbolDefinition = {
      name: "sprite_10",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: _rotation = random(360) - 90; _alpha = random(50) + 40; i = Math.random() * 6;
        clip.rotation = ((Math.floor(Math.random() * 360) - 90) * Math.PI) / 180;
        clip.alpha = (Math.floor(Math.random() * 50) + 40) / 100;
        clip.vars.i = Math.random() * 6;
      },
      onEnterFrame: (clip) => {
        // AS: _xscale = 100 * Math.sin(i += 0.16);
        const i = (clip.vars.i as number) + 0.16;
        clip.vars.i = i;
        clip.scaleX = (100 * Math.sin(i)) / 100;
      },
    };

    // ---- DefineSprite_3 — bouncing gravity particle --------------
    // AS: DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    const sprite3Sym: SymbolDefinition = {
      name: "sprite_3",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: v = 0;
        clip.vars.v = 0;
      },
      onEnterFrame: (clip) => {
        // AS: _Y = _Y + v; _X = _X + vx; v += 0.6;
        // if(_Y > 0) { _Y = 0; v = -5 * Math.random(); vx = -2.5 * Math.random() + 1.25; }
        let v = clip.vars.v as number;
        const vx = (clip.vars.vx as number) ?? 0;
        clip.y = clip.y + v;
        clip.x = clip.x + vx;
        v += 0.6;
        clip.vars.v = v;
        if (clip.y > 0) {
          clip.y = 0;
          clip.vars.v = -5 * Math.random();
          clip.vars.vx = -2.5 * Math.random() + 1.25;
        }
      },
    };

    // ---- DefineSprite_13 — spiral/lemniscate particle -----------
    // AS: DefineSprite_13/frame_1/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: DefineSprite_13/frame_1/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    const sprite13Sym: SymbolDefinition = {
      name: "sprite_13",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: st=0; i=0; p=0; v2=0.03+0.06*Math.random(); _rotation=random(360);
        //     _alpha=120; _parent._alpha=10; v=0.3+0.6*Math.random();
        clip.vars.st = 0;
        clip.vars.i = 0;
        clip.vars.p = 0;
        clip.vars.v2 = 0.03 + 0.06 * Math.random();
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        clip.alpha = 120 / 100;
        // _parent._alpha = 10 — set the parent clip's alpha
        if (clip.parent) {
          clip.parent.alpha = 10 / 100;
        }
        clip.vars.v = 0.3 + 0.6 * Math.random();
      },
      onEnterFrame: (clip) => {
        // AS: if(_Y > -100 & _parent._alpha < 100) { _parent._alpha += 6.6; }
        //     if(_Y < -100) { _parent._alpha -= 6.6; if(_parent._alpha < 0) { _parent._visible=0; stop=1; _parent.removeMovieClip(); } }
        //     _rotation = _rotation + 1.3;
        //     _Y = 5 * Math.cos(i) + (p -= v);
        //     _X = 25 * Math.sin(i += v2);
        //     if(Math.cos(i) < 0) { _alpha = 80 * Math.cos(i) + 100; }
        const v2 = clip.vars.v2 as number;
        const v = clip.vars.v as number;
        let i = clip.vars.i as number;
        let p = clip.vars.p as number;

        if (clip.parent) {
          const parentAlpha = clip.parent.alpha * 100;
          if (clip.y > -100 && parentAlpha < 100) {
            clip.parent.alpha = Math.min(100, parentAlpha + 6.6) / 100;
          }
          if (clip.y < -100) {
            const newParentAlpha = parentAlpha - 6.6;
            clip.parent.alpha = newParentAlpha / 100;
            if (newParentAlpha < 0) {
              clip.parent.visible = false;
              clip.parent.remove();
            }
          }
        }

        clip.rotation += (1.3 * Math.PI) / 180;
        p -= v;
        clip.vars.p = p;
        clip.y = 5 * Math.cos(i) + p;
        i += v2;
        clip.vars.i = i;
        clip.x = 25 * Math.sin(i);

        if (Math.cos(i) < 0) {
          // AS: _alpha = 80 * Math.cos(i) + 100  (result in [20,100] range)
          clip.alpha = (80 * Math.cos(i) + 100) / 100;
        }
      },
    };

    // ---- DefineSprite_12 — random alpha flicker -----------------
    // AS: DefineSprite_12/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    const sprite12Sym: SymbolDefinition = {
      name: "sprite_12",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS: _alpha = random(170);
        clip.alpha = Math.floor(Math.random() * 170) / 100;
      },
    };

    // ---- DefineSprite_14 / anim1 — outer 241-frame timeline -----
    // This is the top-level composite animation rendered via `anim1`.
    // frame_157/DoAction.as: this.end() → signalHit
    // frame_241/DoAction.as: _parent.removeMovieClip(); stop();
    // Note: manifest frameCount=243, stopFrame=240 (0-indexed 240 = AS frame 241).
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 243,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          156,
          (_clip) => {
            // AS: DefineSprite_14/frame_157/DoAction.as → this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          240,
          (clip) => {
            // AS: DefineSprite_14/frame_241/DoAction.as → _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite9Sym);
    this.registry.register(sprite10Sym);
    this.registry.register(sprite3Sym);
    this.registry.register(sprite13Sym);
    this.registry.register(sprite12Sym);
    this.registry.register(anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: scripts/frame_1/DoAction.as → SOMA.playSound("dodge_602");
    callbacks.playSound("dodge_602");

    // Attach the main composite animation at the root so it starts ticking.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
