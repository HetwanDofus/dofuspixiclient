/**
 * Spell 2056 — Unknown spell (likely a Sacrier/Iop ground-impact effect).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2056/scripts/scripts/
 *
 * displayType=51 (WorldAbsoluteAlt). Detected because:
 *   - DefineSprite_3/frame_1 reads `_parent.cellFrom.x` / `_parent.cellFrom.y`
 *     and `_parent.angle` — caster-anchored sprite.
 *   - DefineSprite_8/frame_1 reads `_parent.cellTo.x` / `_parent.cellTo.y`
 *     — target-anchored sprite.
 *   - Both sprites position themselves in world coords → WorldAbsolute pattern.
 *
 * Canonical AS layout:
 *   - main timeline: 2 frames. frame_2/DoAction.as → stop().
 *     frame_1 implicitly places sprite_3 (caster beam) and sprite_8 (target impact).
 *
 *   - DefineSprite_3 (sprite_3) — 24-frame caster-side beam/arrow:
 *       frame_1: rotate to _parent.angle, position at cellFrom.
 *       frame_22: stop().
 *
 *   - DefineSprite_8 (sprite_8) — 144-frame target-side impact composite:
 *       frame_1: call this.end() → signalHit; position self at cellTo.
 *       frame_7: places a bouncing particle (PlaceObject2_5_1) with
 *                onClipEvent(load) and onClipEvent(enterFrame).
 *       frame_109: places a fading overlay (PlaceObject2_7_3) with
 *                  onClipEvent(enterFrame) that subtracts alpha.
 *       frame_142: _parent.removeMovieClip(); stop() → spell complete.
 *
 * Library symbols:
 *   - "sprite_3" — caster beam, 24 frames. frame_1 positions at cellFrom +
 *     rotates to angle. frame_22 stops.
 *   - "sprite_8" — target impact composite, 144 frames. Drives signalHit on
 *     frame_1, attaches bounce particle on frame_7, attaches fade overlay on
 *     frame_109, removes self and calls complete() on frame_142.
 *   - "bounceParticle" (internal, mapped to PlaceObject2_5_1 sprite inside
 *     sprite_8): onLoad seeds physics vars; onEnterFrame runs gravity/bounce.
 *   - "fadeOverlay" (internal, mapped to PlaceObject2_7_3 sprite inside
 *     sprite_8): onEnterFrame decrements alpha by 10/100 per tick.
 *
 * Main timeline: no sound found in frame_2/DoAction.as; only stop().
 *
 * Note on manifest: `librarySymbols` is absent/empty — ALL symbols live in
 * `animations[]` only. Therefore textures are accessed WITHOUT the `lib_`
 * prefix, using bare animation names: "sprite_3", "sprite_8".
 * The bounceParticle and fadeOverlay are sub-sprites inside sprite_8's
 * authored composite frames — they are driven by clip events at runtime
 * and are modelled as container-only SymbolDefinitions (frames: []).
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

// Bounds from manifest animations[] entries (no librarySymbols present).
const SPRITE_3_BOUNDS = {
  width: 105.95,
  height: 0.1,
  offsetX: 0,
  offsetY: -0.1,
};

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
    _context: SpellContext,
  ): void {
    const sprite3Anchor = calculateAnchor(SPRITE_3_BOUNDS);
    const sprite8Anchor = calculateAnchor(SPRITE_8_BOUNDS);

    // ---- bounceParticle — gravity-bounce particle attached at frame_7 ----
    // This is the sprite placed by DefineSprite_8/frame_7/PlaceObject2_5_1.
    // It has no authored visual content of its own — it is a container whose
    // clip events drive physics. frames: [] because it is container-only.
    //
    // AS: DefineSprite_8/frame_7/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
    const bounceParticleSym: SymbolDefinition = {
      name: "bounceParticle",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: g = 0.83; amp = 2.5;
        // AS: vx = 2 * amp * (-0.5 + Math.random());
        // AS: vy = amp * (-0.5 + Math.random());
        // AS: f = -5 - random(5);
        // AS: vrot = -100 + random(200);
        clip.vars.g = 0.83;
        clip.vars.amp = 2.5;
        const amp = clip.vars.amp as number;
        clip.vars.vx = 2 * amp * (-0.5 + Math.random());
        clip.vars.vy = amp * (-0.5 + Math.random());
        clip.vars.f = -5 - Math.floor(Math.random() * 5);
        clip.vars.vrot = -100 + Math.floor(Math.random() * 200);
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_8/frame_7/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // AS: _rotation == vrot;   ← NOTE: this is == (comparison), NOT =.
        //     This is a canonical AS2 no-op (equality check result discarded).
        //     We faithfully reproduce it as a no-op.
        // AS: _parent._x += vx;
        // AS: _parent._y += vy;
        // AS: _Y = _Y + (f += g);
        // AS: if(_Y > 0) { bounce logic }
        const g = clip.vars.g as number;
        let amp = clip.vars.amp as number;
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        let f = clip.vars.f as number;

        // _rotation == vrot → no-op (comparison, not assignment)

        // _parent._x += vx  — move the parent container (sprite_8 sub-clip)
        const parent = clip.parent;
        if (parent) {
          parent.x += vx;
          parent.y += vy;
        }

        // _Y = _Y + (f += g)
        f += g;
        clip.y += f;

        // Bounce when hitting ground (y > 0 in Flash local coords)
        if (clip.y > 0) {
          // AS: vrot *= 0.5;
          // AS: _Y = 0;
          // AS: f = (-f) / 2;
          // AS: amp *= 0.6;
          // AS: vx = amp * (-0.5 + Math.random());
          // AS: vy = amp * (-0.5 + Math.random());
          clip.vars.vrot = (clip.vars.vrot as number) * 0.5;
          clip.y = 0;
          f = (-f) / 2;
          amp *= 0.6;
          vx = amp * (-0.5 + Math.random());
          vy = amp * (-0.5 + Math.random());
        }

        clip.vars.f = f;
        clip.vars.amp = amp;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
      },
    };

    // ---- fadeOverlay — alpha-fade overlay attached at frame_109 ----
    // Placed by DefineSprite_8/frame_109/PlaceObject2_7_3 with only
    // an onClipEvent(enterFrame) that reduces parent alpha.
    // frames: [] — container-only.
    //
    // AS: DefineSprite_8/frame_109/PlaceObject2_7_3/CLIPACTIONRECORD onClipEvent(enterFrame).as
    const fadeOverlaySym: SymbolDefinition = {
      name: "fadeOverlay",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS: _parent._alpha -= 10;
        // Affects the sprite_8 clip's alpha. 10 in AS 0-100 scale = 0.1 in 0-1.
        const parent = clip.parent;
        if (parent) {
          parent.alpha = Math.max(0, parent.alpha - 10 / 100);
        }
      },
    };

    // ---- sprite_3 — caster-side beam/arrow (24 frames) ----
    // AS: DefineSprite_3/frame_1/DoAction.as
    //   _rotation = _parent.angle;
    //   _X = _parent.cellFrom.x;
    //   _Y = _parent.cellFrom.y;
    // AS: DefineSprite_3/frame_22/DoAction.as
    //   stop();
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
            // AS: DefineSprite_3/frame_22/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_8 — target-side impact composite (144 frames) ----
    // AS: DefineSprite_8/frame_1/DoAction.as
    //   this.end();           → signalHit
    //   _X = _parent.cellTo.x;
    //   _Y = _parent.cellTo.y;
    // AS: DefineSprite_8/frame_7 places bounceParticle (PlaceObject2_5_1)
    // AS: DefineSprite_8/frame_109 places fadeOverlay (PlaceObject2_7_3)
    // AS: DefineSprite_8/frame_142/DoAction.as
    //   _parent.removeMovieClip(); stop(); → complete
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
            // this.end() → signalHit (damage popup at target)
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
            // AS: DefineSprite_8/frame_7 — PlaceObject2_5_1 places bounceParticle
            // Attach the bounce particle at depth 1 inside sprite_8.
            clip.attach(bounceParticleSym, "bounceParticle", 1, ctx);
          },
        ],
        [
          108,
          (clip, ctx) => {
            // AS: DefineSprite_8/frame_109 — PlaceObject2_7_3 places fadeOverlay
            // Attach the fade overlay at depth 3 inside sprite_8.
            clip.attach(fadeOverlaySym, "fadeOverlay", 3, ctx);
          },
        ],
        [
          141,
          (clip) => {
            // AS: DefineSprite_8/frame_142/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(bounceParticleSym);
    this.registry.register(fadeOverlaySym);
    this.registry.register(this.sprite3Sym);
    this.registry.register(this.sprite8Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: frame_2/DoAction.as → stop() only; no sound.
    // Implicit frame_1 placement of sprite_3 (caster beam) and
    // sprite_8 (target impact) on the main timeline.
    this.root.attach(this.sprite3Sym, "sprite_3", 1, context);
    this.root.attach(this.sprite8Sym, "sprite_8", 2, context);
  }
}
