/**
 * Spell 1209 — (Unknown name, likely a Feca/Osamodas-type impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1209/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no `move`/`shoot` pair, no
 * `duplicate`, no `_parent.cellFrom`/`cellTo` world-positioning. The
 * spell is a single impact at the target cell. sprite_7 is a 117-frame
 * composite impact animation; sprite_6 is a 2-frame particle sprite
 * whose frame_1 seeds physics via an onEnterFrame closure and frame_2
 * stops. The main timeline frame_2 stops — so the outer mc idles while
 * sprite_7 and however-many sprite_6 particles run. sprite_7 frame_115
 * calls `_parent.removeMovieClip()` to signal completion.
 *
 * Library symbols (librarySymbols[] is absent in manifest — all content
 * comes from `animations[]`):
 *   - sprite_6  — 2-frame drift particle. frame_1 seeds angle/v/va/t
 *                 and installs an onEnterFrame for physics (oscillating
 *                 angle, decaying speed, position integration, scale).
 *                 frame_2 stops the clip.
 *   - sprite_7  — 117-frame composite impact timeline. frame_115
 *                 calls _parent.removeMovieClip(), which we map to
 *                 runtime.complete().
 *
 * NOTE: manifest has no `librarySymbols[]` array — textures are under
 * bare names ("sprite_6", "sprite_7"), NOT "lib_sprite_6" / "lib_sprite_7".
 *
 * Main timeline: frame_2/DoAction.as → stop(). We call
 * `this.runtime.signalHit()` at sprite_7 frame_1 (first visible impact
 * frame) since displayType=11 and no explicit hit frame is authored.
 * Completion fires from sprite_7 frame_114 (= AS frame_115).
 *
 * The canonical AS for sprite_6/frame_1 does NOT use attachMovie — it
 * defines an onEnterFrame on `this`. In the original SWF, sprite_6
 * instances are presumably attached by the main timeline (or sprite_7
 * internals) via attachMovie("sprite_6", ...). Since the AS we have for
 * the main timeline only has `stop()` and sprite_7/frame_115 only has
 * `_parent.removeMovieClip()`, the particle spawning appears to be
 * driven by sprite_7's authored content (a composite timeline). We
 * register sprite_6 so it can be resolved if sprite_7's composite
 * references it at runtime, and attach sprite_7 directly in
 * onSpellStart.
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

const SPRITE_6_BOUNDS = {
  width: 41.25,
  height: 10,
  offsetX: -20,
  offsetY: -5,
};

const SPRITE_7_BOUNDS = {
  width: 187.9,
  height: 187.9,
  offsetX: -95.7,
  offsetY: -109.7,
};

export class Spell1209 extends RuntimeSpell {
  readonly spellId = 1209;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite6Sym!: SymbolDefinition;
  private sprite7Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite6Anchor = calculateAnchor(SPRITE_6_BOUNDS);
    const sprite7Anchor = calculateAnchor(SPRITE_7_BOUNDS);

    // ---- sprite_6 — oscillating drift particle -------------------
    // AS: scripts/DefineSprite_6/frame_1/DoAction.as
    //   Seeds angle, v, va, t on the clip itself, then installs an
    //   onEnterFrame that integrates velocity with angular wobble and
    //   decaying speed.
    //
    // AS: scripts/DefineSprite_6/frame_2/DoAction.as
    //   stop();
    this.sprite6Sym = {
      name: "sprite_6",
      totalFrames: 2,
      frames: textures.getFrames("sprite_6"),
      anchorX: sprite6Anchor.x,
      anchorY: sprite6Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_6/frame_1/DoAction.as
            clip.vars.angle = 360 * Math.random();
            clip.vars.v = 6.67 + Math.floor(Math.random() * 20);
            clip.vars.va = 40 * (-0.5 + Math.random());
            clip.vars.t = 100;

            clip.onEnterFrame = (self) => {
              // AS: if (random(2) == 0) { va = 40 * (-0.5 + Math.random()); }
              if (Math.floor(Math.random() * 2) === 0) {
                self.vars.va = 40 * (-0.5 + Math.random());
              }

              const v = self.vars.v as number;
              let t = self.vars.t as number;
              let angle = self.vars.angle as number;
              const va = self.vars.va as number;

              // AS: _xscale = v * 14
              self.scaleX = (v * 14) / 100;

              // AS: t *= 0.95
              t *= 0.95;
              self.vars.t = t;

              // AS: angle += va
              angle += va;
              self.vars.angle = angle;

              // AS: vx = v * cos(angle * 0.017453...)
              //     vy = v * sin(angle * 0.017453...)
              // angle is in degrees; 0.017453292519943295 = PI/180
              const vx = v * Math.cos(angle * 0.017453292519943295);
              const vy = v * Math.sin(angle * 0.017453292519943295);

              // AS: _X = _X + vx; _Y = _Y + vy
              self.x += vx;
              self.y += vy;

              // AS: v *= 0.9
              self.vars.v = v * 0.9;

              // AS: _rotation = angle  (degrees → radians)
              self.rotation = (angle * Math.PI) / 180;
            };
          },
        ],
        [
          1,
          (clip) => {
            // AS DefineSprite_6/frame_2/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_7 — 117-frame composite impact timeline ----------
    // AS: scripts/DefineSprite_7/frame_115/DoAction.as
    //   _parent.removeMovieClip();
    // frame_115 → 0-based index 114.
    // We also signal hit on the first tick (frame index 0) since this
    // is a TargetCell impact and no earlier dedicated hit frame exists.
    this.sprite7Sym = {
      name: "sprite_7",
      totalFrames: 117,
      frames: textures.getFrames("sprite_7"),
      anchorX: sprite7Anchor.x,
      anchorY: sprite7Anchor.y,
      frameScripts: new Map([
        [
          0,
          () => {
            // First impact frame — signal hit for displayType=11.
            this.runtime.signalHit();
          },
        ],
        [
          114,
          (clip) => {
            // AS DefineSprite_7/frame_115/DoAction.as:
            //   _parent.removeMovieClip();
            // clip is sprite_7; its parent is root (the outer mc).
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite6Sym);
    this.registry.register(this.sprite7Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Main timeline frame_2/DoAction.as: stop()
    // No sound in the canonical scripts. Attach sprite_7 at target
    // (container is already at target cell for displayType=11, so
    // local (0,0) is correct).
    this.root.attach(this.sprite7Sym, "sprite7", 1, context);
  }
}
