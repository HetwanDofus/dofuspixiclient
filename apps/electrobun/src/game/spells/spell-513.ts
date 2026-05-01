/**
 * Spell 513 — Rocaille (Sadida earth spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/513/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single `shoot` symbol (DefineSprite_64_shoot,
 * 264 frames) anchored at the target cell, plus two library symbols:
 *   - `pierres` (DefineSprite_3) — a small rock/stone particle. Has onLoad (seeds vx, vy,
 *     position scatter, scale, alpha, v, vr) and onEnterFrame (gravity + bounce physics,
 *     removes self when settled).
 *   - `sprite60` (DefineSprite_60, directlyDynamic: true) — a "rock cluster" container.
 *     Its onClipEvent(load) attaches 5 `pierres` instances. Placed inside `shoot` at frame
 *     126 (0-based: 125) at depth 25. Has 190 authored frames of visual content.
 *
 * Main timeline: no explicit sound on the main timeline (sounds are embedded in shoot's
 * timeline per the manifest's sounds[] array). The harness attaches `shoot` at the target
 * cell for displayType=11.
 *
 * shoot timeline key frames (1-based AS → 0-based TS):
 *   frame_4   (idx 3)  : SOMA.playSound("many_501"); _X = _parent.cellTo.x; _Y = _parent.cellTo.y
 *   frame_109 (idx 108): SOMA.playSound("many_502")
 *   frame_124 (idx 123): SOMA.playSound("explosion")
 *   frame_127 (idx 126): this.end() → signalHit
 *   frame_151 (idx 150): SOMA.playSound("pic")
 *   frame_166 (idx 165): SOMA.playSound("pic")
 *   frame_181 (idx 180): SOMA.playSound("pic")
 *   frame_193 (idx 192): SOMA.playSound("pic")
 *   frame_262 (idx 261): _parent.removeMovieClip(); stop() → complete
 *
 * sprite60 is placed inside shoot at frame 126 (0-based: 125) at depth 25, matrix
 * (translateX=0.45, translateY=-5.15).
 *
 * Library symbols:
 *   - lib_pierres — rock chip particle. onLoad seeds vx/vy/v/vr/scale/alpha. onEnterFrame
 *     applies gravity+bounce physics; settles and stops when bounce velocity < 1.
 *   - lib_sprite60 — 190-frame container. onLoad attaches 5 `pierres` instances.
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
  width: 6.4,
  height: 4.55,
  offsetX: -3.2,
  offsetY: -2.2,
};

const SPRITE60_BOUNDS = {
  width: 1,
  height: 1,
  offsetX: -0.5,
  offsetY: -0,
};

const SHOOT_BOUNDS = {
  width: 177.65,
  height: 220.1,
  offsetX: -89.65,
  offsetY: -175.25,
};

export class Spell513 extends RuntimeSpell {
  readonly spellId = 513;
  readonly displayType = SpellDisplayType.TargetCell;

  private pierreSym!: SymbolDefinition;
  private sprite60Sym!: SymbolDefinition;
  private shootSym!: SymbolDefinition;

  // Capture sound callback for use inside frameScripts
  private playSound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const pierresAnchor = calculateAnchor(PIERRES_BOUNDS);
    const sprite60Anchor = calculateAnchor(SPRITE60_BOUNDS);
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- lib_pierres — rock chip particle -------------------------
    // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //   var vx = 5 * (Math.random() - 0.5);
    //   var vy = 2 * (Math.random() - 0.5);
    //   _parent._x = 20 * (Math.random() - 0.5);
    //   _parent._y = 10 * (Math.random() - 0.5);
    //   var t = 60 + 40 * Math.random();
    //   _xscale = t; _yscale = t; _alpha = 20 + random(90);
    //   var v = -15 * Math.random() - 5;
    //   var vr = 140 * (-0.5 + Math.random());
    //
    // NOTE: The inner sprite (PlaceObject2_2_1) applies scale/alpha to itself,
    // and sets _parent._x/_y (i.e. the pierres container's position).
    // We model this as the clip itself (the pierres container) having the
    // physics vars, and the onLoad sets both self-transform and self-position
    // (since onLoad fires on the pierres clip, _parent here would be sprite60).
    this.pierreSym = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
        // The inner placed object (PlaceObject2_2_1) seeds vars and sets _parent (_X/_Y = pierres position)
        // plus scales/alpha itself. We apply everything to the pierres clip directly.
        clip.vars.vx = 5 * (Math.random() - 0.5);
        clip.vars.vy = 2 * (Math.random() - 0.5);
        // _parent._x/_y = position of the pierres clip within sprite60
        clip.x = 20 * (Math.random() - 0.5);
        clip.y = 10 * (Math.random() - 0.5);
        const t = 60 + 40 * Math.random();
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (20 + Math.floor(Math.random() * 90)) / 100;
        clip.vars.v = -15 * Math.random() - 5;
        clip.vars.vr = 140 * (-0.5 + Math.random());
        clip.vars.t = 0; // t is used as a settled flag (set to 1 when settled)
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _parent._x += vx; _parent._y += vy; (moves the pierres container)
        // if(t != 1) { _Y += v; _rotation += vr; v += 1; if(_Y > 0) { bounce/settle } }
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        const settled = clip.vars.t as number;

        // _parent._x/_y corresponds to the pierres clip's own position
        clip.x += vx;
        clip.y += vy;

        if (settled !== 1) {
          let v = clip.vars.v as number;
          let vr = clip.vars.vr as number;

          // _Y is the inner sprite's local Y (the visual within pierres)
          // We track this in clip.vars.innerY
          let innerY = (clip.vars.innerY as number | undefined) ?? 0;

          innerY += v;
          // AS: _rotation += vr (degrees → radians)
          clip.rotation += (vr * Math.PI) / 180;
          v += 1;

          if (innerY > 0) {
            // Bounce
            vx /= 2;
            vy /= 2;
            clip.vars.vx = vx;
            clip.vars.vy = vy;
            clip.rotation = 0;
            innerY = 0;
            v = (-v) / 4;
            if (Math.abs(v) < 1) {
              clip.vars.vx = 0;
              clip.vars.vy = 0;
              clip.vars.t = 1;
            }
          }

          clip.vars.v = v;
          clip.vars.vr = vr;
          clip.vars.innerY = innerY;
        }
      },
    };

    // ---- lib_sprite60 — rock cluster container (190 frames) -------
    // AS: DefineSprite_60/frame_1/PlaceObject2_59_1/CLIPACTIONRECORD onClipEvent(load).as
    //   c = 0;
    //   while(c < 5) { this.attachMovie("pierres","pierres" + c, c); c++; }
    this.sprite60Sym = {
      name: "sprite60",
      totalFrames: 190,
      frames: textures.getFrames("lib_sprite60"),
      anchorX: sprite60Anchor.x,
      anchorY: sprite60Anchor.y,
      onLoad: (clip, ctx) => {
        // AS: DefineSprite_60/frame_1/PlaceObject2_59_1/CLIPACTIONRECORD onClipEvent(load).as
        // Attaches 5 pierres particles inside this sprite.
        for (let c = 0; c < 5; c++) {
          clip.attach(this.pierreSym, `pierres${c}`, c, ctx);
        }
      },
    };

    // ---- shoot — 264-frame main animation at target ---------------
    // The shoot animation is the top-level animated symbol (DefineSprite_64_shoot).
    // It has authored per-frame SVG visuals (264 frames) and several frameScripts.
    // It is placed by the harness (TargetCell displayType = container at target),
    // and we attach it from onSpellStart.
    this.shootSym = {
      name: "shoot",
      totalFrames: 264,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          3,
          (clip, _ctx) => {
            // AS: DefineSprite_64_shoot/frame_4/DoAction.as — SOMA.playSound("many_501")
            // AS: DefineSprite_64_shoot/frame_4/DoAction_2.as — _X = _parent.cellTo.x; _Y = _parent.cellTo.y
            // Position the shoot clip at the target cell (in world coords relative to container origin).
            // For displayType=11, the container IS already at cellTo, so (0,0) is correct.
            // But canonical AS sets _X/_Y explicitly from _parent.cellTo — we honour that.
            this.playSound?.("many_501");
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
            if (cellTo) {
              // Container is at cellTo (TargetCell anchor), so local (0,0) IS cellTo.
              // The AS sets absolute coords; since the container origin = cellTo,
              // the local offset is (cellTo.x - anchor.x, cellTo.y - anchor.y) = (0, 0).
              // We set it explicitly to match canonical AS.
              clip.x = 0;
              clip.y = 0;
            }
          },
        ],
        [
          108,
          (_clip, _ctx) => {
            // AS: DefineSprite_64_shoot/frame_109/DoAction.as — SOMA.playSound("many_502")
            this.playSound?.("many_502");
          },
        ],
        [
          123,
          (_clip, _ctx) => {
            // AS: DefineSprite_64_shoot/frame_124/DoAction.as — SOMA.playSound("explosion")
            this.playSound?.("explosion");
          },
        ],
        [
          125,
          (clip, ctx) => {
            // AS: shoot has sprite60 placed at frame_127 in the manifest (0-based: 126),
            // but the placement entry says frame=126 (0-based). The manifest placements[]
            // for sprite60 shows parentSpriteId=64, frame=126, depth=25.
            // We attach sprite60 here at the correct depth with the placement transform.
            // matrix: translateX=0.45, translateY=-5.15, scaleX=1, scaleY=1, no rotation
            if (!clip.children.has("sprite60_inst")) {
              clip.attach(this.sprite60Sym, "sprite60_inst", 25, ctx, {
                x: 0.45,
                y: -5.15,
              });
            }
          },
        ],
        [
          126,
          (_clip, _ctx) => {
            // AS: DefineSprite_64_shoot/frame_127/DoAction.as — this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          150,
          (_clip, _ctx) => {
            // AS: DefineSprite_64_shoot/frame_151/DoAction.as — SOMA.playSound("pic")
            this.playSound?.("pic");
          },
        ],
        [
          165,
          (_clip, _ctx) => {
            // AS: DefineSprite_64_shoot/frame_166/DoAction.as — SOMA.playSound("pic")
            this.playSound?.("pic");
          },
        ],
        [
          180,
          (_clip, _ctx) => {
            // AS: DefineSprite_64_shoot/frame_181/DoAction.as — SOMA.playSound("pic")
            this.playSound?.("pic");
          },
        ],
        [
          192,
          (_clip, _ctx) => {
            // AS: DefineSprite_64_shoot/frame_193/DoAction.as — SOMA.playSound("pic")
            this.playSound?.("pic");
          },
        ],
        [
          261,
          (clip) => {
            // AS: DefineSprite_64_shoot/frame_262/DoAction.as — _parent.removeMovieClip(); stop()
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.pierreSym);
    this.registry.register(this.sprite60Sym);
    this.registry.register(this.shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for use inside frameScripts.
    this.playSound = callbacks.playSound.bind(callbacks);

    // The main timeline for displayType=11 (TargetCell) places the shoot animation
    // at the target cell. We attach it here so it starts ticking from the first frame.
    this.root.attach(this.shootSym, "shoot", 1, context);
  }
}
