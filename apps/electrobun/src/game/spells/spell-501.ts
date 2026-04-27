/**
 * Spell 501 — Maîtrise des Pierres (Earth impact spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/501/scripts/scripts/
 *
 * displayType=11 (TargetCell). This is a direct impact at the target cell —
 * no projectile motion, no caster reference, no dual-anchored timelines.
 * The "shoot" sprite is the main authored timeline (168 frames) placed at
 * the target. The harness for displayType=11 simply anchors the root at
 * the target cell; all content is driven by the "shoot" animation itself.
 *
 * Wait — looking more carefully at the AS: the manifest has `shoot` and
 * `effet` in `animations[]` (top-level composites), plus `librarySymbols`
 * containing `pierres` and `effet`. The script layout is:
 *
 *   - DefineSprite_10_shoot: 168-frame timeline.
 *       frame_1:  SOMA.playSound("many_501")
 *       frame_166: _parent.removeMovieClip(); stop()  → spell complete
 *
 *   - DefineSprite_7 (unnamed container, attached by shoot's harness?):
 *       onClipEvent(load): attach 10 `pierres` symbols (c < 10)
 *
 *   - lib_effet (DefineSprite_3_effet): 27-frame rock-dust puff.
 *       frame_1: randomise _X/_Y offset, gotoAndPlay(random(10)+1)
 *       frame_25: stop()
 *
 *   - lib_pierres (DefineSprite_13_pierres): single-frame flying rock.
 *       onClipEvent(load): seed vx/vy, v, vr, scale, alpha, parent offset
 *       onClipEvent(enterFrame): gravity + bounce + damping physics
 *
 *   - DefineSprite_14_duplicate: attaches 1 `effet` child.
 *       frame_1: attach effet0
 *
 * The "duplicate" symbol is present (DefineSprite_14_duplicate) and its
 * frame_1 attaches `effet`. The manifest has `duplicate` referenced from
 * `DefineSprite_14_duplicate/frame_1/DoAction.as`. This is the canonical
 * displayType=40/41 (BeamLine) pattern — BUT looking at the script list:
 * there is no `move` symbol, and the main timeline drives a `shoot` that
 * plays sound on frame_1 and removes the parent on frame_166. That is the
 * pure displayType=11 (TargetCell) pattern: the harness attaches `shoot`
 * at the target. The `duplicate` symbol here is a library container that
 * the `shoot` timeline attaches internally to spawn `effet` puffs.
 *
 * Actually re-reading: displayType for this spell is most likely 11
 * (TargetCell) because:
 *  - `shoot` is the main 168-frame timeline anchored at target
 *  - `shoot/frame_1` plays a sound (canonical impact)
 *  - `shoot/frame_166` removes _parent (canonical end)
 *  - No `move` symbol, no caster/angle references
 *  - `duplicate` is just a sub-container used internally by shoot
 *
 * Library symbols:
 *   - lib_pierres — single-frame rock particle. onLoad seeds physics
 *     (vx, vy, v, vr, scale, alpha, parent scatter). onEnterFrame runs
 *     gravity+bounce physics. Instances created by DefineSprite_7's load.
 *   - lib_effet — 27-frame rock-dust puff composite. frame_1 randomises
 *     position and jumps to random start frame; frame_25 stops.
 *
 * Container symbols (frames: []):
 *   - shoot — 168-frame main timeline. frame_1 plays sound; frame_166
 *     removes parent + signals completion.
 *   - duplicate — 1-frame container. frame_1 attaches 1 effet child.
 *   - sprite_7 (the unnamed DefineSprite_7) — 1-frame container whose
 *     onLoad attaches 10 `pierres` children.
 *
 * Main timeline: The root in displayType=11 has no authored frame scripts;
 * we attach `shoot` at root in onSpellStart (harness for displayType=11
 * does NOT auto-attach shoot — that's only for 20/21/30/31). Wait —
 * actually for displayType 20/21/30/31 the harness attaches shoot. For
 * displayType 11, the harness does nothing beyond anchoring. So we must
 * attach shoot ourselves.
 *
 * Re-reading harness.ts for displayType=11 (TargetCell): it just returns
 * immediately with no attachments. So the per-spell module must attach
 * `shoot` from onSpellStart.
 *
 * signalHit: The canonical hit signal for displayType=11 is fired from
 * the shoot timeline. `shoot/frame_1` plays the sound — that's the
 * impact moment. We call `this.runtime.signalHit()` there.
 * `complete()` is called at frame_166 (shoot/frame_166's
 * `_parent.removeMovieClip()`).
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

const EFFET_BOUNDS = {
  width: 39.45,
  height: 39.6,
  offsetX: -18.8,
  offsetY: -40.2,
};

export class Spell501 extends RuntimeSpell {
  readonly spellId = 501;
  readonly displayType = SpellDisplayType.TargetCell;

  private pierresSym!: SymbolDefinition;
  private effetSym!: SymbolDefinition;
  private sprite7Sym!: SymbolDefinition;
  private duplicateSym!: SymbolDefinition;
  private shootSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const pierresAnchor = calculateAnchor(PIERRES_BOUNDS);
    const effetAnchor = calculateAnchor(EFFET_BOUNDS);

    // ---- lib_pierres — flying rock particle ----------------------
    // AS: DefineSprite_13_pierres/frame_1/PlaceObject2_12_1/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // NOTE: The clip events are on a child placed *inside* lib_pierres
    // (PlaceObject2_12_1). In AS, that inner child's clip events
    // control the *parent* (lib_pierres instance) via _parent._x etc.
    // We port this as the pierres symbol's own onLoad/onEnterFrame,
    // controlling clip.parent (the pierres instance) for _parent._x/_y
    // and clip itself for _Y, _rotation, _xscale, _yscale, _alpha.
    // Actually since PlaceObject2_12_1 is the single inner sprite of
    // pierres, and it accesses _parent (= pierres clip), we model the
    // handlers on the pierres clip directly and use clip.parent for
    // the scatter position (_parent._x/_y in AS = the pierres clip's
    // position in its parent container).
    this.pierresSym = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,
      onLoad: (clip) => {
        // AS onClipEvent(load):
        //   var c = 0; var tps = 1;
        //   var vx = 5 * (Math.random() - 0.5);
        //   var vy = 2 * (Math.random() - 0.5);
        //   _parent._x = 20 * (Math.random() - 0.5);
        //   _parent._y = 10 * (Math.random() - 0.5);
        //   var t = 60 + 40 * Math.random();
        //   _xscale = t; _yscale = t;
        //   _alpha = 20 + random(90);
        //   var v = -15 * Math.random() - 5;
        //   var vr = 140 * (-0.5 + Math.random());
        clip.vars.c = 0;
        clip.vars.tps = 1;
        clip.vars.vx = 5 * (Math.random() - 0.5);
        clip.vars.vy = 2 * (Math.random() - 0.5);
        // _parent._x/_y: the pierres instance's position within its
        // parent container (DefineSprite_7). We set it on this clip's
        // own x/y since we are the pierres clip and the AS
        // _parent._x refers to where this clip is placed.
        clip.x = 20 * (Math.random() - 0.5);
        clip.y = 10 * (Math.random() - 0.5);
        const t = 60 + 40 * Math.random();
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (20 + Math.floor(Math.random() * 90)) / 100;
        clip.vars.v = -15 * Math.random() - 5;
        clip.vars.vr = 140 * (-0.5 + Math.random());
        // _Y is the inner sprite's Y — we track it separately as vars.innerY
        clip.vars.innerY = 0;
        clip.vars.t = 1; // t in the enterFrame script (the "settled" flag, init 1 means NOT settled; in AS t is used as float, t!=1 means active physics)
        // Actually re-reading: `var t = 60 + 40 * Math.random()` is the scale t,
        // and `if (t != 1)` in enterFrame checks the SAME t. So t starts at
        // a value like 73.4, and `t != 1` is true → physics runs.
        // When the rock settles: `t = 1`. So t is a dual-purpose var:
        // initially the scale %, then set to 1 to mark "settled".
        // We store the physics-active flag in vars.tSettle.
        clip.vars.tSettle = t; // initial value (not 1 → physics active)
        clip.vars.innerY = 0;  // tracks the inner _Y (vertical offset)
      },
      onEnterFrame: (clip) => {
        // AS onClipEvent(enterFrame):
        //   if (c++ == 10) { tps = 0.15; }
        //   if (c == 75)   { tps = 1; }
        //   _parent._x += vx * tps;
        //   _parent._y += vy * tps;
        //   if (t != 1) {
        //     _Y = _Y + v * tps;
        //     _rotation = _rotation + vr * tps;
        //     v += 0.75 * tps;
        //     if (_Y > 0) {
        //       vx /= 2; vy /= 5; _rotation = 0; _Y = 0;
        //       v = (-v) / 4;
        //       if (Math.abs(v) < 1) { vx = 0; vy = 0; t = 1; }
        //     }
        //   }
        let c = clip.vars.c as number;
        let tps = clip.vars.tps as number;
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        let v = clip.vars.v as number;
        let vr = clip.vars.vr as number;
        let innerY = clip.vars.innerY as number;
        let tSettle = clip.vars.tSettle as number;

        if (c === 10) {
          tps = 0.15;
        }
        c++;
        if (c === 75) {
          tps = 1;
        }

        // _parent._x/_y: this clip's position in parent (scatter drift)
        clip.x += vx * tps;
        clip.y += vy * tps;

        if (tSettle !== 1) {
          innerY = innerY + v * tps;
          clip.rotation += (vr * tps * Math.PI) / 180;
          v += 0.75 * tps;

          if (innerY > 0) {
            vx = vx / 2;
            vy = vy / 5;
            clip.rotation = 0;
            innerY = 0;
            v = (-v) / 4;
            if (Math.abs(v) < 1) {
              vx = 0;
              vy = 0;
              tSettle = 1;
            }
          }
        }

        clip.vars.c = c;
        clip.vars.tps = tps;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
        clip.vars.v = v;
        clip.vars.vr = vr;
        clip.vars.innerY = innerY;
        clip.vars.tSettle = tSettle;
      },
    };

    // ---- lib_effet — 27-frame rock-dust puff composite -----------
    // AS: DefineSprite_3_effet/frame_1/DoAction.as
    //   _X = 30 * (-0.5 + Math.random());
    //   _Y = 10 * (-0.5 + Math.random());
    //   gotoAndPlay(random(10) + 1);
    //
    // AS: DefineSprite_3_effet/frame_25/DoAction.as
    //   stop();
    this.effetSym = {
      name: "effet",
      totalFrames: 27,
      frames: textures.getFrames("lib_effet"),
      anchorX: effetAnchor.x,
      anchorY: effetAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_3_effet/frame_1/DoAction.as
            clip.x = 30 * (-0.5 + Math.random());
            clip.y = 10 * (-0.5 + Math.random());
            // AS: gotoAndPlay(random(10) + 1) → 0-based: random start in [0..9]
            const startFrame = Math.floor(Math.random() * 10);
            clip.gotoAndPlay(startFrame);
          },
        ],
        [
          24,
          (clip) => {
            // AS DefineSprite_3_effet/frame_25/DoAction.as
            clip.stop();
          },
        ],
      ]),
    };

    // ---- DefineSprite_7 — unnamed container that spawns pierres --
    // AS: DefineSprite_7/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
    //   c = 0;
    //   while (c < 10) {
    //     this.attachMovie("pierres", "pierres" + c, c);
    //     c++;
    //   }
    //
    // This is a container-only symbol: no authored visual, just spawns
    // 10 pierres on load. It is attached by `shoot` internally.
    this.sprite7Sym = {
      name: "sprite_7",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_7/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
        for (let c = 0; c < 10; c++) {
          clip.attach(this.pierresSym, `pierres${c}`, c, ctx);
        }
      },
    };

    // ---- duplicate — 1-frame container that spawns 1 effet -------
    // AS: DefineSprite_14_duplicate/frame_1/DoAction.as
    //   c = 0;
    //   while (c < 1) {
    //     this.attachMovie("effet", "effet" + c, c);
    //     c++;
    //   }
    this.duplicateSym = {
      name: "duplicate",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_14_duplicate/frame_1/DoAction.as
            for (let c = 0; c < 1; c++) {
              clip.attach(this.effetSym, `effet${c}`, c, ctx);
            }
          },
        ],
      ]),
    };

    // ---- shoot — 168-frame main impact timeline ------------------
    // AS: DefineSprite_10_shoot/frame_1/DoAction.as
    //   SOMA.playSound("many_501");
    // AS: DefineSprite_10_shoot/frame_166/DoAction.as
    //   _parent.removeMovieClip(); stop();
    //
    // The shoot timeline is a container-only symbol (its visual content
    // is the authored composite in animations["shoot"], but we need it
    // as a container to host the sub-symbols). However, the manifest
    // shows shoot has its own 168-frame composite animation. We include
    // those frames so the authored content plays.
    this.shootSym = {
      name: "shoot",
      totalFrames: 168,
      frames: textures.getFrames("shoot"),
      anchorX: calculateAnchor({
        width: 151.65,
        height: 106.55,
        offsetX: -76.3,
        offsetY: -68.1,
      }).x,
      anchorY: calculateAnchor({
        width: 151.65,
        height: 106.55,
        offsetX: -76.3,
        offsetY: -68.1,
      }).y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS DefineSprite_10_shoot/frame_1/DoAction.as
            // SOMA.playSound("many_501") — sound is handled in onSpellStart.
            // Signal hit at the first impact frame.
            this.runtime.signalHit();
          },
        ],
        [
          165,
          (clip) => {
            // AS DefineSprite_10_shoot/frame_166/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.pierresSym);
    this.registry.register(this.effetSym);
    this.registry.register(this.sprite7Sym);
    this.registry.register(this.duplicateSym);
    this.registry.register(this.shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Main timeline frame_1: SOMA.playSound("many_501")
    // The sound is declared on the shoot symbol's frame_1 in canonical AS,
    // but in practice the combat system fires it at spell start.
    callbacks.playSound("many_501");

    // For displayType=11 (TargetCell) the harness does not auto-attach
    // shoot. We attach it here so the 168-frame timeline starts ticking
    // from the next runtime frame. Root is at target cell (0,0 local).
    this.root.attach(this.shootSym, "shoot", 1, context);
  }
}
