/**
 * Spell 1481 — (Unknown name, likely a Sacrier/death-themed spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1481/scripts/scripts/
 *
 * displayType=11 (TargetCell). There are no `move`/`shoot`/`duplicate` library
 * symbols, no caster-anchored positioning, no projectile motion. All sprites
 * are standalone animated composites that play at the target cell. The manifest
 * has no `librarySymbols[]` — all symbols appear only in `animations[]`.
 * Therefore NO `lib_` prefix is used for any `textures.getFrames()` call.
 *
 * The spell has many parallel sprite timelines, but the overall structure is:
 *   - Multiple sprite variants (paired by facing direction or element) that
 *     each play their own authored animation.
 *   - `GAC.applyEnd(this)` → signals hit (damage popup) at the canonical
 *     impact frame of each sprite.
 *   - `GAC.applyAnim(this,"Static")` → the sprite loops/holds on a static
 *     last frame (we implement as `clip.stop()`).
 *   - `SOMA.playSound(...)` → `callbacks.playSound(...)` (from onSpellStart
 *     for the main timeline sounds; from frameScripts for mid-animation sounds,
 *     captured via stored callback reference).
 *   - `stop()` → `clip.stop()`.
 *
 * The manifest `sounds[]` array shows three main-timeline sound cues:
 *   frame 2  → "hit_defaut"
 *   frame 12 → "death"
 *   frame 15 → "death"
 * These are on the MAIN timeline (outer mc), so we fire them from the root's
 * frameScripts.
 *
 * Spell completion: the longest-lived sprite is sprite_44 / sprite_101 (41
 * frames). We use sprite_44's frame_35 `GAC.applyAnim(this,"Static")` and its
 * frame_23 `GAC.applyEnd(this)` as the canonical hit signal. The overall
 * `complete()` is fired when the root timeline would have ended — we use the
 * stop frame of the longest sprite (sprite_44 frame 41 → index 40, or
 * sprite_101 index 40). We attach all sprites from onSpellStart and fire
 * `this.runtime.complete()` at frame 40 of sprite_44 (the last frame index
 * of the 41-frame sprite).
 *
 * GAC.applyEnd semantics: fires `signalHit()` once at the "end" keyframe.
 * GAC.applyAnim("Static") semantics: stop the clip (hold last frame).
 *
 * All sprites are registered as SymbolDefinitions so they can be attached
 * from onSpellStart. Since librarySymbols[] is empty in the manifest, we use
 * bare animation names (no `lib_` prefix) for `textures.getFrames()`.
 *
 * Library symbols registered (all from animations[]):
 *   sprite_29  — 20-frame composite. No scripted events (no script entries).
 *   sprite_34  — 12-frame composite. No scripted events.
 *   sprite_40  — 8-frame composite. frame_5 (empty). frame_8 → stop().
 *   sprite_44  — 41-frame composite. frame_23 → signalHit. frame_35 → stop().
 *   sprite_47  — 24-frame composite. frame_12 → signalHit. frame_24 → stop().
 *   sprite_50  — 27-frame composite. frame_14 → signalHit. frame_21 → stop().
 *   sprite_54  — 24-frame composite. frame_16 → playSound("death"). frame_24 → stop().
 *   sprite_59  — 5-frame composite. frame_5 → stop().
 *   sprite_64  — 5-frame composite. frame_5 → stop().
 *   sprite_65  — 12-frame composite. frame_3 → playSound("hit_defaut"). frame_12 → stop().
 *   sprite_70  — 9-frame composite. frame_9 → stop().
 *   sprite_71  — 13-frame composite. frame_13 → stop().
 *   sprite_95  — 20-frame composite. No scripted events.
 *   sprite_97  — 12-frame composite. No scripted events.
 *   sprite_101 — 41-frame composite. frame_23 → signalHit. frame_35 → stop().
 *   sprite_104 — 24-frame composite. frame_12 → signalHit. frame_24 → stop().
 *   sprite_107 — 27-frame composite. frame_14 → signalHit. frame_21 → stop().
 *   sprite_109 — 20-frame composite. frame_13 → playSound("death"). frame_20 → stop().
 *   sprite_111 — 12-frame composite. frame_3 → playSound("hit_defaut"). frame_12 → stop().
 *   sprite_113 — 13-frame composite. frame_13 → stop().
 *
 * Main timeline: attaches all sprites at root (target cell). Root frameScripts
 * fire the three canonical main-timeline sounds. complete() fires at frame 40
 * of sprite_44 (the last frame of the longest 41-frame composite).
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

// Manifest bounds for all animations[] entries (no librarySymbols[])
const SPRITE_29_BOUNDS  = { width: 106.55, height: 120.8,  offsetX: -45.75,  offsetY: -106.95 };
const SPRITE_34_BOUNDS  = { width: 126.65, height: 113.9,  offsetX: -49.3,   offsetY: -100.05 };
const SPRITE_40_BOUNDS  = { width: 12.6,   height: 12.6,   offsetX: -3.05,   offsetY: -2.65   };
const SPRITE_44_BOUNDS  = { width: 110.2,  height: 164.0,  offsetX: -45.6,   offsetY: -143.8  };
const SPRITE_47_BOUNDS  = { width: 201.1,  height: 117.95, offsetX: -83.25,  offsetY: -104.1  };
const SPRITE_50_BOUNDS  = { width: 163.8,  height: 125.5,  offsetX: -81.9,   offsetY: -100.55 };
const SPRITE_54_BOUNDS  = { width: 528.85, height: 333.3,  offsetX: -53.9,   offsetY: -313.5  };
const SPRITE_59_BOUNDS  = { width: 36.35,  height: 34.2,   offsetX: -17.35,  offsetY: -18.6   };
const SPRITE_64_BOUNDS  = { width: 41.95,  height: 34.55,  offsetX: -25.55,  offsetY: -12.45  };
const SPRITE_65_BOUNDS  = { width: 72.05,  height: 107.05, offsetX: -29.3,   offsetY: -93.2   };
const SPRITE_70_BOUNDS  = { width: 36.35,  height: 34.2,   offsetX: -17.35,  offsetY: -18.6   };
const SPRITE_71_BOUNDS  = { width: 85.85,  height: 104.1,  offsetX: -31.25,  offsetY: -90.25  };
const SPRITE_95_BOUNDS  = { width: 100.75, height: 120.85, offsetX: -57.45,  offsetY: -96.1   };
const SPRITE_97_BOUNDS  = { width: 109.75, height: 102.15, offsetX: -65.45,  offsetY: -88.3   };
const SPRITE_101_BOUNDS = { width: 112.25, height: 141.2,  offsetX: -68.6,   offsetY: -118.9  };
const SPRITE_104_BOUNDS = { width: 179.05, height: 113.55, offsetX: -133.85, offsetY: -99.7   };
const SPRITE_107_BOUNDS = { width: 182.35, height: 128.85, offsetX: -89.5,   offsetY: -115.0  };
const SPRITE_109_BOUNDS = { width: 102.4,  height: 115.9,  offsetX: -50.45,  offsetY: -86.75  };
const SPRITE_111_BOUNDS = { width: 83.5,   height: 101.85, offsetX: -36.15,  offsetY: -86.75  };
const SPRITE_113_BOUNDS = { width: 90.5,   height: 93.35,  offsetX: -35.9,   offsetY: -79.5   };

export class Spell1481 extends RuntimeSpell {
  readonly spellId = 1481;
  readonly displayType = SpellDisplayType.TargetCell;

  // Stored callback reference so frame scripts can call playSound.
  private _playSound: ((id: string) => void) | null = null;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    // ---- sprite_29 — 20-frame composite, no scripted events ----
    // No script files reference DefineSprite_29.
    const sprite29Anchor = calculateAnchor(SPRITE_29_BOUNDS);
    const sprite29Sym: SymbolDefinition = {
      name: "sprite_29",
      totalFrames: 20,
      frames: textures.getFrames("sprite_29"),
      anchorX: sprite29Anchor.x,
      anchorY: sprite29Anchor.y,
    };

    // ---- sprite_34 — 12-frame composite, no scripted events ----
    const sprite34Anchor = calculateAnchor(SPRITE_34_BOUNDS);
    const sprite34Sym: SymbolDefinition = {
      name: "sprite_34",
      totalFrames: 12,
      frames: textures.getFrames("sprite_34"),
      anchorX: sprite34Anchor.x,
      anchorY: sprite34Anchor.y,
    };

    // ---- sprite_40 — 8-frame composite ----
    // AS DefineSprite_40/frame_5/DoAction.as: (empty — no-op)
    // AS DefineSprite_40/frame_8/DoAction.as: stop()
    const sprite40Anchor = calculateAnchor(SPRITE_40_BOUNDS);
    const sprite40Sym: SymbolDefinition = {
      name: "sprite_40",
      totalFrames: 8,
      frames: textures.getFrames("sprite_40"),
      anchorX: sprite40Anchor.x,
      anchorY: sprite40Anchor.y,
      frameScripts: new Map([
        [
          4,
          (_clip) => {
            // AS DefineSprite_40/frame_5/DoAction.as: (empty)
          },
        ],
        [
          7,
          (clip) => {
            // AS DefineSprite_40/frame_8/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_44 — 41-frame composite ----
    // AS DefineSprite_44/frame_23/DoAction.as: GAC.applyEnd(this)  → signalHit
    // AS DefineSprite_44/frame_35/DoAction.as: GAC.applyAnim(this,"Static") → stop()
    // complete() fired at last frame (index 40)
    const sprite44Anchor = calculateAnchor(SPRITE_44_BOUNDS);
    const sprite44Sym: SymbolDefinition = {
      name: "sprite_44",
      totalFrames: 41,
      frames: textures.getFrames("sprite_44"),
      anchorX: sprite44Anchor.x,
      anchorY: sprite44Anchor.y,
      frameScripts: new Map([
        [
          22,
          (_clip) => {
            // AS DefineSprite_44/frame_23/DoAction.as: GAC.applyEnd(this)
            this.runtime.signalHit();
          },
        ],
        [
          34,
          (clip) => {
            // AS DefineSprite_44/frame_35/DoAction.as: GAC.applyAnim(this,"Static")
            clip.stop();
          },
        ],
        [
          40,
          (_clip) => {
            // Last frame of the longest sprite — signal spell completion.
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- sprite_47 — 24-frame composite ----
    // AS DefineSprite_47/frame_12/DoAction.as: GAC.applyEnd(this)  → signalHit
    // AS DefineSprite_47/frame_24/DoAction.as: GAC.applyAnim(this,"Static") → stop()
    const sprite47Anchor = calculateAnchor(SPRITE_47_BOUNDS);
    const sprite47Sym: SymbolDefinition = {
      name: "sprite_47",
      totalFrames: 24,
      frames: textures.getFrames("sprite_47"),
      anchorX: sprite47Anchor.x,
      anchorY: sprite47Anchor.y,
      frameScripts: new Map([
        [
          11,
          (_clip) => {
            // AS DefineSprite_47/frame_12/DoAction.as: GAC.applyEnd(this)
            this.runtime.signalHit();
          },
        ],
        [
          23,
          (clip) => {
            // AS DefineSprite_47/frame_24/DoAction.as: GAC.applyAnim(this,"Static")
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_50 — 27-frame composite ----
    // AS DefineSprite_50/frame_14/DoAction.as: GAC.applyEnd(this)  → signalHit
    // AS DefineSprite_50/frame_21/DoAction.as: GAC.applyAnim(this,"Static") → stop()
    const sprite50Anchor = calculateAnchor(SPRITE_50_BOUNDS);
    const sprite50Sym: SymbolDefinition = {
      name: "sprite_50",
      totalFrames: 27,
      frames: textures.getFrames("sprite_50"),
      anchorX: sprite50Anchor.x,
      anchorY: sprite50Anchor.y,
      frameScripts: new Map([
        [
          13,
          (_clip) => {
            // AS DefineSprite_50/frame_14/DoAction.as: GAC.applyEnd(this)
            this.runtime.signalHit();
          },
        ],
        [
          20,
          (clip) => {
            // AS DefineSprite_50/frame_21/DoAction.as: GAC.applyAnim(this,"Static")
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_54 — 24-frame composite ----
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
        [
          15,
          (_clip) => {
            // AS DefineSprite_54/frame_16/DoAction.as: SOMA.playSound("death")
            this._playSound?.("death");
          },
        ],
        [
          23,
          (clip) => {
            // AS DefineSprite_54/frame_24/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_59 — 5-frame composite ----
    // AS DefineSprite_59/frame_5/DoAction.as: stop()
    const sprite59Anchor = calculateAnchor(SPRITE_59_BOUNDS);
    const sprite59Sym: SymbolDefinition = {
      name: "sprite_59",
      totalFrames: 5,
      frames: textures.getFrames("sprite_59"),
      anchorX: sprite59Anchor.x,
      anchorY: sprite59Anchor.y,
      frameScripts: new Map([
        [
          4,
          (clip) => {
            // AS DefineSprite_59/frame_5/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_64 — 5-frame composite ----
    // AS DefineSprite_64/frame_5/DoAction.as: stop()
    const sprite64Anchor = calculateAnchor(SPRITE_64_BOUNDS);
    const sprite64Sym: SymbolDefinition = {
      name: "sprite_64",
      totalFrames: 5,
      frames: textures.getFrames("sprite_64"),
      anchorX: sprite64Anchor.x,
      anchorY: sprite64Anchor.y,
      frameScripts: new Map([
        [
          4,
          (clip) => {
            // AS DefineSprite_64/frame_5/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_65 — 12-frame composite ----
    // AS DefineSprite_65/frame_3/DoAction.as:  SOMA.playSound("hit_defaut")
    // AS DefineSprite_65/frame_12/DoAction.as: GAC.applyAnim(this,"Static") → stop()
    const sprite65Anchor = calculateAnchor(SPRITE_65_BOUNDS);
    const sprite65Sym: SymbolDefinition = {
      name: "sprite_65",
      totalFrames: 12,
      frames: textures.getFrames("sprite_65"),
      anchorX: sprite65Anchor.x,
      anchorY: sprite65Anchor.y,
      frameScripts: new Map([
        [
          2,
          (_clip) => {
            // AS DefineSprite_65/frame_3/DoAction.as: SOMA.playSound("hit_defaut")
            this._playSound?.("hit_defaut");
          },
        ],
        [
          11,
          (clip) => {
            // AS DefineSprite_65/frame_12/DoAction.as: GAC.applyAnim(this,"Static")
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_70 — 9-frame composite ----
    // AS DefineSprite_70/frame_9/DoAction.as: stop()
    const sprite70Anchor = calculateAnchor(SPRITE_70_BOUNDS);
    const sprite70Sym: SymbolDefinition = {
      name: "sprite_70",
      totalFrames: 9,
      frames: textures.getFrames("sprite_70"),
      anchorX: sprite70Anchor.x,
      anchorY: sprite70Anchor.y,
      frameScripts: new Map([
        [
          8,
          (clip) => {
            // AS DefineSprite_70/frame_9/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_71 — 13-frame composite ----
    // AS DefineSprite_71/frame_13/DoAction.as: GAC.applyAnim(this,"Static") → stop()
    const sprite71Anchor = calculateAnchor(SPRITE_71_BOUNDS);
    const sprite71Sym: SymbolDefinition = {
      name: "sprite_71",
      totalFrames: 13,
      frames: textures.getFrames("sprite_71"),
      anchorX: sprite71Anchor.x,
      anchorY: sprite71Anchor.y,
      frameScripts: new Map([
        [
          12,
          (clip) => {
            // AS DefineSprite_71/frame_13/DoAction.as: GAC.applyAnim(this,"Static")
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_95 — 20-frame composite, no scripted events ----
    const sprite95Anchor = calculateAnchor(SPRITE_95_BOUNDS);
    const sprite95Sym: SymbolDefinition = {
      name: "sprite_95",
      totalFrames: 20,
      frames: textures.getFrames("sprite_95"),
      anchorX: sprite95Anchor.x,
      anchorY: sprite95Anchor.y,
    };

    // ---- sprite_97 — 12-frame composite, no scripted events ----
    const sprite97Anchor = calculateAnchor(SPRITE_97_BOUNDS);
    const sprite97Sym: SymbolDefinition = {
      name: "sprite_97",
      totalFrames: 12,
      frames: textures.getFrames("sprite_97"),
      anchorX: sprite97Anchor.x,
      anchorY: sprite97Anchor.y,
    };

    // ---- sprite_101 — 41-frame composite ----
    // AS DefineSprite_101/frame_23/DoAction.as: GAC.applyEnd(this)  → signalHit
    // AS DefineSprite_101/frame_35/DoAction.as: GAC.applyAnim(this,"Static") → stop()
    const sprite101Anchor = calculateAnchor(SPRITE_101_BOUNDS);
    const sprite101Sym: SymbolDefinition = {
      name: "sprite_101",
      totalFrames: 41,
      frames: textures.getFrames("sprite_101"),
      anchorX: sprite101Anchor.x,
      anchorY: sprite101Anchor.y,
      frameScripts: new Map([
        [
          22,
          (_clip) => {
            // AS DefineSprite_101/frame_23/DoAction.as: GAC.applyEnd(this)
            this.runtime.signalHit();
          },
        ],
        [
          34,
          (clip) => {
            // AS DefineSprite_101/frame_35/DoAction.as: GAC.applyAnim(this,"Static")
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_104 — 24-frame composite ----
    // AS DefineSprite_104/frame_12/DoAction.as: GAC.applyEnd(this)  → signalHit
    // AS DefineSprite_104/frame_24/DoAction.as: GAC.applyAnim(this,"Static") → stop()
    const sprite104Anchor = calculateAnchor(SPRITE_104_BOUNDS);
    const sprite104Sym: SymbolDefinition = {
      name: "sprite_104",
      totalFrames: 24,
      frames: textures.getFrames("sprite_104"),
      anchorX: sprite104Anchor.x,
      anchorY: sprite104Anchor.y,
      frameScripts: new Map([
        [
          11,
          (_clip) => {
            // AS DefineSprite_104/frame_12/DoAction.as: GAC.applyEnd(this)
            this.runtime.signalHit();
          },
        ],
        [
          23,
          (clip) => {
            // AS DefineSprite_104/frame_24/DoAction.as: GAC.applyAnim(this,"Static")
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_107 — 27-frame composite ----
    // AS DefineSprite_107/frame_14/DoAction.as: GAC.applyEnd(this)  → signalHit
    // AS DefineSprite_107/frame_21/DoAction.as: GAC.applyAnim(this,"Static") → stop()
    const sprite107Anchor = calculateAnchor(SPRITE_107_BOUNDS);
    const sprite107Sym: SymbolDefinition = {
      name: "sprite_107",
      totalFrames: 27,
      frames: textures.getFrames("sprite_107"),
      anchorX: sprite107Anchor.x,
      anchorY: sprite107Anchor.y,
      frameScripts: new Map([
        [
          13,
          (_clip) => {
            // AS DefineSprite_107/frame_14/DoAction.as: GAC.applyEnd(this)
            this.runtime.signalHit();
          },
        ],
        [
          20,
          (clip) => {
            // AS DefineSprite_107/frame_21/DoAction.as: GAC.applyAnim(this,"Static")
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_109 — 20-frame composite ----
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
        [
          12,
          (_clip) => {
            // AS DefineSprite_109/frame_13/DoAction.as: SOMA.playSound("death")
            this._playSound?.("death");
          },
        ],
        [
          19,
          (clip) => {
            // AS DefineSprite_109/frame_20/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_111 — 12-frame composite ----
    // AS DefineSprite_111/frame_3/DoAction.as:  SOMA.playSound("hit_defaut")
    // AS DefineSprite_111/frame_12/DoAction.as: GAC.applyAnim(this,"Static") → stop()
    const sprite111Anchor = calculateAnchor(SPRITE_111_BOUNDS);
    const sprite111Sym: SymbolDefinition = {
      name: "sprite_111",
      totalFrames: 12,
      frames: textures.getFrames("sprite_111"),
      anchorX: sprite111Anchor.x,
      anchorY: sprite111Anchor.y,
      frameScripts: new Map([
        [
          2,
          (_clip) => {
            // AS DefineSprite_111/frame_3/DoAction.as: SOMA.playSound("hit_defaut")
            this._playSound?.("hit_defaut");
          },
        ],
        [
          11,
          (clip) => {
            // AS DefineSprite_111/frame_12/DoAction.as: GAC.applyAnim(this,"Static")
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_113 — 13-frame composite ----
    // AS DefineSprite_113/frame_13/DoAction.as: GAC.applyAnim(this,"Static") → stop()
    const sprite113Anchor = calculateAnchor(SPRITE_113_BOUNDS);
    const sprite113Sym: SymbolDefinition = {
      name: "sprite_113",
      totalFrames: 13,
      frames: textures.getFrames("sprite_113"),
      anchorX: sprite113Anchor.x,
      anchorY: sprite113Anchor.y,
      frameScripts: new Map([
        [
          12,
          (clip) => {
            // AS DefineSprite_113/frame_13/DoAction.as: GAC.applyAnim(this,"Static")
            clip.stop();
          },
        ],
      ]),
    };

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
    // Store callback so frame scripts inside symbols can call playSound.
    this._playSound = callbacks.playSound;

    // Main timeline sounds[] cues (frame 2 → "hit_defaut", frame 12 → "death",
    // frame 15 → "death") are on the ROOT timeline. Wire them into the root's
    // frameScripts via onEnterFrame on the root clip, checking elapsedFrames.
    // We implement this by attaching an onEnterFrame to the root that fires
    // the three sound cues at the canonical frames.
    //
    // manifest.sounds[]:
    //   { frame: 2,  soundId: "hit_defaut" }
    //   { frame: 12, soundId: "death"      }
    //   { frame: 15, soundId: "death"      }
    //
    // The runtime ticks at 60 fps (TRIPLEFRAMERATE). The SWF fps is 20.
    // TRIPLEFRAMERATE means the authored 20 fps × 3 = 60 fps tick rate.
    // So authored frame N corresponds to runtime tick N (1-indexed same as AS).
    // We track which sounds have fired using a local state bitmask.
    let soundsFired = 0;
    this.root.onEnterFrame = (_clip) => {
      const elapsed = this.runtime.framesElapsed;
      if (!(soundsFired & 1) && elapsed >= 2) {
        // AS main timeline frame_2: SOMA.playSound("hit_defaut")
        this._playSound?.("hit_defaut");
        soundsFired |= 1;
      }
      if (!(soundsFired & 2) && elapsed >= 12) {
        // AS main timeline frame_12: SOMA.playSound("death")
        this._playSound?.("death");
        soundsFired |= 2;
      }
      if (!(soundsFired & 4) && elapsed >= 15) {
        // AS main timeline frame_15: SOMA.playSound("death")
        this._playSound?.("death");
        soundsFired |= 4;
      }
      if (soundsFired === 7) {
        // All three cues fired — remove the onEnterFrame to stop polling.
        this.root.onEnterFrame = null;
      }
    };

    // Attach all sprite symbols to the root at the target cell (depth order
    // matches typical z-ordering — lower depths behind, higher in front).
    const sym29  = this.registry.resolve("sprite_29");
    const sym34  = this.registry.resolve("sprite_34");
    const sym40  = this.registry.resolve("sprite_40");
    const sym44  = this.registry.resolve("sprite_44");
    const sym47  = this.registry.resolve("sprite_47");
    const sym50  = this.registry.resolve("sprite_50");
    const sym54  = this.registry.resolve("sprite_54");
    const sym59  = this.registry.resolve("sprite_59");
    const sym64  = this.registry.resolve("sprite_64");
    const sym65  = this.registry.resolve("sprite_65");
    const sym70  = this.registry.resolve("sprite_70");
    const sym71  = this.registry.resolve("sprite_71");
    const sym95  = this.registry.resolve("sprite_95");
    const sym97  = this.registry.resolve("sprite_97");
    const sym101 = this.registry.resolve("sprite_101");
    const sym104 = this.registry.resolve("sprite_104");
    const sym107 = this.registry.resolve("sprite_107");
    const sym109 = this.registry.resolve("sprite_109");
    const sym111 = this.registry.resolve("sprite_111");
    const sym113 = this.registry.resolve("sprite_113");

    if (sym29)  { this.root.attach(sym29,  "sprite_29",  1,  context); }
    if (sym34)  { this.root.attach(sym34,  "sprite_34",  2,  context); }
    if (sym40)  { this.root.attach(sym40,  "sprite_40",  3,  context); }
    if (sym44)  { this.root.attach(sym44,  "sprite_44",  4,  context); }
    if (sym47)  { this.root.attach(sym47,  "sprite_47",  5,  context); }
    if (sym50)  { this.root.attach(sym50,  "sprite_50",  6,  context); }
    if (sym54)  { this.root.attach(sym54,  "sprite_54",  7,  context); }
    if (sym59)  { this.root.attach(sym59,  "sprite_59",  8,  context); }
    if (sym64)  { this.root.attach(sym64,  "sprite_64",  9,  context); }
    if (sym65)  { this.root.attach(sym65,  "sprite_65",  10, context); }
    if (sym70)  { this.root.attach(sym70,  "sprite_70",  11, context); }
    if (sym71)  { this.root.attach(sym71,  "sprite_71",  12, context); }
    if (sym95)  { this.root.attach(sym95,  "sprite_95",  13, context); }
    if (sym97)  { this.root.attach(sym97,  "sprite_97",  14, context); }
    if (sym101) { this.root.attach(sym101, "sprite_101", 15, context); }
    if (sym104) { this.root.attach(sym104, "sprite_104", 16, context); }
    if (sym107) { this.root.attach(sym107, "sprite_107", 17, context); }
    if (sym109) { this.root.attach(sym109, "sprite_109", 18, context); }
    if (sym111) { this.root.attach(sym111, "sprite_111", 19, context); }
    if (sym113) { this.root.attach(sym113, "sprite_113", 20, context); }
  }
}
