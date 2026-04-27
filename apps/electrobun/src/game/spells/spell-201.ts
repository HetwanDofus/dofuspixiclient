/**
 * Spell 201 — Griffes (Iop claw strike).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/201/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell is a pure impact at the target cell:
 * no projectile motion, no caster reference, no dual-anchor. The outer mc
 * sits at target and the top-level child (DefineSprite_6 / DefineSprite_7)
 * plays out there. No `move`/`shoot`/`duplicate` symbols exist, so no
 * ballistic or beam harness applies.
 *
 * AS layout:
 *   - frame_1/DoAction.as: SOMA.playSound("crockette_201")
 *   - DefineSprite_3: a scrolling particle with `onEnterFrame` physics
 *       (_X decrements, _alpha fades). Placed directly on the main timeline.
 *   - DefineSprite_6: 13+-frame scratch container. Frame 1 positions self
 *       randomly (Y in [-40, 0]) and stops if cpt > 6. Frame 7 plays sound
 *       "lance02". Frame 13 attachMovies a "griffes" symbol at the cpt index,
 *       copies _y and _rotation to it, increments cpt.
 *   - DefineSprite_7: 163-frame outer container that holds two placed instances
 *       of DefineSprite_6 (PlaceObject2_6_1 and PlaceObject2_6_3) plus the
 *       DefineSprite_3 particle. Frame_1 sets cpt=0. Frame_163 calls
 *       _parent.removeMovieClip() + signals completion.
 *   - DefineSprite_4_griffes (lib symbol "griffes"): 30-frame claw animation.
 *       Frame 28 removes itself and stops.
 *
 * PlaceObject2_6_1 (first scratch instance inside DefineSprite_7):
 *   onLoad: _rotation = random(90)+135; swapDepths(1100)
 *   onEnterFrame: if currentFrame==1 → _rotation = random(90)+135
 *
 * PlaceObject2_6_3 (second scratch instance inside DefineSprite_7):
 *   onLoad: _rotation = random(90)-45; gotoAndPlay(18); swapDepths(1000)
 *   onEnterFrame: if currentFrame==1 → _rotation = random(90)-45
 *
 * DefineSprite_3 (particle):
 *   frame_1: v = 1.6 + random(5); va = 3;
 *   onEnterFrame: _X -= (v /= 1.4); _alpha -= va;
 *
 * signalHit: at DefineSprite_6 frame_13 (when the claw stamps the target).
 * complete: at DefineSprite_7 frame_163 (_parent.removeMovieClip).
 *
 * Library symbols:
 *   - lib_griffes — 30-frame claw strike. frame_28 removes itself.
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

const GRIFFES_BOUNDS = {
  width: 61.25,
  height: 38.45,
  offsetX: -24.3,
  offsetY: -21.6,
};

export class Spell201 extends RuntimeSpell {
  readonly spellId = 201;
  readonly displayType = SpellDisplayType.TargetCell;

  // Hold references so onSpellStart can attach them
  private griffesSym!: SymbolDefinition;
  private sprite3Sym!: SymbolDefinition;
  private sprite6Sym!: SymbolDefinition;
  private sprite7Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const griffesAnchor = calculateAnchor(GRIFFES_BOUNDS);

    // ---- lib_griffes — 30-frame claw stamp ----------------------
    // AS: DefineSprite_4_griffes/frame_28/DoAction.as
    //   removeMovieClip(this); stop();
    this.griffesSym = {
      name: "griffes",
      totalFrames: 30,
      frames: textures.getFrames("lib_griffes"),
      anchorX: griffesAnchor.x,
      anchorY: griffesAnchor.y,
      frameScripts: new Map([
        [
          27,
          (clip) => {
            // AS DefineSprite_4_griffes/frame_28/DoAction.as
            clip.remove();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- DefineSprite_3 — leftward-drifting particle ------------
    // AS DefineSprite_3/frame_1/DoAction.as:
    //   v = 1.6 + random(5);
    //   va = 3;
    //   onEnterFrame: _X -= (v /= 1.4); _alpha -= va;
    // Placed directly on DefineSprite_7's main timeline.
    this.sprite3Sym = {
      name: "sprite3",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_3/frame_1/DoAction.as — initial seed
        clip.vars.v = 1.6 + Math.floor(Math.random() * 5);
        clip.vars.va = 3;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_3/frame_1/DoAction.as — onEnterFrame lambda
        let v = clip.vars.v as number;
        const va = clip.vars.va as number;
        v = v / 1.4;
        clip.x -= v;
        clip.vars.v = v;
        clip.alpha = clip.alpha - va / 100;
      },
    };

    // ---- DefineSprite_6 — scratch-launcher sub-clip -------------
    // This container is placed TWICE inside DefineSprite_7, with
    // different initial rotations (PlaceObject2_6_1 and PlaceObject2_6_3).
    // The two instances share the same authored timeline but differ only
    // in their onLoad rotation and gotoAndPlay offset.
    // We model this as a single SymbolDefinition and attach it twice with
    // different onLoad overrides via the transform + vars trick in the
    // parent's frameScripts.
    //
    // AS DefineSprite_6/frame_1/DoAction.as:
    //   _Y = random(40) - 40;
    //   if (_parent.cpt > 6) { stop(); }
    //
    // AS DefineSprite_6/frame_7/DoAction.as:
    //   SOMA.playSound("lance02");
    //
    // AS DefineSprite_6/frame_13/DoAction.as:
    //   _parent.attachMovie("griffes","griffes"+_parent.cpt, _parent.cpt+100);
    //   eval("_parent.griffes"+_parent.cpt)._y = _Y;
    //   eval("_parent.griffes"+_parent.cpt)._rotation = _rotation;
    //   _parent.cpt = _parent.cpt + 1;
    //
    // signalHit fires here (first stamp of the claw marks the hit).
    this.sprite6Sym = {
      name: "sprite6",
      totalFrames: 30,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_6/frame_1/DoAction.as
            const yOff = Math.floor(Math.random() * 40) - 40;
            clip.y = yOff;
            const parent = clip.parent;
            const cpt = (parent?.vars.cpt as number) ?? 0;
            if (cpt > 6) {
              clip.stop();
            }
          },
        ],
        [
          6,
          () => {
            // AS DefineSprite_6/frame_7/DoAction.as
            // Sound played here; we capture callbacks in onSpellStart.
            if (this.soundCallback) {
              this.soundCallback("lance02");
            }
          },
        ],
        [
          12,
          (clip, ctx) => {
            // AS DefineSprite_6/frame_13/DoAction.as
            const parent = clip.parent;
            if (!parent) {
              return;
            }
            const cpt = (parent.vars.cpt as number) ?? 0;
            const instanceName = `griffes${cpt}`;
            const attached = parent.attach(
              this.griffesSym,
              instanceName,
              cpt + 100,
              ctx,
            );
            // Mirror: eval("_parent.griffes"+cpt)._y = _Y
            attached.y = clip.y;
            // Mirror: eval("_parent.griffes"+cpt)._rotation = _rotation
            attached.rotation = clip.rotation;
            parent.vars.cpt = cpt + 1;
            // Signal hit on the first claw stamp (canonical impact moment).
            if (cpt === 0) {
              this.runtime.signalHit();
            }
          },
        ],
      ]),
    };

    // ---- DefineSprite_7 — outer 163-frame envelope --------------
    // frame_1: cpt = 0
    //   Also implicitly places PlaceObject2_6_1, PlaceObject2_6_3, and
    //   the particle (sprite3). We handle their onLoad offsets here.
    //
    // PlaceObject2_6_1 onClipEvent(load):
    //   _rotation = random(90) + 135; swapDepths(1100)
    // PlaceObject2_6_1 onClipEvent(enterFrame):
    //   if (this._currentframe == 1) { _rotation = random(90)+135; }
    //
    // PlaceObject2_6_3 onClipEvent(load):
    //   _rotation = random(90) - 45; gotoAndPlay(18); swapDepths(1000)
    // PlaceObject2_6_3 onClipEvent(enterFrame):
    //   if (this._currentframe == 1) { _rotation = random(90)-45; }
    //
    // frame_163: _parent.removeMovieClip(); stop();
    //
    // The two sprite6 instances share the same symbol definition but
    // their onLoad behaviour differs only in initial rotation and
    // optional gotoAndPlay. We attach them in frame_1 of sprite7 and
    // set vars so their own frame_0 script can read the initial values.
    // Because SpellClip.attach runs onLoad and then frameScripts[0],
    // we seed the rotation via post-attach assignment to clip.rotation
    // (which is what canonical AS does in clip events, NOT frame_0).
    //
    // We implement the two clip-event behaviours as separate
    // SymbolDefinition instances with different onLoad/onEnterFrame so
    // both sets of canonical events are accurately reproduced.

    // Instance 1 (PlaceObject2_6_1): rotation = random(90)+135
    const sprite6Instance1Sym: SymbolDefinition = {
      name: "sprite6_1",
      totalFrames: 30,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_7/PlaceObject2_6_1/onClipEvent(load)
        const rot = Math.floor(Math.random() * 90) + 135;
        clip.rotation = (rot * Math.PI) / 180;
        // swapDepths(1100) — reflected as zIndex in the Pixi container
        clip.container.zIndex = 1100;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_7/PlaceObject2_6_1/onClipEvent(enterFrame)
        if (clip.currentFrame === 0) {
          const rot = Math.floor(Math.random() * 90) + 135;
          clip.rotation = (rot * Math.PI) / 180;
        }
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_6/frame_1/DoAction.as
            const yOff = Math.floor(Math.random() * 40) - 40;
            clip.y = yOff;
            const parent = clip.parent;
            const cpt = (parent?.vars.cpt as number) ?? 0;
            if (cpt > 6) {
              clip.stop();
            }
          },
        ],
        [
          6,
          () => {
            // AS DefineSprite_6/frame_7/DoAction.as
            if (this.soundCallback) {
              this.soundCallback("lance02");
            }
          },
        ],
        [
          12,
          (clip, ctx) => {
            // AS DefineSprite_6/frame_13/DoAction.as
            const parent = clip.parent;
            if (!parent) {
              return;
            }
            const cpt = (parent.vars.cpt as number) ?? 0;
            const instanceName = `griffes${cpt}`;
            const attached = parent.attach(
              this.griffesSym,
              instanceName,
              cpt + 100,
              ctx,
            );
            attached.y = clip.y;
            attached.rotation = clip.rotation;
            parent.vars.cpt = cpt + 1;
            if (cpt === 0) {
              this.runtime.signalHit();
            }
          },
        ],
      ]),
    };

    // Instance 2 (PlaceObject2_6_3): rotation = random(90)-45, gotoAndPlay(18)
    const sprite6Instance2Sym: SymbolDefinition = {
      name: "sprite6_3",
      totalFrames: 30,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_7/PlaceObject2_6_3/onClipEvent(load)
        const rot = Math.floor(Math.random() * 90) - 45;
        clip.rotation = (rot * Math.PI) / 180;
        clip.gotoAndPlay(17); // AS gotoAndPlay(18) → 0-based index 17
        // swapDepths(1000)
        clip.container.zIndex = 1000;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_7/PlaceObject2_6_3/onClipEvent(enterFrame)
        if (clip.currentFrame === 0) {
          const rot = Math.floor(Math.random() * 90) - 45;
          clip.rotation = (rot * Math.PI) / 180;
        }
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_6/frame_1/DoAction.as
            const yOff = Math.floor(Math.random() * 40) - 40;
            clip.y = yOff;
            const parent = clip.parent;
            const cpt = (parent?.vars.cpt as number) ?? 0;
            if (cpt > 6) {
              clip.stop();
            }
          },
        ],
        [
          6,
          () => {
            // AS DefineSprite_6/frame_7/DoAction.as
            if (this.soundCallback) {
              this.soundCallback("lance02");
            }
          },
        ],
        [
          12,
          (clip, ctx) => {
            // AS DefineSprite_6/frame_13/DoAction.as
            const parent = clip.parent;
            if (!parent) {
              return;
            }
            const cpt = (parent.vars.cpt as number) ?? 0;
            const instanceName = `griffes${cpt}`;
            const attached = parent.attach(
              this.griffesSym,
              instanceName,
              cpt + 100,
              ctx,
            );
            attached.y = clip.y;
            attached.rotation = clip.rotation;
            parent.vars.cpt = cpt + 1;
            if (cpt === 0) {
              this.runtime.signalHit();
            }
          },
        ],
      ]),
    };

    // ---- DefineSprite_7 — outer envelope ------------------------
    // frame_1: cpt = 0; attach sprite6_1, sprite6_3, sprite3
    // frame_163: _parent.removeMovieClip(); stop();
    this.sprite7Sym = {
      name: "sprite7",
      totalFrames: 163,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_7/frame_1/DoAction.as: cpt = 0
            clip.vars.cpt = 0;
            // Attach the two scratch instances (PlaceObject2_6_1 and
            // PlaceObject2_6_3) and the drifting particle (sprite3).
            clip.attach(sprite6Instance1Sym, "scratchA", 2, ctx);
            clip.attach(sprite6Instance2Sym, "scratchB", 3, ctx);
            clip.attach(this.sprite3Sym, "particle", 4, ctx);
          },
        ],
        [
          162,
          (clip) => {
            // AS DefineSprite_7/frame_163/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.griffesSym);
    this.registry.register(this.sprite3Sym);
    this.registry.register(this.sprite6Sym);
    this.registry.register(sprite6Instance1Sym);
    this.registry.register(sprite6Instance2Sym);
    this.registry.register(this.sprite7Sym);
  }

  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS frame_1/DoAction.as: SOMA.playSound("crockette_201")
    callbacks.playSound("crockette_201");
    // Capture for use inside frame_7 of sprite6 instances
    this.soundCallback = callbacks.playSound;
    // Attach the outer envelope at root; it drives the whole spell.
    this.root.attach(this.sprite7Sym, "sprite7", 1, context);
  }
}
