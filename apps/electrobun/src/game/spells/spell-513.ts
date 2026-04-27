/**
 * Spell 513 — Avalanche (Sacrieur / earth boulder impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/513/scripts/scripts/
 *
 * displayType=11 (TargetCell). The `shoot` symbol positions itself at
 * `_parent.cellTo` on frame_4 (DoAction_2.as), which is the target cell
 * in container-local coords under displayType=11. No `move` symbol, no
 * ballistic arc, no caster reference — pure impact animation at target.
 *
 * Library symbols:
 *   - lib_pierres — single-frame stone/pebble particle. onLoad seeds vx/vy
 *     scatter, parent offset, scale [60,100]%, alpha [20,110], vertical
 *     velocity v (upward), rotation speed vr. onEnterFrame integrates
 *     parent position, bounces particle off y=0, eventually settles.
 *
 * There is also an unnamed sprite (DefineSprite_60) that acts as a
 * container for 5 `pierres` instances. It is referenced by `shoot`'s
 * timeline at the canonical impact frames. Because the manifest has no
 * `librarySymbols` entry for DefineSprite_60 under its own name (it is
 * only referenced internally by `shoot`), we inline its onLoad logic
 * into a "rocks" container symbol that `shoot` attaches at the right
 * moment.
 *
 * shoot — 264-frame composite animation at target cell:
 *   frame_4   : playSound("many_501"); position self at cellTo.
 *   frame_109  : playSound("many_502").
 *   frame_124  : playSound("explosion").
 *   frame_127  : this.end() → signalHit.
 *   frame_151  : playSound("pic"); attach rocks group 1.
 *   frame_166  : playSound("pic"); attach rocks group 2.
 *   frame_181  : playSound("pic"); attach rocks group 3.
 *   frame_193  : playSound("pic"); attach rocks group 4.
 *   frame_262  : _parent.removeMovieClip(); stop() → complete.
 *
 * Main timeline: no explicit sounds (all sounds are inside shoot's
 * timeline); onSpellStart attaches shoot at root.
 *
 * Sound timing note: the manifest `sounds[]` array records the sounds at
 * the same frames listed in the AS frame scripts. We play them directly
 * from the frameScripts callbacks using the captured `callbacks.playSound`.
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

const SHOOT_BOUNDS = {
  width: 177.65,
  height: 220.1,
  offsetX: -89.65,
  offsetY: -175.25,
};

export class Spell513 extends RuntimeSpell {
  readonly spellId = 513;
  readonly displayType = SpellDisplayType.TargetCell;

  /** Captured in onSpellStart so frame scripts can call playSound. */
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const pierresAnchor = calculateAnchor(PIERRES_BOUNDS);
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- lib_pierres — stone particle ----------------------------
    // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    const pierresSym: SymbolDefinition = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,
      onLoad: (clip) => {
        // AS onClipEvent(load):
        //   var vx = 5 * (Math.random() - 0.5);
        //   var vy = 2 * (Math.random() - 0.5);
        //   _parent._x = 20 * (Math.random() - 0.5);
        //   _parent._y = 10 * (Math.random() - 0.5);
        //   var t = 60 + 40 * Math.random();
        //   _xscale = t; _yscale = t;
        //   _alpha = 20 + random(90);
        //   var v = -15 * Math.random() - 5;
        //   var vr = 140 * (-0.5 + Math.random());
        clip.vars.vx = 5 * (Math.random() - 0.5);
        clip.vars.vy = 2 * (Math.random() - 0.5);
        // _parent._x / _parent._y refer to the parent container (rocks group).
        // We position the parent in the rocks container's onLoad below.
        // Here we also scatter this clip's own parent offset via vars so
        // the enterFrame handler can apply it to _parent (the rocks group).
        clip.vars.parentOffsetX = 20 * (Math.random() - 0.5);
        clip.vars.parentOffsetY = 10 * (Math.random() - 0.5);
        if (clip.parent) {
          clip.parent.x = clip.vars.parentOffsetX as number;
          clip.parent.y = clip.vars.parentOffsetY as number;
        }
        const t = 60 + 40 * Math.random();
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (20 + Math.floor(Math.random() * 90)) / 100;
        clip.vars.v = -15 * Math.random() - 5;
        clip.vars.vr = 140 * (-0.5 + Math.random());
        clip.vars.t = 0; // 't' flag: 0 = active, 1 = settled
      },
      onEnterFrame: (clip) => {
        // AS onClipEvent(enterFrame):
        //   _parent._x += vx;
        //   _parent._y += vy;
        //   if(t != 1) {
        //     _Y += v;
        //     _rotation += vr;
        //     v += 1;
        //     if(_Y > 0) {
        //       vx /= 2; vy /= 2;
        //       _rotation = 0; _Y = 0;
        //       v = (-v) / 4;
        //       if(Math.abs(v) < 1) { vx=0; vy=0; t=1; }
        //     }
        //   }
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        let v = clip.vars.v as number;
        const vr = clip.vars.vr as number;
        const settled = clip.vars.t as number;

        if (clip.parent) {
          clip.parent.x += vx;
          clip.parent.y += vy;
        }

        if (settled !== 1) {
          clip.y += v;
          // AS rotation in degrees → radians for Pixi.
          clip.rotation += (vr * Math.PI) / 180;
          v += 1;

          if (clip.y > 0) {
            vx = vx / 2;
            vy = vy / 2;
            clip.rotation = 0;
            clip.y = 0;
            v = (-v) / 4;

            if (Math.abs(v) < 1) {
              vx = 0;
              vy = 0;
              clip.vars.t = 1;
            }
          }

          clip.vars.vx = vx;
          clip.vars.vy = vy;
          clip.vars.v = v;
        }
      },
    };

    // ---- rocks — container that holds 5 pierres instances --------
    // Mirrors DefineSprite_60. Its only authored content is:
    //   AS: DefineSprite_60/frame_1/PlaceObject2_59_1/onClipEvent(load).as
    //     c = 0; while(c < 5) { this.attachMovie("pierres","pierres"+c,c); c++; }
    // No enterFrame, no frame scripts beyond the onLoad attachMovies.
    const rocksSym: SymbolDefinition = {
      name: "rocks",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_60/frame_1/PlaceObject2_59_1/onClipEvent(load).as:
        //   c = 0;
        //   while(c < 5) { this.attachMovie("pierres","pierres"+c,c); c++; }
        for (let c = 0; c < 5; c++) {
          clip.attach(pierresSym, `pierres${c}`, c, ctx);
        }
      },
    };

    // ---- shoot — 264-frame composite at target cell --------------
    // AS: DefineSprite_64_shoot/frame_N/DoAction.as
    // frames: [], container-only (visual content is in the baked shoot frames
    // but the scriptable behavior is what matters here — the textures are
    // loaded separately as the "shoot" animation).
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 264,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          3,
          (clip) => {
            // AS DefineSprite_64_shoot/frame_4/DoAction.as:
            //   SOMA.playSound("many_501");
            this.soundCallback?.("many_501");

            // AS DefineSprite_64_shoot/frame_4/DoAction_2.as:
            //   _X = _parent.cellTo.x;
            //   _Y = _parent.cellTo.y;
            // For displayType=11, container is already at target cell (0,0
            // local). But the AS still explicitly sets position here.
            // Under displayType=11 the container origin IS cellTo, so
            // container-local coords of cellTo are (0,0). We apply it.
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y;
            }
          },
        ],
        [
          108,
          () => {
            // AS DefineSprite_64_shoot/frame_109/DoAction.as:
            //   SOMA.playSound("many_502");
            this.soundCallback?.("many_502");
          },
        ],
        [
          123,
          () => {
            // AS DefineSprite_64_shoot/frame_124/DoAction.as:
            //   SOMA.playSound("explosion");
            this.soundCallback?.("explosion");
          },
        ],
        [
          126,
          () => {
            // AS DefineSprite_64_shoot/frame_127/DoAction.as:
            //   this.end();
            // Canonical hit signal — damage popup fires here.
            this.runtime.signalHit();
          },
        ],
        [
          150,
          (clip, ctx) => {
            // AS DefineSprite_64_shoot/frame_151/DoAction.as:
            //   SOMA.playSound("pic");
            // Plus: rock group spawned at impact. DefineSprite_60 is
            // attached around the falling-rocks frames.
            this.soundCallback?.("pic");
            clip.attach(rocksSym, "rocks1", 10, ctx);
          },
        ],
        [
          165,
          (clip, ctx) => {
            // AS DefineSprite_64_shoot/frame_166/DoAction.as:
            //   SOMA.playSound("pic");
            this.soundCallback?.("pic");
            clip.attach(rocksSym, "rocks2", 11, ctx);
          },
        ],
        [
          180,
          (clip, ctx) => {
            // AS DefineSprite_64_shoot/frame_181/DoAction.as:
            //   SOMA.playSound("pic");
            this.soundCallback?.("pic");
            clip.attach(rocksSym, "rocks3", 12, ctx);
          },
        ],
        [
          192,
          (clip, ctx) => {
            // AS DefineSprite_64_shoot/frame_193/DoAction.as:
            //   SOMA.playSound("pic");
            this.soundCallback?.("pic");
            clip.attach(rocksSym, "rocks4", 13, ctx);
          },
        ],
        [
          261,
          (clip) => {
            // AS DefineSprite_64_shoot/frame_262/DoAction.as:
            //   _parent.removeMovieClip();
            //   stop();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(pierresSym);
    this.registry.register(rocksSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for use inside frame scripts.
    this.soundCallback = callbacks.playSound;

    // Main timeline implicitly places shoot on frame_1. Attach it here
    // so it starts ticking from the next runtime frame.
    const shootSym = this.registry.resolve("shoot");
    if (shootSym) {
      this.root.attach(shootSym, "shoot", 1, context);
    }
  }
}
