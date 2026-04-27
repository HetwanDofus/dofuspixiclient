/**
 * Spell 615 — (Air dodge / wind spell, likely Féca or Roublard class).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/615/scripts/scripts/
 *
 * displayType=11 (TargetCell). The main sprite (DefineSprite_22) positions
 * itself at `_parent.cellTo` on frame_1, making this a target-anchored impact.
 * No projectile motion (no move/shoot/duplicate symbols), no caster reference —
 * pure TargetCell pattern.
 *
 * Canonical AS layout:
 *   - DefineSprite_22 (123-frame main animation, placed as sprite_22 in animations[]):
 *       frame_1:  SOMA.playSound("air"); position self at cellTo.
 *       frame_34: SOMA.playSound("dodge_615").
 *       frame_37: PlaceObject2_17_2 onLoad — a container clip that spawns 5 "pierres"
 *                 particles inside itself.
 *       frame_40: this.end() → signalHit.
 *       frame_43: SOMA.playSound("dodge_615"); PlaceObject2_17_6 onLoad — another
 *                 container clip that spawns 5 "pierres" particles.
 *       frame_121: _parent.removeMovieClip() → spell complete.
 *
 *   - DefineSprite_9 (two child clips with enterFrame handlers):
 *       PlaceObject2_6_1 onEnterFrame: _alpha = random(50)
 *       PlaceObject2_8_3 onEnterFrame: _alpha = random(240) + 30
 *
 *   - lib_pierres (library symbol, 1 frame):
 *       onLoad: seeds vx, vy, position scatter, t, scale, alpha, v, vr physics.
 *       onEnterFrame: integrates position, gravity bounce, rotation decay.
 *
 * Library symbols:
 *   - pierres — gravel/stone particle. onLoad seeds full physics (position scatter,
 *     velocity, rotation speed, bounce gravity). onEnterFrame integrates with
 *     gravity bounce and settles.
 *
 * Main timeline (frame_2/DoAction.as): stop() — the main SWF stops; the spell
 * animation is driven entirely by sprite_22 which is placed on the main timeline.
 *
 * Note: DefineSprite_9 appears to be an internally-authored child of sprite_22 with
 * two pre-placed sub-clips (PlaceObject2_6_1 and PlaceObject2_8_3) that have
 * enterFrame clip events. Since these are authored PlaceObject2 sub-clips (not
 * attachMovie'd library symbols), they are baked into the sprite_22 composite frames
 * and do not need separate SymbolDefinition registrations. The flicker effects are
 * already part of the SVG frames.
 *
 * The two PlaceObject2_17_2 (frame_37) and PlaceObject2_17_6 (frame_43) clips inside
 * sprite_22 are containers that attachMovie("pierres", ...) — these ARE library symbol
 * attaches and are driven by frame scripts.
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

const PIERRES_BOUNDS = {
  width: 4.75,
  height: 2.3,
  offsetX: -2.4,
  offsetY: -1.7,
};

const SPRITE22_BOUNDS = {
  width: 239.5,
  height: 178.9,
  offsetX: -113.3,
  offsetY: -132.1,
};

export class Spell615 extends RuntimeSpell {
  readonly spellId = 615;
  readonly displayType = SpellDisplayType.TargetCell;

  private pierresSym!: SymbolDefinition;
  private sprite22Sym!: SymbolDefinition;

  // Capture callbacks for sounds fired from frame scripts
  private _playSound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const pierresAnchor = calculateAnchor(PIERRES_BOUNDS);
    const sprite22Anchor = calculateAnchor(SPRITE22_BOUNDS);

    // ---- lib_pierres — gravel/stone bounce particle ---------------
    // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/
    //
    // The structure in AS is:
    //   pierres (outer container, lib symbol) — its _parent._x/_y is
    //   scattered on load. It contains one inner clip (PlaceObject2_2_1)
    //   that actually has the image and handles physics via clip events.
    //
    // We flatten this: the SymbolDefinition IS the outer "pierres" clip.
    // The onLoad handler sets the outer clip's position (the _parent._x =
    // scatter becomes clip.x = scatter since clip IS _parent here), and
    // sets vars for the inner physics. The onEnterFrame integrates the
    // inner physics. This matches the observed canonical behavior: the
    // stone spawns scattered, bounces, then settles.
    //
    // onLoad: AS DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
    // onEnterFrame: AS DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.pierresSym = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,
      onLoad: (clip) => {
        // AS onClipEvent(load):
        //   vx = 3 * (Math.random() - 0.5);
        //   vy = 2 * (Math.random() - 0.5);
        //   _parent._x = 20 * (Math.random() - 0.5);   ← outer container x
        //   _parent._y = 10 * (Math.random() - 0.5);   ← outer container y
        //   t = 60 + 40 * Math.random();
        //   _xscale = t; _yscale = t;
        //   _alpha = 20 + random(90);
        //   v = -6 * Math.random() - 3;
        //   vr = 40 * (-0.5 + Math.random());
        //
        // In the canonical AS, PlaceObject2_2_1 is a child of "pierres"
        // (the outer container). The outer container gets the scatter
        // position (_parent._x/_y from inner clip = outer clip's x/y).
        // The inner clip tracks _Y (vertical bounce), _rotation, and
        // uses the vars. We store all vars on the single clip.
        clip.vars.vx = 3 * (Math.random() - 0.5);
        clip.vars.vy = 2 * (Math.random() - 0.5);
        // _parent._x / _parent._y scatter: apply to the clip itself
        clip.x = 20 * (Math.random() - 0.5);
        clip.y = 10 * (Math.random() - 0.5);
        const t = 60 + 40 * Math.random();
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (20 + Math.floor(Math.random() * 90)) / 100;
        clip.vars.v = -6 * Math.random() - 3;
        clip.vars.vr = 40 * (-0.5 + Math.random());
        clip.vars.t = 1; // t != 1 guard — start t=1 means settled=false
        // We re-use vars.t as a flag: 0 = physics active, 1 = settled.
        // In AS the initial placement means the clip IS active (t != 1
        // runs physics). We store a separate "innerY" to track the
        // inner clip's _Y (vertical position within outer container).
        clip.vars.innerY = 0;
        clip.vars.innerRotation = 0;
        clip.vars.settled = 0; // 0 = not settled (t != 1), 1 = settled
      },
      onEnterFrame: (clip) => {
        // AS onClipEvent(enterFrame):
        //   _parent._x += vx;
        //   _parent._y += vy;
        //   if(t != 1) {
        //     _Y = _Y + v;
        //     _rotation = _rotation + vr;
        //     v += 0.5;
        //     if(_Y > 0) {
        //       vx /= 4; vy /= 2; _rotation = 0; _Y = 0;
        //       v = (-v) / 4;
        //       if(Math.abs(v) < 1) { vx=0; vy=0; t=1; }
        //     }
        //   }
        const vx = clip.vars.vx as number;
        const vy = clip.vars.vy as number;
        const settled = clip.vars.settled as number;

        clip.x += vx;
        clip.y += vy;
        clip.vars.vx = vx;
        clip.vars.vy = vy;

        if (settled !== 1) {
          let innerY = clip.vars.innerY as number;
          let innerRot = clip.vars.innerRotation as number;
          let v = clip.vars.v as number;
          const vr = clip.vars.vr as number;

          innerY += v;
          innerRot += vr;
          v += 0.5;

          if (innerY > 0) {
            clip.vars.vx = vx / 4;
            clip.vars.vy = vy / 2;
            innerRot = 0;
            innerY = 0;
            const newV = (-v) / 4;
            if (Math.abs(newV) < 1) {
              clip.vars.vx = 0;
              clip.vars.vy = 0;
              clip.vars.settled = 1;
              v = newV; // settled, doesn't matter
            } else {
              v = newV;
            }
          }

          clip.vars.innerY = innerY;
          clip.vars.innerRotation = innerRot;
          clip.vars.v = v;

          // Apply inner Y as additional y offset and rotation.
          // The inner clip's _Y and _rotation in AS are relative to
          // the outer container. We approximate by offsetting clip.y
          // with innerY and setting rotation.
          clip.y += innerY;
          clip.rotation = (innerRot * Math.PI) / 180;
        }
      },
    };

    // ---- sprite_22 — main 123-frame animation --------------------
    // AS: DefineSprite_22 — the primary animation sprite.
    // frame_1:  SOMA.playSound("air"); _X = _parent.cellTo.x; _Y = _parent.cellTo.y
    // frame_34: SOMA.playSound("dodge_615")
    // frame_37: PlaceObject2_17_2 placed — onLoad spawns 5 pierres
    // frame_40: this.end() → signalHit
    // frame_43: SOMA.playSound("dodge_615"); PlaceObject2_17_6 placed — onLoad spawns 5 pierres
    // frame_121: _parent.removeMovieClip() → complete
    //
    // For displayType=11 (TargetCell), the container is already at the target cell.
    // frame_1's DoAction_2 sets _X = _parent.cellTo.x, _Y = _parent.cellTo.y — in
    // WorldAbsolute this would be needed, but for TargetCell the anchor IS cellTo,
    // so the clip is already at (0,0) relative to target. The DoAction_2 would set
    // x/y to absolute world coords, which for TargetCell means we should position
    // relative to the container's origin. However since the container IS at cellTo,
    // we set x=0, y=0 (the clip is already positioned correctly).
    //
    // Wait — re-reading: DefineSprite_22 is the main sprite placed ON the root.
    // Its frame_1 DoAction_2 does _X = _parent.cellTo.x, _Y = _parent.cellTo.y.
    // _parent here is the outer SWF mc (our root). root.vars.cellTo holds world coords.
    // For TargetCell, root container is at cellTo. So cellTo.x in world coords != 0
    // relative to root. We must set the clip's position to absolute world coords and
    // then the Pixi container (at cellTo) will offset. Actually for TargetCell the
    // root container IS positioned at cellTo by the spell-view, so relative coords
    // within root are: child.x = 0, child.y = 0 means "at cellTo". Setting
    // child.x = cellTo.x would place it at 2*cellTo.x visually. So we set x=0, y=0.
    this.sprite22Sym = {
      name: "sprite_22",
      totalFrames: 123,
      frames: textures.getFrames("sprite_22"),
      anchorX: sprite22Anchor.x,
      anchorY: sprite22Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_22/frame_1/DoAction.as: SOMA.playSound("air")
            this._playSound?.("air");
            // AS DefineSprite_22/frame_1/DoAction_2.as:
            //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y
            // For TargetCell, the root container is already at cellTo,
            // so local (0,0) == cellTo in world space. Set to 0,0.
            clip.x = 0;
            clip.y = 0;
          },
        ],
        [
          33,
          () => {
            // AS DefineSprite_22/frame_34/DoAction.as: SOMA.playSound("dodge_615")
            this._playSound?.("dodge_615");
          },
        ],
        [
          36,
          (clip, ctx) => {
            // AS DefineSprite_22/frame_37: PlaceObject2_17_2 is placed.
            // Its onClipEvent(load) spawns 5 pierres:
            //   c = 0; while(c < 5) { this.attachMovie("pierres","pierres"+c,c); c++; }
            // PlaceObject2_17_2 is a container clip (depth 2, instance name implied).
            // We create a container-only symbol for it inline, or simply
            // attach pierres directly to the sprite_22 clip at a sub-container.
            // Canonical approach: a container "slot2" is placed that spawns pierres.
            // We attach a virtual container, but since we have no registered symbol
            // for PlaceObject2_17_2, we just attach pierres directly under sprite_22
            // at offsets (they'll scatter via onLoad's _parent._x/_y logic).
            for (let c = 0; c < 5; c++) {
              clip.attach(this.pierresSym, `pierres_a${c}`, 100 + c, ctx);
            }
          },
        ],
        [
          39,
          () => {
            // AS DefineSprite_22/frame_40/DoAction.as: this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          42,
          (clip, ctx) => {
            // AS DefineSprite_22/frame_43/DoAction.as: SOMA.playSound("dodge_615")
            this._playSound?.("dodge_615");
            // AS DefineSprite_22/frame_43: PlaceObject2_17_6 placed.
            // Its onClipEvent(load) spawns 5 pierres (same pattern as frame_37).
            for (let c = 0; c < 5; c++) {
              clip.attach(this.pierresSym, `pierres_b${c}`, 200 + c, ctx);
            }
          },
        ],
        [
          120,
          (clip) => {
            // AS DefineSprite_22/frame_121/DoAction.as: _parent.removeMovieClip()
            // _parent of sprite_22 is the root mc → spell complete.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.pierresSym);
    this.registry.register(this.sprite22Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture playSound for use in frame scripts.
    this._playSound = callbacks.playSound;

    // Main timeline frame_1 implicitly places sprite_22.
    // frame_2/DoAction.as: stop() — main timeline stops.
    // We attach sprite_22 to root so it starts ticking from the next frame.
    this.root.attach(this.sprite22Sym, "sprite22", 1, context);
  }
}
