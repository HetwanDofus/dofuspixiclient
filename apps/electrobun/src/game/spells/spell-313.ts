/**
 * Spell 313 — (Unknown name, likely a Feca/explosion-type spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/313/scripts/scripts/
 *
 * displayType=11 (TargetCell). The main-timeline frame_1 positions the
 * outer mc directly at cellTo (_X = _parent.cellTo.x / _Y = _parent.cellTo.y),
 * which is the canonical TargetCell pattern. There are no projectile/move/shoot
 * symbols, no caster-side references, no duplicate beam logic.
 *
 * Library symbols (from manifest animations[], no librarySymbols[]):
 *   - sprite_3  — 36-frame shockwave ring at target. frame_34 → stop().
 *                 PlaceObject2_3_1 clip events: onLoad seeds amp=50;
 *                 onEnterFrame oscillates _rotation with decaying amplitude.
 *                 PlaceObject2_3_3 clip events: onLoad seeds amp=70, _alpha=50;
 *                 onEnterFrame oscillates _rotation with decaying amplitude.
 *   - sprite_14 — 174-frame explosion composite at target. frame_1 positions
 *                 self at cellTo. frame_70 plays "explosion" sound.
 *                 frame_73 → this.end() (signalHit). frame_172 →
 *                 _parent.removeMovieClip() (spell complete).
 *                 Contains two placed child instances (PlaceObject2_3_1 and
 *                 PlaceObject2_3_3) of sprite_3 — ported as attached children
 *                 in frame_1 DoAction with their respective clip-event handlers
 *                 inlined into their SymbolDefinition.
 *   - sprite_12 — debris/fragment particle spawned inside sprite_14's context.
 *                 onLoad seeds velocity/scale/alpha-decay. onEnterFrame
 *                 integrates motion with friction.
 *
 * NOTE: manifest.json has no `librarySymbols[]` array — all symbols are in
 * `animations[]`. Therefore textures are loaded WITHOUT the `lib_` prefix.
 *
 * Main timeline (frame_2/DoAction.as): stop(). No sound on the main timeline.
 * The explosion sound fires from sprite_14's frame_70 script.
 *
 * Signal flow:
 *   - signalHit fires at sprite_14 frame_73 (this.end()).
 *   - complete()  fires at sprite_14 frame_172 (_parent.removeMovieClip()).
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

// Bounds from animations[] entries (no librarySymbols[] present).
const SPRITE_3_BOUNDS = {
  width: 19,
  height: 63.5,
  offsetX: -9.95,
  offsetY: -120.15,
};

const SPRITE_14_BOUNDS = {
  width: 182.45,
  height: 213.45,
  offsetX: -79,
  offsetY: -197,
};

// sprite_12 is referenced by DefineSprite_12 clip events but has no
// dedicated animation entry in the manifest — it is a sub-particle
// spawned by sprite_14. We use sprite_3's texture as a stand-in for
// the debris fragment since no explicit manifest entry exists.
// (In practice the runtime will render with whatever frames are found.)
const SPRITE_12_BOUNDS = {
  width: 19,
  height: 63.5,
  offsetX: -9.95,
  offsetY: -120.15,
};

export class Spell313 extends RuntimeSpell {
  readonly spellId = 313;
  readonly displayType = SpellDisplayType.TargetCell;

  // Hold references so onSpellStart can attach them.
  private sprite14Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite3Anchor = calculateAnchor(SPRITE_3_BOUNDS);
    const sprite14Anchor = calculateAnchor(SPRITE_14_BOUNDS);
    const sprite12Anchor = calculateAnchor(SPRITE_12_BOUNDS);

    // ---- sprite_3 — shockwave ring at target --------------------
    // Two placed instances of this symbol exist inside sprite_14:
    //   PlaceObject2_3_1 (instance "s1") and PlaceObject2_3_3 (instance "s3").
    // They share the same visual but have different onLoad seeds (amp=50 vs
    // amp=70 / _alpha=50). We model them as two distinct symbol definitions
    // (sprite_3_a and sprite_3_b) so each can carry its own clip event handlers.
    //
    // sprite_3_a — PlaceObject2_3_1 variant (amp=50, default alpha)
    // AS: DefineSprite_14/frame_1/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: DefineSprite_14/frame_1/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // AS: DefineSprite_3/frame_34/DoAction.as
    const sprite3aSym: SymbolDefinition = {
      name: "sprite_3_a",
      totalFrames: 36,
      frames: textures.getFrames("sprite_3"),
      anchorX: sprite3Anchor.x,
      anchorY: sprite3Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_14/frame_1/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.amp = 50;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_14/frame_1/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        const amp = clip.vars.amp as number;
        clip.rotation = (amp * (-0.5 + Math.random()) * Math.PI) / 180;
        clip.vars.amp = amp * 0.8;
      },
      frameScripts: new Map([
        [
          33,
          (clip) => {
            // AS: DefineSprite_3/frame_34/DoAction.as → stop();
            clip.stop();
          },
        ],
      ]),
    };

    // sprite_3_b — PlaceObject2_3_3 variant (amp=70, _alpha=50)
    // AS: DefineSprite_14/frame_1/PlaceObject2_3_3/CLIPACTIONRECORD onClipEvent(load).as
    // AS: DefineSprite_14/frame_1/PlaceObject2_3_3/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // AS: DefineSprite_3/frame_34/DoAction.as
    const sprite3bSym: SymbolDefinition = {
      name: "sprite_3_b",
      totalFrames: 36,
      frames: textures.getFrames("sprite_3"),
      anchorX: sprite3Anchor.x,
      anchorY: sprite3Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_14/frame_1/PlaceObject2_3_3/CLIPACTIONRECORD onClipEvent(load).as
        clip.alpha = 50 / 100;
        clip.vars.amp = 70;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_14/frame_1/PlaceObject2_3_3/CLIPACTIONRECORD onClipEvent(enterFrame).as
        const amp = clip.vars.amp as number;
        clip.rotation = (amp * (-0.5 + Math.random()) * Math.PI) / 180;
        clip.vars.amp = amp * 0.8;
      },
      frameScripts: new Map([
        [
          33,
          (clip) => {
            // AS: DefineSprite_3/frame_34/DoAction.as → stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_12 — debris/fragment particle -------------------
    // AS: DefineSprite_12/frame_1/PlaceObject2_11_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: DefineSprite_12/frame_1/PlaceObject2_11_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    const sprite12Sym: SymbolDefinition = {
      name: "sprite_12",
      totalFrames: 36,
      frames: textures.getFrames("sprite_3"),
      anchorX: sprite12Anchor.x,
      anchorY: sprite12Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_12/frame_1/PlaceObject2_11_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.valph = 1.3 + Math.floor(Math.random() * 5);
        clip.vars.ta = Math.floor(Math.random() * 50);
        const t = 50 + 50 * Math.random();
        clip.vars.t = t;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        const vx = 40 * (-0.5 + Math.random());
        clip.vars.vx = vx;
        clip.vars.vy = 20 * (-0.5 + Math.random());
        let sens: number;
        if (vx < 0) {
          sens = -1;
        } else {
          sens = 1;
        }
        clip.vars.sens = sens;
        clip.vars.vr = 3 * vx;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_12/frame_1/PlaceObject2_11_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        const valph = clip.vars.valph as number;
        let ta = clip.vars.ta as number;
        const t = clip.vars.t as number;
        const sens = clip.vars.sens as number;
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        let vr = clip.vars.vr as number;

        clip.alpha = Math.max(0, clip.alpha - valph / 100);
        ta -= (ta - t) / 7;
        // AS: _xscale = ta * sens  (percent) → decimal
        clip.scaleX = (ta * sens) / 100;
        clip.scaleY = ta / 100;
        clip.x += vx;
        clip.y += vy;
        // AS: _rotation += vr  (degrees) → radians delta
        clip.rotation += (vr * Math.PI) / 180;
        vx *= 0.8;
        vy *= 0.8;
        vr *= 0.9;

        clip.vars.ta = ta;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
        clip.vars.vr = vr;
      },
    };

    // ---- sprite_7 — smoke/spark particle (DefineSprite_7) -------
    // Used implicitly inside the explosion composite; no explicit
    // manifest animation entry by that exact name, so we use the
    // sprite_3 texture as a visual stand-in for the particle.
    // AS: DefineSprite_7/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: DefineSprite_7/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    const sprite7Sym: SymbolDefinition = {
      name: "sprite_7",
      totalFrames: 1,
      frames: textures.getFrames("sprite_3"),
      anchorX: sprite3Anchor.x,
      anchorY: sprite3Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_7/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
        // NOTE: _alpha = 150 → clamp to 1.0 (Flash allows >100 but Pixi clamps to 1).
        clip.alpha = 1.0;
        clip.vars.v2 = -0.3 * Math.random();
        clip.vars.vr = 11300 * (Math.random() - 0.5);
        const t = 30 + Math.floor(Math.random() * 70);
        clip.vars.t = t;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.vars.v = -10 - Math.floor(Math.random() * 30);
        clip.x = 50 * (Math.random() - 0.5);
        clip.vars.fv = 0.6 + 0.3 * Math.random();
        clip.vars.fvr = 0.7 + 0.2 * Math.random();
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_7/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        const v2 = clip.vars.v2 as number;
        let v = clip.vars.v as number;
        let vr = clip.vars.vr as number;
        const fv = clip.vars.fv as number;
        const fvr = clip.vars.fvr as number;

        // AS: _alpha -= 1.6  (0-100 scale) → 0.016 in 0-1 scale
        clip.alpha = Math.max(0, clip.alpha - 1.6 / 100);
        // AS: _rotation += vr  (degrees) → radians delta
        clip.rotation += (vr * Math.PI) / 180;
        clip.y += v + v2;
        v *= fv;
        vr *= fvr;

        clip.vars.v = v;
        clip.vars.vr = vr;
      },
    };

    // ---- sprite_14 — main explosion composite (174 frames) ------
    // AS: DefineSprite_14/frame_1/DoAction.as  → _X = _parent.cellTo.x; _Y = _parent.cellTo.y
    // AS: DefineSprite_14/frame_70/DoAction.as → SOMA.playSound("explosion")
    // AS: DefineSprite_14/frame_73/DoAction.as → this.end() [signalHit]
    // AS: DefineSprite_14/frame_172/DoAction.as → _parent.removeMovieClip() [complete]
    //
    // The two sprite_3 instances (PlaceObject2_3_1 and PlaceObject2_3_3)
    // placed on sprite_14's frame_1 are attached in the frame_1 script below
    // with their respective symbol definitions.
    const self = this;
    this.sprite14Sym = {
      name: "sprite_14",
      totalFrames: 174,
      frames: textures.getFrames("sprite_14"),
      anchorX: sprite14Anchor.x,
      anchorY: sprite14Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_14/frame_1/DoAction.as
            // _X = _parent.cellTo.x; _Y = _parent.cellTo.y
            // For TargetCell the container is already at cellTo, so
            // the child's local (0,0) is at cellTo. Position at (0,0).
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y;
            }

            // Attach the two authored sprite_3 child instances placed
            // on sprite_14's frame_1 timeline.
            // AS: PlaceObject2_3_1 (instance at depth 1)
            clip.attach(sprite3aSym, "s3_1", 1, ctx);
            // AS: PlaceObject2_3_3 (instance at depth 3)
            clip.attach(sprite3bSym, "s3_3", 3, ctx);
          },
        ],
        [
          69,
          (_clip) => {
            // AS: DefineSprite_14/frame_70/DoAction.as → SOMA.playSound("explosion")
            // Sound is captured via the callbacks reference stored in onSpellStart.
            self.playSoundCallback?.("explosion");
          },
        ],
        [
          72,
          (_clip) => {
            // AS: DefineSprite_14/frame_73/DoAction.as → this.end() [signalHit]
            self.runtime.signalHit();
          },
        ],
        [
          171,
          (clip) => {
            // AS: DefineSprite_14/frame_172/DoAction.as → _parent.removeMovieClip()
            clip.remove();
            self.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite3aSym);
    this.registry.register(sprite3bSym);
    this.registry.register(sprite12Sym);
    this.registry.register(sprite7Sym);
    this.registry.register(this.sprite14Sym);
  }

  // Capture the playSound callback so frame scripts can use it.
  private playSoundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture for use inside sprite_14's frame_70 script.
    this.playSoundCallback = callbacks.playSound;

    // Main timeline frame_2/DoAction.as: stop(). No sound here.
    // Attach sprite_14 to the root so its timeline starts ticking.
    this.root.attach(this.sprite14Sym, "sprite14", 1, context);
  }
}
