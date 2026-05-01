/**
 * Spell 609 — (Sacrieur / Pandawa class spell, orange flame pillar).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 *
 * Canonical AS layout (`tools/combat-exporter/output/spell-anims/609/scripts/scripts/`):
 *
 *   - `DefineSprite_13` — main 150-frame animated sprite (anim1). The outermost
 *     authored timeline. Contains:
 *       frame_76: PlaceObject2 at depth 2 — places sprite7 instance with an
 *                 onClipEvent(enterFrame) that randomises _alpha and _rotation.
 *       frame_148: DoAction → `_parent.removeMovieClip()` → spell complete.
 *
 *   - `DefineSprite_7` (lib `sprite7`) — a single-frame glow sprite placed inside
 *     DefineSprite_13 at frame 76 (depth 2). Its own onClipEvent(enterFrame)
 *     (scripts/DefineSprite_7/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as)
 *     pulses `_alpha = random(20) + 80` and `_rotation = random(360)` every tick.
 *     Note: DefineSprite_13 frame_76 has a *second* CLIPACTIONRECORD
 *     (PlaceObject2_6_2/CLIPACTIONRECORD onClipEvent(enterFrame).as) with the
 *     identical body — this refers to the same handler applied to the same placed
 *     instance (both script files are identical and both resolve to sprite7).
 *
 * displayType=11 (TargetCell): single composite animation plays at the target cell.
 * No `move` / `shoot` / projectile logic. The harness places the container at the
 * target cell and we attach a single `anim1` symbol that drives the full timeline.
 * The `anim1` is the main timeline (DefineSprite_13, 150 frames). The `sprite7`
 * particle is placed at frame 76 inside `anim1` and runs its enterFrame handler
 * for the remainder of the timeline.
 *
 * signalHit: fired at frame 76 (when the glow particle first appears — canonical
 * impact frame).
 * complete: fired at frame 148 (canonical `_parent.removeMovieClip()` in
 * DefineSprite_13/frame_148/DoAction.as).
 *
 * Library symbols:
 *   - `sprite7` — single-frame glow disk (lib_sprite7). onEnterFrame pulses alpha
 *     in [80,100] and randomises rotation every tick. Placed at frame 76 of anim1.
 *   - `anim1`   — 150-frame main composite. frames: textures.getFrames("anim1")
 *     (no lib_ prefix — lives in animations[], not librarySymbols[]). frameScripts:
 *     frame 75 attaches sprite7, frame 147 calls complete().
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

// Bounds from manifest.json librarySymbols[0] (sprite7)
const SPRITE7_BOUNDS = {
  width: 136.65,
  height: 122.8,
  offsetX: -68.3,
  offsetY: -61.4,
};

// Bounds from manifest.json animations[0] (anim1)
const ANIM1_BOUNDS = {
  width: 67.15,
  height: 144.5,
  offsetX: -28.95,
  offsetY: -134.35,
};

export class Spell609 extends RuntimeSpell {
  readonly spellId = 609;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const sprite7Anchor = calculateAnchor(SPRITE7_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- sprite7 — pulsing glow particle inside anim1 -----------
    // AS: scripts/DefineSprite_7/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // and: scripts/DefineSprite_13/frame_76/PlaceObject2_6_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // Both scripts are identical:
    //   _alpha = random(20) + 80;
    //   _rotation = random(360);
    const sprite7Sym: SymbolDefinition = {
      name: "sprite7",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite7"),
      anchorX: sprite7Anchor.x,
      anchorY: sprite7Anchor.y,
      onEnterFrame: (clip) => {
        // AS: _alpha = random(20) + 80  →  alpha in [80, 100]
        clip.alpha = (Math.floor(Math.random() * 20) + 80) / 100;
        // AS: _rotation = random(360)  →  degrees → radians
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
      },
    };

    // ---- anim1 — 150-frame main composite timeline (DefineSprite_13) --
    // animations[] entry, NOT in librarySymbols[] → use bare name "anim1"
    // (no lib_ prefix).
    //
    // Key frame scripts:
    //   frame 76 (0-based: 75):
    //     PlaceObject2 depth 2 → attach sprite7.
    //     This is also the canonical hit frame (impact visible).
    //   frame 148 (0-based: 147):
    //     AS DefineSprite_13/frame_148/DoAction.as: _parent.removeMovieClip()
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 150,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          75,
          (clip, ctx) => {
            // AS: DefineSprite_13/frame_76 → PlaceObject2 depth 2 places sprite7.
            // The placement matrix from manifest (frame 18 of placements[] is the
            // first "place" kind entry, but the canonical PlaceObject2 at frame 76
            // of DefineSprite_13 is what drives the dynamic handler).
            // We attach sprite7 at the canonical depth 2, no special transform
            // (the SWF matrix places it near the center of the flame pillar).
            // First placement from manifest: translateX=1.5, translateY=-103.7
            // (approximately the flame center offset).
            clip.attach(sprite7Sym, "sprite7_glow", 2, ctx, {
              x: 1.5,
              y: -103.7,
            });
            // Signal hit at the frame when the glow appears (canonical impact).
            this.runtime.signalHit();
          },
        ],
        [
          147,
          (clip) => {
            // AS: scripts/DefineSprite_13/frame_148/DoAction.as
            //   _parent.removeMovieClip();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite7Sym);
    this.registry.register(anim1Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // Main timeline places anim1 (DefineSprite_13) at depth 1.
    // No SOMA.playSound found in the canonical scripts for this spell.
    // Attach anim1 so it starts ticking from the next runtime frame.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
