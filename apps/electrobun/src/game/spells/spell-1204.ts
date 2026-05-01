/**
 * Spell 1204 — Panda spell (m_panda_spell_a).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1204/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear). The spell has a `move` symbol (DefineSprite_9_move)
 * with an inner clip that flickers alpha, and a `shoot` symbol (DefineSprite_8_shoot)
 * that plays 74 frames and then removes the parent. There is no ballistic arc — the
 * harness rotates the container to face the target and attaches `shoot` at the target
 * offset. The `move` symbol is attached by the harness at root as the linear projectile
 * body.
 *
 * Library symbols (all container-only; `shoot` has authored frame textures):
 *   - DefineSprite_6   — unnamed spark particle. frame_1 seeds angle/v/va/t; onEnterFrame
 *                        drifts the spark with cosine-X / sine-Y and decays v. No separate
 *                        lib_ textures in manifest; treated as container-only with frames:[].
 *   - DefineSprite_4   — unnamed puff particle. frame_1 seeds angle/v/va/t; onEnterFrame
 *                        oscillates scale by t decay. Also container-only.
 *   - move (DefineSprite_9_move) — projectile body container. Contains PlaceObject2_3_1
 *                        (characterId 3, i.e. DefineSprite_4's sibling) which flickers
 *                        alpha 50+random(50) on enterFrame. The harness attaches `move` at
 *                        root for ProjectileLinear.
 *   - shoot (DefineSprite_8_shoot) — 74-frame impact. frame_4 resets rotation to 0.
 *                        PlaceObject2_7_1 placed at frame_39 area decays alpha by 3.34/frame.
 *                        frame_72 stops + removes parent → spell complete.
 *
 * Main timeline: SOMA.playSound("m_panda_spell_a").
 *
 * signalHit: fired at frame_4 of shoot (first substantive frame after attach, when the
 * impact visual appears). The harness does NOT fire signalHit for ProjectileLinear.
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

export class Spell1204 extends RuntimeSpell {
  readonly spellId = 1204;
  readonly displayType = SpellDisplayType.ProjectileLinear;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    // ---- DefineSprite_6 — spark particle -------------------------
    // AS: scripts/DefineSprite_6/frame_1/DoAction.as
    // Seeds angle from _parent._parent.angle, then drifts with
    // abs(cos) X and sin Y, decaying v by 0.95 per frame.
    const sprite6Sym: SymbolDefinition = {
      name: "sprite6",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: angle = _parent._parent.angle; v = 0.67 + random(5);
        // va = 20 * (-0.5 + Math.random()); t = 100;
        const root = clip.parent?.parent;
        const angleDeg = (root?.vars.angle as number) ?? 0;
        clip.vars.angle = angleDeg;
        clip.vars.v = 0.67 + Math.floor(Math.random() * 5);
        clip.vars.va = 20 * (-0.5 + Math.random());
        clip.vars.t = 100;
      },
      onEnterFrame: (clip) => {
        // AS: scripts/DefineSprite_6/frame_1/DoAction.as (onEnterFrame inline)
        let angle = clip.vars.angle as number;
        let v = clip.vars.v as number;
        let va = clip.vars.va as number;
        let t = clip.vars.t as number;

        if (Math.floor(Math.random() * 5) === 0) {
          va = 20 * (-0.5 + Math.random());
          clip.vars.va = va;
        }

        // AS: _xscale = v * 10
        clip.scaleX = (v * 10) / 100;

        t *= 0.999;
        angle += va;

        const rad = angle * 0.017453292519943295;
        const vx = Math.abs(v * Math.cos(rad));
        const vy = v * Math.sin(rad);

        clip.x += vx;
        clip.y += vy;

        v *= 0.95;

        // AS: _rotation = angle (degrees → radians)
        clip.rotation = (angle * Math.PI) / 180;

        clip.vars.angle = angle;
        clip.vars.v = v;
        clip.vars.va = va;
        clip.vars.t = t;
      },
    };

    // ---- DefineSprite_4 — puff particle --------------------------
    // AS: scripts/DefineSprite_4/frame_1/DoAction.as
    // Similar to sprite6 but uses _xscale = _yscale = t, t decays by 0.975.
    const sprite4Sym: SymbolDefinition = {
      name: "sprite4",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: angle = _parent._parent.angle; v = 0.67 + random(5);
        // va = 20 * (-0.5 + Math.random()); t = 70 + random(30);
        const root = clip.parent?.parent;
        const angleDeg = (root?.vars.angle as number) ?? 0;
        clip.vars.angle = angleDeg;
        clip.vars.v = 0.67 + Math.floor(Math.random() * 5);
        clip.vars.va = 20 * (-0.5 + Math.random());
        clip.vars.t = 70 + Math.floor(Math.random() * 30);
      },
      onEnterFrame: (clip) => {
        // AS: scripts/DefineSprite_4/frame_1/DoAction.as (onEnterFrame inline)
        let angle = clip.vars.angle as number;
        let v = clip.vars.v as number;
        let va = clip.vars.va as number;
        let t = clip.vars.t as number;

        if (Math.floor(Math.random() * 3) === 1) {
          va = 20 * (-0.5 + Math.random());
          clip.vars.va = va;
        }

        // AS: _xscale = t; _yscale = t
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;

        t *= 0.975;

        angle += va;

        const rad = angle * 0.017453292519943295;
        const vx = Math.abs(v * Math.cos(rad));
        const vy = v * Math.sin(rad);

        clip.x += vx;
        clip.y += vy;

        v *= 0.95;

        clip.vars.angle = angle;
        clip.vars.v = v;
        clip.vars.va = va;
        clip.vars.t = t;
      },
    };

    // ---- DefineSprite_9_move — projectile body container ---------
    // Contains PlaceObject2_3_1 which has an onClipEvent(enterFrame)
    // that flickers alpha: _alpha = 50 + random(50).
    // AS: scripts/DefineSprite_9_move/frame_1/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // PlaceObject2_3_1 references characterId 3 (sprite4-family puff particle).
    // We model it as an inner symbol with the flickering onEnterFrame.
    const moveInnerSym: SymbolDefinition = {
      name: "moveInner",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS: scripts/DefineSprite_9_move/frame_1/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _alpha = 50 + random(50)
        clip.alpha = (50 + Math.floor(Math.random() * 50)) / 100;
      },
    };

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
            // AS: DefineSprite_9_move/frame_1 — PlaceObject2_3_1 placed at frame 1
            // Attach the inner flickering puff clip.
            clip.attach(moveInnerSym, "inner1", 1, ctx);
          },
        ],
      ]),
    };

    // ---- DefineSprite_8_shoot — 74-frame impact ------------------
    // AS: scripts/DefineSprite_8_shoot/frame_4/DoAction.as  → _rotation = 0
    // AS: scripts/DefineSprite_8_shoot/frame_39/PlaceObject2_7_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //     → _parent._alpha -= 3.34  (fades the clip that was placed)
    // AS: scripts/DefineSprite_8_shoot/frame_72/DoAction.as → stop(); _parent.removeMovieClip()
    //
    // The PlaceObject2_7_1 sprite (characterId 7 ~ sprite6-family spark) is placed at
    // frame_39 area of shoot's timeline. Its enterFrame handler decays the clip's own
    // parent (the shoot container) alpha by 3.34 each tick. We model PlaceObject2_7_1
    // as a child symbol with the decay handler attached to shoot at frame 39 (index 38).
    const shootFadeSym: SymbolDefinition = {
      name: "shootFade",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS: scripts/DefineSprite_8_shoot/frame_39/PlaceObject2_7_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _parent._alpha -= 3.34  → fade the shoot clip itself
        const parent = clip.parent;
        if (parent) {
          parent.alpha = Math.max(0, parent.alpha - 3.34 / 100);
        }
      },
    };

    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);
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
            // AS: scripts/DefineSprite_8_shoot/frame_4/DoAction.as
            // _rotation = 0  — override any harness-applied rotation
            clip.rotation = 0;
            // Signal hit at the first impact frame (frame_4, index 3).
            this.runtime.signalHit();
          },
        ],
        [
          38,
          (clip, ctx) => {
            // AS: DefineSprite_8_shoot/frame_39 places PlaceObject2_7_1 with
            // onClipEvent(enterFrame) that decays _parent._alpha -= 3.34.
            // Attach the fade-driver child here.
            if (!clip.children.has("shootFade")) {
              clip.attach(shootFadeSym, "shootFade", 7, ctx);
            }
          },
        ],
        [
          71,
          (clip) => {
            // AS: scripts/DefineSprite_8_shoot/frame_72/DoAction.as
            // stop(); _parent.removeMovieClip();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite6Sym);
    this.registry.register(sprite4Sym);
    this.registry.register(moveInnerSym);
    this.registry.register(moveSym);
    this.registry.register(shootFadeSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // AS: scripts/frame_1/DoAction.as
    // SOMA.playSound("m_panda_spell_a");
    callbacks.playSound("m_panda_spell_a");
  }
}
