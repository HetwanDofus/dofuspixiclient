/**
 * Spell 1206 — Panda Spell (Pandawa).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1206/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear). The spell has a `shoot` symbol and
 * no `move` symbol. The main-timeline frame_1 plays a sound. The harness
 * attaches `shoot` at the target offset with the caster→target rotation.
 *
 * Library symbols:
 *   - DefineSprite_6 ("sprite6") — a smoke/trail particle. frame_1 seeds
 *     angle, v, va, t and runs onEnterFrame physics: wobbles angle, drifts
 *     x/y, decays v. No explicit removal (runs until parent is removed).
 *   - DefineSprite_4 ("sprite4") — a bubble/scale particle. frame_1 seeds
 *     angle, v, va, t (70-100), runs onEnterFrame: scales by t, decays t,
 *     drifts x/y, decays v. No explicit removal.
 *   - DefineSprite_9_move ("move") — container placed by harness (even
 *     though there is no move symbol authored: see below). Actually
 *     this is the inner placed clip inside move with alpha flicker.
 *   - "shoot" (DefineSprite_8_shoot) — 74-frame composite container.
 *       frame_4: _rotation = 0 (override harness rotation).
 *       frame_39: a child clip (PlaceObject2_7_1) has onEnterFrame that
 *                 decrements _parent._alpha by 3.34 each frame.
 *       frame_72: stop(); _parent.removeMovieClip() → complete.
 *
 * The `move` symbol (DefineSprite_9_move) has a placed child at
 * PlaceObject2_3_1 whose onClipEvent(enterFrame) flickers alpha:
 *   _alpha = 50 + random(50)
 * The child placed inside move has no named character in librarySymbols
 * but its behavior must be live. We model it as a sub-symbol "moveInner"
 * whose onEnterFrame implements the flicker, attached from move's frame_1.
 *
 * The shoot frame_39 places PlaceObject2_7_1 whose onClipEvent(enterFrame)
 * does: _parent._alpha -= 3.34. This means the shoot clip itself fades.
 * We model this as an onEnterFrame set on the shoot clip at frame 39.
 *
 * Main timeline: SOMA.playSound("m_panda_spell_a").
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

// shoot bounds from manifest animations[]
const SHOOT_BOUNDS = {
  width: 115.25,
  height: 64.5,
  offsetX: -66,
  offsetY: -32.3,
};

export class Spell1206 extends RuntimeSpell {
  readonly spellId = 1206;
  readonly displayType = SpellDisplayType.ProjectileLinear;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    // ---- sprite6 — smoke/trail particle (DefineSprite_6) ---------
    // AS: scripts/DefineSprite_6/frame_1/DoAction.as
    // Seeds angle from _parent._parent.angle, v, va, t.
    // onEnterFrame: wobbles angle, drifts X/Y using cos/sin, decays v.
    const sprite6Sym: SymbolDefinition = {
      name: "sprite6",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_6/frame_1/DoAction.as
        // angle = _parent._parent.angle — walk up: clip → shoot → root
        const root = clip.parent?.parent;
        const angleDeg = (root?.vars.angle as number) ?? 0;
        clip.vars.angle = angleDeg;
        clip.vars.v = 0.67 + Math.floor(Math.random() * 5);
        clip.vars.va = 20 * (-0.5 + Math.random());
        clip.vars.t = 100;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_6/frame_1/DoAction.as onEnterFrame
        let angle = clip.vars.angle as number;
        let v = clip.vars.v as number;

        if (Math.floor(Math.random() * 5) === 0) {
          clip.vars.va = 20 * (-0.5 + Math.random());
        }
        const va = clip.vars.va as number;
        let t = clip.vars.t as number;

        // _xscale = v * 10 → scaleX = (v * 10) / 100 = v / 10
        clip.scaleX = (v * 10) / 100;
        t *= 0.999;
        angle += va;

        const vx = Math.abs(v * Math.cos(angle * 0.017453292519943295));
        const vy = v * Math.sin(angle * 0.017453292519943295);
        clip.x += vx;
        clip.y += vy;
        v *= 0.95;
        // _rotation = angle (degrees) → radians
        clip.rotation = (angle * Math.PI) / 180;

        clip.vars.angle = angle;
        clip.vars.v = v;
        clip.vars.va = va;
        clip.vars.t = t;
      },
    };

    // ---- sprite4 — bubble/scale particle (DefineSprite_4) --------
    // AS: scripts/DefineSprite_4/frame_1/DoAction.as
    // Seeds angle, v, va, t (70-100). onEnterFrame: scale by t, decay t,
    // drift x/y, decay v. No removal script (lives until parent removed).
    const sprite4Sym: SymbolDefinition = {
      name: "sprite4",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_4/frame_1/DoAction.as
        const root = clip.parent?.parent;
        const angleDeg = (root?.vars.angle as number) ?? 0;
        clip.vars.angle = angleDeg;
        clip.vars.v = 0.67 + Math.floor(Math.random() * 5);
        clip.vars.va = 20 * (-0.5 + Math.random());
        clip.vars.t = 70 + Math.floor(Math.random() * 30);
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_4/frame_1/DoAction.as onEnterFrame
        let angle = clip.vars.angle as number;
        let v = clip.vars.v as number;
        let t = clip.vars.t as number;

        if (Math.floor(Math.random() * 3) === 1) {
          clip.vars.va = 20 * (-0.5 + Math.random());
        }
        const va = clip.vars.va as number;

        // _xscale = t, _yscale = t → decimal
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        t *= 0.975;
        angle += va;

        const vx = Math.abs(v * Math.cos(angle * 0.017453292519943295));
        const vy = v * Math.sin(angle * 0.017453292519943295);
        clip.x += vx;
        clip.y += vy;
        v *= 0.95;

        clip.vars.angle = angle;
        clip.vars.v = v;
        clip.vars.va = va;
        clip.vars.t = t;
      },
    };

    // ---- moveInner — child inside move with alpha flicker --------
    // AS: scripts/DefineSprite_9_move/frame_1/PlaceObject2_3_1/
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    // _alpha = 50 + random(50) → alpha = (50 + random(50)) / 100
    const moveInnerSym: SymbolDefinition = {
      name: "moveInner",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS DefineSprite_9_move/frame_1/PlaceObject2_3_1/
        //    CLIPACTIONRECORD onClipEvent(enterFrame).as
        clip.alpha = (50 + Math.floor(Math.random() * 50)) / 100;
      },
    };

    // ---- move — container used by ProjectileLinear harness -------
    // DefineSprite_9_move has a placed child (PlaceObject2_3_1) with
    // alpha-flicker behavior. We model move as a container that attaches
    // moveInner on frame_1.
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Place moveInner child — mirrors PlaceObject2_3_1 in
            // DefineSprite_9_move/frame_1
            clip.attach(moveInnerSym, "moveInner", 3, ctx);
          },
        ],
      ]),
    };

    // ---- shoot — 74-frame composite at target --------------------
    // AS: scripts/DefineSprite_8_shoot/frame_4/DoAction.as → _rotation = 0
    // AS: scripts/DefineSprite_8_shoot/frame_39/PlaceObject2_7_1/
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as → _parent._alpha -= 3.34
    // AS: scripts/DefineSprite_8_shoot/frame_72/DoAction.as → stop(); _parent.removeMovieClip()
    //
    // The shoot composite has authored frame textures (74 frames of SVG).
    // We also spawn sprite6 and sprite4 particles to match the dynamic
    // particle effects that would be authored inside the shoot timeline.
    // The frame_39 placement puts a child whose onEnterFrame decrements
    // _parent._alpha by 3.34 per frame — this fades the shoot clip itself.
    // We model this as: at frame_39, install an onEnterFrame on the shoot
    // clip itself that decrements alpha, and remove it once shoot is done.
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);
    const shootFrames = textures.getFrames("shoot");

    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 74,
      frames: shootFrames,
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // frame_1: attach initial particle burst — sprite6 and sprite4
            // particles are placed inside shoot. Spawn a small number to
            // represent the authored placements.
            for (let c = 0; c < 3; c++) {
              clip.attach(sprite6Sym, `sprite6_${c}`, 10 + c, ctx);
            }
            for (let c = 0; c < 3; c++) {
              clip.attach(sprite4Sym, `sprite4_${c}`, 20 + c, ctx);
            }
          },
        ],
        [
          3,
          (clip) => {
            // AS DefineSprite_8_shoot/frame_4/DoAction.as
            // _rotation = 0 — override the harness-applied rotation so
            // the shoot composite faces upright at target.
            clip.rotation = 0;
          },
        ],
        [
          38,
          (clip) => {
            // AS DefineSprite_8_shoot/frame_39/PlaceObject2_7_1/
            //    CLIPACTIONRECORD onClipEvent(enterFrame).as
            // The placed child does: _parent._alpha -= 3.34
            // We install this fade directly onto the shoot clip's
            // onEnterFrame starting at this frame.
            clip.onEnterFrame = (self) => {
              // Port of: _parent._alpha -= 3.34 (0-100 scale → 0-1)
              self.alpha -= 3.34 / 100;
              if (self.alpha < 0) {
                self.alpha = 0;
              }
            };
            // Also signal hit at the impact point (frame 39 is the
            // canonical impact frame where the alpha-fade child is placed).
            this.runtime.signalHit();
          },
        ],
        [
          71,
          (clip) => {
            // AS DefineSprite_8_shoot/frame_72/DoAction.as
            // stop(); _parent.removeMovieClip();
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite6Sym);
    this.registry.register(sprite4Sym);
    this.registry.register(moveInnerSym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // AS: scripts/frame_1/DoAction.as
    // SOMA.playSound("m_panda_spell_a");
    callbacks.playSound("m_panda_spell_a");
  }
}
