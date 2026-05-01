/**
 * Spell 412 — (Iop/warrior strike-type impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/412/scripts/scripts/
 *
 * displayType=11 (TargetCell). The canonical DefineSprite_14/frame_1/DoAction.as
 * explicitly positions itself at `_parent.cellTo.x / _parent.cellTo.y` and resets
 * `_rotation = 0`, which is the classic TargetCell pattern. No projectile, no
 * caster-side element — single impact anchored at the target cell.
 *
 * Library symbols:
 *   - sprite3 (characterId 3, directlyDynamic: true) — single-frame rotating disc.
 *     onClipEvent(enterFrame): `_rotation = _rotation + 23.3` (degrees/tick).
 *     Placed by DefineSprite_14 at frame 0, depths 1 and 4, with specific
 *     matrix + colorTransform tweens across the full timeline.
 *     The long tween schedule (placement data in manifest) is baked into the
 *     composite sprite_14 SVGs; we only need to attach the live clip so the
 *     rotation handler runs per-tick.
 *
 * Main timeline (sprite_14, 144 frames / stopFrame 135):
 *   frame_1  (index 0):  position self at cellTo, rotation=0.
 *   frame_85 (index 84): this.end() → signalHit.
 *   frame_136 (index 135): _parent.removeMovieClip() + stop() → complete.
 *
 * Top-level main timeline frame_2/DoAction.as: stop().
 * No SOMA.playSound found — onSpellStart only does the stop (no-op for us).
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

// Bounds from manifest.json librarySymbols[0] (sprite3, characterId 3)
const SPRITE3_BOUNDS = {
  width: 300,
  height: 305.95,
  offsetX: -147.8,
  offsetY: -153.25,
};

// Bounds from manifest.json animations[0] (sprite_14)
const SPRITE14_BOUNDS = {
  width: 186.7,
  height: 220.2,
  offsetX: -92.65,
  offsetY: -173.7,
};

export class Spell412 extends RuntimeSpell {
  readonly spellId = 412;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite14Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite3Anchor = calculateAnchor(SPRITE3_BOUNDS);
    const sprite14Anchor = calculateAnchor(SPRITE14_BOUNDS);

    // ---- sprite3 — rotating disc particle -----------------------
    // directlyDynamic: true. Placed by sprite_14 at frame 0.
    // AS: scripts/DefineSprite_3/frame_1/PlaceObject2_2_1/
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation = _rotation + 23.3;
    const sprite3Sym: SymbolDefinition = {
      name: "sprite3",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite3"),
      anchorX: sprite3Anchor.x,
      anchorY: sprite3Anchor.y,
      onEnterFrame: (clip) => {
        // AS: DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _rotation = _rotation + 23.3;
        clip.rotation += (23.3 * Math.PI) / 180;
      },
    };

    // ---- sprite_14 — main impact composite (144 frames) ---------
    // Canonical DefineSprite_14 scripts:
    //   frame_1  (index 0):  _X = _parent.cellTo.x; _Y = _parent.cellTo.y; _rotation = 0;
    //   frame_85 (index 84): this.end() → signalHit
    //   frame_136 (index 135): _parent.removeMovieClip(); stop(); → complete
    //
    // sprite3 is placed at depth 1 and depth 4 inside sprite_14 at frame 0
    // (two instances, different matrix/colorTransform). The long tween schedule
    // across the timeline is baked into the composite sprite_14 SVG frames —
    // we only need to attach live sprite3 clips so the rotation handler runs.
    this.sprite14Sym = {
      name: "sprite_14",
      totalFrames: 144,
      frames: textures.getFrames("sprite_14"),
      anchorX: sprite14Anchor.x,
      anchorY: sprite14Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_14/frame_1/DoAction.as
            // _X = _parent.cellTo.x; _Y = _parent.cellTo.y; _rotation = 0;
            // For TargetCell, the container is already anchored at cellTo by the
            // harness (root.container at cellTo). sprite_14 is attached at root,
            // so we position it at (0,0) in container-local coords (i.e. at the
            // target cell) and reset rotation to 0.
            clip.x = 0;
            clip.y = 0;
            clip.rotation = 0;

            // Place two sprite3 instances inside sprite_14 (depths 1 and 4).
            // AS: PlaceObject2 at frame 0 (kind: "place"), depth 1 and depth 4.
            // Initial matrix from manifest placements[0] (depth 1):
            //   scaleX=0.543, scaleY=0.272, translateX=-1.65, translateY=0.45, alphaMult=0
            // Initial matrix from manifest placements[1] (depth 4):
            //   scaleX=0.616, scaleY=0.308, translateX=-1.65, translateY=-126.55, alphaMult=0
            // Both start at alpha=0 (alphaMult=0 → alpha=0); the tween ramps them up.
            // Since the tween data is already baked into the composite SVG frames,
            // we attach the clips at the canonical initial transform so the
            // rotation enterFrame handler keeps running while the SVG handles
            // the opacity/scale tween visually.
            const s3depth1 = clip.attach(sprite3Sym, "sprite3_1", 1, ctx, {
              x: -1.65,
              y: 0.45,
            });
            s3depth1.scaleX = 0.5432281494140625;
            s3depth1.scaleY = 0.2716217041015625;
            s3depth1.alpha = 0; // alphaMult=0 at frame 0

            const s3depth4 = clip.attach(sprite3Sym, "sprite3_4", 4, ctx, {
              x: -1.65,
              y: -126.55,
            });
            s3depth4.scaleX = 0.6156158447265625;
            s3depth4.scaleY = 0.3078155517578125;
            s3depth4.alpha = 0; // alphaMult=0 at frame 0
          },
        ],
        [
          84,
          () => {
            // AS: DefineSprite_14/frame_85/DoAction.as
            // this.end() → damage popup at target
            this.runtime.signalHit();
          },
        ],
        [
          135,
          (clip) => {
            // AS: DefineSprite_14/frame_136/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite3Sym);
    this.registry.register(this.sprite14Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Top-level main timeline frame_2/DoAction.as: stop()
    // No SOMA.playSound in the canonical source. Attach sprite_14 at root so
    // its timeline starts ticking from the next runtime frame.
    this.root.attach(this.sprite14Sym, "sprite_14", 1, context);
  }
}
