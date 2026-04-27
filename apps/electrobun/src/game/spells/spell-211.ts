/**
 * Spell 211 — Craqueleur (Cra earth arrow / crack shot).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/211/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). The main timeline frame_2 script
 * (PlaceObject2_22_1/onClipEvent(load)) reads _parent.cellFrom and
 * _parent.cellTo to position its children at WORLD coords — canonical
 * pattern for WorldAbsolute. The outer container sits at (0,0) and
 * per-spell scripts do the explicit world placement.
 *
 * Manifest animations (no librarySymbols — NO lib_ prefix anywhere):
 *   - sprite_21  — 93-frame horizontal crack/beam animation placed at
 *                  cellFrom, rotated to face cellTo. Stops at frame 67
 *                  (DefineSprite_21/frame_67: stop()). No hit/complete
 *                  signals from this sprite.
 *   - sprite_22  — 93-frame composite beam body (the "clac" stretched
 *                  segment). Its onClipEvent(load) sets _width based on
 *                  the parent distance `d`. Placed at cellFrom rotated
 *                  toward cellTo; acts as the beam visual.
 *   - sprite_28  — 114-frame impact composite at cellTo. frame_37 fires
 *                  this.end() (signalHit) and plays "crockette_211".
 *                  frame_112 calls _parent.removeMovieClip() → complete.
 *
 * Additionally, DefineSprite_26 is an inline dust/spark particle
 * spawned by sprite_22's frame_1 (the "clac" onLoad seeds it as a
 * child). However, the only onClipEvent in the manifest for the main
 * timeline is frame_2/PlaceObject2_22_1 which places the sprite_22
 * child ("clac") and also sets _parent.clac._x/_y to cellTo, and
 * positions itself at cellFrom. sprite_26 (the dust puff) is placed
 * as a child of clac and its frame_1 seeds scatter/scale/alpha physics.
 *
 * Main timeline (frame_2/DoAction.as): stop().
 * Main timeline places "clac" (sprite_22) at depth 1 with the load
 * event that positions it. We also need to place sprite_28 at cellTo.
 *
 * Architecture: displayType=50 (WorldAbsolute). Root at (0,0).
 * onSpellStart attaches sprite_28 (impact) and sprite_22 (beam/clac).
 * sprite_22's frame_1 is where the load event fires (positions beam).
 * sprite_28's frame_37 signals hit + sound; frame_112 signals complete.
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

const SPRITE_21_BOUNDS = {
  width: 394.8,
  height: 95.35,
  offsetX: -9.35,
  offsetY: -53.8,
};

const SPRITE_22_BOUNDS = {
  width: 224.9,
  height: 95.35,
  offsetX: 1.75,
  offsetY: -53.95,
};

const SPRITE_28_BOUNDS = {
  width: 59,
  height: 49.75,
  offsetX: -27.35,
  offsetY: -24.25,
};

export class Spell211 extends RuntimeSpell {
  readonly spellId = 211;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private sprite21Sym!: SymbolDefinition;
  private sprite22Sym!: SymbolDefinition;
  private sprite28Sym!: SymbolDefinition;
  private sprite26Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite21Anchor = calculateAnchor(SPRITE_21_BOUNDS);
    const sprite22Anchor = calculateAnchor(SPRITE_22_BOUNDS);
    const sprite28Anchor = calculateAnchor(SPRITE_28_BOUNDS);

    // ---- sprite_26 — dust/spark puff particle -------------------
    // AS DefineSprite_26/frame_1/DoAction.as:
    //   _X = 30 * (-0.5 + Math.random())
    //   _Y = 30 * (-0.5 + Math.random())
    //   ta = 150 + random(50)
    //   t = 100 + 400 * Math.random()
    //   va = 1.3 + 1.3 * Math.random()
    //   onEnterFrame: ta -= (ta - t) / 7; _xscale = ta; _yscale = ta; _alpha -= va
    // sprite_26 has no authored frame textures in the manifest — it is
    // a container-only particle. Its visual is driven purely by the
    // scale/alpha animation seeded in frame_1. We treat it as frames:[]
    // (invisible container) for now; the visual comes from the
    // authored DefineSprite_26 graphic frames not present in this manifest.
    this.sprite26Sym = {
      name: "sprite_26",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_26/frame_1/DoAction.as
            clip.x = 30 * (-0.5 + Math.random());
            clip.y = 30 * (-0.5 + Math.random());
            const ta = 150 + Math.floor(Math.random() * 50);
            const t = 100 + 400 * Math.random();
            const va = 1.3 + 1.3 * Math.random();
            clip.scaleX = ta / 100;
            clip.scaleY = ta / 100;
            clip.vars.ta = ta;
            clip.vars.t = t;
            clip.vars.va = va;
            clip.onEnterFrame = (c) => {
              let currentTa = c.vars.ta as number;
              const currentT = c.vars.t as number;
              const currentVa = c.vars.va as number;
              currentTa -= (currentTa - currentT) / 7;
              c.scaleX = currentTa / 100;
              c.scaleY = currentTa / 100;
              c.alpha -= currentVa / 100;
              c.vars.ta = currentTa;
            };
          },
        ],
      ]),
    };

    // ---- sprite_21 — horizontal crack beam at cellFrom ----------
    // AS DefineSprite_21/frame_67/DoAction.as: stop()
    // No librarySymbols entry — textures under bare name "sprite_21".
    // Positioned at cellFrom, rotated toward cellTo, via the outer
    // frame_2 PlaceObject2_22_1 onClipEvent(load) logic (which also
    // positions the "clac" / sprite_22). We apply the same world coords
    // in the symbol's frame_1 frameScript by reading root.vars.
    this.sprite21Sym = {
      name: "sprite_21",
      totalFrames: 93,
      frames: textures.getFrames("sprite_21"),
      anchorX: sprite21Anchor.x,
      anchorY: sprite21Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // Position at cellFrom, rotate to face cellTo.
            // Mirrors the world-positioning done by the outer
            // main-timeline placement in the canonical SWF.
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as { x: number; y: number } | undefined;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y - 20;
            }
            if (cellFrom && cellTo) {
              const dx = cellTo.x - cellFrom.x;
              const dy = (cellTo.y - 20) - (cellFrom.y - 20);
              clip.rotation = Math.atan2(dy, dx);
            }
          },
        ],
        [
          66,
          (clip) => {
            // AS DefineSprite_21/frame_67/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_22 — composite beam body ("clac") ---------------
    // AS frame_2/PlaceObject2_22_1/CLIPACTIONRECORD onClipEvent(load).as:
    //   x1 = _parent.cellFrom.x;  y1 = _parent.cellFrom.y - 20
    //   x2 = _parent.cellTo.x;    y2 = _parent.cellTo.y - 20
    //   _parent.clac._x = x2;     _parent.clac._y = y2   (sets sprite_28 "clac" pos)
    //   _X = x1; _Y = y1
    //   dx = x2 - x1; dy = y2 - y1
    //   d = Math.sqrt(dx*dx + dy*dy)
    //   _rotation = Math.atan2(dy, dx) * 180 / 3.1415
    //
    // AS DefineSprite_22/frame_1/PlaceObject2_21_1/CLIPACTIONRECORD onClipEvent(load).as:
    //   _width = _parent.d / 4.5
    //   (This is a child of sprite_22 itself — sprite_21 placed inside
    //   sprite_22 as instance PlaceObject2_21_1. We handle this by
    //   recording d on vars and adjusting scaleX of the sprite to
    //   stretch the beam to match the distance.)
    this.sprite22Sym = {
      name: "sprite_22",
      totalFrames: 93,
      frames: textures.getFrames("sprite_22"),
      anchorX: sprite22Anchor.x,
      anchorY: sprite22Anchor.y,
      onLoad: (clip) => {
        // AS frame_2/PlaceObject2_22_1/CLIPACTIONRECORD onClipEvent(load).as
        const root = clip.parent;
        const cellFrom = root?.vars.cellFrom as { x: number; y: number } | undefined;
        const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
        if (!cellFrom || !cellTo) {
          return;
        }
        const x1 = cellFrom.x;
        const y1 = cellFrom.y - 20;
        const x2 = cellTo.x;
        const y2 = cellTo.y - 20;
        clip.x = x1;
        clip.y = y1;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const d = Math.sqrt(dx * dx + dy * dy);
        clip.rotation = Math.atan2(dy, dx);
        // Store d on vars so inner frame_1 child can use it.
        clip.vars.d = d;
        // AS DefineSprite_22/frame_1/PlaceObject2_21_1/onClipEvent(load):
        //   _width = _parent.d / 4.5
        // sprite_22 is the beam body — stretch its width to cover the
        // distance. Width = d / 4.5 mapped to scaleX relative to
        // natural sprite width (224.9).
        const naturalWidth = SPRITE_22_BOUNDS.width;
        const targetWidth = d / 4.5;
        clip.scaleX = targetWidth / naturalWidth;
      },
    };

    // ---- sprite_28 — impact composite at cellTo -----------------
    // AS DefineSprite_28/frame_37/DoAction.as:
    //   this.end();  SOMA.playSound("crockette_211")
    // AS DefineSprite_28/frame_112/DoAction.as:
    //   _parent.removeMovieClip()
    this.sprite28Sym = {
      name: "sprite_28",
      totalFrames: 114,
      frames: textures.getFrames("sprite_28"),
      anchorX: calculateAnchor(SPRITE_28_BOUNDS).x,
      anchorY: calculateAnchor(SPRITE_28_BOUNDS).y,
      onLoad: (clip) => {
        // Position the impact sprite at cellTo on load.
        const root = clip.parent;
        const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
        if (cellTo) {
          clip.x = cellTo.x;
          clip.y = cellTo.y - 20;
        }
      },
      frameScripts: new Map([
        [
          36,
          (_clip) => {
            // AS DefineSprite_28/frame_37/DoAction.as:
            //   this.end() → signalHit; SOMA.playSound("crockette_211")
            this.runtime.signalHit();
            this.soundCallback?.("crockette_211");
          },
        ],
        [
          111,
          (clip) => {
            // AS DefineSprite_28/frame_112/DoAction.as:
            //   _parent.removeMovieClip() → spell complete
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite26Sym);
    this.registry.register(this.sprite21Sym);
    this.registry.register(this.sprite22Sym);
    this.registry.register(this.sprite28Sym);
  }

  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for use from frameScripts.
    this.soundCallback = callbacks.playSound;

    // Main timeline frame_2/DoAction.as: stop()
    // Attach sprite_28 (impact at cellTo) at depth 1.
    // Attach sprite_22 (beam/"clac" at cellFrom→cellTo) at depth 2.
    // Attach sprite_21 (crack beam overlay at cellFrom) at depth 3.
    // displayType=50: root is at world (0,0); children position
    // themselves in world coords via their onLoad / frame_1 scripts
    // reading root.vars.cellFrom and root.vars.cellTo.
    this.root.attach(this.sprite28Sym, "clac", 1, context);
    this.root.attach(this.sprite22Sym, "sprite22", 2, context);
    this.root.attach(this.sprite21Sym, "sprite21", 3, context);
  }
}
