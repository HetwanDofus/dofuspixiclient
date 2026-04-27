/**
 * Spell 1056 — (Wabbit CC / Death animation).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1056/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile, no caster-side
 * positioning logic, no dual-anchored WorldAbsolute pattern, and no move/shoot
 * symbols. All animated content is authored timelines placed on the main
 * timeline at specific frames (frame_15, frame_23, frame_31, frame_37) and
 * referenced via PlaceObject2 clip events. The container is anchored at the
 * target cell.
 *
 * Main timeline:
 *   frame_1:  var apparition = 1  (stored on root.vars)
 *   frame_15: PlaceObject2_21_1 onClipEvent(load) → _parent.apparition = 0
 *   frame_23: PlaceObject2_22_1 onClipEvent(load) → _parent.apparition = 0
 *   frame_31: PlaceObject2_12_1 onClipEvent(load) → if apparition==1 GAC.applyAnim("Appear")
 *   frame_37: PlaceObject2_16_1 onClipEvent(load) → if apparition==1 GAC.applyAnim("Appear")
 *
 * Sounds from manifest:
 *   frame 0: "death"       (first frame)
 *   frame 2: "hit_defaut"  (third frame)
 *   frame 7: "cc_wabbit"   (eighth frame)
 *
 * Library symbols: none — all content is from animations[] only, no librarySymbols[].
 *
 * The canonical AS uses GAC.applyAnim / GAC.applyEnd which are game-engine
 * calls that control fighter character animations. These have no visual effect
 * in the spell animation layer itself; we model them as no-ops but preserve
 * the structural frame timing. Sounds are played from within the sprite
 * frameScripts.
 *
 * The sprite timelines:
 *   sprite_19  (15f): frame_14 → stop()
 *   sprite_21  (13f): frame_13 → GAC.applyAnim("Static") [no-op]
 *   sprite_22  (13f): frame_13 → GAC.applyAnim("Static") [no-op]
 *   sprite_23  (10f): no scripts
 *   sprite_24  (10f): no scripts
 *   sprite_27  (27f): frame_8  → playSound("cc_wabbit")
 *                     frame_9  → GAC.applyEnd [no-op]
 *                     frame_27 → GAC.applyAnim("Static") [no-op]
 *   sprite_30  (23f): frame_8  → playSound("cc_wabbit")
 *                     frame_9  → GAC.applyEnd [no-op]
 *                     frame_23 → GAC.applyAnim("Static") [no-op]
 *   sprite_34  (29f): frame_9  → PlaceObject2_32_19 onEnterFrame: _alpha = random(100)
 *                     frame_24 → GAC.applyEnd [no-op]
 *                     frame_29 → GAC.applyAnim("Static") [no-op]
 *   sprite_35  (30f): frame_9  → PlaceObject2_32_16 onEnterFrame: _alpha = random(100)
 *                     frame_24 → GAC.applyEnd [no-op]
 *                     frame_30 → GAC.applyAnim("Static") [no-op]
 *   sprite_43  (9f):  frame_9  → stop()
 *   sprite_48  (12f): frame_3  → playSound("hit_defaut")
 *                     frame_12 → _parent.gotoAndStop("StaticR") [no-op]
 *   sprite_51  (12f): frame_3  → playSound("hit_defaut")
 *                     frame_12 → _parent.gotoAndStop("StaticL") [no-op]
 *   sprite_55  (9f):  frame_9  → stop()
 *   sprite_56  (13f): frame_13 → GAC.applyAnim("Static") [no-op]
 *   sprite_57  (13f): frame_13 → GAC.applyAnim("Static") [no-op]
 *   sprite_61  (9f):  frame_1  → playSound("death")
 *                     frame_9  → stop()
 *   sprite_67  (10f): frame_1  → playSound("death")
 *                     frame_10 → stop()
 *
 * Completion: The longest sprite is sprite_35 at 30 frames (then Static loop).
 * We signal complete from sprite_35's frame_30 script (GAC.applyAnim("Static")
 * marks the end of the authored animation). signalHit is fired from sprite_48
 * and sprite_51 at their frame_3 ("hit_defaut" sound = impact moment).
 * We use sprite_48's frame_3 as the canonical hit signal (first hit_defaut).
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

const SPRITE_19_BOUNDS = {
  width: 23.3,
  height: 35.5,
  offsetX: -11.45,
  offsetY: -18.3,
};
const SPRITE_21_BOUNDS = {
  width: 33.5,
  height: 47.9,
  offsetX: -17.6,
  offsetY: -41.95,
};
const SPRITE_22_BOUNDS = {
  width: 33.5,
  height: 44.9,
  offsetX: -15,
  offsetY: -38.75,
};
const SPRITE_23_BOUNDS = {
  width: 36.1,
  height: 55.65,
  offsetX: -18.95,
  offsetY: -46,
};
const SPRITE_24_BOUNDS = {
  width: 35.05,
  height: 53.3,
  offsetX: -16.75,
  offsetY: -43.35,
};
const SPRITE_27_BOUNDS = {
  width: 45.9,
  height: 51.35,
  offsetX: -28.25,
  offsetY: -44.4,
};
const SPRITE_30_BOUNDS = {
  width: 48.35,
  height: 49.6,
  offsetX: -19.35,
  offsetY: -43.85,
};
const SPRITE_34_BOUNDS = {
  width: 41.35,
  height: 133.95,
  offsetX: -23.35,
  offsetY: -117.95,
};
const SPRITE_35_BOUNDS = {
  width: 40.1,
  height: 125.8,
  offsetX: -16.65,
  offsetY: -118.5,
};
const SPRITE_43_BOUNDS = {
  width: 52.2,
  height: 33.55,
  offsetX: -25.85,
  offsetY: -17.15,
};
const SPRITE_48_BOUNDS = {
  width: 71.05,
  height: 75.75,
  offsetX: -52.25,
  offsetY: -71.45,
};
const SPRITE_51_BOUNDS = {
  width: 85.45,
  height: 75.55,
  offsetX: -64.75,
  offsetY: -71.45,
};
const SPRITE_55_BOUNDS = {
  width: 57.6,
  height: 40.1,
  offsetX: -28.55,
  offsetY: -20.35,
};
const SPRITE_56_BOUNDS = {
  width: 72.55,
  height: 64.75,
  offsetX: -56.35,
  offsetY: -58.6,
};
const SPRITE_57_BOUNDS = {
  width: 71.55,
  height: 64.55,
  offsetX: -56.35,
  offsetY: -58.6,
};
const SPRITE_61_BOUNDS = {
  width: 67.15,
  height: 83.4,
  offsetX: -33.9,
  offsetY: -69.95,
};
const SPRITE_67_BOUNDS = {
  width: 38.15,
  height: 87.05,
  offsetX: -19.1,
  offsetY: -69.1,
};

export class Spell1056 extends RuntimeSpell {
  readonly spellId = 1056;
  readonly displayType = SpellDisplayType.TargetCell;

  private soundCallback?: (id: string) => void;
  private hitSignalledFromSprite = false;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    // ---- sprite_19 (15 frames) -----------------------------------
    // AS DefineSprite_19/frame_14/DoAction.as: stop()
    const sprite19Anchor = calculateAnchor(SPRITE_19_BOUNDS);
    const sprite19Sym: SymbolDefinition = {
      name: "sprite_19",
      totalFrames: 15,
      frames: textures.getFrames("sprite_19"),
      anchorX: sprite19Anchor.x,
      anchorY: sprite19Anchor.y,
      frameScripts: new Map([
        [
          13,
          (clip) => {
            // AS DefineSprite_19/frame_14/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_21 (13 frames) -----------------------------------
    // AS DefineSprite_21/frame_13/DoAction.as: GAC.applyAnim(this,"Static") [no-op]
    const sprite21Anchor = calculateAnchor(SPRITE_21_BOUNDS);
    const sprite21Sym: SymbolDefinition = {
      name: "sprite_21",
      totalFrames: 13,
      frames: textures.getFrames("sprite_21"),
      anchorX: sprite21Anchor.x,
      anchorY: sprite21Anchor.y,
      frameScripts: new Map([
        [
          12,
          (_clip) => {
            // AS DefineSprite_21/frame_13/DoAction.as: GAC.applyAnim(this,"Static") — no-op
          },
        ],
      ]),
    };

    // ---- sprite_22 (13 frames) -----------------------------------
    // AS DefineSprite_22/frame_13/DoAction.as: GAC.applyAnim(this,"Static") [no-op]
    const sprite22Anchor = calculateAnchor(SPRITE_22_BOUNDS);
    const sprite22Sym: SymbolDefinition = {
      name: "sprite_22",
      totalFrames: 13,
      frames: textures.getFrames("sprite_22"),
      anchorX: sprite22Anchor.x,
      anchorY: sprite22Anchor.y,
      frameScripts: new Map([
        [
          12,
          (_clip) => {
            // AS DefineSprite_22/frame_13/DoAction.as: GAC.applyAnim(this,"Static") — no-op
          },
        ],
      ]),
    };

    // ---- sprite_23 (10 frames) -----------------------------------
    // No scripts in canonical AS.
    const sprite23Anchor = calculateAnchor(SPRITE_23_BOUNDS);
    const sprite23Sym: SymbolDefinition = {
      name: "sprite_23",
      totalFrames: 10,
      frames: textures.getFrames("sprite_23"),
      anchorX: sprite23Anchor.x,
      anchorY: sprite23Anchor.y,
    };

    // ---- sprite_24 (10 frames) -----------------------------------
    // No scripts in canonical AS.
    const sprite24Anchor = calculateAnchor(SPRITE_24_BOUNDS);
    const sprite24Sym: SymbolDefinition = {
      name: "sprite_24",
      totalFrames: 10,
      frames: textures.getFrames("sprite_24"),
      anchorX: sprite24Anchor.x,
      anchorY: sprite24Anchor.y,
    };

    // ---- sprite_27 (27 frames) -----------------------------------
    // AS DefineSprite_27/frame_8/DoAction.as:  SOMA.playSound("cc_wabbit")
    // AS DefineSprite_27/frame_9/DoAction.as:  GAC.applyEnd(this) [no-op]
    // AS DefineSprite_27/frame_27/DoAction.as: GAC.applyAnim(this,"Static") [no-op]
    const sprite27Anchor = calculateAnchor(SPRITE_27_BOUNDS);
    const sprite27Sym: SymbolDefinition = {
      name: "sprite_27",
      totalFrames: 27,
      frames: textures.getFrames("sprite_27"),
      anchorX: sprite27Anchor.x,
      anchorY: sprite27Anchor.y,
      frameScripts: new Map([
        [
          7,
          (_clip) => {
            // AS DefineSprite_27/frame_8/DoAction.as: SOMA.playSound("cc_wabbit")
            this.soundCallback?.("cc_wabbit");
          },
        ],
        [
          8,
          (_clip) => {
            // AS DefineSprite_27/frame_9/DoAction.as: GAC.applyEnd(this) — no-op
          },
        ],
        [
          26,
          (_clip) => {
            // AS DefineSprite_27/frame_27/DoAction.as: GAC.applyAnim(this,"Static") — no-op
          },
        ],
      ]),
    };

    // ---- sprite_30 (23 frames) -----------------------------------
    // AS DefineSprite_30/frame_8/DoAction.as:  SOMA.playSound("cc_wabbit")
    // AS DefineSprite_30/frame_9/DoAction.as:  GAC.applyEnd(this) [no-op]
    // AS DefineSprite_30/frame_23/DoAction.as: GAC.applyAnim(this,"Static") [no-op]
    const sprite30Anchor = calculateAnchor(SPRITE_30_BOUNDS);
    const sprite30Sym: SymbolDefinition = {
      name: "sprite_30",
      totalFrames: 23,
      frames: textures.getFrames("sprite_30"),
      anchorX: sprite30Anchor.x,
      anchorY: sprite30Anchor.y,
      frameScripts: new Map([
        [
          7,
          (_clip) => {
            // AS DefineSprite_30/frame_8/DoAction.as: SOMA.playSound("cc_wabbit")
            this.soundCallback?.("cc_wabbit");
          },
        ],
        [
          8,
          (_clip) => {
            // AS DefineSprite_30/frame_9/DoAction.as: GAC.applyEnd(this) — no-op
          },
        ],
        [
          22,
          (_clip) => {
            // AS DefineSprite_30/frame_23/DoAction.as: GAC.applyAnim(this,"Static") — no-op
          },
        ],
      ]),
    };

    // ---- sprite_34 (29 frames) -----------------------------------
    // AS DefineSprite_34/frame_9/PlaceObject2_32_19/CLIPACTIONRECORD onClipEvent(enterFrame).as:
    //   _alpha = random(100)
    // This clip event is on a child PlaceObject placed at frame_9. We model
    // it as an onEnterFrame on sprite_34 itself that starts randomising alpha
    // after the sprite has reached frame 9 (i.e. after frame index 8).
    // AS DefineSprite_34/frame_24/DoAction.as: GAC.applyEnd(this) [no-op]
    // AS DefineSprite_34/frame_29/DoAction.as: GAC.applyAnim(this,"Static") [no-op]
    const sprite34Anchor = calculateAnchor(SPRITE_34_BOUNDS);
    const sprite34Sym: SymbolDefinition = {
      name: "sprite_34",
      totalFrames: 29,
      frames: textures.getFrames("sprite_34"),
      anchorX: sprite34Anchor.x,
      anchorY: sprite34Anchor.y,
      onEnterFrame: (clip) => {
        // AS DefineSprite_34/frame_9/PlaceObject2_32_19/CLIPACTIONRECORD onClipEvent(enterFrame).as:
        // _alpha = random(100) — active once the PlaceObject at frame_9 is placed.
        // We gate this on currentFrame >= 8 (0-based frame 8 = AS frame_9).
        if (clip.currentFrame >= 8) {
          clip.alpha = Math.floor(Math.random() * 100) / 100;
        }
      },
      frameScripts: new Map([
        [
          23,
          (_clip) => {
            // AS DefineSprite_34/frame_24/DoAction.as: GAC.applyEnd(this) — no-op
          },
        ],
        [
          28,
          (_clip) => {
            // AS DefineSprite_34/frame_29/DoAction.as: GAC.applyAnim(this,"Static") — no-op
          },
        ],
      ]),
    };

    // ---- sprite_35 (30 frames) -----------------------------------
    // AS DefineSprite_35/frame_9/PlaceObject2_32_16/CLIPACTIONRECORD onClipEvent(enterFrame).as:
    //   _alpha = random(100)
    // AS DefineSprite_35/frame_24/DoAction.as: GAC.applyEnd(this) [no-op]
    // AS DefineSprite_35/frame_30/DoAction.as: GAC.applyAnim(this,"Static") [no-op]
    // sprite_35 is the longest timeline at 30 frames → signals spell completion.
    const sprite35Anchor = calculateAnchor(SPRITE_35_BOUNDS);
    const sprite35Sym: SymbolDefinition = {
      name: "sprite_35",
      totalFrames: 30,
      frames: textures.getFrames("sprite_35"),
      anchorX: sprite35Anchor.x,
      anchorY: sprite35Anchor.y,
      onEnterFrame: (clip) => {
        // AS DefineSprite_35/frame_9/PlaceObject2_32_16/CLIPACTIONRECORD onClipEvent(enterFrame).as:
        // _alpha = random(100) — active once the PlaceObject at frame_9 is placed.
        if (clip.currentFrame >= 8) {
          clip.alpha = Math.floor(Math.random() * 100) / 100;
        }
      },
      frameScripts: new Map([
        [
          23,
          (_clip) => {
            // AS DefineSprite_35/frame_24/DoAction.as: GAC.applyEnd(this) — no-op
          },
        ],
        [
          29,
          (clip) => {
            // AS DefineSprite_35/frame_30/DoAction.as: GAC.applyAnim(this,"Static")
            // This is the end of the authored animation — signal completion.
            clip.stop();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- sprite_43 (9 frames) ------------------------------------
    // AS DefineSprite_43/frame_9/DoAction.as: stop()
    const sprite43Anchor = calculateAnchor(SPRITE_43_BOUNDS);
    const sprite43Sym: SymbolDefinition = {
      name: "sprite_43",
      totalFrames: 9,
      frames: textures.getFrames("sprite_43"),
      anchorX: sprite43Anchor.x,
      anchorY: sprite43Anchor.y,
      frameScripts: new Map([
        [
          8,
          (clip) => {
            // AS DefineSprite_43/frame_9/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_48 (12 frames) -----------------------------------
    // AS DefineSprite_48/frame_3/DoAction.as:  SOMA.playSound("hit_defaut")
    // AS DefineSprite_48/frame_12/DoAction.as: _parent.gotoAndStop("StaticR") [no-op]
    // frame_3 is the impact sound → canonical signalHit.
    const sprite48Anchor = calculateAnchor(SPRITE_48_BOUNDS);
    const sprite48Sym: SymbolDefinition = {
      name: "sprite_48",
      totalFrames: 12,
      frames: textures.getFrames("sprite_48"),
      anchorX: sprite48Anchor.x,
      anchorY: sprite48Anchor.y,
      frameScripts: new Map([
        [
          2,
          (_clip) => {
            // AS DefineSprite_48/frame_3/DoAction.as: SOMA.playSound("hit_defaut")
            this.soundCallback?.("hit_defaut");
            // Signal hit at first impact sound (canonical hit moment).
            if (!this.hitSignalledFromSprite) {
              this.hitSignalledFromSprite = true;
              this.runtime.signalHit();
            }
          },
        ],
        [
          11,
          (_clip) => {
            // AS DefineSprite_48/frame_12/DoAction.as: _parent.gotoAndStop("StaticR") — no-op
          },
        ],
      ]),
    };

    // ---- sprite_51 (12 frames) -----------------------------------
    // AS DefineSprite_51/frame_3/DoAction.as:  SOMA.playSound("hit_defaut")
    // AS DefineSprite_51/frame_12/DoAction.as: _parent.gotoAndStop("StaticL") [no-op]
    const sprite51Anchor = calculateAnchor(SPRITE_51_BOUNDS);
    const sprite51Sym: SymbolDefinition = {
      name: "sprite_51",
      totalFrames: 12,
      frames: textures.getFrames("sprite_51"),
      anchorX: sprite51Anchor.x,
      anchorY: sprite51Anchor.y,
      frameScripts: new Map([
        [
          2,
          (_clip) => {
            // AS DefineSprite_51/frame_3/DoAction.as: SOMA.playSound("hit_defaut")
            this.soundCallback?.("hit_defaut");
            // Guard: only signal hit once (sprite_48 fires first).
            if (!this.hitSignalledFromSprite) {
              this.hitSignalledFromSprite = true;
              this.runtime.signalHit();
            }
          },
        ],
        [
          11,
          (_clip) => {
            // AS DefineSprite_51/frame_12/DoAction.as: _parent.gotoAndStop("StaticL") — no-op
          },
        ],
      ]),
    };

    // ---- sprite_55 (9 frames) ------------------------------------
    // AS DefineSprite_55/frame_9/DoAction.as: stop()
    const sprite55Anchor = calculateAnchor(SPRITE_55_BOUNDS);
    const sprite55Sym: SymbolDefinition = {
      name: "sprite_55",
      totalFrames: 9,
      frames: textures.getFrames("sprite_55"),
      anchorX: sprite55Anchor.x,
      anchorY: sprite55Anchor.y,
      frameScripts: new Map([
        [
          8,
          (clip) => {
            // AS DefineSprite_55/frame_9/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_56 (13 frames) -----------------------------------
    // AS DefineSprite_56/frame_13/DoAction.as: GAC.applyAnim(this,"Static") [no-op]
    const sprite56Anchor = calculateAnchor(SPRITE_56_BOUNDS);
    const sprite56Sym: SymbolDefinition = {
      name: "sprite_56",
      totalFrames: 13,
      frames: textures.getFrames("sprite_56"),
      anchorX: sprite56Anchor.x,
      anchorY: sprite56Anchor.y,
      frameScripts: new Map([
        [
          12,
          (_clip) => {
            // AS DefineSprite_56/frame_13/DoAction.as: GAC.applyAnim(this,"Static") — no-op
          },
        ],
      ]),
    };

    // ---- sprite_57 (13 frames) -----------------------------------
    // AS DefineSprite_57/frame_13/DoAction.as: GAC.applyAnim(this,"Static") [no-op]
    const sprite57Anchor = calculateAnchor(SPRITE_57_BOUNDS);
    const sprite57Sym: SymbolDefinition = {
      name: "sprite_57",
      totalFrames: 13,
      frames: textures.getFrames("sprite_57"),
      anchorX: sprite57Anchor.x,
      anchorY: sprite57Anchor.y,
      frameScripts: new Map([
        [
          12,
          (_clip) => {
            // AS DefineSprite_57/frame_13/DoAction.as: GAC.applyAnim(this,"Static") — no-op
          },
        ],
      ]),
    };

    // ---- sprite_61 (9 frames) ------------------------------------
    // AS DefineSprite_61/frame_1/DoAction.as: SOMA.playSound("death")
    // AS DefineSprite_61/frame_9/DoAction.as: stop()
    const sprite61Anchor = calculateAnchor(SPRITE_61_BOUNDS);
    const sprite61Sym: SymbolDefinition = {
      name: "sprite_61",
      totalFrames: 9,
      frames: textures.getFrames("sprite_61"),
      anchorX: sprite61Anchor.x,
      anchorY: sprite61Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS DefineSprite_61/frame_1/DoAction.as: SOMA.playSound("death")
            this.soundCallback?.("death");
          },
        ],
        [
          8,
          (clip) => {
            // AS DefineSprite_61/frame_9/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_67 (10 frames) -----------------------------------
    // AS DefineSprite_67/frame_1/DoAction.as:  SOMA.playSound("death")
    // AS DefineSprite_67/frame_10/DoAction.as: stop()
    const sprite67Anchor = calculateAnchor(SPRITE_67_BOUNDS);
    const sprite67Sym: SymbolDefinition = {
      name: "sprite_67",
      totalFrames: 10,
      frames: textures.getFrames("sprite_67"),
      anchorX: sprite67Anchor.x,
      anchorY: sprite67Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS DefineSprite_67/frame_1/DoAction.as: SOMA.playSound("death")
            this.soundCallback?.("death");
          },
        ],
        [
          9,
          (clip) => {
            // AS DefineSprite_67/frame_10/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    this.registry.register(sprite19Sym);
    this.registry.register(sprite21Sym);
    this.registry.register(sprite22Sym);
    this.registry.register(sprite23Sym);
    this.registry.register(sprite24Sym);
    this.registry.register(sprite27Sym);
    this.registry.register(sprite30Sym);
    this.registry.register(sprite34Sym);
    this.registry.register(sprite35Sym);
    this.registry.register(sprite43Sym);
    this.registry.register(sprite48Sym);
    this.registry.register(sprite51Sym);
    this.registry.register(sprite55Sym);
    this.registry.register(sprite56Sym);
    this.registry.register(sprite57Sym);
    this.registry.register(sprite61Sym);
    this.registry.register(sprite67Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for use inside frameScripts.
    this.soundCallback = callbacks.playSound;

    // AS scripts/frame_1/DoAction.as: var apparition = 1;
    // Store on root.vars so PlaceObject clip-event logic can read it.
    this.root.vars.apparition = 1;

    // The main timeline places multiple sprites at various frames via
    // PlaceObject2. The canonical clip events fire on those placed
    // objects' onClipEvent(load). We attach all registered sprites now
    // so they start ticking. The manifested PlaceObject2 clip events
    // that set/read `apparition` are modelled inline here:
    //
    //   frame_15: PlaceObject2_21_1 onClipEvent(load) → _parent.apparition = 0
    //   frame_23: PlaceObject2_22_1 onClipEvent(load) → _parent.apparition = 0
    //   frame_31: PlaceObject2_12_1 onClipEvent(load) → if apparition==1 GAC.applyAnim("Appear")
    //   frame_37: PlaceObject2_16_1 onClipEvent(load) → if apparition==1 GAC.applyAnim("Appear")
    //
    // GAC.applyAnim / GAC.applyEnd are fighter-character animation calls
    // with no visual effect in the spell layer — they are no-ops here.
    // The apparition flag only gates those GAC calls, so the flag logic
    // itself is also effectively a no-op for our purposes.
    //
    // We attach all sprite symbols at root so they play their authored
    // timelines in parallel, matching the canonical Flash PlaceObject2
    // behaviour (each placed at different depths on the main timeline).

    const sprite19Sym = this.registry.resolve("sprite_19");
    if (sprite19Sym) {
      this.root.attach(sprite19Sym, "sprite_19", 1, context);
    }

    const sprite21Sym = this.registry.resolve("sprite_21");
    if (sprite21Sym) {
      this.root.attach(sprite21Sym, "sprite_21", 2, context);
    }

    const sprite22Sym = this.registry.resolve("sprite_22");
    if (sprite22Sym) {
      this.root.attach(sprite22Sym, "sprite_22", 3, context);
    }

    const sprite23Sym = this.registry.resolve("sprite_23");
    if (sprite23Sym) {
      this.root.attach(sprite23Sym, "sprite_23", 4, context);
    }

    const sprite24Sym = this.registry.resolve("sprite_24");
    if (sprite24Sym) {
      this.root.attach(sprite24Sym, "sprite_24", 5, context);
    }

    const sprite27Sym = this.registry.resolve("sprite_27");
    if (sprite27Sym) {
      this.root.attach(sprite27Sym, "sprite_27", 6, context);
    }

    const sprite30Sym = this.registry.resolve("sprite_30");
    if (sprite30Sym) {
      this.root.attach(sprite30Sym, "sprite_30", 7, context);
    }

    const sprite34Sym = this.registry.resolve("sprite_34");
    if (sprite34Sym) {
      this.root.attach(sprite34Sym, "sprite_34", 8, context);
    }

    const sprite35Sym = this.registry.resolve("sprite_35");
    if (sprite35Sym) {
      this.root.attach(sprite35Sym, "sprite_35", 9, context);
    }

    const sprite43Sym = this.registry.resolve("sprite_43");
    if (sprite43Sym) {
      this.root.attach(sprite43Sym, "sprite_43", 10, context);
    }

    const sprite48Sym = this.registry.resolve("sprite_48");
    if (sprite48Sym) {
      this.root.attach(sprite48Sym, "sprite_48", 11, context);
    }

    const sprite51Sym = this.registry.resolve("sprite_51");
    if (sprite51Sym) {
      this.root.attach(sprite51Sym, "sprite_51", 12, context);
    }

    const sprite55Sym = this.registry.resolve("sprite_55");
    if (sprite55Sym) {
      this.root.attach(sprite55Sym, "sprite_55", 13, context);
    }

    const sprite56Sym = this.registry.resolve("sprite_56");
    if (sprite56Sym) {
      this.root.attach(sprite56Sym, "sprite_56", 14, context);
    }

    const sprite57Sym = this.registry.resolve("sprite_57");
    if (sprite57Sym) {
      this.root.attach(sprite57Sym, "sprite_57", 15, context);
    }

    const sprite61Sym = this.registry.resolve("sprite_61");
    if (sprite61Sym) {
      this.root.attach(sprite61Sym, "sprite_61", 16, context);
    }

    const sprite67Sym = this.registry.resolve("sprite_67");
    if (sprite67Sym) {
      this.root.attach(sprite67Sym, "sprite_67", 17, context);
    }
  }
}
