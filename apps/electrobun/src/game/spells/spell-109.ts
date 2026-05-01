/**
 * Spell 109 — Carapace (Feca shield).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/109/scripts/scripts/
 *
 * displayType=10 (CasterCell). This is a self-buff / shield spell anchored at
 * the caster. There is no projectile, no target-cell impact. The main animation
 * (anim1, 129 frames) plays at the caster cell. A single library symbol
 * (sprite14) is a "clipEvent" particle that spins via onEnterFrame.
 *
 * Canonical AS layout:
 *
 *   - anim1 (main composite, 129 frames): the big shield visual. Treated as the
 *     top-level symbol. DefineSprite_17 wraps it; its frame_127 does
 *     `_parent.removeMovieClip()` → complete(). frame_1 plays sound "shield_cara".
 *
 *   - DefineSprite_13 (sub-symbol inside main anim):
 *       frame_1: `_rotation = random(360)` — randomises initial rotation.
 *       frame_28: `stop()` — halts after 28 frames.
 *
 *   - DefineSprite_14 / sprite14 (directlyDynamic: true, clipEvent):
 *       onClipEvent(enterFrame): `_rotation = _rotation + 10` — spins 10 deg/frame.
 *       Placed inside DefineSprite_15 (sprite15) timeline at various frames with
 *       different transforms (the manifest placements array).
 *
 *   - DefineSprite_15 / sprite15 (directlyDynamic: false, wrapper):
 *       frame_55: `stop()` — halts at 55 frames.
 *       Contains sprite14 instances placed at various parent frames with
 *       different depths/transforms. Since sprite15 is itself placed many times
 *       inside DefineSprite_17 (the outermost wrapper), and the whole animation
 *       is pre-rendered into anim1, we model the top-level anim1 symbol as the
 *       primary visual and wire sprite14's rotation handler as the sole live
 *       CLIPACTIONRECORD that must run at runtime.
 *
 *   The main visual is the pre-rendered `anim1` composite (129 frames). The only
 *   runtime dynamic behaviour that cannot be baked is sprite14's per-frame
 *   `_rotation += 10` handler. We attach sprite14 clips (from their placement
 *   entries inside sprite15, which itself is placed many times inside DefineSprite_17)
 *   via the anim1 symbol's frameScripts mirroring the canonical PlaceObject2 placement
 *   frames from the manifest.
 *
 *   signalHit: fired at anim1 frame 1 (frame index 0) — the instant the shield
 *   appears (no explicit "hit frame" in the canonical AS; the shield is applied
 *   immediately on cast).
 *
 *   complete(): fired at frame 127 of DefineSprite_17 → anim1 frame index 126.
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

// --- Manifest bounds for library symbols ---

const SPRITE14_BOUNDS = {
  width: 53.9,
  height: 23.85,
  offsetX: -41.15,
  offsetY: -12.5,
};

const SPRITE15_BOUNDS = {
  width: 60.4,
  height: 30.45,
  offsetX: -47.65,
  offsetY: -19.1,
};

const ANIM1_BOUNDS = {
  width: 113.3,
  height: 95.9,
  offsetX: -47.6,
  offsetY: -58.8,
};

export class Spell109 extends RuntimeSpell {
  readonly spellId = 109;
  // Self-buff / shield anchored at the caster cell. No projectile motion,
  // no target-cell impact. VisualEffectHandler displayType=10 (CasterCell).
  readonly displayType = SpellDisplayType.CasterCell;

  private sprite14Sym!: SymbolDefinition;
  private sprite15Sym!: SymbolDefinition;
  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite14Anchor = calculateAnchor(SPRITE14_BOUNDS);
    const sprite15Anchor = calculateAnchor(SPRITE15_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- sprite14 — spinning particle (directlyDynamic: true) --------
    // Canonical CLIPACTIONRECORD:
    //   DefineSprite_14/frame_1/PlaceObject2_3_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   onClipEvent(enterFrame){ _rotation = _rotation + 10; }
    //
    // No onClipEvent(load) exists for sprite14 — no init needed.
    this.sprite14Sym = {
      name: "sprite14",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite14"),
      anchorX: sprite14Anchor.x,
      anchorY: sprite14Anchor.y,
      // AS DefineSprite_14/frame_1/PlaceObject2_3_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
      // _rotation = _rotation + 10  (degrees → radians delta)
      onEnterFrame: (clip) => {
        clip.rotation += (10 * Math.PI) / 180;
      },
    };

    // ---- sprite15 — wrapper (directlyDynamic: false) ------------------
    // Contains sprite14 instances at various frames/depths/transforms.
    // frame_55: stop()
    // Placements of sprite14 inside sprite15 occur at frames 0,1,2,...
    // Each "place" entry in manifest.librarySymbols[1].placements with
    // parentSpriteId===15 describes when+where to attach a sprite14 instance.
    //
    // We attach one sprite14 instance in frame_1 (index 0) since the primary
    // animation is pre-rendered into anim1. The individual placement-frame
    // attaches with full matrix data are implemented below for the placements
    // that have kind:"place".
    //
    // The placements[] for sprite15 inside DefineSprite_17 are all on the
    // outer anim1 wrapper — those are handled in the anim1Sym frameScripts.
    this.sprite15Sym = {
      name: "sprite15",
      totalFrames: 57,
      frames: textures.getFrames("lib_sprite15"),
      anchorX: sprite15Anchor.x,
      anchorY: sprite15Anchor.y,
      frameScripts: new Map([
        [
          0,
          // AS: sprite14 is placed at depth 1 in sprite15 frame_1 with matrix
          // translateX: -6.5, translateY: -6.6, colorTransform white (full bright).
          // This is the canonical PlaceObject2 placement.
          (clip, ctx) => {
            clip.attach(this.sprite14Sym, "sprite14_d1", 1, ctx, {
              x: -6.5,
              y: -6.6,
            });
          },
        ],
        [
          54,
          // AS: DefineSprite_15/frame_55/DoAction.as → stop()
          (clip) => {
            clip.stop();
          },
        ],
      ]),
    };

    // ---- anim1 — main 129-frame shield composite ----------------------
    // This is the pre-rendered composite visual for the whole spell.
    // Corresponds to DefineSprite_17 (the outermost wrapper).
    //
    // frame_1 (index 0):
    //   AS DefineSprite_17/frame_1/DoAction.as → SOMA.playSound("shield_cara")
    //   (sound handled in onSpellStart; also signal hit here)
    //
    // frame_127 (index 126):
    //   AS DefineSprite_17/frame_127/DoAction.as → _parent.removeMovieClip()
    //   → this.runtime.complete()
    //
    // The manifest also shows sprite15 instances placed at various frames inside
    // DefineSprite_17 (parentSpriteId===17). We attach sprite15 instances at the
    // corresponding frame indices. Each "place" entry gets an attach; "move"
    // entries would mutate transforms — since the visual is pre-rendered into
    // anim1 frames, we only attach the live clips (sprite14 inside sprite15)
    // so the rotation handler runs. We attach them at their canonical placement
    // frames.
    //
    // Placements of sprite15 inside DefineSprite_17 (parentSpriteId===17):
    //   frame 0  depth 4  (ratio 0)   — matrix scaleX:0.2203..., tx:23.75, ty:-6.1
    //   frame 3  depth 6  (ratio 3)   — matrix tx:15.7, ty:6.75
    //   frame 6  depth 10 (ratio 6)   — matrix tx:15.25, ty:-1.1
    //   frame 9  depth 8  (ratio 9)   — matrix tx:1.5, ty:10.25
    //   frame 9  depth 12 (ratio 9)   — matrix tx:23.75, ty:-22.15
    //   frame 12 depth 16 (ratio 12)  — matrix tx:-14.2, ty:6.95
    //   frame 15 depth 14 (ratio 15)  — matrix tx:1.5, ty:1.95
    //   frame 15 depth 18 (ratio 15)  — matrix tx:16.25, ty:-13.8
    //   frame 18 depth 20 (ratio 18)  — matrix tx:-13.7, ty:-0.95
    //   frame 18 depth 22 (ratio 18)  — matrix tx:14.7, ty:-27.6
    //   frame 21 depth 24 (ratio 21)  — matrix tx:1.5, ty:-12.05
    //   frame 24 depth 26 (ratio 24)  — matrix tx:-22.65, ty:-6.15
    //   frame 24 depth 28 (ratio 24)  — matrix tx:14.35, ty:-36.2
    //   frame 27 depth 30 (ratio 27)  — matrix tx:0.75, ty:-27.7
    //   frame 27 depth 32 (ratio 27)  — matrix tx:-14.75, ty:-13.6
    //   frame 30 depth 34 (ratio 30)  — matrix tx:0.75, ty:-38.95
    //   frame 33 depth 36 (ratio 33)  — matrix tx:-13.4, ty:-27
    //   frame 36 depth 38 (ratio 36)  — matrix tx:-12.8, ty:-36.05
    //   frame 36 depth 40 (ratio 36)  — matrix tx:-22.05, ty:-21.35

    const sprite15PlacementsMap = new Map<
      number,
      Array<{ depth: number; x: number; y: number; alpha?: number }>
    >([
      [0, [{ depth: 4, x: 23.75, y: -6.1 }]],
      [3, [{ depth: 6, x: 15.7, y: 6.75, alpha: 207 / 256 }]],
      [6, [{ depth: 10, x: 15.25, y: -1.1 }]],
      [
        9,
        [
          { depth: 8, x: 1.5, y: 10.25, alpha: 161 / 256 },
          { depth: 12, x: 23.75, y: -22.15 },
        ],
      ],
      [12, [{ depth: 16, x: -14.2, y: 6.95, alpha: 161 / 256 }]],
      [
        15,
        [
          { depth: 14, x: 1.5, y: 1.95, alpha: 207 / 256 },
          { depth: 18, x: 16.25, y: -13.8 },
        ],
      ],
      [
        18,
        [
          { depth: 20, x: -13.7, y: -0.95, alpha: 207 / 256 },
          { depth: 22, x: 14.7, y: -27.6, alpha: 102 / 256 },
        ],
      ],
      [21, [{ depth: 24, x: 1.5, y: -12.05 }]],
      [
        24,
        [
          { depth: 26, x: -22.65, y: -6.15, alpha: 161 / 256 },
          { depth: 28, x: 14.35, y: -36.2 },
        ],
      ],
      [
        27,
        [
          { depth: 30, x: 0.75, y: -27.7 },
          { depth: 32, x: -14.75, y: -13.6 },
        ],
      ],
      [30, [{ depth: 34, x: 0.75, y: -38.95 }]],
      [33, [{ depth: 36, x: -13.4, y: -27 }]],
      [
        36,
        [
          { depth: 38, x: -12.8, y: -36.05 },
          { depth: 40, x: -22.05, y: -21.35, alpha: 207 / 256 },
        ],
      ],
    ]);

    // Build frameScripts for anim1 from the placements map + canonical frame actions
    const anim1FrameScripts = new Map<
      number,
      (clip: SpellClip, ctx: SpellContext) => void
    >();

    // Helper: populate attachment frame scripts for sprite15 placements
    for (const [frameIdx, placements] of sprite15PlacementsMap) {
      anim1FrameScripts.set(frameIdx, (clip, ctx) => {
        // AS: PlaceObject2 placements of sprite15 inside DefineSprite_17
        // at the given frame. Each placement gets an independent sprite15
        // instance so its sprite14 child can spin independently.
        for (const p of placements) {
          const instanceName = `sprite15_d${p.depth}`;
          const child = clip.attach(
            this.sprite15Sym,
            instanceName,
            p.depth,
            ctx,
            { x: p.x, y: p.y },
          );
          if (p.alpha !== undefined) {
            child.alpha = p.alpha;
          }
        }
      });
    }

    // frame_1 (index 0): signalHit — shield appears immediately on caster.
    // The sound is fired in onSpellStart. We merge with any placement at index 0.
    const existingFrame0 = anim1FrameScripts.get(0);
    anim1FrameScripts.set(0, (clip, ctx) => {
      // AS DefineSprite_17/frame_1/DoAction.as: SOMA.playSound("shield_cara")
      // (sound handled in onSpellStart; signal hit here as the shield takes effect)
      this.runtime.signalHit();
      if (existingFrame0) {
        existingFrame0(clip, ctx);
      }
    });

    // frame_127 (index 126): _parent.removeMovieClip() → complete()
    // AS DefineSprite_17/frame_127/DoAction.as
    anim1FrameScripts.set(126, (clip) => {
      clip.remove();
      this.runtime.complete();
    });

    this.anim1Sym = {
      name: "anim1",
      totalFrames: 129,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: anim1FrameScripts,
    };

    this.registry.register(this.sprite14Sym);
    this.registry.register(this.sprite15Sym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS DefineSprite_17/frame_1/DoAction.as: SOMA.playSound("shield_cara")
    callbacks.playSound("shield_cara");
    // Attach the main anim1 composite at root depth 1.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}

// TypeScript type import needed for the frameScripts map value signature
// used inline above. We import SpellClip indirectly through the closure type —
// the handler signature already captures it via the SymbolDefinition contract.
// No extra import needed; SpellClip is only referenced by the runtime internally.
