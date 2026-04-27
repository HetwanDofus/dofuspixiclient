/**
 * Spell 2000 — Wabbit attack.
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2000/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). The container sits at world origin (0,0);
 * all children position themselves using absolute world coords from
 * _parent.cellFrom / _parent.cellTo stored on root.vars by the harness.
 *
 * Main timeline layout:
 *   frame_1/DoAction.as:  SOMA.playSound("wab_2000a")
 *   frame_2/DoAction.as:  stop()
 *   frame_2 also places PlaceObject2_3_1 (the boule projectile container)
 *   and DefineSprite_13 (the target-side impact animation) on the root.
 *
 * DefineSprite_13 (sprite_13, 42 frames, placed at root):
 *   frame_1/DoAction.as:   SOMA.playSound("wab_2000b")
 *   frame_1/DoAction_2.as: _X = _parent.cellTo.x; _Y = _parent.cellTo.y; this.end()
 *                          → positions itself at cellTo, fires signalHit
 *   frame_40/DoAction.as:  stop(); _parent.removeMovieClip() → spell complete
 *
 * PlaceObject2_3_1 (boule_container, placed at root on frame_2):
 *   onClipEvent(load):      seed position at caster, init spring-physics vars,
 *                           set inner boule _yscale=200, _xscale=50
 *   onClipEvent(enterFrame): multi-waypoint spring motion toward target;
 *                            drives rotation + squash/stretch scale on self;
 *                            at t==66 calls _parent.gotoAndStop(3) which we
 *                            model as removing the boule container.
 *
 * Library symbols: none (librarySymbols[] is absent from manifest).
 * sprite_13 appears in animations[] — use bare "sprite_13" key (no lib_ prefix).
 * boule_container has no authored frame textures (container-only).
 *
 * signalHit: fired from sprite_13 frameScripts[0] (mirrors "this.end()").
 * complete:  fired from sprite_13 frameScripts[39] (mirrors "_parent.removeMovieClip()").
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

const SPRITE_13_BOUNDS = {
  width: 76.85,
  height: 50.9,
  offsetX: -38.6,
  offsetY: -28.85,
};

export class Spell2000 extends RuntimeSpell {
  readonly spellId = 2000;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private sprite13Sym!: SymbolDefinition;
  private bouleContainerSym!: SymbolDefinition;
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const sprite13Anchor = calculateAnchor(SPRITE_13_BOUNDS);

    // ---- sprite_13 — impact animation at target cell -------------
    // Canonical: scripts/DefineSprite_13/frame_1/DoAction.as
    //            scripts/DefineSprite_13/frame_1/DoAction_2.as
    //            scripts/DefineSprite_13/frame_40/DoAction.as
    this.sprite13Sym = {
      name: "sprite_13",
      totalFrames: 42,
      frames: textures.getFrames("sprite_13"),
      anchorX: sprite13Anchor.x,
      anchorY: sprite13Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: scripts/DefineSprite_13/frame_1/DoAction.as
            // SOMA.playSound("wab_2000b")
            this.soundCallback?.("wab_2000b");

            // AS: scripts/DefineSprite_13/frame_1/DoAction_2.as
            // _X = _parent.cellTo.x; _Y = _parent.cellTo.y; this.end()
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y;
            }
            // this.end() → damage popup at target
            this.runtime.signalHit();
          },
        ],
        [
          39,
          (clip) => {
            // AS: scripts/DefineSprite_13/frame_40/DoAction.as
            // stop(); _parent.removeMovieClip()
            clip.stop();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- boule_container — projectile driven by spring physics ---
    // Container-only (no authored frame textures). Driven entirely by
    // onClipEvent(load) and onClipEvent(enterFrame).
    //
    // The canonical SWF has an inner "boule" child whose _xscale/_yscale
    // are manipulated. We model the squash/stretch directly on this clip's
    // own scaleX/scaleY since we have no authored sub-child.
    //
    // Canonical: scripts/frame_2/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(load).as
    //            scripts/frame_2/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.bouleContainerSym = {
      name: "boule_container",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: onClipEvent(load)
        // x1 = _parent.cellFrom.x; y1 = _parent.cellFrom.y
        // x2 = _parent.cellTo.x;   y2 = _parent.cellTo.y
        // px = x1; py = y1 - 120
        // _X = x1; _Y = y1 - 70
        // boule._yscale = 200; boule._xscale = 50
        // t = 0; v = 0
        const root = clip.parent;
        const cellFrom = root?.vars.cellFrom as { x: number; y: number } | undefined;
        const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
        const x1 = cellFrom?.x ?? 0;
        const y1 = cellFrom?.y ?? 0;
        const x2 = cellTo?.x ?? 0;
        const y2 = cellTo?.y ?? 0;
        clip.vars.x1 = x1;
        clip.vars.y1 = y1;
        clip.vars.x2 = x2;
        clip.vars.y2 = y2;
        clip.vars.px = x1;
        clip.vars.py = y1 - 120;
        clip.x = x1;
        clip.y = y1 - 70;
        // boule inner _yscale=200, _xscale=50 → decimal
        clip.scaleY = 200 / 100;
        clip.scaleX = 50 / 100;
        clip.vars.t = 0;
        clip.vars.v = 0;
      },
      onEnterFrame: (clip) => {
        // AS: onClipEvent(enterFrame)
        let t = clip.vars.t as number;
        const x1 = clip.vars.x1 as number;
        const y1 = clip.vars.y1 as number;
        const x2 = clip.vars.x2 as number;
        const y2 = clip.vars.y2 as number;
        let px = clip.vars.px as number;
        let py = clip.vars.py as number;

        // AS: if(t++ == 21) { ... }
        // Post-increment: test THEN increment. So we test at current t, then bump.
        if (t === 21) {
          px = x1 + (x2 - x1) / 6 + (-0.5 + Math.random()) * 100;
          py = y1 + (y2 - y1) / 6 + (-0.5 + Math.random()) * 50 - 50;
          clip.vars.px = px;
          clip.vars.py = py;
        }
        t++;
        clip.vars.t = t;

        if (t === 42) {
          px = x2;
          py = y2 - 100;
          clip.vars.px = px;
          clip.vars.py = py;
        }
        if (t === 63) {
          px = x2;
          py = y2 + 50;
          clip.vars.px = px;
          clip.vars.py = py;
        }
        if (t === 66) {
          // AS: _parent.gotoAndStop(3)
          // The outer mc transitions away; we model this by removing the
          // boule container to halt further projectile ticking.
          clip.remove();
          return;
        }

        const vx = (-(clip.x - px)) / 9;
        const vy = (-(clip.y - py)) / 9;
        let v = Math.sqrt(vx * vx + vy * vy);

        // AS: _rotation = Math.atan2(vy,vx) * 57.29746936176985
        // 57.29... = 180/PI converts atan2 result (radians) to degrees for Flash.
        // clip.rotation expects radians, so we use atan2 directly.
        clip.rotation = Math.atan2(vy, vx);

        if (v > 6) {
          v = 6;
        }
        clip.vars.v = v;

        // AS: boule._xscale = 100 + 3*v; boule._yscale = 100 - 3*v
        // Applied to this clip directly (no authored sub-child).
        clip.scaleX = (100 + 3 * v) / 100;
        clip.scaleY = (100 - 3 * v) / 100;

        clip.x = clip.x + vx;
        clip.y = clip.y + vy;
      },
    };

    this.registry.register(this.sprite13Sym);
    this.registry.register(this.bouleContainerSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // Capture callbacks so frame scripts inside sprite_13 can play sounds.
    this.soundCallback = callbacks.playSound;

    // AS: scripts/frame_1/DoAction.as — SOMA.playSound("wab_2000a")
    callbacks.playSound("wab_2000a");

    // AS: frame_2/DoAction.as — stop() on main timeline.
    // frame_2 also places PlaceObject2_3_1 (boule_container) and DefineSprite_13
    // (sprite_13) on the root. Attach them so they start ticking next runtime frame.
    this.root.attach(this.bouleContainerSym, "boule_container", 1, context);
    this.root.attach(this.sprite13Sym, "sprite_13", 2, context);
  }
}
