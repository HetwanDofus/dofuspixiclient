/**
 * Spell 2056 — (Unknown name, likely a Cra/projectile spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2056/scripts/scripts/
 *
 * displayType=51 (WorldAbsoluteAlt). Two parallel authored timelines:
 *   - sprite_3 (24 frames): caster-side arrow/beam. frame_1 positions at cellFrom,
 *     rotates to angle. frame_22 stops.
 *   - sprite_8 (144 frames): target-side impact. frame_1 calls this.end() (signalHit)
 *     and positions at cellTo. frame_7 places a sub-sprite (PlaceObject2_5_1) with
 *     bounce physics. frame_109 places a sub-sprite (PlaceObject2_7_3) that fades
 *     the parent. frame_142 removes parent and stops (spell complete).
 *
 * The harness for WorldAbsoluteAlt only seeds root.vars (cellFrom, cellTo, angle,
 * level). Both sprite_3 and sprite_8 position themselves at world coords via
 * _parent.cellFrom / _parent.cellTo. signalHit is called from sprite_8's frame_1
 * (this.end()). complete() is called from sprite_8's frame_142.
 *
 * Library symbols: none (librarySymbols[] is empty in the manifest).
 * Both sprite_3 and sprite_8 are in animations[] only — no lib_ prefix.
 *
 * The sub-sprite at PlaceObject2_5_1 (frame_7 of sprite_8) has bounce physics:
 *   onLoad: seed g, amp, vx, vy, f, vrot
 *   onEnterFrame: bounce on Y=0 with friction, move parent
 *
 * The sub-sprite at PlaceObject2_7_3 (frame_109 of sprite_8) fades:
 *   onEnterFrame: _parent._alpha -= 10 (i.e. sprite_8's alpha decreases 10/100 per frame)
 *
 * Main timeline: frame_2/DoAction.as → stop(). No sound in the canonical AS.
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

// sprite_3 bounds from manifest animations[]
const SPRITE_3_BOUNDS = {
  width: 105.95,
  height: 0.1,
  offsetX: 0,
  offsetY: -0.1,
};

// sprite_8 bounds from manifest animations[]
const SPRITE_8_BOUNDS = {
  width: 66.4,
  height: 15.4,
  offsetX: -48.25,
  offsetY: -50.1,
};

export class Spell2056 extends RuntimeSpell {
  readonly spellId = 2056;
  readonly displayType = SpellDisplayType.WorldAbsoluteAlt;

  private sprite3Sym!: SymbolDefinition;
  private sprite8Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const sprite3Anchor = calculateAnchor(SPRITE_3_BOUNDS);
    const sprite8Anchor = calculateAnchor(SPRITE_8_BOUNDS);

    // ---- sub-sprite for bounce physics (PlaceObject2_5_1 inside sprite_8 frame_7) ----
    // This is an inline clip placed by sprite_8's frame_7 with clip events.
    // We model it as a registered symbol so sprite_8's frameScripts can attach it.
    // It has no authored textures (container-only), physics driven by onLoad/onEnterFrame.
    const bounceSym: SymbolDefinition = {
      name: "_bounce_particle",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      // AS: DefineSprite_8/frame_7/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip) => {
        clip.vars.g = 0.83;
        clip.vars.amp = 2.5;
        clip.vars.vx = 2 * 2.5 * (-0.5 + Math.random());
        clip.vars.vy = 2.5 * (-0.5 + Math.random());
        clip.vars.f = -5 - Math.floor(Math.random() * 5);
        clip.vars.vrot = -100 + Math.floor(Math.random() * 200);
      },
      // AS: DefineSprite_8/frame_7/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
      onEnterFrame: (clip) => {
        const g = clip.vars.g as number;
        let amp = clip.vars.amp as number;
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        let f = clip.vars.f as number;
        const vrot = clip.vars.vrot as number;

        // AS: _rotation == vrot  (note: == not = in canonical AS, this is a no-op comparison)
        // Per canonical AS this is a comparison (==), not assignment. No-op — intentionally skip.

        // AS: _parent._x += vx; _parent._y += vy;
        // _parent here is sprite_8 (the outer clip that contains this bounce particle)
        const parent = clip.parent;
        if (parent) {
          parent.x += vx;
          parent.y += vy;
        }

        // AS: _Y = _Y + (f += g)
        f += g;
        clip.y = clip.y + f;
        clip.vars.f = f;

        // AS: if(_Y > 0) { bounce }
        if (clip.y > 0) {
          // AS: vrot *= 0.5 (but vrot is a local var, not reassigned back — canonical quirk, skip)
          // AS: _Y = 0
          clip.y = 0;
          // AS: f = (-f) / 2
          clip.vars.f = (-f) / 2;
          // AS: amp *= 0.6
          amp *= 0.6;
          clip.vars.amp = amp;
          // AS: vx = amp * (-0.5 + Math.random())
          vx = amp * (-0.5 + Math.random());
          clip.vars.vx = vx;
          // AS: vy = amp * (-0.5 + Math.random())
          vy = amp * (-0.5 + Math.random());
          clip.vars.vy = vy;
        } else {
          clip.vars.vx = vx;
          clip.vars.vy = vy;
        }
      },
    };

    // ---- sub-sprite for fade (PlaceObject2_7_3 inside sprite_8 frame_109) ----
    // Container-only clip; onEnterFrame decrements parent alpha by 10 each frame.
    const fadeSym: SymbolDefinition = {
      name: "_fade_controller",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      // AS: DefineSprite_8/frame_109/PlaceObject2_7_3/CLIPACTIONRECORD onClipEvent(enterFrame).as
      onEnterFrame: (clip) => {
        // AS: _parent._alpha -= 10  (parent is sprite_8)
        const parent = clip.parent;
        if (parent) {
          parent.alpha = Math.max(0, parent.alpha - 10 / 100);
        }
      },
    };

    // ---- sprite_3 — caster-side arrow/beam (24 frames) ----------
    // frame_1: position at cellFrom, rotate to angle
    // frame_22: stop()
    this.sprite3Sym = {
      name: "sprite_3",
      totalFrames: 24,
      frames: textures.getFrames("sprite_3"),
      anchorX: sprite3Anchor.x,
      anchorY: sprite3Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_3/frame_1/DoAction.as
            // _rotation = _parent.angle;
            // _X = _parent.cellFrom.x;
            // _Y = _parent.cellFrom.y;
            const root = clip.parent;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            clip.rotation = (angleDeg * Math.PI) / 180;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y;
            }
          },
        ],
        [
          21,
          (clip) => {
            // AS: DefineSprite_3/frame_22/DoAction.as
            // stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_8 — target-side impact (144 frames) -------------
    // frame_1: this.end() → signalHit; position at cellTo
    // frame_7: attach bounce particle sub-sprite
    // frame_109: attach fade controller sub-sprite
    // frame_142: _parent.removeMovieClip(); stop() → complete()
    this.sprite8Sym = {
      name: "sprite_8",
      totalFrames: 144,
      frames: textures.getFrames("sprite_8"),
      anchorX: sprite8Anchor.x,
      anchorY: sprite8Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_8/frame_1/DoAction.as
            // this.end();
            // _X = _parent.cellTo.x;
            // _Y = _parent.cellTo.y;
            this.runtime.signalHit();
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y;
            }
          },
        ],
        [
          6,
          (clip, ctx) => {
            // AS: DefineSprite_8/frame_7 — PlaceObject2_5_1 placed with clipEvents
            // This is the frame where the bounce particle is placed on sprite_8.
            clip.attach(bounceSym, "_bounce_particle_1", 5, ctx);
          },
        ],
        [
          108,
          (clip, ctx) => {
            // AS: DefineSprite_8/frame_109 — PlaceObject2_7_3 placed with clipEvents
            // This is the frame where the fade controller is placed on sprite_8.
            clip.attach(fadeSym, "_fade_controller_3", 7, ctx);
          },
        ],
        [
          141,
          (clip) => {
            // AS: DefineSprite_8/frame_142/DoAction.as
            // _parent.removeMovieClip();
            // stop();
            clip.stop();
            const parent = clip.parent;
            if (parent) {
              parent.remove();
            }
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(bounceSym);
    this.registry.register(fadeSym);
    this.registry.register(this.sprite3Sym);
    this.registry.register(this.sprite8Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS: scripts/frame_2/DoAction.as → stop()
    // No sound in the canonical main timeline.
    // Attach both authored timelines to root so they start ticking immediately.
    this.root.attach(this.sprite3Sym, "sprite_3", 1, context);
    this.root.attach(this.sprite8Sym, "sprite_8", 2, context);
  }
}
