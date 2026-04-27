/**
 * Spell 1203 — Panda (displayType=20 ProjectileLinear).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1203/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear): the harness attaches "shoot" at the
 * target-relative offset inside a container rotated to face the target.
 * There is also a "move" symbol (DefineSprite_9_move) whose frame_1 child
 * (PlaceObject2_3_1) has an onClipEvent(enterFrame) that randomly flickers
 * alpha — it acts as the in-flight projectile body driven by the harness.
 *
 * Library symbols (all in animations[], no librarySymbols[] entries):
 *   - DefineSprite_6 — small sparkle/smoke particle. frame_1 seeds angle,
 *     v, va, t and drives an onEnterFrame with cosine/sine motion + decay.
 *   - DefineSprite_4 — larger puff particle. frame_1 seeds angle, v, va, t
 *     and drives an onEnterFrame similar to DefineSprite_6 but with
 *     symmetric xscale/yscale decay (xscale = yscale = t).
 *   - move (DefineSprite_9_move) — the in-flight projectile container.
 *     Its authored child (PlaceObject2_3_1) has an onClipEvent(enterFrame)
 *     that sets _alpha = 50 + random(50). We model this as the move symbol's
 *     onEnterFrame.
 *   - shoot (DefineSprite_8_shoot) — 74-frame impact composite.
 *     frame_4 (index 3): _rotation = 0 (override harness angle).
 *     frame_39 (index 38): authored child PlaceObject2_7_1 has an
 *       onClipEvent(enterFrame) that decrements _parent._alpha by 3.34 each
 *       frame — we model this as shoot's onEnterFrame starting at frame 39.
 *     frame_72 (index 71): stop(); _parent.removeMovieClip() → complete.
 *
 * Main timeline: SOMA.playSound("m_panda_spell_a"); (no stop, no child attaches)
 *
 * NOTE: manifest has no librarySymbols[] entries. All symbols appear only in
 * animations[]. The sole animation entry is "shoot" with its 74 frames.
 * DefineSprite_6, DefineSprite_4, and DefineSprite_9_move are not in the
 * manifest animations list (they have no standalone texture export), so we
 * treat them as container-only symbols with frames: [].
 *
 * signalHit: NOT called manually — the harness fires it for displayType 20
 * when "shoot" is attached at the target offset. Wait — actually for
 * ProjectileLinear (20/21) the harness attaches shoot and rotates the
 * container, but does NOT call signalHit automatically (only displayType 30/31
 * ballistic does). We must call signalHit from shoot's frame_4 script (the
 * canonical first "action" frame after attachment, mirroring the impact).
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

const SHOOT_BOUNDS = {
  width: 115.25,
  height: 64.5,
  offsetX: -66,
  offsetY: -32.3,
};

export class Spell1203 extends RuntimeSpell {
  readonly spellId = 1203;
  readonly displayType = SpellDisplayType.ProjectileLinear;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- DefineSprite_6 — small sparkle/smoke particle -----------
    // AS: scripts/DefineSprite_6/frame_1/DoAction.as
    // Seeds angle, v, va, t and drives cosine/sine motion + scale/decay.
    const sprite6Sym: SymbolDefinition = {
      name: "sprite6",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_6/frame_1/DoAction.as
            const root = clip.parent?.parent ?? clip.parent;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            clip.vars.angle = angleDeg;
            clip.vars.v = 0.67 + Math.floor(Math.random() * 5);
            clip.vars.va = 20 * (-0.5 + Math.random());
            clip.vars.t = 100;
            clip.onEnterFrame = (c) => {
              // AS: this.onEnterFrame in DefineSprite_6/frame_1/DoAction.as
              if (Math.floor(Math.random() * 5) === 0) {
                c.vars.va = 20 * (-0.5 + Math.random());
              }
              let v = c.vars.v as number;
              let angle = c.vars.angle as number;
              const va = c.vars.va as number;
              let t = c.vars.t as number;

              // AS: _xscale = v * 10 (percent) → scaleX = v * 10 / 100
              c.scaleX = (v * 10) / 100;
              t *= 0.999;
              angle += va;
              const vx = Math.abs(v * Math.cos(angle * 0.017453292519943295));
              const vy = v * Math.sin(angle * 0.017453292519943295);
              c.x += vx;
              c.y += vy;
              v *= 0.95;
              // AS: _rotation = angle (degrees)
              c.rotation = (angle * Math.PI) / 180;

              c.vars.v = v;
              c.vars.angle = angle;
              c.vars.t = t;
            };
          },
        ],
      ]),
    };

    // ---- DefineSprite_4 — larger puff particle -------------------
    // AS: scripts/DefineSprite_4/frame_1/DoAction.as
    // Seeds angle, v, va, t; drives xscale/yscale = t decay + motion.
    const sprite4Sym: SymbolDefinition = {
      name: "sprite4",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_4/frame_1/DoAction.as
            const root = clip.parent?.parent ?? clip.parent;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            clip.vars.angle = angleDeg;
            clip.vars.v = 0.67 + Math.floor(Math.random() * 5);
            clip.vars.va = 20 * (-0.5 + Math.random());
            clip.vars.t = 70 + Math.floor(Math.random() * 30);
            clip.onEnterFrame = (c) => {
              // AS: this.onEnterFrame in DefineSprite_4/frame_1/DoAction.as
              if (Math.floor(Math.random() * 3) === 1) {
                c.vars.va = 20 * (-0.5 + Math.random());
              }
              let v = c.vars.v as number;
              let angle = c.vars.angle as number;
              const va = c.vars.va as number;
              let t = c.vars.t as number;

              // AS: _xscale = t; _yscale = t (percent) → decimal
              c.scaleX = t / 100;
              c.scaleY = t / 100;
              t *= 0.975;
              angle += va;
              const vx = Math.abs(v * Math.cos(angle * 0.017453292519943295));
              const vy = v * Math.sin(angle * 0.017453292519943295);
              c.x += vx;
              c.y += vy;
              v *= 0.95;

              c.vars.v = v;
              c.vars.angle = angle;
              c.vars.t = t;
            };
          },
        ],
      ]),
    };

    // ---- move — in-flight projectile container -------------------
    // AS: scripts/DefineSprite_9_move/frame_1/PlaceObject2_3_1/
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    // The authored child (PlaceObject2_3_1) flickers alpha each frame.
    // We model this as move's own onEnterFrame (the child IS the move
    // clip itself in our simplified model — no sub-child layer needed).
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS: DefineSprite_9_move/frame_1/PlaceObject2_3_1/onClipEvent(enterFrame)
        // _alpha = 50 + random(50)  → 0-1 scale
        clip.alpha = (50 + Math.floor(Math.random() * 50)) / 100;
      },
    };

    // ---- shoot — 74-frame impact composite -----------------------
    // AS: DefineSprite_8_shoot
    //   frame_4  (index 3):  _rotation = 0
    //   frame_39 (index 38): authored child starts decrementing
    //                        _parent._alpha by 3.34 each frame.
    //   frame_72 (index 71): stop(); _parent.removeMovieClip()
    //
    // The fade-out (PlaceObject2_7_1 enterFrame) targets _parent._alpha,
    // i.e. the shoot clip's own alpha. We model this by setting up an
    // onEnterFrame on the shoot clip at frame 38 via a frameScript flag.
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 74,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          3,
          (clip) => {
            // AS: DefineSprite_8_shoot/frame_4/DoAction.as
            // _rotation = 0 — override the harness-applied rotation
            clip.rotation = 0;
            // signal hit at impact (first action frame of shoot)
            this.runtime.signalHit();
          },
        ],
        [
          38,
          (clip) => {
            // AS: DefineSprite_8_shoot/frame_39/PlaceObject2_7_1/
            //     CLIPACTIONRECORD onClipEvent(enterFrame).as
            // Starting at frame 39, the authored child decrements
            // _parent._alpha by 3.34 each frame. We wire this as
            // shoot's onEnterFrame from this point forward.
            clip.onEnterFrame = (c) => {
              // AS: _parent._alpha -= 3.34  (0-100 → 0-1 delta = 3.34/100)
              c.alpha -= 3.34 / 100;
            };
          },
        ],
        [
          71,
          (clip) => {
            // AS: DefineSprite_8_shoot/frame_72/DoAction.as
            // stop(); _parent.removeMovieClip()
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite6Sym);
    this.registry.register(sprite4Sym);
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
