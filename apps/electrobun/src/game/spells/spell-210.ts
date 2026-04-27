/**
 * Spell 210 — Griffes de Craqueleur (Crackler Claws).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/210/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no `move`, `shoot`, `duplicate`,
 * or `_parent.cellFrom`/`cellTo` references. It is a pure impact animation at
 * the target cell. A single outer container (DefineSprite_7, 163 frames) drives
 * the whole show, removing itself at frame 163 to signal completion.
 *
 * Symbol layout:
 *
 *   - lib_griffes (DefineSprite_4_griffes, 30 frames) — claw swipe sprite.
 *     frame_28: removeMovieClip(this) + stop(). No onLoad/onEnterFrame.
 *     Spawned dynamically by DefineSprite_6 at frame_13.
 *
 * Container symbols (no rendered frames):
 *
 *   - DefineSprite_6 (unnamed launcher, 13+ frames):
 *       frame_1:  random Y offset ∈ [-40, 0]; if cpt > 6, stop().
 *       frame_7:  SOMA.playSound("lance02").
 *       frame_13: attachMovie("griffes", "griffes"+cpt, cpt+100);
 *                 copy _y and _rotation onto the new griffes clip; cpt++.
 *     This sprite is pre-placed twice on DefineSprite_7's timeline with
 *     clip events that randomise _rotation and stagger the second copy to
 *     start at frame 18.
 *
 *   - DefineSprite_7 (outer container, 163 frames):
 *       frame_1 DoAction: cpt = 0.
 *       Two pre-placed instances of DefineSprite_6 ("g1" at depth 1, "g3"
 *       at depth 3) with clip events:
 *         PlaceObject2_6_1 onLoad:  _rotation = random(90)+135; swapDepths(1100)
 *         PlaceObject2_6_1 onEnterFrame: if frame==1 → re-randomise rotation
 *         PlaceObject2_6_3 onLoad:  _rotation = random(90)-45; gotoAndPlay(18); swapDepths(1000)
 *         PlaceObject2_6_3 onEnterFrame: if frame==1 → re-randomise rotation
 *       frame_163: _parent.removeMovieClip(); stop() → spell complete.
 *
 *   - DefineSprite_3 (unused ambient particle visible on main timeline):
 *       frame_1: v = 1.6+random(5); va=3; onEnterFrame drifts X left + fades alpha.
 *
 * Main timeline (frame_1): SOMA.playSound("crockette_201").
 *
 * signalHit is fired at DefineSprite_6/frame_13 (first time a griffes clip
 * is spawned — i.e. when cpt goes from 0 to 1, which is the first claw impact).
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

export class Spell210 extends RuntimeSpell {
  readonly spellId = 210;
  readonly displayType = SpellDisplayType.TargetCell;

  private griffesSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const griffesAnchor = calculateAnchor(GRIFFES_BOUNDS);

    // ---- lib_griffes — claw swipe sprite (30 frames) -------------
    // AS: DefineSprite_4_griffes/frame_28/DoAction.as
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
            // AS DefineSprite_4_griffes/frame_28/DoAction.as:
            //   removeMovieClip(this); stop();
            clip.remove();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- DefineSprite_6 — claw launcher container (13+ frames) --
    // This symbol is pre-placed twice on DefineSprite_7's timeline.
    // We model it as a registered symbol so it can be attached by the
    // outer container. Its clip-event handlers (load/enterFrame) are
    // baked into the two named instances "g1" and "g3" via the outer
    // container's frameScripts.
    const launcher6Sym: SymbolDefinition = {
      name: "launcher6",
      totalFrames: 13,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_6/frame_1/DoAction.as:
            //   _Y = random(40) - 40;
            //   if (_parent.cpt > 6) { stop(); }
            clip.y = Math.floor(Math.random() * 40) - 40;
            const outerCpt = (clip.parent?.vars.cpt as number) ?? 0;
            if (outerCpt > 6) {
              clip.stop();
            }
          },
        ],
        [
          6,
          (_clip) => {
            // AS DefineSprite_6/frame_7/DoAction.as:
            //   SOMA.playSound("lance02");
            // Sound is stored; we capture the callback reference in
            // onSpellStart and call it here.
            this._playSound?.("lance02");
          },
        ],
        [
          12,
          (clip, ctx) => {
            // AS DefineSprite_6/frame_13/DoAction.as:
            //   _parent.attachMovie("griffes","griffes" + _parent.cpt, _parent.cpt + 100);
            //   eval("_parent.griffes" + _parent.cpt)._y = _Y;
            //   eval("_parent.griffes" + _parent.cpt)._rotation = _rotation;
            //   _parent.cpt = _parent.cpt + 1;
            const outer = clip.parent;
            if (!outer) {
              return;
            }
            const cpt = (outer.vars.cpt as number) ?? 0;
            const instanceName = `griffes${cpt}`;
            const depth = cpt + 100;
            const newClip = outer.attach(
              this.griffesSym,
              instanceName,
              depth,
              ctx
            );
            // Apply the launcher's current _y and _rotation to the new griffes clip.
            newClip.y = clip.y;
            newClip.rotation = clip.rotation;
            outer.vars.cpt = cpt + 1;

            // Signal hit on the first claw impact (canonical first attachMovie).
            if (cpt === 0) {
              this.runtime.signalHit();
            }
          },
        ],
      ]),
    };

    // ---- DefineSprite_3 — ambient drift particle (main timeline) -
    // AS: DefineSprite_3/frame_1/DoAction.as
    // This particle drifts left and fades. It is placed on the main
    // timeline (not via attachMovie from a library symbol lookup) but
    // we model it as a registered container symbol so we can attach it
    // from onSpellStart.
    const ambient3Sym: SymbolDefinition = {
      name: "ambient3",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_3/frame_1/DoAction.as:
            //   v = 1.6 + random(5);
            //   va = 3;
            //   this.onEnterFrame = function() { _X -= (v /= 1.4); _alpha -= va; };
            clip.vars.v = 1.6 + Math.floor(Math.random() * 5);
            clip.vars.va = 3;
          },
        ],
      ]),
      onEnterFrame: (clip) => {
        // Canonical onEnterFrame set dynamically in frame_1 DoAction:
        //   _X = _X - (v /= 1.4);
        //   _alpha = _alpha - va;
        let v = clip.vars.v as number;
        const va = clip.vars.va as number;
        v /= 1.4;
        clip.x -= v;
        clip.vars.v = v;
        clip.alpha -= va / 100;
      },
    };

    // ---- DefineSprite_7 — outer container (163 frames) -----------
    // Hosts two pre-placed launcher instances ("g1" at depth 1 with
    // PlaceObject2_6_1 clip events, "g3" at depth 3 with
    // PlaceObject2_6_3 clip events).
    const outer7Sym: SymbolDefinition = {
      name: "outer7",
      totalFrames: 163,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_7/frame_1/DoAction.as:
            //   cpt = 0;
            clip.vars.cpt = 0;

            // Pre-place launcher "g1" (PlaceObject2_6_1):
            // onClipEvent(load): _rotation = random(90)+135; swapDepths(1100)
            const g1 = clip.attach(launcher6Sym, "g1", 1, ctx);
            g1.rotation = ((Math.floor(Math.random() * 90) + 135) * Math.PI) / 180;
            // swapDepths(1100) — modelled as zIndex, already set to 1100.
            g1.container.zIndex = 1100;
            // onClipEvent(enterFrame) for g1:
            g1.onEnterFrame = (c) => {
              // AS DefineSprite_7/frame_1/PlaceObject2_6_1/onClipEvent(enterFrame):
              //   if (this._currentframe == 1) { _rotation = random(90) + 135; }
              if (c.currentFrame === 0) {
                c.rotation =
                  ((Math.floor(Math.random() * 90) + 135) * Math.PI) / 180;
              }
            };

            // Pre-place launcher "g3" (PlaceObject2_6_3):
            // onClipEvent(load): _rotation = random(90)-45; gotoAndPlay(18); swapDepths(1000)
            const g3 = clip.attach(launcher6Sym, "g3", 3, ctx);
            g3.rotation = ((Math.floor(Math.random() * 90) - 45) * Math.PI) / 180;
            g3.gotoAndPlay(17); // AS gotoAndPlay(18) → 0-based index 17
            g3.container.zIndex = 1000;
            // onClipEvent(enterFrame) for g3:
            g3.onEnterFrame = (c) => {
              // AS DefineSprite_7/frame_1/PlaceObject2_6_3/onClipEvent(enterFrame):
              //   if (this._currentframe == 1) { _rotation = random(90) - 45; }
              if (c.currentFrame === 0) {
                c.rotation =
                  ((Math.floor(Math.random() * 90) - 45) * Math.PI) / 180;
              }
            };
          },
        ],
        [
          162,
          (clip) => {
            // AS DefineSprite_7/frame_163/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.griffesSym);
    this.registry.register(launcher6Sym);
    this.registry.register(ambient3Sym);
    this.registry.register(outer7Sym);

    // Store sym references for onSpellStart.
    this._outer7Sym = outer7Sym;
    this._ambient3Sym = ambient3Sym;
  }

  private _outer7Sym!: SymbolDefinition;
  private _ambient3Sym!: SymbolDefinition;
  private _playSound?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("crockette_201");
    callbacks.playSound("crockette_201");

    // Capture sound callback for use inside launcher frame_7.
    this._playSound = callbacks.playSound;

    // Attach the outer container (DefineSprite_7) at depth 1.
    this.root.attach(this._outer7Sym, "outer7", 1, context);

    // Attach the ambient drift particle (DefineSprite_3) at depth 2.
    this.root.attach(this._ambient3Sym, "ambient3", 2, context);
  }
}
