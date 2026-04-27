/**
 * Spell 2044 — Beam/line spell (likely Cra or similar beam class).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2044/scripts/scripts/
 *
 * displayType=40 (BeamLine). Detection rationale:
 *   - The main timeline places a single outer clip (PlaceObject2_18_1) on frame_2.
 *   - Its onLoad computes dx/dy/d/inte/ix/iy from cellFrom→cellTo, exactly the
 *     "how many segments along the line" pattern.
 *   - Its onEnterFrame calls `attachMovie("duplic","duplic"+c, c)` twice per step,
 *     advancing `c` from 0 to `inte` — placing duplicates along the line.
 *   - There is no separate `shoot` attached at the end (no BeamLineAlt), and no
 *     parabolic arc, no rotation-to-target, no worldAbsolute dual-timeline.
 *   - This is the canonical BeamLine (displayType=40) pattern.
 *
 * HOWEVER: the canonical BeamLine harness (displayType 40) drives `duplicate`
 * placement automatically. But here the outer clip IS the driver — it is NOT
 * the root directly; it is a child clip placed on the main timeline with its
 * own enterFrame that calls attachMovie("duplic",...). The outer mc is placed
 * at cellFrom and a synthetic `a` child is placed at cellTo for offset math.
 *
 * Because the per-clip enterFrame drives all the logic (including the
 * `this.end()` → signalHit and `_parent.removeMovieClip()` → complete),
 * and the harness for BeamLine would re-implement this differently, we use
 * displayType=11 (TargetCell) so the harness leaves the root alone, and we
 * implement the full logic manually in the outer clip's onLoad/onEnterFrame.
 * This mirrors the canonical AS exactly.
 *
 * Wait — re-reading the guide: for displayType 40 the harness calls attachIfRegistered
 * for "duplicate". But HERE the outer container IS an authored clip (PlaceObject2_18_1)
 * that itself does the attachMovie("duplic",...). The harness BeamLine would fight
 * with this. The right approach: use WorldAbsolute (50) so the harness only seeds
 * cellFrom/cellTo/angle on root.vars and leaves placement entirely to the per-spell
 * onSpellStart child attach. We attach the "outer" container (the driver clip) in
 * onSpellStart, and its onLoad/onEnterFrame replicate the canonical clip events.
 *
 * Library symbols:
 *   - lib_duplic — 36-frame particle placed along the line. frame_1 seeds t/scale/
 *     rotation/position from parent's c/ix/iy. frame_34 removes itself.
 *
 * Main timeline (frame_2): stop() — the real work is in the outer clip events.
 *
 * Outer clip (PlaceObject2_18_1 on frame_2):
 *   onLoad:  position self at cellFrom; set synthetic a._x/a._y at cellTo;
 *            compute dx/dy/d/inte/ix/iy/c/lok/t2.
 *   onEnterFrame: while c < inte → attachMovie("duplic","duplic"+c, c) × 2;
 *                 else → this.end() (signalHit, once); t2++ == 20 → _parent.removeMovieClip().
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
  // Use WorldAbsolute so the harness only seeds cellFrom/cellTo/angle on
  // root.vars and does NOT attempt to drive any projectile / beam logic.
  // All placement is done manually via the outer container clip's events.
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private duplicSym!: SymbolDefinition;
  private outerSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const duplicAnchor = calculateAnchor(DUPLIC_BOUNDS);

    // ---- lib_duplic — 36-frame particle placed along the caster→target line ----
    // frame_1:  AS DefineSprite_17_duplic/frame_1/DoAction.as
    //   t = random(50) + 10;
    //   _xscale = t; _yscale = t;
    //   _rotation = random(360);
    //   _X = _parent.c * _parent.ix;
    //   _Y = _parent.c * _parent.iy;
    // frame_34: AS DefineSprite_17_duplic/frame_34/DoAction.as
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
            // AS: DefineSprite_17_duplic/frame_1/DoAction.as
            const t = Math.floor(Math.random() * 50) + 10;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            // _parent here is the outer container clip (the beam driver)
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
            // AS: DefineSprite_17_duplic/frame_34/DoAction.as
            // this.removeMovieClip(); stop();
            clip.remove();
          },
        ],
      ]),
    };

    // ---- outer container — the beam driver clip (PlaceObject2_18_1 on frame_2) ----
    // This is NOT a library symbol in AS but we model it as a SymbolDefinition
    // so we can attach it from onSpellStart and wire its clip events.
    // It has no authored frame content (container-only).
    //
    // onLoad: AS frame_2/PlaceObject2_18_1/CLIPACTIONRECORD onClipEvent(load).as
    //   Position self at cellFrom.y - 25; place synthetic child `a` at cellTo.
    //   Compute dx/dy/d/inte/ix/iy; init c=0, lok=0, t2=0.
    //
    // onEnterFrame: AS frame_2/PlaceObject2_18_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   if (c < inte): attachMovie("duplic","duplic"+c, c) × 2; c++
    //   else: if (lok != 1): this.end(); lok=1;
    //         if (t2++ == 20): _parent.removeMovieClip()
    this.outerSym = {
      name: "outer",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: frame_2/PlaceObject2_18_1/CLIPACTIONRECORD onClipEvent(load).as
        const root = clip.parent;
        const cellFrom = root?.vars.cellFrom as { x: number; y: number } | undefined;
        const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;

        const selfX = cellFrom?.x ?? 0;
        const selfY = (cellFrom?.y ?? 0) - 25;
        clip.x = selfX;
        clip.y = selfY;

        // Store the synthetic `a` position directly on vars (AS: _parent.a._x/_y)
        const aX = cellTo?.x ?? 0;
        const aY = (cellTo?.y ?? 0) - 25;
        clip.vars.aX = aX;
        clip.vars.aY = aY;

        const dx = -selfX + aX;
        const dy = -selfY + aY;
        const d = Math.sqrt(dx * dx + dy * dy);
        const inte = Math.round(d / 13);
        clip.vars.dx = dx;
        clip.vars.dy = dy;
        clip.vars.d = d;
        clip.vars.inte = inte;
        clip.vars.ix = dx / inte;
        clip.vars.iy = dy / inte;
        clip.vars.c = 0;
        clip.vars.lok = 0;
        clip.vars.t2 = 0;
      },
      onEnterFrame: (clip, ctx) => {
        // AS: frame_2/PlaceObject2_18_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        const c = clip.vars.c as number;
        const inte = clip.vars.inte as number;

        if (c < inte) {
          // attachMovie("duplic","duplic"+c, c) — canonical AS attaches it twice
          // (at depth c and depth c+100). We use distinct instance names so the
          // second attach doesn't replace the first (AS depth is separate from name,
          // but here the instance names differ: "duplic"+c vs "duplic"+c again at c+100).
          // In canonical AS attachMovie at a new depth creates a new clip even with
          // the same name if the depth differs. We model this with unique names.
          clip.attach(this.duplicSym, `duplic_a_${c}`, c, ctx);
          clip.attach(this.duplicSym, `duplic_b_${c}`, c + 100, ctx);
          clip.vars.c = c + 1;
        } else {
          const lok = clip.vars.lok as number;
          if (lok !== 1) {
            // this.end() → signalHit
            this.runtime.signalHit();
            clip.vars.lok = 1;
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
    this.registry.register(this.outerSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS: frame_2/DoAction.as → stop()
    // The main timeline stops and the outer container clip (PlaceObject2_18_1)
    // begins driving the animation. We attach it here so it starts ticking
    // from the next runtime frame.
    this.root.attach(this.outerSym, "outer", 1, context);
  }
}
