/**
 * Spell 1205 — Panda Ivresse (Pandawa).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1205/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear). The spell has a `shoot` symbol
 * (DefineSprite_8_shoot) and a `move` symbol (DefineSprite_9_move). The
 * move symbol has an `onClipEvent(enterFrame)` that pulses alpha, and
 * the shoot symbol drives the impact animation with two inline particle
 * symbols (DefineSprite_6 and DefineSprite_4) placed inside it.
 *
 * Layout:
 *   - `move`        — container placed by the harness at root. Contains
 *                     a sub-sprite (PlaceObject2_3_1) whose enterFrame
 *                     pulses alpha 50-100%.
 *   - `shoot`       — 74-frame container placed by the harness at target
 *                     offset along the rotated caster→target line.
 *                     frame_4 resets rotation to 0 (upright impact).
 *                     Contains a sub-sprite (PlaceObject2_7_1) at frame
 *                     39 whose enterFrame decrements alpha by 3.34/100
 *                     per tick (fade-out).
 *                     frame_72 stops + removes parent → spell complete.
 *   - `sprite6`     — particle (DefineSprite_6): angle-driven drift with
 *                     random angular velocity changes, xscale = v*10.
 *   - `sprite4`     — particle (DefineSprite_4): angle-driven drift with
 *                     scale decay (t *= 0.975).
 *
 * Main timeline: SOMA.playSound("m_panda_spell_a").
 *
 * Because the harness attaches `move` at the caster and `shoot` at the
 * target offset for ProjectileLinear, and shoot's frame_4 resets
 * rotation, the impact animation plays upright. signalHit is NOT called
 * here for the projectile phase (harness doesn't fire it for
 * ProjectileLinear) — we fire it from shoot's frame_4 as the canonical
 * "impact" moment. complete() is fired from shoot's frame_72.
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

export class Spell1205 extends RuntimeSpell {
  readonly spellId = 1205;
  readonly displayType = SpellDisplayType.ProjectileLinear;

  // Store symbols as instance fields so onSpellStart and nested
  // frameScripts can reference them without closure-capture issues.
  private sprite6Sym!: SymbolDefinition;
  private sprite4Sym!: SymbolDefinition;
  private moveSym!: SymbolDefinition;
  private shootSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    // ---- sprite6 (DefineSprite_6) — angle-drift particle -----------
    // AS: scripts/scripts/DefineSprite_6/frame_1/DoAction.as
    // No librarySymbols entry — this is an anonymous sprite placed
    // inside shoot. No texture frames (the particle uses only transform
    // state; its visual content is the baked shoot composite).
    // We treat it as a container-only symbol with dynamic onEnterFrame.
    this.sprite6Sym = {
      name: "sprite6",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      // AS DefineSprite_6/frame_1/DoAction.as — runs as onLoad equivalent
      // (frame_1 script seeds state immediately on creation)
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: angle = _parent._parent.angle;
            //     v = 0.67 + random(5);
            //     va = 20 * (-0.5 + Math.random());
            //     t = 100;
            const root = clip.parent?.parent?.parent ?? clip.parent?.parent;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            clip.vars.angle = angleDeg;
            clip.vars.v = 0.67 + Math.floor(Math.random() * 5);
            clip.vars.va = 20 * (-0.5 + Math.random());
            clip.vars.t = 100;
          },
        ],
      ]),
      // AS DefineSprite_6/frame_1/DoAction.as — this.onEnterFrame = function()
      onEnterFrame: (clip) => {
        // AS:
        //   if(random(5) == 0) { va = 20 * (-0.5 + Math.random()); }
        //   _xscale = v * 10;
        //   t *= 0.999;
        //   angle += va;
        //   vx = Math.abs(v * Math.cos(angle * 0.017453292519943295));
        //   vy = v * Math.sin(angle * 0.017453292519943295);
        //   _X = _X + vx;
        //   _Y = _Y + vy;
        //   v *= 0.95;
        //   _rotation = angle;
        let angle = clip.vars.angle as number;
        let v = clip.vars.v as number;
        let va = clip.vars.va as number;
        let t = clip.vars.t as number;

        if (Math.floor(Math.random() * 5) === 0) {
          va = 20 * (-0.5 + Math.random());
        }
        // _xscale = v * 10  → decimal: v * 10 / 100 = v * 0.1
        clip.scaleX = (v * 10) / 100;
        t *= 0.999;
        angle += va;
        const vx = Math.abs(v * Math.cos(angle * 0.017453292519943295));
        const vy = v * Math.sin(angle * 0.017453292519943295);
        clip.x += vx;
        clip.y += vy;
        v *= 0.95;
        // _rotation = angle (degrees → radians)
        clip.rotation = (angle * Math.PI) / 180;

        clip.vars.angle = angle;
        clip.vars.v = v;
        clip.vars.va = va;
        clip.vars.t = t;
      },
    };

    // ---- sprite4 (DefineSprite_4) — angle-drift particle with scale --
    // AS: scripts/scripts/DefineSprite_4/frame_1/DoAction.as
    this.sprite4Sym = {
      name: "sprite4",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: angle = _parent._parent.angle;
            //     v = 0.67 + random(5);
            //     va = 20 * (-0.5 + Math.random());
            //     t = 70 + random(30);
            const root = clip.parent?.parent?.parent ?? clip.parent?.parent;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            clip.vars.angle = angleDeg;
            clip.vars.v = 0.67 + Math.floor(Math.random() * 5);
            clip.vars.va = 20 * (-0.5 + Math.random());
            clip.vars.t = 70 + Math.floor(Math.random() * 30);
          },
        ],
      ]),
      // AS DefineSprite_4/frame_1/DoAction.as — this.onEnterFrame = function()
      onEnterFrame: (clip) => {
        // AS:
        //   if(random(3) == 1) { va = 20 * (-0.5 + Math.random()); }
        //   _xscale = t;
        //   _yscale = t;
        //   t *= 0.975;
        //   angle += va;
        //   vx = Math.abs(v * Math.cos(angle * 0.017453292519943295));
        //   vy = v * Math.sin(angle * 0.017453292519943295);
        //   _X = _X + vx;
        //   _Y = _Y + vy;
        //   v *= 0.95;
        let angle = clip.vars.angle as number;
        let v = clip.vars.v as number;
        let va = clip.vars.va as number;
        let t = clip.vars.t as number;

        if (Math.floor(Math.random() * 3) === 1) {
          va = 20 * (-0.5 + Math.random());
        }
        // _xscale/_yscale = t (percent) → decimal
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

    // ---- move (DefineSprite_9_move) — projectile container --------
    // Contains a single sub-sprite (PlaceObject2_3_1) whose enterFrame
    // pulses alpha. We model that sub-sprite inline as a container-only
    // anonymous symbol. No texture for move itself (container only).
    //
    // AS: DefineSprite_9_move/frame_1/PlaceObject2_3_1/
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _alpha = 50 + random(50);
    const moveInnerSym: SymbolDefinition = {
      name: "move_inner",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      // AS DefineSprite_9_move/.../onClipEvent(enterFrame)
      onEnterFrame: (clip) => {
        // _alpha = 50 + random(50)  → 0-1 range
        const alphaVal = 50 + Math.floor(Math.random() * 50);
        clip.alpha = alphaVal / 100;
      },
    };

    this.moveSym = {
      name: "move",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: PlaceObject2_3_1 is placed at frame_1 of move.
            // Attach the inner pulsing sub-sprite.
            clip.attach(moveInnerSym, "move_inner", 1, ctx);
          },
        ],
      ]),
    };

    // ---- shoot (DefineSprite_8_shoot) — 74-frame impact -----------
    // Uses the shoot animation frames from manifest.animations[].
    // frame_4: _rotation = 0  (upright override, canonical pattern)
    // frame_39: PlaceObject2_7_1 is placed — its enterFrame fades alpha.
    // frame_72: stop(); _parent.removeMovieClip(); → spell complete.
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // Sub-sprite placed at shoot's frame 39, whose enterFrame
    // decrements alpha by 3.34 each tick.
    // AS: DefineSprite_8_shoot/frame_39/PlaceObject2_7_1/
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _parent._alpha -= 3.34;
    const shootFadeInnerSym: SymbolDefinition = {
      name: "shoot_fade_inner",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      // AS DefineSprite_8_shoot/frame_39/.../onClipEvent(enterFrame)
      onEnterFrame: (clip) => {
        // _parent._alpha -= 3.34  (alpha 0-100 in AS → 0-1 in TS)
        const parent = clip.parent;
        if (parent) {
          parent.alpha = Math.max(0, parent.alpha - 3.34 / 100);
        }
      },
    };

    this.shootSym = {
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
            //   _rotation = 0;
            clip.rotation = 0;
            // Canonical "impact" moment — fire signalHit here for
            // ProjectileLinear (harness does NOT auto-fire it).
            this.runtime.signalHit();
          },
        ],
        [
          38,
          (clip, ctx) => {
            // AS: frame_39 places PlaceObject2_7_1 (fade sprite) on shoot.
            // Attach the fade inner sprite so its onEnterFrame runs.
            if (!clip.children.has("shoot_fade_inner")) {
              // Also spawn the particle symbols at the impact frame.
              // DefineSprite_6 and DefineSprite_4 are placed inside shoot
              // (children of shoot's timeline). Spawn a handful
              // proportional to level.
              const root = clip.parent;
              const level = (root?.vars.level as number) ?? 1;
              const nb6 = 2 + Math.floor(level * 1.5);
              const nb4 = 2 + Math.floor(level * 1.5);
              for (let c = 0; c < nb6; c++) {
                clip.attach(this.sprite6Sym, `sprite6_${c}`, 100 + c, ctx);
              }
              for (let c = 0; c < nb4; c++) {
                clip.attach(this.sprite4Sym, `sprite4_${c}`, 200 + c, ctx);
              }
              clip.attach(shootFadeInnerSym, "shoot_fade_inner", 7, ctx);
            }
          },
        ],
        [
          71,
          (clip) => {
            // AS: DefineSprite_8_shoot/frame_72/DoAction.as
            //   stop();
            //   _parent.removeMovieClip();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite6Sym);
    this.registry.register(this.sprite4Sym);
    this.registry.register(moveInnerSym);
    this.registry.register(this.moveSym);
    this.registry.register(shootFadeInnerSym);
    this.registry.register(this.shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // AS: scripts/scripts/frame_1/DoAction.as
    //   SOMA.playSound("m_panda_spell_a");
    callbacks.playSound("m_panda_spell_a");
  }
}
