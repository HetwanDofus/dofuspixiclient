/**
 * Spell 306 — Lakam (Earth/Rock impact spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/306/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell is a single animated composite
 * `shoot` timeline (75 frames) placed at the target cell with no projectile
 * motion and no caster-side content. The main timeline sets level=5 and plays
 * the "lakam_405" sound. The `shoot` symbol contains:
 *
 *   - An internal sub-sprite (DefineSprite_5) that runs an onLoad/onEnterFrame
 *     loop spawning up to 6 `pierres` (rock) library-symbol particles over 6
 *     frames. Each `pierres` particle has full ballistic physics: random launch
 *     velocity, gravity integration, and a bounce/friction landing.
 *   - Several internal stop()-only sub-sprites (DefineSprite_2, 16, 20, 21, 22,
 *     23) that are authored timeline content within the composite `shoot`
 *     asset — their frame scripts are baked into the exported composite frames
 *     and do not need to be wired separately in TypeScript, EXCEPT for:
 *       • DefineSprite_6_shoot/frame_73: `_parent.removeMovieClip(); stop();`
 *         → this is the outer `shoot` clip's own frame_73 (AS 1-based =
 *         runtime frame index 72), which removes itself and completes the spell.
 *       • DefineSprite_23/frame_16: `this.end();` → signalHit (damage popup).
 *         DefineSprite_23 is nested inside `shoot`; its frame_16 (index 15)
 *         maps to approximately shoot's frame_16. We fire signalHit from
 *         shoot's frame_15 (AS frame_16) to match canonical timing.
 *
 * The `pierres` library symbol is the only attachMovie target referenced in AS.
 * DefineSprite_5 (the spawner container) is authored inside the composite
 * `shoot` asset; we do not need to register it separately — but we DO need to
 * register `pierres` so that the onEnterFrame inside the composite can attach it.
 *
 * NOTE on DefineSprite_5 / pierres spawner:
 *   The composite `shoot` frames already include the authored rendered content
 *   for sub-sprites. However, the runtime-spawned `pierres` particles (via
 *   attachMovie in DefineSprite_5's onEnterFrame) are DYNAMIC — they must be
 *   registered and driven by clip events. We wire a synthetic onEnterFrame on
 *   the `shoot` clip to replicate the DefineSprite_5 spawner logic (c starts
 *   at 0, increments by 1 per frame for 6 frames, attaching a `pierres` child
 *   each time), because DefineSprite_5 is a sub-sprite of `shoot` and its
 *   onClipEvent fires within shoot's lifetime.
 *
 * displayType=11 — single impact at target cell, no projectile, no caster
 * reference in any AS script.
 *
 * Library symbols:
 *   - lib_pierres — rock particle. onLoad seeds position scatter, velocity
 *     vx/vy (random launch), lim (bounce floor), rotation to match launch
 *     angle. onEnterFrame integrates gravity (vy += 0.3), bounces at lim
 *     with vy *= -0.6, vx *= 0.6.
 *
 * Main timeline (frame_1/DoAction.as):
 *   SOMA.playSound("lakam_405");
 *   level = 5;   ← sets root.vars.level (already set by harness from context,
 *                   but AS hardcodes 5 here; we honour it in onSpellStart)
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
  width: 40.2,
  height: 14.95,
  offsetX: 45.75,
  offsetY: -4.7,
};

const SHOOT_BOUNDS = {
  width: 65.9,
  height: 65.9,
  offsetX: -39.4,
  offsetY: -52.95,
};

export class Spell306 extends RuntimeSpell {
  readonly spellId = 306;
  readonly displayType = SpellDisplayType.TargetCell;

  private pierresSym!: SymbolDefinition;
  private shootSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const pierresAnchor = calculateAnchor(PIERRES_BOUNDS);
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- lib_pierres — rock particle with ballistic physics ------
    // AS: DefineSprite_17_pierres/frame_1/PlaceObject2_16_1/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //   _X = (Math.random() - 0.5) * 10
    //   _Y = (Math.random() - 0.5) * 10
    //   vx = (Math.random() - 0.5) * 3.5
    //   vy = (-Math.random()) * 7.5
    //   lim = 50 + (Math.random() - 0.5) * 20
    //   _rotation = Math.atan2(vy, vx) * 57.29746936176985  (degrees)
    //
    // AS: DefineSprite_17_pierres/frame_1/PlaceObject2_16_1/
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _X = _X + vx
    //   _Y = _Y + (vy += 0.3)
    //   if (_Y > lim) { _Y = lim; vy = (-vy) * 0.6; vx *= 0.6 }
    this.pierresSym = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_17_pierres/.../onClipEvent(load)
        clip.x = (Math.random() - 0.5) * 10;
        clip.y = (Math.random() - 0.5) * 10;
        clip.vars.vx = (Math.random() - 0.5) * 3.5;
        clip.vars.vy = (-Math.random()) * 7.5;
        clip.vars.lim = 50 + (Math.random() - 0.5) * 20;
        // AS stores rotation in degrees via atan2 * 57.297...
        // Convert to radians for Pixi: (degrees * PI/180) = radians
        // atan2(vy,vx) * 57.297... * PI/180 = atan2(vy,vx) — so just use atan2 directly.
        const vx = clip.vars.vx as number;
        const vy = clip.vars.vy as number;
        clip.rotation = Math.atan2(vy, vx);
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_17_pierres/.../onClipEvent(enterFrame)
        const vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        const lim = clip.vars.lim as number;

        vy += 0.3;
        clip.x += vx;
        clip.y += vy;

        if (clip.y > lim) {
          clip.y = lim;
          vy = (-vy) * 0.6;
          clip.vars.vx = vx * 0.6;
        }

        clip.vars.vy = vy;
      },
    };

    // ---- shoot — 75-frame composite impact at target -------------
    // The composite asset contains all authored sub-sprite rendering.
    // We drive two runtime behaviours from frameScripts:
    //
    //   1. A synthetic pierres-spawner replicating DefineSprite_5's
    //      onLoad/onEnterFrame (c starts at 0 in onLoad, increments by 1
    //      per frame for 6 frames, attaching a `pierres` child each time).
    //      We implement this as shoot's own onLoad (seeds vars.c = 0) and
    //      onEnterFrame (spawns one pierres per frame until c >= 6).
    //
    //   2. DefineSprite_23/frame_16/DoAction.as: `this.end();`
    //      → signalHit at shoot's frame 16 (AS 1-based) = runtime index 15.
    //
    //   3. DefineSprite_6_shoot/frame_73/DoAction.as:
    //      `_parent.removeMovieClip(); stop();`
    //      → at shoot's frame 73 (AS 1-based) = runtime index 72,
    //        remove shoot and complete the spell.
    //
    // Note: DefineSprite_2/frame_1 (_rotation = random(360)) is authored
    // content inside the composite and fires within the baked asset —
    // no separate registration needed for the rotation-only sub-sprite.
    // DefineSprite_16/frame_10, DefineSprite_20/frame_19,
    // DefineSprite_21/frame_13, DefineSprite_22/frame_31,
    // DefineSprite_23/frame_115 are all stop() calls on authored
    // sub-sprites that are baked into the composite frames.
    this.shootSym = {
      name: "shoot",
      totalFrames: 75,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      onLoad: (clip) => {
        // Synthetic: mirrors DefineSprite_5/frame_1/PlaceObject2_3_3/
        // CLIPACTIONRECORD onClipEvent(load).as
        //   c = 0;
        clip.vars.c = 0;
      },
      onEnterFrame: (clip, ctx) => {
        // Synthetic: mirrors DefineSprite_5/frame_1/PlaceObject2_3_3/
        // CLIPACTIONRECORD onClipEvent(enterFrame).as
        //   if (c < 6) { c += 1; this.attachMovie("pierres","pierres"+c,c); }
        const c = clip.vars.c as number;
        if (c < 6) {
          const next = c + 1;
          clip.attach(this.pierresSym, `pierres${next}`, next, ctx);
          clip.vars.c = next;
        }
      },
      frameScripts: new Map([
        [
          15,
          () => {
            // AS: DefineSprite_23/frame_16/DoAction.as → this.end()
            // Fires signalHit (damage popup at target).
            this.runtime.signalHit();
          },
        ],
        [
          72,
          (clip) => {
            // AS: DefineSprite_6_shoot/frame_73/DoAction.as
            //   _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.pierresSym);
    this.registry.register(this.shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: scripts/frame_1/DoAction.as
    //   SOMA.playSound("lakam_405");
    //   level = 5;
    callbacks.playSound("lakam_405");
    // level=5 is hardcoded in the canonical AS main timeline — store on
    // root.vars so any descendant traversal for `_parent.level` finds it.
    this.root.vars.level = 5;

    // The `shoot` symbol is the single top-level authored timeline for this
    // spell (displayType=11, target cell). Attach it at the root so it
    // starts ticking from the next runtime frame.
    this.root.attach(this.shootSym, "shoot", 1, context);
  }
}
