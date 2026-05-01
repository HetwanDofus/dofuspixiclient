/**
 * Spell 311 — (Iop/Sacrier lightning column or similar impact spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/311/scripts/scripts/
 *
 * displayType=11 (TargetCell). The main canonical SWF (DefineSprite_21) places
 * itself at _parent.cellTo in frame_1, which matches TargetCell anchoring
 * (container already at target cell). No projectile, no caster reference, no
 * dual-anchor — pure target-cell impact animation.
 *
 * Library symbols:
 *   - sprite4  (characterId 4, directlyDynamic: true) — placed on DefineSprite_21
 *     at frame 0 (depth 5). onLoad: seeds `i = 0`. onEnterFrame: oscillates
 *     _xscale as 100 * sin(i += 0.1). This is the "lightning bolt" shape that
 *     sinusoidally wiggles horizontally.
 *
 *   - sprite9  (characterId 9, directlyDynamic: true) — placed on DefineSprite_21
 *     at frame 9 (depth 1) with two placed sub-children each carrying
 *     independent onClipEvent(enterFrame) handlers:
 *       PlaceObject2_6_1 (depth 1): _alpha = 0 + random(120)  → flickers 0–120
 *       PlaceObject2_8_3 (depth 3): _alpha = random(100) + 90 → flickers 90–190
 *                                    + _rotation += 10  (spin)
 *     Both children are authored as part of the same DefineSprite_9 timeline
 *     but have separate per-instance handlers. We model them as two separate
 *     child symbol definitions that are attached inside sprite9's frameScripts.
 *
 * Main timeline (DefineSprite_21, 99 frames):
 *   frame_1  (index 0): _X = _parent.cellTo.x; _Y = _parent.cellTo.y
 *                       → for TargetCell the container IS already at cellTo, so
 *                          this sets the clip to (0, 0) relative to the container.
 *                          We faithfully reproduce the assignment.
 *   frame_70 (index 69): this.end() → signalHit (damage popup)
 *   frame_97 (index 96): _parent.removeMovieClip() → complete()
 *
 * sprite9 (the glow disc) appears at frame 9 (0-based index 9) of DefineSprite_21
 * and has a 71-frame tweened placement track managed by the authored PlaceObject2
 * records embedded in the composite SVG frames. The clipEvent handlers however
 * must be re-run every tick.
 *
 * Note on "PlaceObject2_6_1" and "PlaceObject2_8_3" inside DefineSprite_9:
 *   These are two authored children of DefineSprite_9. The manifest's
 *   librarySymbols lists sprite9 as a single 1-frame symbol. Its internal
 *   children (the glow "ring" at depth 1 and the rotating "halo" at depth 3)
 *   are baked into lib_sprite9_0.svg as static content, BUT their per-tick
 *   alpha/rotation mutations must be driven at runtime. We model the two
 *   sub-handlers as separate SymbolDefinitions (sprite9_inner1, sprite9_inner3)
 *   attached inside sprite9's frameScripts, each with the canonical onEnterFrame.
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

// Bounds from manifest.librarySymbols
const SPRITE4_BOUNDS = {
  width: 58.2,
  height: 84.9,
  offsetX: -29.1,
  offsetY: -42.45,
};

const SPRITE9_BOUNDS = {
  width: 28.3,
  height: 28.3,
  offsetX: -14.15,
  offsetY: -14.15,
};

// sprite_21 (the main timeline container for this spell)
const SPRITE21_BOUNDS = {
  width: 85.5,
  height: 461.3,
  offsetX: -43.85,
  offsetY: -456.05,
};

export class Spell311 extends RuntimeSpell {
  readonly spellId = 311;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite21Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite4Anchor = calculateAnchor(SPRITE4_BOUNDS);
    const sprite9Anchor = calculateAnchor(SPRITE9_BOUNDS);
    const sprite21Anchor = calculateAnchor(SPRITE21_BOUNDS);

    // ---- sprite4 — sinusoidal wiggle lightning bolt --------------------------------
    // AS DefineSprite_4/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as:
    //   i = 0;
    // AS DefineSprite_4/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as:
    //   _xscale = 100 * Math.sin(i += 0.1);
    const sprite4Sym: SymbolDefinition = {
      name: "sprite4",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite4"),
      anchorX: sprite4Anchor.x,
      anchorY: sprite4Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_4/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.i = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_4/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let i = clip.vars.i as number;
        i += 0.1;
        clip.vars.i = i;
        // AS: _xscale = 100 * Math.sin(i)  → decimal scale
        clip.scaleX = Math.sin(i);
      },
    };

    // ---- sprite9 inner child at depth 1 — alpha flicker ---------------------------
    // AS DefineSprite_9/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as:
    //   _alpha = 0 + random(120);
    // This child is the glow "ring" baked into lib_sprite9_0.svg. We model it as a
    // transparent overlay clip using the sprite9 texture (same visual) at depth 1.
    // Its only job is to drive per-tick alpha randomisation.
    const sprite9Inner1Sym: SymbolDefinition = {
      name: "sprite9inner1",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      onEnterFrame: (clip) => {
        // AS DefineSprite_9/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _alpha = 0 + random(120)  → range [0, 119]
        clip.alpha = Math.floor(Math.random() * 120) / 100;
      },
    };

    // ---- sprite9 inner child at depth 3 — alpha flicker + rotation ----------------
    // AS DefineSprite_9/frame_1/PlaceObject2_8_3/CLIPACTIONRECORD onClipEvent(enterFrame).as:
    //   _alpha = random(100) + 90;   → range [90, 189]
    //   this._rotation += 10;
    const sprite9Inner3Sym: SymbolDefinition = {
      name: "sprite9inner3",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      onEnterFrame: (clip) => {
        // AS DefineSprite_9/frame_1/PlaceObject2_8_3/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _alpha = random(100) + 90  → range [90, 189] — clamp to 0-1 scale
        const rawAlpha = Math.floor(Math.random() * 100) + 90;
        clip.alpha = Math.min(rawAlpha / 100, 1);
        // _rotation += 10 degrees per frame
        clip.rotation += (10 * Math.PI) / 180;
      },
    };

    // ---- sprite9 — glow disc container, appears at DefineSprite_21 frame 9 -------
    // DefineSprite_9 is a 1-frame authored symbol. It contains two PlaceObject2
    // children (at depths 1 and 3) each with independent onClipEvent(enterFrame).
    // We attach those two inner clips in sprite9's frame_1 script (index 0).
    // The outer transform/colorTransform from the placements[] tween track is
    // authored into the composite sprite_21_*.svg frames, so the container's
    // visual position is already embedded. We still need the live clips for the
    // per-tick handlers. We position inner clips at (0,0) relative to sprite9
    // since that's where the authored children sit.
    const sprite9Sym: SymbolDefinition = {
      name: "sprite9",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Attach the two inner sub-children of DefineSprite_9 so their
            // onEnterFrame handlers run each tick.
            // PlaceObject2_6_1 at depth 1 (initial transform from placement: roughly scale 2, y=-40)
            clip.attach(sprite9Inner1Sym, "inner1", 1, ctx, { x: -0.5, y: -40.1 });
            // PlaceObject2_8_3 at depth 3 — the initial ratio=9 on the placement
            // indicates a staggered-instance offset; we honour it as the frame placement
            // and do not add extra phase since the enterFrame handler is stateless.
            clip.attach(sprite9Inner3Sym, "inner3", 3, ctx, { x: -0.5, y: -40.1 });
          },
        ],
      ]),
    };

    // ---- sprite_21 — main impact timeline (99 frames) ----------------------------
    // This is the top-level authored animation for the spell. The manifest's
    // animations[] contains sprite_21 with 99 frames of composite SVGs.
    // AS DefineSprite_21/frame_1/DoAction.as:
    //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
    //   For TargetCell the container is already at cellTo, so x=0, y=0 locally.
    // AS DefineSprite_21/frame_70/DoAction.as:
    //   this.end() → signalHit
    // AS DefineSprite_21/frame_97/DoAction.as:
    //   _parent.removeMovieClip() → complete
    //
    // sprite4 is placed at frame 0 of DefineSprite_21 (depth 5, initial matrix).
    // sprite9 is placed at frame 9 (0-based index 9) of DefineSprite_21 (depth 1).
    this.sprite21Sym = {
      name: "sprite_21",
      totalFrames: 99,
      frames: textures.getFrames("sprite_21"),
      anchorX: sprite21Anchor.x,
      anchorY: sprite21Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_21/frame_1/DoAction.as
            // _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
            // Container (root) is anchored at cellTo for TargetCell.
            // sprite_21 positions itself at cellTo relative to its own parent (root).
            // root.vars.cellTo holds world coords; container origin = cellTo, so
            // local offset is (0, 0).
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
            if (cellTo) {
              clip.x = 0;
              clip.y = 0;
            }
            // Attach sprite4 at depth 5 per the canonical placement
            // matrix: translateX=0, translateY=-340, scaleX≈0.074, scaleY≈2.734
            clip.attach(sprite4Sym, "sprite4", 5, ctx, {
              x: 0,
              y: -340,
            });
            // Apply initial scaleX/scaleY from placement matrix
            const sp4 = clip.children.get("sprite4");
            if (sp4) {
              sp4.scaleX = 0.073516845703125;
              sp4.scaleY = 2.73394775390625;
              sp4.alpha = 131 / 256;
            }
          },
        ],
        [
          9,
          (clip, ctx) => {
            // AS: PlaceObject2 places sprite9 at frame 9 (0-based index 9) of
            // DefineSprite_21. Placement matrix: scaleX≈2.025, translateX=-0.5, y=-40.1
            clip.attach(sprite9Sym, "sprite9", 1, ctx, {
              x: -0.5,
              y: -40.1,
            });
            const sp9 = clip.children.get("sprite9");
            if (sp9) {
              sp9.scaleX = 2.0248260498046875;
              sp9.scaleY = 2.0248260498046875;
              sp9.alpha = 8 / 256;
            }
          },
        ],
        [
          69,
          () => {
            // AS DefineSprite_21/frame_70/DoAction.as: this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          96,
          (clip) => {
            // AS DefineSprite_21/frame_97/DoAction.as: _parent.removeMovieClip()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite4Sym);
    this.registry.register(sprite9Inner1Sym);
    this.registry.register(sprite9Inner3Sym);
    this.registry.register(sprite9Sym);
    this.registry.register(this.sprite21Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_2/DoAction.as: stop();
    // Main timeline frame_1 implicitly places sprite_21. Attach it here so it
    // begins ticking from the next runtime frame.
    // The main SWF frame_2 has stop() — that applies to the outer SWF timeline,
    // not to sprite_21's own playhead, so sprite_21 plays freely to frame 97.
    this.root.attach(this.sprite21Sym, "sprite21", 1, context);
  }
}
