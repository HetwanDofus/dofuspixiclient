/**
 * Spell 1050 — Sacrieur blood-drop spell.
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1050/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). The outer sprite (DefineSprite_7) positions
 * itself at _parent.cellFrom in its frame_1/DoAction_2.as, and all children
 * (goutte drops) are spawned relative to that position. The harness exposes
 * cellFrom/cellTo on root.vars; the sprite_7 symbol reads those in its
 * frame_1 script. Since the spell positions itself via _parent.cellFrom
 * (world coords) rather than being anchored at the target or caster directly
 * by the harness, this is a WorldAbsolute pattern.
 *
 * Architecture:
 *   - Main timeline (frame_2/DoAction.as): stop(). No sound on main timeline.
 *   - DefineSprite_7 (78-frame outer container):
 *       frame_1/DoAction.as: SOMA.playSound("sacrieur_1050")
 *       frame_1/DoAction_2.as: position self at cellFrom, spawn 19 goutte drops
 *       frame_43/DoAction.as: this.end() → signalHit
 *       frame_49/DoAction.as: SOMA.playSound("sacrieur_1050b")
 *       frame_76/DoAction.as: _parent.removeMovieClip(); stop() → complete
 *   - DefineSprite_4 (30-frame sprite_4, composite): used as the drop visual
 *       frame_1/PlaceObject2_2_1/onClipEvent(load): alpha 50-100%, scale 50-110%
 *       frame_28/DoAction.as: stop()
 *   - DefineSprite_5_goutte (library symbol "goutte", 1 frame wrapper):
 *       frame_1/DoAction.as: seed vx/vy on parent clip; attach onEnterFrame to drift
 *       PlaceObject2_4_1/onClipEvent(load): the inner sprite_4 child — stop(), y=-1, g=0.67, f seed
 *       PlaceObject2_4_1/onClipEvent(enterFrame): gravity integration; on landing play() + stop drift
 *
 * Library symbols:
 *   - lib_goutte — single-frame drop container. frame_1 seeds vx/vy drift;
 *     inner child (sprite_4) has gravity physics via onLoad/onEnterFrame clip events.
 *
 * Note on the two-layer structure:
 *   DefineSprite_5_goutte is a 1-frame wrapper that:
 *     1. In its DoAction.as (frame_1): seeds vx/vy on itself, attaches a
 *        self-updating onEnterFrame to drift _X/_Y.
 *     2. Contains a PlaceObject2 child (the sprite_4 visual) that has its
 *        own load/enterFrame clip events for gravity.
 *   We model the goutte as a single SymbolDefinition whose onLoad seeds the
 *   parent-level vars (vx, vy, g, f, fin) and whose onEnterFrame drives both
 *   the horizontal drift AND the gravity of the inner visual — collapsed into
 *   one clip since SpellClip doesn't support sub-clip events separately.
 *   The sprite_4 visual frames are played through via the goutte's frameScripts.
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

const GOUTTE_BOUNDS = {
  width: 20.4,
  height: 17.4,
  offsetX: -10.2,
  offsetY: -12.3,
};

export class Spell1050 extends RuntimeSpell {
  readonly spellId = 1050;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private sprite7Sym!: SymbolDefinition;
  private goutteSym!: SymbolDefinition;

  // Sound callback captured in onSpellStart for use inside frame scripts.
  private playSound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const goutteAnchor = calculateAnchor(GOUTTE_BOUNDS);

    // ---- lib_goutte — blood drop particle -------------------------
    // Canonical: DefineSprite_5_goutte
    //
    // The goutte symbol is a 1-frame container. Its authored content:
    //   - DoAction.as (frame_1): seeds vx/vy drift on the clip itself,
    //     attaches an onEnterFrame that moves _X/_Y by those deltas.
    //   - PlaceObject2_4_1 child (sprite_4): the visual, with gravity
    //     physics via onClipEvent(load) / onClipEvent(enterFrame).
    //
    // We collapse the two layers: the outer drift and the inner gravity
    // are both driven from the single SpellClip's onLoad + onEnterFrame.
    // The sprite_4 frames (30-frame composite) are rendered through the
    // goutte clip's own frames array (lib_goutte has 1 frame but we use
    // sprite_4's frames for the visual; the manifest's lib_goutte entry
    // points at lib_goutte_0.svg which is the same art as sprite_4_0).
    //
    // Physics model (collapsed):
    //   onLoad:
    //     - AS DefineSprite_5_goutte/frame_1/DoAction.as:
    //         vx = 7.5 * (-0.5 + Math.random())
    //         vy = 3.75 * (-0.5 + Math.random())
    //     - AS PlaceObject2_4_1/onClipEvent(load):
    //         _alpha = 50 + random(50)   (on inner sprite — apply to clip)
    //         t = 50 + random(60)        (scale 50-110%)
    //         _xscale = _yscale = t
    //         _Y = -1  (start above ground)
    //         g = 0.67
    //         f = -11 - 1.67 * Math.random()  (upward velocity, negative)
    //         fin = 0
    //
    //   onEnterFrame (combined drift + gravity):
    //     - Horizontal drift (from outer DoAction.as onEnterFrame):
    //         _X += vx; _Y += vy  (vy is also applied while still falling)
    //     - Gravity (from PlaceObject2_4_1/onClipEvent(enterFrame)):
    //         if inner _Y < 0:  f += g; inner _Y += f
    //         else if fin != 1: play(); fin = 1; vx = 0; vy = 0
    //
    // Since we don't have a separate inner clip, we track a single
    // "dropY" local that simulates the inner sprite_4's _Y, and drive
    // the combined y-motion from there.
    this.goutteSym = {
      name: "goutte",
      totalFrames: 1,
      frames: textures.getFrames("lib_goutte"),
      anchorX: goutteAnchor.x,
      anchorY: goutteAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_5_goutte/frame_1/DoAction.as
        clip.vars.vx = 7.5 * (-0.5 + Math.random());
        clip.vars.vy = 3.75 * (-0.5 + Math.random());

        // AS DefineSprite_5_goutte/frame_1/PlaceObject2_4_1/onClipEvent(load)
        const alpha = 50 + Math.floor(Math.random() * 50);
        clip.alpha = alpha / 100;
        const t = 50 + Math.floor(Math.random() * 60);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        // dropY simulates the inner sprite_4's _Y (starts at -1, falls to 0)
        clip.vars.dropY = -1;
        clip.vars.g = 0.67;
        clip.vars.f = -11 - 1.67 * Math.random();
        clip.vars.fin = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_5_goutte/frame_1/PlaceObject2_4_1/onClipEvent(enterFrame)
        const dropY = clip.vars.dropY as number;
        const fin = clip.vars.fin as number;

        if (dropY < 0) {
          // Still in the air — apply gravity to the inner dropY
          const g = clip.vars.g as number;
          let f = clip.vars.f as number;
          f += g;
          clip.vars.f = f;
          clip.vars.dropY = dropY + f;

          // AS outer onEnterFrame drift: _X += vx; _Y += vy
          const vx = clip.vars.vx as number;
          const vy = clip.vars.vy as number;
          clip.x += vx;
          clip.y += vy;
        } else if (fin !== 1) {
          // Landed — stop drift, start playing the visual timeline
          // AS: play(); fin = 1; _parent.vx = 0; _parent.vy = 0
          clip.vars.fin = 1;
          clip.vars.vx = 0;
          clip.vars.vy = 0;
          // play() in canonical AS starts the sprite_4 splash animation;
          // since we stopped the goutte timeline on load (stop() in AS),
          // calling play() here resumes it. In our model the clip is
          // stopped at frame 0; we resume.
          clip.play();
        }
        // Once landed and fin==1, no drift update needed (vx=vy=0)
      },
      frameScripts: new Map([
        [
          // AS DefineSprite_4/frame_28/DoAction.as: stop()
          // frame_28 → index 27 (0-based)
          27,
          (clip) => {
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_7 — main outer 78-frame timeline -----------------
    // Canonical: DefineSprite_7
    //   frame_1/DoAction.as: SOMA.playSound("sacrieur_1050")
    //   frame_1/DoAction_2.as: position self at cellFrom; spawn 19 goutte
    //   frame_43/DoAction.as: this.end() → signalHit
    //   frame_49/DoAction.as: SOMA.playSound("sacrieur_1050b")
    //   frame_76/DoAction.as: _parent.removeMovieClip(); stop()
    this.sprite7Sym = {
      name: "sprite_7",
      totalFrames: 78,
      frames: textures.getFrames("sprite_7"),
      anchorX: calculateAnchor({
        width: 125.7,
        height: 96.75,
        offsetX: -62.1,
        offsetY: -64.8,
      }).x,
      anchorY: calculateAnchor({
        width: 125.7,
        height: 96.75,
        offsetX: -62.1,
        offsetY: -64.8,
      }).y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_7/frame_1/DoAction.as + DoAction_2.as
            // Sound is played from onSpellStart (main timeline), so
            // here we handle DoAction_2.as: position + spawn gouttes.
            //
            // AS: _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y;
            }

            // AS: c = 1; while(c < 20) { attachMovie("goutte","goutte"+c,c); c++; }
            for (let c = 1; c < 20; c++) {
              clip.attach(this.goutteSym, `goutte${c}`, c, ctx);
            }
          },
        ],
        [
          42,
          (_clip) => {
            // AS DefineSprite_7/frame_43/DoAction.as: this.end()
            this.runtime.signalHit();
          },
        ],
        [
          48,
          (_clip) => {
            // AS DefineSprite_7/frame_49/DoAction.as: SOMA.playSound("sacrieur_1050b")
            this.playSound?.("sacrieur_1050b");
          },
        ],
        [
          75,
          (clip) => {
            // AS DefineSprite_7/frame_76/DoAction.as: _parent.removeMovieClip(); stop()
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.goutteSym);
    this.registry.register(this.sprite7Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS DefineSprite_7/frame_1/DoAction.as: SOMA.playSound("sacrieur_1050")
    // The manifest also records this as sounds[0] at frame 0.
    callbacks.playSound("sacrieur_1050");

    // Capture for use inside frame_49 script
    this.playSound = callbacks.playSound;

    // Attach the outer sprite_7 timeline as a child of root.
    // For WorldAbsolute, the container is at world (0,0); sprite_7's
    // frame_1 script will position it at cellFrom.
    this.root.attach(this.sprite7Sym, "sprite_7", 1, context);
  }
}
