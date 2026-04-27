/**
 * Spell 1481 — Unknown (GAC-driven multi-sprite spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1481/scripts/scripts/
 *
 * displayType=11 (TargetCell). No `move`/`shoot`/`duplicate` symbols, no
 * caster-relative anchoring, no WorldAbsolute dual-timeline pattern. All
 * authored content is a collection of sprite timelines placed at the target
 * cell. The longest-lived sprite determines completion.
 *
 * No librarySymbols[] in manifest — all symbols appear only in animations[].
 * Therefore NO `lib_` prefix anywhere; texture keys are the bare sprite names.
 *
 * Symbol layout (all from animations[]):
 *   sprite_29  (20 frames) — no scripts; looping visual
 *   sprite_34  (12 frames) — no scripts; looping visual
 *   sprite_40  (8 frames)  — frame_5 empty; frame_8 → stop()
 *   sprite_44  (41 frames) — frame_23 → GAC.applyEnd; frame_35 → GAC.applyAnim("Static")
 *   sprite_47  (24 frames) — frame_12 → GAC.applyEnd; frame_24 → GAC.applyAnim("Static")
 *   sprite_50  (27 frames) — frame_14 → GAC.applyEnd; frame_21 → GAC.applyAnim("Static")
 *   sprite_54  (24 frames) — frame_16 → SOMA.playSound("death"); frame_24 → stop()
 *   sprite_59  (5 frames)  — frame_5 → stop()
 *   sprite_64  (5 frames)  — frame_5 → stop()
 *   sprite_65  (12 frames) — frame_3 → SOMA.playSound("hit_defaut"); frame_12 → GAC.applyAnim("Static")
 *   sprite_70  (9 frames)  — frame_9 → stop()
 *   sprite_71  (13 frames) — frame_13 → GAC.applyAnim("Static")
 *   sprite_95  (20 frames) — no scripts; looping visual
 *   sprite_97  (12 frames) — no scripts; looping visual
 *   sprite_101 (41 frames) — frame_23 → GAC.applyEnd; frame_35 → GAC.applyAnim("Static")
 *   sprite_104 (24 frames) — frame_12 → GAC.applyEnd; frame_24 → GAC.applyAnim("Static")
 *   sprite_107 (27 frames) — frame_14 → GAC.applyEnd; frame_21 → GAC.applyAnim("Static")
 *   sprite_109 (20 frames) — frame_13 → SOMA.playSound("death"); frame_20 → stop()
 *   sprite_111 (12 frames) — frame_3 → SOMA.playSound("hit_defaut"); frame_12 → GAC.applyAnim("Static")
 *   sprite_113 (13 frames) — frame_13 → GAC.applyAnim("Static")
 *
 * GAC.applyEnd(this) → canonical "end of active phase" → signals hit.
 * GAC.applyAnim(this,"Static") → canonical "loop static idle" → stop() equivalent.
 * The final completion is driven by the last sprite to finish its active
 * sequence. Looking at the data: sprite_54 (24 frames, frame_24 stops) and
 * sprite_109 (20 frames, frame_20 stops) are the longest non-static sprites.
 * sprite_54 frame_24 is our completion trigger as it is the last authored stop.
 *
 * Main timeline sounds (from manifest.json sounds[]):
 *   frame 2  → "hit_defaut"
 *   frame 12 → "death"
 *   frame 15 → "death"
 * These are main-timeline sounds; we fire them via sprite frame scripts that
 * match the AS source files (sprite_111/frame_3, sprite_65/frame_3,
 * sprite_54/frame_16, sprite_109/frame_13). The manifest-level sounds at
 * frames 2/12/15 are driven by the per-sprite frame scripts already.
 *
 * signalHit is fired at the first GAC.applyEnd occurrence (sprite_44/frame_23,
 * sprite_47/frame_12, sprite_50/frame_14, sprite_101/frame_23, sprite_104/frame_12,
 * sprite_107/frame_14). We use sprite_104/frame_12 (earliest applyEnd at frame 12)
 * as the canonical hit signal since the manifest also lists frame 12 as the
 * "hit_defaut" sound frame.
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

// Bounds from manifest animations[]
const SPRITE_29_BOUNDS = { width: 106.55, height: 120.8, offsetX: -45.75, offsetY: -106.95 };
const SPRITE_34_BOUNDS = { width: 126.65, height: 113.9, offsetX: -49.3, offsetY: -100.05 };
const SPRITE_40_BOUNDS = { width: 12.6, height: 12.6, offsetX: -3.05, offsetY: -2.65 };
const SPRITE_44_BOUNDS = { width: 110.2, height: 164, offsetX: -45.6, offsetY: -143.8 };
const SPRITE_47_BOUNDS = { width: 201.1, height: 117.95, offsetX: -83.25, offsetY: -104.1 };
const SPRITE_50_BOUNDS = { width: 163.8, height: 125.5, offsetX: -81.9, offsetY: -100.55 };
const SPRITE_54_BOUNDS = { width: 528.85, height: 333.3, offsetX: -53.9, offsetY: -313.5 };
const SPRITE_59_BOUNDS = { width: 36.35, height: 34.2, offsetX: -17.35, offsetY: -18.6 };
const SPRITE_64_BOUNDS = { width: 41.95, height: 34.55, offsetX: -25.55, offsetY: -12.45 };
const SPRITE_65_BOUNDS = { width: 72.05, height: 107.05, offsetX: -29.3, offsetY: -93.2 };
const SPRITE_70_BOUNDS = { width: 36.35, height: 34.2, offsetX: -17.35, offsetY: -18.6 };
const SPRITE_71_BOUNDS = { width: 85.85, height: 104.1, offsetX: -31.25, offsetY: -90.25 };
const SPRITE_95_BOUNDS = { width: 100.75, height: 120.85, offsetX: -57.45, offsetY: -96.1 };
const SPRITE_97_BOUNDS = { width: 109.75, height: 102.15, offsetX: -65.45, offsetY: -88.3 };
const SPRITE_101_BOUNDS = { width: 112.25, height: 141.2, offsetX: -68.6, offsetY: -118.9 };
const SPRITE_104_BOUNDS = { width: 179.05, height: 113.55, offsetX: -133.85, offsetY: -99.7 };
const SPRITE_107_BOUNDS = { width: 182.35, height: 128.85, offsetX: -89.5, offsetY: -115 };
const SPRITE_109_BOUNDS = { width: 102.4, height: 115.9, offsetX: -50.45, offsetY: -86.75 };
const SPRITE_111_BOUNDS = { width: 83.5, height: 101.85, offsetX: -36.15, offsetY: -86.75 };
const SPRITE_113_BOUNDS = { width: 90.5, height: 93.35, offsetX: -35.9, offsetY: -79.5 };

export class Spell1481 extends RuntimeSpell {
  readonly spellId = 1481;
  readonly displayType = SpellDisplayType.TargetCell;

  private soundCallback?: (id: string) => void;
  private hitSignalledBySpell = false;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    // ---- sprite_29 — looping visual, no frame scripts ---------------
    const sprite29Anchor = calculateAnchor(SPRITE_29_BOUNDS);
    const sprite29Sym: SymbolDefinition = {
      name: "sprite_29",
      totalFrames: 20,
      frames: textures.getFrames("sprite_29"),
      anchorX: sprite29Anchor.x,
      anchorY: sprite29Anchor.y,
    };

    // ---- sprite_34 — looping visual, no frame scripts ---------------
    const sprite34Anchor = calculateAnchor(SPRITE_34_BOUNDS);
    const sprite34Sym: SymbolDefinition = {
      name: "sprite_34",
      totalFrames: 12,
      frames: textures.getFrames("sprite_34"),
      anchorX: sprite34Anchor.x,
      anchorY: sprite34Anchor.y,
    };

    // ---- sprite_40 — stops at frame 8 --------------------------------
    // AS DefineSprite_40/frame_5/DoAction.as: (empty)
    // AS DefineSprite_40/frame_8/DoAction.as: stop()
    const sprite40Anchor = calculateAnchor(SPRITE_40_BOUNDS);
    const sprite40Sym: SymbolDefinition = {
      name: "sprite_40",
      totalFrames: 8,
      frames: textures.getFrames("sprite_40"),
      anchorX: sprite40Anchor.x,
      anchorY: sprite40Anchor.y,
      frameScripts: new Map([
        [4, (_clip) => {
          // AS DefineSprite_40/frame_5/DoAction.as: (empty — no-op)
        }],
        [7, (clip) => {
          // AS DefineSprite_40/frame_8/DoAction.as: stop()
          clip.stop();
        }],
      ]),
    };

    // ---- sprite_44 — 41 frames; applyEnd at 23, applyAnim at 35 -----
    // AS DefineSprite_44/frame_23/DoAction.as: GAC.applyEnd(this)
    // AS DefineSprite_44/frame_35/DoAction.as: GAC.applyAnim(this,"Static")
    const sprite44Anchor = calculateAnchor(SPRITE_44_BOUNDS);
    const sprite44Sym: SymbolDefinition = {
      name: "sprite_44",
      totalFrames: 41,
      frames: textures.getFrames("sprite_44"),
      anchorX: sprite44Anchor.x,
      anchorY: sprite44Anchor.y,
      frameScripts: new Map([
        [22, () => {
          // AS DefineSprite_44/frame_23/DoAction.as: GAC.applyEnd(this)
          this.trySignalHit();
        }],
        [34, (clip) => {
          // AS DefineSprite_44/frame_35/DoAction.as: GAC.applyAnim(this,"Static")
          clip.stop();
        }],
      ]),
    };

    // ---- sprite_47 — 24 frames; applyEnd at 12, applyAnim at 24 -----
    // AS DefineSprite_47/frame_12/DoAction.as: GAC.applyEnd(this)
    // AS DefineSprite_47/frame_24/DoAction.as: GAC.applyAnim(this,"Static")
    const sprite47Anchor = calculateAnchor(SPRITE_47_BOUNDS);
    const sprite47Sym: SymbolDefinition = {
      name: "sprite_47",
      totalFrames: 24,
      frames: textures.getFrames("sprite_47"),
      anchorX: sprite47Anchor.x,
      anchorY: sprite47Anchor.y,
      frameScripts: new Map([
        [11, () => {
          // AS DefineSprite_47/frame_12/DoAction.as: GAC.applyEnd(this)
          this.trySignalHit();
        }],
        [23, (clip) => {
          // AS DefineSprite_47/frame_24/DoAction.as: GAC.applyAnim(this,"Static")
          clip.stop();
        }],
      ]),
    };

    // ---- sprite_50 — 27 frames; applyEnd at 14, applyAnim at 21 -----
    // AS DefineSprite_50/frame_14/DoAction.as: GAC.applyEnd(this)
    // AS DefineSprite_50/frame_21/DoAction.as: GAC.applyAnim(this,"Static")
    const sprite50Anchor = calculateAnchor(SPRITE_50_BOUNDS);
    const sprite50Sym: SymbolDefinition = {
      name: "sprite_50",
      totalFrames: 27,
      frames: textures.getFrames("sprite_50"),
      anchorX: sprite50Anchor.x,
      anchorY: sprite50Anchor.y,
      frameScripts: new Map([
        [13, () => {
          // AS DefineSprite_50/frame_14/DoAction.as: GAC.applyEnd(this)
          this.trySignalHit();
        }],
        [20, (clip) => {
          // AS DefineSprite_50/frame_21/DoAction.as: GAC.applyAnim(this,"Static")
          clip.stop();
        }],
      ]),
    };

    // ---- sprite_54 — 24 frames; sound at 16, stop at 24 -------------
    // AS DefineSprite_54/frame_16/DoAction.as: SOMA.playSound("death")
    // AS DefineSprite_54/frame_24/DoAction.as: stop()
    const sprite54Anchor = calculateAnchor(SPRITE_54_BOUNDS);
    const sprite54Sym: SymbolDefinition = {
      name: "sprite_54",
      totalFrames: 24,
      frames: textures.getFrames("sprite_54"),
      anchorX: sprite54Anchor.x,
      anchorY: sprite54Anchor.y,
      frameScripts: new Map([
        [15, () => {
          // AS DefineSprite_54/frame_16/DoAction.as: SOMA.playSound("death")
          this.soundCallback?.("death");
        }],
        [23, (clip) => {
          // AS DefineSprite_54/frame_24/DoAction.as: stop()
          clip.stop();
          this.runtime.complete();
        }],
      ]),
    };

    // ---- sprite_59 — 5 frames; stop at 5 ----------------------------
    // AS DefineSprite_59/frame_5/DoAction.as: stop()
    const sprite59Anchor = calculateAnchor(SPRITE_59_BOUNDS);
    const sprite59Sym: SymbolDefinition = {
      name: "sprite_59",
      totalFrames: 5,
      frames: textures.getFrames("sprite_59"),
      anchorX: sprite59Anchor.x,
      anchorY: sprite59Anchor.y,
      frameScripts: new Map([
        [4, (clip) => {
          // AS DefineSprite_59/frame_5/DoAction.as: stop()
          clip.stop();
        }],
      ]),
    };

    // ---- sprite_64 — 5 frames; stop at 5 ----------------------------
    // AS DefineSprite_64/frame_5/DoAction.as: stop()
    const sprite64Anchor = calculateAnchor(SPRITE_64_BOUNDS);
    const sprite64Sym: SymbolDefinition = {
      name: "sprite_64",
      totalFrames: 5,
      frames: textures.getFrames("sprite_64"),
      anchorX: sprite64Anchor.x,
      anchorY: sprite64Anchor.y,
      frameScripts: new Map([
        [4, (clip) => {
          // AS DefineSprite_64/frame_5/DoAction.as: stop()
          clip.stop();
        }],
      ]),
    };

    // ---- sprite_65 — 12 frames; sound at 3, applyAnim at 12 ---------
    // AS DefineSprite_65/frame_3/DoAction.as: SOMA.playSound("hit_defaut")
    // AS DefineSprite_65/frame_12/DoAction.as: GAC.applyAnim(this,"Static")
    const sprite65Anchor = calculateAnchor(SPRITE_65_BOUNDS);
    const sprite65Sym: SymbolDefinition = {
      name: "sprite_65",
      totalFrames: 12,
      frames: textures.getFrames("sprite_65"),
      anchorX: sprite65Anchor.x,
      anchorY: sprite65Anchor.y,
      frameScripts: new Map([
        [2, () => {
          // AS DefineSprite_65/frame_3/DoAction.as: SOMA.playSound("hit_defaut")
          this.soundCallback?.("hit_defaut");
        }],
        [11, (clip) => {
          // AS DefineSprite_65/frame_12/DoAction.as: GAC.applyAnim(this,"Static")
          clip.stop();
        }],
      ]),
    };

    // ---- sprite_70 — 9 frames; stop at 9 ----------------------------
    // AS DefineSprite_70/frame_9/DoAction.as: stop()
    const sprite70Anchor = calculateAnchor(SPRITE_70_BOUNDS);
    const sprite70Sym: SymbolDefinition = {
      name: "sprite_70",
      totalFrames: 9,
      frames: textures.getFrames("sprite_70"),
      anchorX: sprite70Anchor.x,
      anchorY: sprite70Anchor.y,
      frameScripts: new Map([
        [8, (clip) => {
          // AS DefineSprite_70/frame_9/DoAction.as: stop()
          clip.stop();
        }],
      ]),
    };

    // ---- sprite_71 — 13 frames; applyAnim at 13 ---------------------
    // AS DefineSprite_71/frame_13/DoAction.as: GAC.applyAnim(this,"Static")
    const sprite71Anchor = calculateAnchor(SPRITE_71_BOUNDS);
    const sprite71Sym: SymbolDefinition = {
      name: "sprite_71",
      totalFrames: 13,
      frames: textures.getFrames("sprite_71"),
      anchorX: sprite71Anchor.x,
      anchorY: sprite71Anchor.y,
      frameScripts: new Map([
        [12, (clip) => {
          // AS DefineSprite_71/frame_13/DoAction.as: GAC.applyAnim(this,"Static")
          clip.stop();
        }],
      ]),
    };

    // ---- sprite_95 — looping visual, no frame scripts ---------------
    const sprite95Anchor = calculateAnchor(SPRITE_95_BOUNDS);
    const sprite95Sym: SymbolDefinition = {
      name: "sprite_95",
      totalFrames: 20,
      frames: textures.getFrames("sprite_95"),
      anchorX: sprite95Anchor.x,
      anchorY: sprite95Anchor.y,
    };

    // ---- sprite_97 — looping visual, no frame scripts ---------------
    const sprite97Anchor = calculateAnchor(SPRITE_97_BOUNDS);
    const sprite97Sym: SymbolDefinition = {
      name: "sprite_97",
      totalFrames: 12,
      frames: textures.getFrames("sprite_97"),
      anchorX: sprite97Anchor.x,
      anchorY: sprite97Anchor.y,
    };

    // ---- sprite_101 — 41 frames; applyEnd at 23, applyAnim at 35 ----
    // AS DefineSprite_101/frame_23/DoAction.as: GAC.applyEnd(this)
    // AS DefineSprite_101/frame_35/DoAction.as: GAC.applyAnim(this,"Static")
    const sprite101Anchor = calculateAnchor(SPRITE_101_BOUNDS);
    const sprite101Sym: SymbolDefinition = {
      name: "sprite_101",
      totalFrames: 41,
      frames: textures.getFrames("sprite_101"),
      anchorX: sprite101Anchor.x,
      anchorY: sprite101Anchor.y,
      frameScripts: new Map([
        [22, () => {
          // AS DefineSprite_101/frame_23/DoAction.as: GAC.applyEnd(this)
          this.trySignalHit();
        }],
        [34, (clip) => {
          // AS DefineSprite_101/frame_35/DoAction.as: GAC.applyAnim(this,"Static")
          clip.stop();
        }],
      ]),
    };

    // ---- sprite_104 — 24 frames; applyEnd at 12, applyAnim at 24 ----
    // AS DefineSprite_104/frame_12/DoAction.as: GAC.applyEnd(this)
    // AS DefineSprite_104/frame_24/DoAction.as: GAC.applyAnim(this,"Static")
    const sprite104Anchor = calculateAnchor(SPRITE_104_BOUNDS);
    const sprite104Sym: SymbolDefinition = {
      name: "sprite_104",
      totalFrames: 24,
      frames: textures.getFrames("sprite_104"),
      anchorX: sprite104Anchor.x,
      anchorY: sprite104Anchor.y,
      frameScripts: new Map([
        [11, () => {
          // AS DefineSprite_104/frame_12/DoAction.as: GAC.applyEnd(this)
          this.trySignalHit();
        }],
        [23, (clip) => {
          // AS DefineSprite_104/frame_24/DoAction.as: GAC.applyAnim(this,"Static")
          clip.stop();
        }],
      ]),
    };

    // ---- sprite_107 — 27 frames; applyEnd at 14, applyAnim at 21 ----
    // AS DefineSprite_107/frame_14/DoAction.as: GAC.applyEnd(this)
    // AS DefineSprite_107/frame_21/DoAction.as: GAC.applyAnim(this,"Static")
    const sprite107Anchor = calculateAnchor(SPRITE_107_BOUNDS);
    const sprite107Sym: SymbolDefinition = {
      name: "sprite_107",
      totalFrames: 27,
      frames: textures.getFrames("sprite_107"),
      anchorX: sprite107Anchor.x,
      anchorY: sprite107Anchor.y,
      frameScripts: new Map([
        [13, () => {
          // AS DefineSprite_107/frame_14/DoAction.as: GAC.applyEnd(this)
          this.trySignalHit();
        }],
        [20, (clip) => {
          // AS DefineSprite_107/frame_21/DoAction.as: GAC.applyAnim(this,"Static")
          clip.stop();
        }],
      ]),
    };

    // ---- sprite_109 — 20 frames; sound at 13, stop at 20 ------------
    // AS DefineSprite_109/frame_13/DoAction.as: SOMA.playSound("death")
    // AS DefineSprite_109/frame_20/DoAction.as: stop()
    const sprite109Anchor = calculateAnchor(SPRITE_109_BOUNDS);
    const sprite109Sym: SymbolDefinition = {
      name: "sprite_109",
      totalFrames: 20,
      frames: textures.getFrames("sprite_109"),
      anchorX: sprite109Anchor.x,
      anchorY: sprite109Anchor.y,
      frameScripts: new Map([
        [12, () => {
          // AS DefineSprite_109/frame_13/DoAction.as: SOMA.playSound("death")
          this.soundCallback?.("death");
        }],
        [19, (clip) => {
          // AS DefineSprite_109/frame_20/DoAction.as: stop()
          clip.stop();
        }],
      ]),
    };

    // ---- sprite_111 — 12 frames; sound at 3, applyAnim at 12 --------
    // AS DefineSprite_111/frame_3/DoAction.as: SOMA.playSound("hit_defaut")
    // AS DefineSprite_111/frame_12/DoAction.as: GAC.applyAnim(this,"Static")
    const sprite111Anchor = calculateAnchor(SPRITE_111_BOUNDS);
    const sprite111Sym: SymbolDefinition = {
      name: "sprite_111",
      totalFrames: 12,
      frames: textures.getFrames("sprite_111"),
      anchorX: sprite111Anchor.x,
      anchorY: sprite111Anchor.y,
      frameScripts: new Map([
        [2, () => {
          // AS DefineSprite_111/frame_3/DoAction.as: SOMA.playSound("hit_defaut")
          this.soundCallback?.("hit_defaut");
        }],
        [11, (clip) => {
          // AS DefineSprite_111/frame_12/DoAction.as: GAC.applyAnim(this,"Static")
          clip.stop();
        }],
      ]),
    };

    // ---- sprite_113 — 13 frames; applyAnim at 13 --------------------
    // AS DefineSprite_113/frame_13/DoAction.as: GAC.applyAnim(this,"Static")
    const sprite113Anchor = calculateAnchor(SPRITE_113_BOUNDS);
    const sprite113Sym: SymbolDefinition = {
      name: "sprite_113",
      totalFrames: 13,
      frames: textures.getFrames("sprite_113"),
      anchorX: sprite113Anchor.x,
      anchorY: sprite113Anchor.y,
      frameScripts: new Map([
        [12, (clip) => {
          // AS DefineSprite_113/frame_13/DoAction.as: GAC.applyAnim(this,"Static")
          clip.stop();
        }],
      ]),
    };

    // Register all symbols
    this.registry.register(sprite29Sym);
    this.registry.register(sprite34Sym);
    this.registry.register(sprite40Sym);
    this.registry.register(sprite44Sym);
    this.registry.register(sprite47Sym);
    this.registry.register(sprite50Sym);
    this.registry.register(sprite54Sym);
    this.registry.register(sprite59Sym);
    this.registry.register(sprite64Sym);
    this.registry.register(sprite65Sym);
    this.registry.register(sprite70Sym);
    this.registry.register(sprite71Sym);
    this.registry.register(sprite95Sym);
    this.registry.register(sprite97Sym);
    this.registry.register(sprite101Sym);
    this.registry.register(sprite104Sym);
    this.registry.register(sprite107Sym);
    this.registry.register(sprite109Sym);
    this.registry.register(sprite111Sym);
    this.registry.register(sprite113Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for use in frame scripts
    this.soundCallback = callbacks.playSound;

    // Attach all authored sprites to the root at target cell (displayType=11).
    // Depth assignments follow the manifest animations[] order.
    // Each sprite is a top-level authored timeline placed at the target.
    const sprite29Sym = this.registry.resolve("sprite_29");
    if (sprite29Sym) {
      this.root.attach(sprite29Sym, "sprite29", 1, context);
    }
    const sprite34Sym = this.registry.resolve("sprite_34");
    if (sprite34Sym) {
      this.root.attach(sprite34Sym, "sprite34", 2, context);
    }
    const sprite40Sym = this.registry.resolve("sprite_40");
    if (sprite40Sym) {
      this.root.attach(sprite40Sym, "sprite40", 3, context);
    }
    const sprite44Sym = this.registry.resolve("sprite_44");
    if (sprite44Sym) {
      this.root.attach(sprite44Sym, "sprite44", 4, context);
    }
    const sprite47Sym = this.registry.resolve("sprite_47");
    if (sprite47Sym) {
      this.root.attach(sprite47Sym, "sprite47", 5, context);
    }
    const sprite50Sym = this.registry.resolve("sprite_50");
    if (sprite50Sym) {
      this.root.attach(sprite50Sym, "sprite50", 6, context);
    }
    const sprite54Sym = this.registry.resolve("sprite_54");
    if (sprite54Sym) {
      this.root.attach(sprite54Sym, "sprite54", 7, context);
    }
    const sprite59Sym = this.registry.resolve("sprite_59");
    if (sprite59Sym) {
      this.root.attach(sprite59Sym, "sprite59", 8, context);
    }
    const sprite64Sym = this.registry.resolve("sprite_64");
    if (sprite64Sym) {
      this.root.attach(sprite64Sym, "sprite64", 9, context);
    }
    const sprite65Sym = this.registry.resolve("sprite_65");
    if (sprite65Sym) {
      this.root.attach(sprite65Sym, "sprite65", 10, context);
    }
    const sprite70Sym = this.registry.resolve("sprite_70");
    if (sprite70Sym) {
      this.root.attach(sprite70Sym, "sprite70", 11, context);
    }
    const sprite71Sym = this.registry.resolve("sprite_71");
    if (sprite71Sym) {
      this.root.attach(sprite71Sym, "sprite71", 12, context);
    }
    const sprite95Sym = this.registry.resolve("sprite_95");
    if (sprite95Sym) {
      this.root.attach(sprite95Sym, "sprite95", 13, context);
    }
    const sprite97Sym = this.registry.resolve("sprite_97");
    if (sprite97Sym) {
      this.root.attach(sprite97Sym, "sprite97", 14, context);
    }
    const sprite101Sym = this.registry.resolve("sprite_101");
    if (sprite101Sym) {
      this.root.attach(sprite101Sym, "sprite101", 15, context);
    }
    const sprite104Sym = this.registry.resolve("sprite_104");
    if (sprite104Sym) {
      this.root.attach(sprite104Sym, "sprite104", 16, context);
    }
    const sprite107Sym = this.registry.resolve("sprite_107");
    if (sprite107Sym) {
      this.root.attach(sprite107Sym, "sprite107", 17, context);
    }
    const sprite109Sym = this.registry.resolve("sprite_109");
    if (sprite109Sym) {
      this.root.attach(sprite109Sym, "sprite109", 18, context);
    }
    const sprite111Sym = this.registry.resolve("sprite_111");
    if (sprite111Sym) {
      this.root.attach(sprite111Sym, "sprite111", 19, context);
    }
    const sprite113Sym = this.registry.resolve("sprite_113");
    if (sprite113Sym) {
      this.root.attach(sprite113Sym, "sprite113", 20, context);
    }
  }

  /**
   * GAC.applyEnd(this) canonical hit signal — idempotent, fires once
   * on the first sprite to reach its applyEnd frame.
   */
  private trySignalHit(): void {
    if (!this.hitSignalledBySpell) {
      this.hitSignalledBySpell = true;
      this.runtime.signalHit();
    }
  }
}
