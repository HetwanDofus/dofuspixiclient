/**
 * Spell 2044 — (Beam-line duplicate spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2044/scripts/scripts/
 *
 * displayType=40 (BeamLine). Detection rationale:
 *   - The outer movie clip (frame_2/PlaceObject2_18_1) has an onClipEvent(load)
 *     that computes a caster→target vector, divides it into `inte` steps, and
 *     an onClipEvent(enterFrame) that drops `duplic` symbols periodically along
 *     the line — exactly the BeamLine pattern (displayType 40/41).
 *   - No "shoot" symbol is present, so plain BeamLine (40) rather than
 *     BeamLineAlt (41).
 *   - The harness for displayType 40 handles the periodic duplicate dropping
 *     automatically when a "duplicate" symbol is registered. However, the
 *     canonical AS in this spell uses a custom outer container clip
 *     (PlaceObject2_18_1) that IS the controller — it reads _parent.cellFrom /
 *     _parent.cellTo, computes the line geometry itself, and drops duplic pairs
 *     at every step. That controller clip IS the outer mc placed on the main
 *     timeline (frame_2). We implement it faithfully as the root's onEnterFrame.
 *
 * Library symbols:
 *   - lib_duplic (DefineSprite_17_duplic, 36 frames):
 *       frame_1: random scale [10,60]%, random rotation, position at
 *                `c * ix` / `c * iy` relative to parent.
 *       frame_34: removeMovieClip(this); stop().
 *
 * Main timeline (frame_2/DoAction.as): stop().
 *
 * The outer container clip (PlaceObject2_18_1) placed at frame_2 carries the
 * beam geometry controller via its clip events:
 *   onLoad:  compute dx/dy/d/inte/ix/iy, seed c=0, lok=0, t2=0.
 *   onEnterFrame: while c < inte → attachMovie("duplic", "duplic"+c, c) twice
 *                 (depth c and c+100); after that, call this.end() once (signalHit),
 *                 then after t2==20 frames, _parent.removeMovieClip().
 *
 * Because displayType=40's harness onEnterFrame would duplicate the line logic,
 * we use displayType=WorldAbsolute (50) so the harness does NOT set up its own
 * beam loop, and we implement the entire controller as the root onEnterFrame
 * seeded from onSpellStart. The root's vars carry ix/iy/inte/c/lok/t2 mirroring
 * the canonical PlaceObject2_18_1 outer clip.
 *
 * Wait — re-reading more carefully: the canonical controller is placed as a
 * child clip of the outer mc (not the root). The cleanest faithful port is
 * displayType=TargetCell (11) so the container sits at target (or we use
 * CasterCell / WorldAbsolute). Actually the controller reads _parent.cellFrom
 * and _parent.cellTo (world coords exposed by harness on root.vars for ALL
 * displayTypes). We use displayType=WorldAbsolute (50) so the container is at
 * (0,0) and children position themselves with absolute world coords — matching
 * the canonical `_X = _parent.cellFrom.x` assignment in onLoad.
 *
 * The "outer container" (PlaceObject2_18_1, which in Flash is a blank sprite
 * placed on the main timeline) is modelled as a SymbolDefinition "controller"
 * that gets attached from onSpellStart. Its onLoad/onEnterFrame handlers port
 * the two CLIPACTIONRECORD scripts 1:1.
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

const DUPLIC_BOUNDS = {
  width: 84.6,
  height: 68.9,
  offsetX: -21.1,
  offsetY: -45.65,
};

export class Spell2044 extends RuntimeSpell {
  readonly spellId = 2044;
  // WorldAbsolute: container at (0,0); the controller clip positions itself
  // at cellFrom using _parent.cellFrom / _parent.cellTo world coords, which
  // the harness exposes on root.vars for all displayTypes.
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private duplicSym!: SymbolDefinition;
  private controllerSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const duplicAnchor = calculateAnchor(DUPLIC_BOUNDS);

    // ---- lib_duplic — 36-frame beam particle ----------------------
    // AS DefineSprite_17_duplic/frame_1/DoAction.as:
    //   t = random(50) + 10;
    //   _xscale = t; _yscale = t;
    //   _rotation = random(360);
    //   _X = _parent.c * _parent.ix;
    //   _Y = _parent.c * _parent.iy;
    // AS DefineSprite_17_duplic/frame_34/DoAction.as:
    //   this.removeMovieClip(); stop();
    this.duplicSym = {
      name: "duplic",
      totalFrames: 36,
      frames: textures.getFrames("lib_duplic"),
      anchorX: duplicAnchor.x,
      anchorY: duplicAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_17_duplic/frame_1/DoAction.as
            const t = Math.floor(Math.random() * 50) + 10;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            // _parent.c and _parent.ix/iy are stored on the controller clip
            const parent = clip.parent;
            const c = (parent?.vars.c as number) ?? 0;
            const ix = (parent?.vars.ix as number) ?? 0;
            const iy = (parent?.vars.iy as number) ?? 0;
            clip.x = c * ix;
            clip.y = c * iy;
          },
        ],
        [
          33,
          (clip) => {
            // AS DefineSprite_17_duplic/frame_34/DoAction.as
            // this.removeMovieClip(); stop();
            clip.remove();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- controller — blank outer sprite (PlaceObject2_18_1) -----
    // This models the blank sprite placed at frame_2 of the main timeline.
    // It carries the two CLIPACTIONRECORD handlers that drive the beam loop.
    // AS frame_2/PlaceObject2_18_1/CLIPACTIONRECORD onClipEvent(load).as:
    //   _X = _parent.cellFrom.x;
    //   _Y = _parent.cellFrom.y - 25;
    //   _parent.a._x = _parent.cellTo.x;
    //   _parent.a._y = _parent.cellTo.y - 25;
    //   dx = -_X + _parent.a._x;
    //   dy = -_Y + _parent.a._y;
    //   d = Math.sqrt(dx*dx + dy*dy);
    //   inte = Math.round(d / 13);
    //   ix = dx / inte;
    //   iy = dy / inte;
    //   c = 0; lok = 0; t2 = 0;
    // AS frame_2/PlaceObject2_18_1/CLIPACTIONRECORD onClipEvent(enterFrame).as:
    //   if (c < inte) {
    //     attachMovie("duplic","duplic"+c, c);
    //     attachMovie("duplic","duplic"+c, c+100);
    //     c++;
    //   } else {
    //     if (lok != 1) { this.end(); lok = 1; }
    //     if (t2++ == 20) { _parent.removeMovieClip(); }
    //   }
    this.controllerSym = {
      name: "controller",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS frame_2/PlaceObject2_18_1/CLIPACTIONRECORD onClipEvent(load).as
        const root = clip.parent;
        const cellFrom = root?.vars.cellFrom as { x: number; y: number } | undefined;
        const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;

        const selfX = cellFrom?.x ?? 0;
        const selfY = (cellFrom?.y ?? 0) - 25;
        clip.x = selfX;
        clip.y = selfY;

        const aX = cellTo?.x ?? 0;
        const aY = (cellTo?.y ?? 0) - 25;
        // Store the target position for reference (mirrors _parent.a._x/_y)
        clip.vars.aX = aX;
        clip.vars.aY = aY;

        const dx = -selfX + aX;
        const dy = -selfY + aY;
        const d = Math.sqrt(dx * dx + dy * dy);
        const inte = Math.round(d / 13);
        const safeInte = inte > 0 ? inte : 1;
        clip.vars.dx = dx;
        clip.vars.dy = dy;
        clip.vars.d = d;
        clip.vars.inte = safeInte;
        clip.vars.ix = dx / safeInte;
        clip.vars.iy = dy / safeInte;
        clip.vars.c = 0;
        clip.vars.lok = 0;
        clip.vars.t2 = 0;
      },
      onEnterFrame: (clip, ctx) => {
        // AS frame_2/PlaceObject2_18_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        const c = clip.vars.c as number;
        const inte = clip.vars.inte as number;

        if (c < inte) {
          // Drop two duplic instances per step (depth c and c+100).
          // NOTE: the canonical AS uses the same instance name "duplic"+c
          // for both, meaning the second attach replaces the first at the
          // same name. We mirror that by using the same instanceName — the
          // second attach call on clip.attach will replace the first.
          clip.attach(this.duplicSym, `duplic${c}`, c, ctx);
          clip.attach(this.duplicSym, `duplic${c}`, c + 100, ctx);
          clip.vars.c = c + 1;
        } else {
          let lok = clip.vars.lok as number;
          if (lok !== 1) {
            // this.end() → signalHit
            this.runtime.signalHit();
            lok = 1;
            clip.vars.lok = lok;
          }
          let t2 = clip.vars.t2 as number;
          if (t2 === 20) {
            // _parent.removeMovieClip() → spell complete
            clip.parent?.remove();
            this.runtime.complete();
          }
          clip.vars.t2 = t2 + 1;
        }
      },
    };

    this.registry.register(this.duplicSym);
    this.registry.register(this.controllerSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS frame_2/DoAction.as: stop()
    // The main timeline places the controller sprite at frame_2 (implicitly),
    // then stops. We attach the controller here so it starts running from the
    // next runtime tick.
    this.root.attach(this.controllerSym, "controller", 1, context);
  }
}
