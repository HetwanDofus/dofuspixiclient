/**
 * Spell 1204 — (Panda spell, displayType=20 ProjectileLinear).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1204/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear): The manifest has a `shoot` animation in
 * `animations[]` (not in `librarySymbols[]`), and the harness attaches `shoot`
 * at the target-relative offset inside a container rotated to face the target.
 * This matches the ProjectileLinear pattern: root at caster, rotated to face
 * target, `shoot` placed at the target delta offset.
 *
 * Library symbols (none in librarySymbols[]): all content is in `animations[]`.
 *   - `shoot` — 74-frame animated impact. Uses a `PlaceObject2_7_1` child
 *     (DefineSprite_4) spawned at frame_4 via _rotation=0 override, with an
 *     onEnterFrame that fades it out (_alpha -= 3.34 per frame from frame_39).
 *     frame_72: stop() + _parent.removeMovieClip() → spell complete.
 *   - `DefineSprite_6` — particle symbol attached inside shoot. Seeds angle,
 *     v, va, t in frame_1; drifts outward with angular wobble each frame.
 *   - `DefineSprite_4` — particle symbol attached inside shoot. Seeds angle,
 *     v, va, t in frame_1; scales down as it drifts.
 *   - `DefineSprite_9_move` — the `move` container (for ProjectileLinear the
 *     harness doesn't actually use move, but a child PlaceObject2_3_1 inside
 *     it flickers alpha each frame via onClipEvent(enterFrame)).
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("m_panda_spell_a").
 *
 * Shoot symbol details:
 *   - frame_4/DoAction.as: `_rotation = 0` — resets the harness rotation so
 *     the impact plays upright.
 *   - PlaceObject2_7_1 onClipEvent(enterFrame) (from frame_39): `_parent._alpha -= 3.34`
 *     This is a child clip inside shoot whose enterFrame decrements the parent
 *     shoot's alpha. We model this as shoot's own onEnterFrame gated on frame >= 38.
 *   - frame_72/DoAction.as: stop() + _parent.removeMovieClip() → complete.
 *
 * NOTE: DefineSprite_6 and DefineSprite_4 appear as library symbols attached
 * inside `shoot` by the AS scripts. Since they are not listed in manifest
 * `librarySymbols[]`, their texture key has NO `lib_` prefix. We use
 * `textures.getFrames("shoot")` for the shoot animation itself (bare name from
 * `animations[]`). DefineSprite_6 and DefineSprite_4 are container-only symbols
 * (particle emitters) with no authored frame textures exposed in the manifest —
 * their visual is the `shoot` composite asset frames. We register them with
 * `frames: []` as container-only, driving all their visual through the
 * `shoot` frames on the shoot symbol itself.
 *
 * The harness for ProjectileLinear attaches `shoot` at the target-local offset
 * and rotates the root container to face the target. Our `shoot` frame_4 sets
 * `_rotation = 0` to cancel that rotation for the impact display.
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

export class Spell1204 extends RuntimeSpell {
  readonly spellId = 1204;
  readonly displayType = SpellDisplayType.ProjectileLinear;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- DefineSprite_6 — drifting particle inside shoot ---------
    // AS: DefineSprite_6/frame_1/DoAction.as
    // Seeds angle from grandparent, v, va, t=100; drifts outward with
    // angular wobble. xscale driven by v*10 each frame.
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
            // AS: DefineSprite_6/frame_1/DoAction.as
            // angle = _parent._parent.angle
            // v = 0.67 + random(5)
            // va = 20 * (-0.5 + Math.random())
            // t = 100
            const root = clip.parent?.parent;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            clip.vars.angle = angleDeg;
            clip.vars.v = 0.67 + Math.floor(Math.random() * 5);
            clip.vars.va = 20 * (-0.5 + Math.random());
            clip.vars.t = 100;
          },
        ],
      ]),
      onEnterFrame: (clip) => {
        // AS: DefineSprite_6/frame_1/DoAction.as — this.onEnterFrame
        let angle = clip.vars.angle as number;
        let v = clip.vars.v as number;
        let va = clip.vars.va as number;
        let t = clip.vars.t as number;

        if (Math.floor(Math.random() * 5) === 0) {
          va = 20 * (-0.5 + Math.random());
        }

        clip.scaleX = (v * 10) / 100;

        t *= 0.999;
        angle += va;

        const angleRad = angle * 0.017453292519943295;
        const vx = Math.abs(v * Math.cos(angleRad));
        const vy = v * Math.sin(angleRad);

        clip.x += vx;
        clip.y += vy;

        v *= 0.95;
        clip.rotation = (angle * Math.PI) / 180;

        clip.vars.angle = angle;
        clip.vars.v = v;
        clip.vars.va = va;
        clip.vars.t = t;
      },
    };

    // ---- DefineSprite_4 — scaling drifting particle inside shoot -
    // AS: DefineSprite_4/frame_1/DoAction.as
    // Seeds angle from grandparent, v, va, t=70+random(30); scales
    // down (t*=0.975) and drifts outward with angular wobble.
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
            // AS: DefineSprite_4/frame_1/DoAction.as
            // angle = _parent._parent.angle
            // v = 0.67 + random(5)
            // va = 20 * (-0.5 + Math.random())
            // t = 70 + random(30)
            const root = clip.parent?.parent;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            clip.vars.angle = angleDeg;
            clip.vars.v = 0.67 + Math.floor(Math.random() * 5);
            clip.vars.va = 20 * (-0.5 + Math.random());
            clip.vars.t = 70 + Math.floor(Math.random() * 30);
          },
        ],
      ]),
      onEnterFrame: (clip) => {
        // AS: DefineSprite_4/frame_1/DoAction.as — this.onEnterFrame
        let angle = clip.vars.angle as number;
        let v = clip.vars.v as number;
        let va = clip.vars.va as number;
        let t = clip.vars.t as number;

        if (Math.floor(Math.random() * 3) === 1) {
          va = 20 * (-0.5 + Math.random());
        }

        clip.scaleX = t / 100;
        clip.scaleY = t / 100;

        t *= 0.975;
        angle += va;

        const angleRad = angle * 0.017453292519943295;
        const vx = Math.abs(v * Math.cos(angleRad));
        const vy = v * Math.sin(angleRad);

        clip.x += vx;
        clip.y += vy;

        v *= 0.95;

        clip.vars.angle = angle;
        clip.vars.v = v;
        clip.vars.va = va;
        clip.vars.t = t;
      },
    };

    // ---- move — container with a flickering-alpha child ----------
    // AS: DefineSprite_9_move/frame_1/PlaceObject2_3_1/
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    // The child placed at depth 1 inside move flickers its own alpha
    // each frame. We model the child as an inline symbol registered
    // under the harness-conventional "move" name. The child's
    // onEnterFrame does: _alpha = 50 + random(50).
    // Since the harness for ProjectileLinear doesn't drive a move
    // animation, we register move as a minimal container so it's
    // present if the harness resolves it.
    const moveChildSym: SymbolDefinition = {
      name: "moveChild",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS: DefineSprite_9_move/frame_1/PlaceObject2_3_1/
        //     CLIPACTIONRECORD onClipEvent(enterFrame).as
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
            // Place the child that flickers alpha each frame
            clip.attach(moveChildSym, "child1", 1, ctx);
          },
        ],
      ]),
    };

    // ---- shoot — 74-frame animated impact at target --------------
    // AS: DefineSprite_8_shoot
    //   frame_4/DoAction.as: _rotation = 0
    //   frame_39/PlaceObject2_7_1/onClipEvent(enterFrame): _parent._alpha -= 3.34
    //     (a child placed at frame_39 whose enterFrame decrements shoot's alpha)
    //   frame_72/DoAction.as: stop(); _parent.removeMovieClip()
    //
    // The frame_39 clip event is modelled as shoot's own onEnterFrame
    // that starts decrementing alpha once frame 38 (0-based) is reached,
    // matching the canonical "child placed at frame 39 whose every-frame
    // enterFrame fires from that point on".
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 74,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      onEnterFrame: (clip) => {
        // AS: DefineSprite_8_shoot/frame_39/PlaceObject2_7_1/
        //     CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _parent._alpha -= 3.34
        // The child is placed at frame_39 (0-based: 38), so alpha
        // decrement starts from frame 38 onward.
        if (clip.currentFrame >= 38) {
          clip.alpha = Math.max(0, clip.alpha - 3.34 / 100);
        }
      },
      frameScripts: new Map([
        [
          3,
          (clip) => {
            // AS: DefineSprite_8_shoot/frame_4/DoAction.as
            // _rotation = 0
            // Cancels the velocity-angle rotation the harness applied.
            clip.rotation = 0;
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
    this.registry.register(moveChildSym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // AS: frame_1/DoAction.as
    // SOMA.playSound("m_panda_spell_a");
    callbacks.playSound("m_panda_spell_a");
  }
}
