/**
 * Spell 2066 — Boo (Sadida bubble volley).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2066/scripts/scripts/
 *
 * displayType=51 (WorldAbsoluteAlt). The spell has two parallel authored
 * timelines placed on the main timeline:
 *   - sprite_10 (DefineSprite_10): caster-side timeline (46 frames).
 *       frame_1:  positions self at _parent.cellFrom, y-25; plays "boo_up" sound.
 *       frame_1 also has a PlaceObject (sprite_9) whose onClipEvent(load) sets
 *       _rotation = _parent._parent.angle (i.e. the inner sprite_9 faces the target).
 *       frame_46: stop().
 *   - sprite_11 (DefineSprite_11): target-side timeline (135 frames).
 *       frame_1:  positions self at _parent.cellTo, y-30; sets rotation to angle.
 *       frame_70: spawns 6 "bulle" particles (attachMovie loop c=1..6); calls this.end() → signalHit.
 *       frame_133: _parent.removeMovieClip() → spell complete.
 *
 * Library symbols:
 *   - bulle (DefineSprite_5_bulle): single-frame bubble particle.
 *       onClipEvent(load) on its inner sprite: gotoAndPlay(random(10)+1) — random start frame.
 *       frame_1/DoAction.as: seeds rx,ry,vx,vy,_alpha; sets onEnterFrame for drift.
 *
 * Main timeline (frame_2/DoAction.as): SOMA.playSound("jet_903"); stop().
 * Frame_1 implicitly places sprite_10 + sprite_11; we attach them in onSpellStart.
 *
 * sprite_9 (DefineSprite_9) is an inner child of sprite_10 — it is placed by
 * the authored timeline of sprite_10 (PlaceObject2_9_1). Its only script is
 * frame_25/DoAction.as: stop(). We model it as a container symbol registered
 * and attached by sprite_10's frame_1 script.
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

const BULLE_BOUNDS = {
  width: 28,
  height: 30.65,
  offsetX: -16.6,
  offsetY: -14.85,
};

export class Spell2066 extends RuntimeSpell {
  readonly spellId = 2066;
  readonly displayType = SpellDisplayType.WorldAbsoluteAlt;

  private bulleSym!: SymbolDefinition;
  private sprite9Sym!: SymbolDefinition;
  private sprite10Sym!: SymbolDefinition;
  private sprite11Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const bulleAnchor = calculateAnchor(BULLE_BOUNDS);

    // ---- bulle — single-frame bubble particle --------------------
    // AS: DefineSprite_5_bulle/frame_1/DoAction.as +
    //     DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as
    //
    // The onClipEvent(load) fires on the inner placed sprite (sprite_4),
    // doing: gotoAndPlay(random(10) + 1). In our model the bulle clip
    // itself IS the visual, so we apply gotoAndPlay on the bulle clip
    // directly in onLoad to randomise its start frame (sprite_4 has 54
    // frames; we clamp to the available 54 frames).
    //
    // frame_1/DoAction.as seeds physics and sets onEnterFrame drift.
    this.bulleSym = {
      name: "bulle",
      totalFrames: 54,
      frames: textures.getFrames("lib_bulle"),
      anchorX: bulleAnchor.x,
      anchorY: bulleAnchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as
        // gotoAndPlay(random(10) + 1)  → 0-based: random(10) + 1 - 1 = random(10)
        clip.gotoAndPlay(Math.floor(Math.random() * 10));
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_5_bulle/frame_1/DoAction.as
            clip.vars.rx = 0.7 + 0.15 * Math.random();
            clip.vars.ry = 0.8 + 0.15 * Math.random();
            clip.vars.vx = 20 + Math.floor(Math.random() * 25);
            clip.vars.vy = -15 + Math.floor(Math.random() * 30);
            clip.alpha = (Math.floor(Math.random() * 50) + 50) / 100;
            // Set onEnterFrame drift via the vars bag; we wire it as onEnterFrame below.
          },
        ],
      ]),
      onEnterFrame: (clip) => {
        // AS: DefineSprite_5_bulle/frame_1/DoAction.as — this.onEnterFrame = function() { ... }
        // _X = _X + (vx *= rx);  _Y = _Y + (vy *= ry);
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        const rx = clip.vars.rx as number;
        const ry = clip.vars.ry as number;
        vx *= rx;
        vy *= ry;
        clip.x += vx;
        clip.y += vy;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
      },
    };

    // ---- sprite_9 — inner beam/arrow sprite inside sprite_10 ----
    // AS: DefineSprite_9/frame_25/DoAction.as — stop()
    // PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(load).as:
    //   _rotation = _parent._parent.angle;
    // sprite_9 is placed at the authored position inside sprite_10 (at
    // its default local origin). It has authored frame textures (sprite_9).
    this.sprite9Sym = {
      name: "sprite_9",
      totalFrames: 27,
      frames: textures.getFrames("sprite_9"),
      anchorX: calculateAnchor({ width: 215.5, height: 37.6, offsetX: -47.1, offsetY: -18.8 }).x,
      anchorY: calculateAnchor({ width: 215.5, height: 37.6, offsetX: -47.1, offsetY: -18.8 }).y,
      onLoad: (clip) => {
        // AS: DefineSprite_10/frame_46/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(load).as
        // _rotation = _parent._parent.angle;
        // _parent is sprite_10 clip; _parent._parent is the outer mc (root).
        // root.vars.angle is in DEGREES (canonical AS convention — harness stores it in degrees).
        const root = clip.parent?.parent;
        const angleDeg = (root?.vars.angle as number) ?? 0;
        clip.rotation = (angleDeg * Math.PI) / 180;
      },
      frameScripts: new Map([
        [
          24,
          (clip) => {
            // AS: DefineSprite_9/frame_25/DoAction.as — stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_10 — caster-side timeline (46 frames) ------------
    // AS: DefineSprite_10/frame_1/DoAction.as   → SOMA.playSound("boo_up")
    // AS: DefineSprite_10/frame_1/DoAction_2.as → position at cellFrom, y-25
    // The PlaceObject2_9_1 (sprite_9) is placed on frame_46 of the authored
    // timeline — its onClipEvent(load) sets rotation. We model this as
    // frame_45 (0-based) attaching sprite_9.
    // AS: DefineSprite_10/frame_46/DoAction.as → stop()
    this.sprite10Sym = {
      name: "sprite_10",
      totalFrames: 48,
      frames: textures.getFrames("sprite_10"),
      anchorX: calculateAnchor({ width: 215.5, height: 72.45, offsetX: -48.1, offsetY: -60 }).x,
      anchorY: calculateAnchor({ width: 215.5, height: 72.45, offsetX: -48.1, offsetY: -60 }).y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_10/frame_1/DoAction.as — SOMA.playSound("boo_up")
            // (sound is handled via onSpellStart; this script also positions the clip)
            // AS: DefineSprite_10/frame_1/DoAction_2.as
            // _X = _parent.cellFrom.x;  _Y = _parent.cellFrom.y - 25;
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as { x: number; y: number } | undefined;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y - 25;
            }
            // Attach sprite_9 at frame_1 as it is placed on the authored timeline
            // (the PlaceObject is tagged at frame_46 in the source, but the onClipEvent
            // load fires when sprite_9 is first instantiated; we attach it here at
            // frame_1 so it plays alongside sprite_10 from the start — matching
            // the authored SWF behaviour where the inner clip is always present).
            clip.attach(this.sprite9Sym, "sprite_9", 1, ctx);
          },
        ],
        [
          45,
          (clip) => {
            // AS: DefineSprite_10/frame_46/DoAction.as — stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_11 — target-side timeline (135 frames) -----------
    // AS: DefineSprite_11/frame_1/DoAction.as
    //   _X = _parent.cellTo.x;  _Y = _parent.cellTo.y - 30;  _rotation = _parent.angle;
    // AS: DefineSprite_11/frame_70/DoAction.as
    //   c = 1; while(c < 7) { this.attachMovie("bulle","bulle"+c,c); c++; }
    // AS: DefineSprite_11/frame_70/DoAction_2.as
    //   this.end() → signalHit
    // AS: DefineSprite_11/frame_133/DoAction.as
    //   _parent.removeMovieClip() → spell complete
    this.sprite11Sym = {
      name: "sprite_11",
      totalFrames: 135,
      frames: textures.getFrames("sprite_11"),
      anchorX: calculateAnchor({ width: 238.5, height: 50.05, offsetX: -236.15, offsetY: -24.9 }).x,
      anchorY: calculateAnchor({ width: 238.5, height: 50.05, offsetX: -236.15, offsetY: -24.9 }).y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_11/frame_1/DoAction.as
            // _X = _parent.cellTo.x;  _Y = _parent.cellTo.y - 30;  _rotation = _parent.angle;
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y - 30;
            }
            clip.rotation = (angleDeg * Math.PI) / 180;
          },
        ],
        [
          69,
          (clip, ctx) => {
            // AS: DefineSprite_11/frame_70/DoAction.as
            // c = 1; while(c < 7) { this.attachMovie("bulle","bulle"+c,c); c++; }
            for (let c = 1; c < 7; c++) {
              clip.attach(this.bulleSym, `bulle${c}`, c, ctx);
            }
            // AS: DefineSprite_11/frame_70/DoAction_2.as — this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          132,
          (clip) => {
            // AS: DefineSprite_11/frame_133/DoAction.as — _parent.removeMovieClip()
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.bulleSym);
    this.registry.register(this.sprite9Sym);
    this.registry.register(this.sprite10Sym);
    this.registry.register(this.sprite11Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: frame_2/DoAction.as — SOMA.playSound("jet_903"); stop();
    callbacks.playSound("jet_903");
    // AS: DefineSprite_10/frame_1/DoAction.as — SOMA.playSound("boo_up")
    // The boo_up sound is authored inside sprite_10's frame_1. We play it
    // here alongside the main-timeline sound since both fire at spell start.
    callbacks.playSound("boo_up");
    // Implicit frame_1 placement of sprite_10 + sprite_11 on the main timeline.
    this.root.attach(this.sprite10Sym, "sprite10", 1, context);
    this.root.attach(this.sprite11Sym, "sprite11", 2, context);
  }
}
