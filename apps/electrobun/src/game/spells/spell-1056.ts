/**
 * Spell 1056 — (Wabbit CC / Death spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1056/scripts/scripts/
 *
 * This spell has NO librarySymbols[] in the manifest — all animations live in
 * the top-level `animations[]` list. There are NO `attachMovie` calls and NO
 * `move`/`shoot`/`duplicate` projectile symbols. The spell is a collection of
 * authored timeline sprites placed directly on the main timeline at specific
 * frames, with clip events on some of them.
 *
 * displayType=11 (TargetCell): The spell has no caster-relative or projectile
 * logic. All sprites appear at/near the target. No `move`, `shoot`, or
 * `duplicate` symbols are referenced. Default impact at target cell.
 *
 * Main timeline structure:
 *   frame_1/DoAction.as: var apparition = 1; — stored on root.vars
 *
 * CLIPACTIONRECORD inventory — all 6 ported as onLoad / onEnterFrame handlers:
 *
 *   frame_15/PlaceObject2_21_1/onClipEvent(load):
 *     _parent.apparition = 0;
 *     → onLoad on sprite_21Sym: writes root.vars.apparition = 0
 *
 *   frame_23/PlaceObject2_22_1/onClipEvent(load):
 *     _parent.apparition = 0;
 *     → onLoad on sprite_22Sym: writes root.vars.apparition = 0
 *
 *   frame_31/PlaceObject2_12_1/onClipEvent(load):
 *     if(_parent.apparition == 1) { GAC.applyAnim(this,"Appear"); }
 *     → onLoad on sprite_34Sym: reads root.vars.apparition; GAC is no-op in runtime
 *
 *   frame_37/PlaceObject2_16_1/onClipEvent(load):
 *     if(_parent.apparition == 1) { GAC.applyAnim(this,"Appear"); }
 *     → onLoad on sprite_35Sym: reads root.vars.apparition; GAC is no-op in runtime
 *
 *   DefineSprite_34/frame_9/PlaceObject2_32_19/onClipEvent(enterFrame):
 *     _alpha = random(100);
 *     → onEnterFrame on flicker_34Sym: clip.alpha = random(100)/100
 *
 *   DefineSprite_35/frame_9/PlaceObject2_32_16/onClipEvent(enterFrame):
 *     _alpha = random(100);
 *     → onEnterFrame on flicker_35Sym: clip.alpha = random(100)/100
 *
 * Authored sprites and their canonical frame scripts:
 *   sprite_19  — 15 frames, frame_14: stop()
 *   sprite_21  — 13 frames, frame_13: GAC.applyAnim("Static") [no-op → stop]
 *                onLoad: _parent.apparition = 0
 *   sprite_22  — 13 frames, frame_13: GAC.applyAnim("Static") [no-op → stop]
 *                onLoad: _parent.apparition = 0
 *   sprite_23  — 10 frames (no scripts)
 *   sprite_24  — 10 frames (no scripts)
 *   sprite_27  — 27 frames, frame_8: playSound("cc_wabbit"),
 *                frame_9: GAC.applyEnd [no-op], frame_27: GAC.applyAnim("Static") [→ stop]
 *   sprite_30  — 23 frames, frame_8: playSound("cc_wabbit"),
 *                frame_9: GAC.applyEnd [no-op], frame_23: GAC.applyAnim("Static") [→ stop]
 *   sprite_34  — 29 frames, onLoad: if(apparition==1) GAC.applyAnim("Appear") [no-op],
 *                frame_9: attaches flicker child with enterFrame alpha randomiser,
 *                frame_24: GAC.applyEnd [no-op], frame_29: GAC.applyAnim("Static") [→ stop]
 *   sprite_35  — 30 frames, onLoad: if(apparition==1) GAC.applyAnim("Appear") [no-op],
 *                frame_9: attaches flicker child with enterFrame alpha randomiser,
 *                frame_24: GAC.applyEnd [no-op], frame_30: GAC.applyAnim("Static") [→ stop]
 *   sprite_43  — 9 frames, frame_9: stop()
 *   sprite_48  — 12 frames, frame_3: playSound("hit_defaut") + signalHit,
 *                frame_12: _parent.gotoAndStop("StaticR") [→ stop]
 *   sprite_51  — 12 frames, frame_3: playSound("hit_defaut"),
 *                frame_12: _parent.gotoAndStop("StaticL") [→ stop]
 *   sprite_55  — 9 frames, frame_9: stop()
 *   sprite_56  — 13 frames, frame_13: GAC.applyAnim("Static") [→ stop]
 *   sprite_57  — 13 frames, frame_13: GAC.applyAnim("Static") [→ stop]
 *   sprite_61  — 9 frames, frame_1: playSound("death"), frame_9: stop()
 *   sprite_67  — 10 frames, frame_1: playSound("death"), frame_10: stop() + complete()
 *
 * Completion: triggered from sprite_67's frame_9 (0-based) stop script —
 * sprite_67 is the last sprite attached (at root frame 36) and is the
 * canonical end-of-spell signal.
 *
 * signalHit: fired at sprite_48/frame_2 (0-based), the "hit_defaut" sound frame,
 * which is the canonical impact marker. displayType=11 so harness does not auto-signal.
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
const SPRITE_19_BOUNDS = { width: 23.3, height: 35.5, offsetX: -11.45, offsetY: -18.3 };
const SPRITE_21_BOUNDS = { width: 33.5, height: 47.9, offsetX: -17.6, offsetY: -41.95 };
const SPRITE_22_BOUNDS = { width: 33.5, height: 44.9, offsetX: -15, offsetY: -38.75 };
const SPRITE_23_BOUNDS = { width: 36.1, height: 55.65, offsetX: -18.95, offsetY: -46 };
const SPRITE_24_BOUNDS = { width: 35.05, height: 53.3, offsetX: -16.75, offsetY: -43.35 };
const SPRITE_27_BOUNDS = { width: 45.9, height: 51.35, offsetX: -28.25, offsetY: -44.4 };
const SPRITE_30_BOUNDS = { width: 48.35, height: 49.6, offsetX: -19.35, offsetY: -43.85 };
const SPRITE_34_BOUNDS = { width: 41.35, height: 133.95, offsetX: -23.35, offsetY: -117.95 };
const SPRITE_35_BOUNDS = { width: 40.1, height: 125.8, offsetX: -16.65, offsetY: -118.5 };
const SPRITE_43_BOUNDS = { width: 52.2, height: 33.55, offsetX: -25.85, offsetY: -17.15 };
const SPRITE_48_BOUNDS = { width: 71.05, height: 75.75, offsetX: -52.25, offsetY: -71.45 };
const SPRITE_51_BOUNDS = { width: 85.45, height: 75.55, offsetX: -64.75, offsetY: -71.45 };
const SPRITE_55_BOUNDS = { width: 57.6, height: 40.1, offsetX: -28.55, offsetY: -20.35 };
const SPRITE_56_BOUNDS = { width: 72.55, height: 64.75, offsetX: -56.35, offsetY: -58.6 };
const SPRITE_57_BOUNDS = { width: 71.55, height: 64.55, offsetX: -56.35, offsetY: -58.6 };
const SPRITE_61_BOUNDS = { width: 67.15, height: 83.4, offsetX: -33.9, offsetY: -69.95 };
const SPRITE_67_BOUNDS = { width: 38.15, height: 87.05, offsetX: -19.1, offsetY: -69.1 };

export class Spell1056 extends RuntimeSpell {
  readonly spellId = 1056;
  readonly displayType = SpellDisplayType.TargetCell;

  private playSound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    // ---- sprite_19 — 15-frame sprite, frame_14: stop() ----------
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
            // AS: DefineSprite_19/frame_14/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_21 — 13-frame sprite ----------------------------
    // onLoad: AS frame_15/PlaceObject2_21_1/CLIPACTIONRECORD onClipEvent(load).as
    //   _parent.apparition = 0;
    // frame_13: GAC.applyAnim(this,"Static") [no-op → stop]
    const sprite21Anchor = calculateAnchor(SPRITE_21_BOUNDS);
    const sprite21Sym: SymbolDefinition = {
      name: "sprite_21",
      totalFrames: 13,
      frames: textures.getFrames("sprite_21"),
      anchorX: sprite21Anchor.x,
      anchorY: sprite21Anchor.y,
      onLoad: (clip) => {
        // AS: frame_15/PlaceObject2_21_1/CLIPACTIONRECORD onClipEvent(load).as
        //   _parent.apparition = 0;
        const root = clip.parent;
        if (root) {
          root.vars.apparition = 0;
        }
      },
      frameScripts: new Map([
        [
          12,
          (clip) => {
            // AS: DefineSprite_21/frame_13/DoAction.as → GAC.applyAnim(this,"Static") [no-op → stop]
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_22 — 13-frame sprite ----------------------------
    // onLoad: AS frame_23/PlaceObject2_22_1/CLIPACTIONRECORD onClipEvent(load).as
    //   _parent.apparition = 0;
    // frame_13: GAC.applyAnim(this,"Static") [no-op → stop]
    const sprite22Anchor = calculateAnchor(SPRITE_22_BOUNDS);
    const sprite22Sym: SymbolDefinition = {
      name: "sprite_22",
      totalFrames: 13,
      frames: textures.getFrames("sprite_22"),
      anchorX: sprite22Anchor.x,
      anchorY: sprite22Anchor.y,
      onLoad: (clip) => {
        // AS: frame_23/PlaceObject2_22_1/CLIPACTIONRECORD onClipEvent(load).as
        //   _parent.apparition = 0;
        const root = clip.parent;
        if (root) {
          root.vars.apparition = 0;
        }
      },
      frameScripts: new Map([
        [
          12,
          (clip) => {
            // AS: DefineSprite_22/frame_13/DoAction.as → GAC.applyAnim(this,"Static") [no-op → stop]
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_23 — 10-frame sprite, no scripts -----------------
    const sprite23Anchor = calculateAnchor(SPRITE_23_BOUNDS);
    const sprite23Sym: SymbolDefinition = {
      name: "sprite_23",
      totalFrames: 10,
      frames: textures.getFrames("sprite_23"),
      anchorX: sprite23Anchor.x,
      anchorY: sprite23Anchor.y,
    };

    // ---- sprite_24 — 10-frame sprite, no scripts -----------------
    const sprite24Anchor = calculateAnchor(SPRITE_24_BOUNDS);
    const sprite24Sym: SymbolDefinition = {
      name: "sprite_24",
      totalFrames: 10,
      frames: textures.getFrames("sprite_24"),
      anchorX: sprite24Anchor.x,
      anchorY: sprite24Anchor.y,
    };

    // ---- sprite_27 — 27-frame sprite ----------------------------
    // frame_8: SOMA.playSound("cc_wabbit")
    // frame_9: GAC.applyEnd(this) [no-op]
    // frame_27: GAC.applyAnim(this,"Static") [no-op → stop]
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
            // AS: DefineSprite_27/frame_8/DoAction.as → SOMA.playSound("cc_wabbit")
            this.playSound?.("cc_wabbit");
          },
        ],
        [
          8,
          (_clip) => {
            // AS: DefineSprite_27/frame_9/DoAction.as → GAC.applyEnd(this) [no-op]
          },
        ],
        [
          26,
          (clip) => {
            // AS: DefineSprite_27/frame_27/DoAction.as → GAC.applyAnim(this,"Static") [no-op → stop]
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_30 — 23-frame sprite ----------------------------
    // frame_8: SOMA.playSound("cc_wabbit")
    // frame_9: GAC.applyEnd(this) [no-op]
    // frame_23: GAC.applyAnim(this,"Static") [no-op → stop]
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
            // AS: DefineSprite_30/frame_8/DoAction.as → SOMA.playSound("cc_wabbit")
            this.playSound?.("cc_wabbit");
          },
        ],
        [
          8,
          (_clip) => {
            // AS: DefineSprite_30/frame_9/DoAction.as → GAC.applyEnd(this) [no-op]
          },
        ],
        [
          22,
          (clip) => {
            // AS: DefineSprite_30/frame_23/DoAction.as → GAC.applyAnim(this,"Static") [no-op → stop]
            clip.stop();
          },
        ],
      ]),
    };

    // ---- flicker_34 — container-only child placed inside sprite_34 at frame_9 ---
    // AS: DefineSprite_34/frame_9/PlaceObject2_32_19/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _alpha = random(100);
    // This sub-sprite is placed at depth 19 within sprite_34's frame_9 timeline.
    // Per-tick it randomises its own alpha — NOT baked into pre-rendered SVG frames,
    // must run as a live clip with onEnterFrame.
    const flicker34Sym: SymbolDefinition = {
      name: "flicker_34",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS: DefineSprite_34/frame_9/PlaceObject2_32_19/CLIPACTIONRECORD onClipEvent(enterFrame).as
        //   _alpha = random(100);
        clip.alpha = Math.floor(Math.random() * 100) / 100;
      },
    };

    // ---- sprite_34 — 29-frame sprite with flicker child ----------
    // onLoad: AS frame_31/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(load).as
    //   if(_parent.apparition == 1) { GAC.applyAnim(this,"Appear"); }
    //   GAC.applyAnim is a no-op in the spell runtime (no fighter sprite to control).
    // frame_9: place flicker_34 child at depth 19
    // frame_24: GAC.applyEnd [no-op]
    // frame_29: GAC.applyAnim("Static") [no-op → stop]
    const sprite34Anchor = calculateAnchor(SPRITE_34_BOUNDS);
    const sprite34Sym: SymbolDefinition = {
      name: "sprite_34",
      totalFrames: 29,
      frames: textures.getFrames("sprite_34"),
      anchorX: sprite34Anchor.x,
      anchorY: sprite34Anchor.y,
      onLoad: (clip) => {
        // AS: frame_31/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(load).as
        //   if(_parent.apparition == 1) { GAC.applyAnim(this,"Appear"); }
        // _parent is the root clip. GAC.applyAnim is a no-op in the spell runtime.
        const root = clip.parent;
        const apparition = (root?.vars.apparition as number) ?? 0;
        if (apparition === 1) {
          // GAC.applyAnim(this,"Appear") — no-op in spell runtime
        }
      },
      frameScripts: new Map([
        [
          8,
          (clip, ctx) => {
            // AS: DefineSprite_34/frame_9 places PlaceObject2_32_19 with onClipEvent(enterFrame)
            // The alpha-randomising child placed at depth 19 within sprite_34 at frame 9.
            clip.attach(flicker34Sym, "flicker_32_19", 19, ctx);
          },
        ],
        [
          23,
          (_clip) => {
            // AS: DefineSprite_34/frame_24/DoAction.as → GAC.applyEnd(this) [no-op]
          },
        ],
        [
          28,
          (clip) => {
            // AS: DefineSprite_34/frame_29/DoAction.as → GAC.applyAnim(this,"Static") [no-op → stop]
            clip.stop();
          },
        ],
      ]),
    };

    // ---- flicker_35 — container-only child placed inside sprite_35 at frame_9 ---
    // AS: DefineSprite_35/frame_9/PlaceObject2_32_16/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _alpha = random(100);
    // Per-tick alpha randomisation — must run as a live clip with onEnterFrame.
    const flicker35Sym: SymbolDefinition = {
      name: "flicker_35",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS: DefineSprite_35/frame_9/PlaceObject2_32_16/CLIPACTIONRECORD onClipEvent(enterFrame).as
        //   _alpha = random(100);
        clip.alpha = Math.floor(Math.random() * 100) / 100;
      },
    };

    // ---- sprite_35 — 30-frame sprite with flicker child ----------
    // onLoad: AS frame_37/PlaceObject2_16_1/CLIPACTIONRECORD onClipEvent(load).as
    //   if(_parent.apparition == 1) { GAC.applyAnim(this,"Appear"); }
    //   GAC.applyAnim is a no-op in the spell runtime.
    // frame_9: place flicker_35 child at depth 16
    // frame_24: GAC.applyEnd [no-op]
    // frame_30: GAC.applyAnim("Static") [no-op → stop]
    const sprite35Anchor = calculateAnchor(SPRITE_35_BOUNDS);
    const sprite35Sym: SymbolDefinition = {
      name: "sprite_35",
      totalFrames: 30,
      frames: textures.getFrames("sprite_35"),
      anchorX: sprite35Anchor.x,
      anchorY: sprite35Anchor.y,
      onLoad: (clip) => {
        // AS: frame_37/PlaceObject2_16_1/CLIPACTIONRECORD onClipEvent(load).as
        //   if(_parent.apparition == 1) { GAC.applyAnim(this,"Appear"); }
        // _parent is the root clip. GAC.applyAnim is a no-op in the spell runtime.
        const root = clip.parent;
        const apparition = (root?.vars.apparition as number) ?? 0;
        if (apparition === 1) {
          // GAC.applyAnim(this,"Appear") — no-op in spell runtime
        }
      },
      frameScripts: new Map([
        [
          8,
          (clip, ctx) => {
            // AS: DefineSprite_35/frame_9 places PlaceObject2_32_16 with onClipEvent(enterFrame)
            // The alpha-randomising child placed at depth 16 within sprite_35 at frame 9.
            clip.attach(flicker35Sym, "flicker_32_16", 16, ctx);
          },
        ],
        [
          23,
          (_clip) => {
            // AS: DefineSprite_35/frame_24/DoAction.as → GAC.applyEnd(this) [no-op]
          },
        ],
        [
          29,
          (clip) => {
            // AS: DefineSprite_35/frame_30/DoAction.as → GAC.applyAnim(this,"Static") [no-op → stop]
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_43 — 9-frame sprite, frame_9: stop() -------------
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
            // AS: DefineSprite_43/frame_9/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_48 — 12-frame sprite ----------------------------
    // frame_3: SOMA.playSound("hit_defaut") + signalHit (canonical impact frame)
    // frame_12: _parent.gotoAndStop("StaticR") [→ stop in runtime]
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
            // AS: DefineSprite_48/frame_3/DoAction.as → SOMA.playSound("hit_defaut")
            this.playSound?.("hit_defaut");
            // Canonical impact frame — signal hit for damage popup
            this.runtime.signalHit();
          },
        ],
        [
          11,
          (clip) => {
            // AS: DefineSprite_48/frame_12/DoAction.as → _parent.gotoAndStop("StaticR")
            // _parent.gotoAndStop is a fighter animation control call — no-op in spell runtime
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_51 — 12-frame sprite ----------------------------
    // frame_3: SOMA.playSound("hit_defaut")
    // frame_12: _parent.gotoAndStop("StaticL") [→ stop in runtime]
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
            // AS: DefineSprite_51/frame_3/DoAction.as → SOMA.playSound("hit_defaut")
            this.playSound?.("hit_defaut");
          },
        ],
        [
          11,
          (clip) => {
            // AS: DefineSprite_51/frame_12/DoAction.as → _parent.gotoAndStop("StaticL")
            // _parent.gotoAndStop is a fighter animation control call — no-op in spell runtime
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_55 — 9-frame sprite, frame_9: stop() -------------
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
            // AS: DefineSprite_55/frame_9/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_56 — 13-frame sprite, frame_13: GAC.applyAnim (→ stop) ---
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
          (clip) => {
            // AS: DefineSprite_56/frame_13/DoAction.as → GAC.applyAnim(this,"Static") [no-op → stop]
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_57 — 13-frame sprite, frame_13: GAC.applyAnim (→ stop) ---
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
          (clip) => {
            // AS: DefineSprite_57/frame_13/DoAction.as → GAC.applyAnim(this,"Static") [no-op → stop]
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_61 — 9-frame sprite ----------------------------
    // frame_1: SOMA.playSound("death")
    // frame_9: stop()
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
            // AS: DefineSprite_61/frame_1/DoAction.as → SOMA.playSound("death")
            this.playSound?.("death");
          },
        ],
        [
          8,
          (clip) => {
            // AS: DefineSprite_61/frame_9/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_67 — 10-frame sprite, the final/longest-lived ---
    // frame_1: SOMA.playSound("death")
    // frame_10: stop() + runtime.complete()
    // sprite_67 is attached last (at root frame 36) and its stop frame
    // is the canonical end-of-spell signal.
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
            // AS: DefineSprite_67/frame_1/DoAction.as → SOMA.playSound("death")
            this.playSound?.("death");
          },
        ],
        [
          9,
          (clip) => {
            // AS: DefineSprite_67/frame_10/DoAction.as → stop()
            clip.stop();
            // Final frame of the final sprite — signal spell completion
            this.runtime.complete();
          },
        ],
      ]),
    };

    // Register all symbols
    this.registry.register(sprite19Sym);
    this.registry.register(sprite21Sym);
    this.registry.register(sprite22Sym);
    this.registry.register(sprite23Sym);
    this.registry.register(sprite24Sym);
    this.registry.register(sprite27Sym);
    this.registry.register(sprite30Sym);
    this.registry.register(flicker34Sym);
    this.registry.register(sprite34Sym);
    this.registry.register(flicker35Sym);
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
    // Store sound callback for use in sprite frame scripts
    this.playSound = callbacks.playSound;

    // AS: frame_1/DoAction.as → var apparition = 1;
    this.root.vars.apparition = 1;

    // Manifest sound at frame 0 (1-based frame 1): "death"
    // This fires before any sprite's own frame_1 sound.
    callbacks.playSound("death");

    // Attach initial sprites that appear on the main timeline from frame 1.
    // sprite_19, sprite_43, sprite_55, sprite_61 are present from the start.
    const sprite19Sym = this.registry.resolve("sprite_19");
    const sprite43Sym = this.registry.resolve("sprite_43");
    const sprite55Sym = this.registry.resolve("sprite_55");
    const sprite61Sym = this.registry.resolve("sprite_61");

    if (sprite19Sym) {
      this.root.attach(sprite19Sym, "sprite19", 1, context);
    }
    if (sprite43Sym) {
      this.root.attach(sprite43Sym, "sprite43", 2, context);
    }
    if (sprite55Sym) {
      this.root.attach(sprite55Sym, "sprite55", 3, context);
    }
    if (sprite61Sym) {
      this.root.attach(sprite61Sym, "sprite61", 4, context);
    }

    // Drive main-timeline frame-based placements via root onEnterFrame.
    // We count elapsed root frames and attach sprites at the canonical
    // main-timeline frame numbers derived from the script file paths.
    let rootFrame = 0;
    this.root.onEnterFrame = (_clip, ctx) => {
      rootFrame++;

      if (rootFrame === 2) {
        // frame 3 (0-based: 2) — manifest sound "hit_defaut" at frame index 2
        // Attach sprite_48 and sprite_51 (hit animation sprites).
        // Also attach sprite_23 and sprite_24 which have no explicit placement
        // frame in the scripts but appear in the same visual phase.
        const sprite48Sym = this.registry.resolve("sprite_48");
        const sprite51Sym = this.registry.resolve("sprite_51");
        const sprite23Sym = this.registry.resolve("sprite_23");
        const sprite24Sym = this.registry.resolve("sprite_24");
        if (sprite48Sym) {
          this.root.attach(sprite48Sym, "sprite48", 5, ctx);
        }
        if (sprite51Sym) {
          this.root.attach(sprite51Sym, "sprite51", 6, ctx);
        }
        if (sprite23Sym) {
          this.root.attach(sprite23Sym, "sprite23", 7, ctx);
        }
        if (sprite24Sym) {
          this.root.attach(sprite24Sym, "sprite24", 8, ctx);
        }
      }

      if (rootFrame === 7) {
        // frame 8 (0-based: 7) — manifest sound "cc_wabbit" at frame index 7
        // Attach sprite_27, sprite_30, sprite_56, sprite_57 (CC animation sprites).
        const sprite27Sym = this.registry.resolve("sprite_27");
        const sprite30Sym = this.registry.resolve("sprite_30");
        const sprite56Sym = this.registry.resolve("sprite_56");
        const sprite57Sym = this.registry.resolve("sprite_57");
        if (sprite27Sym) {
          this.root.attach(sprite27Sym, "sprite27", 9, ctx);
        }
        if (sprite30Sym) {
          this.root.attach(sprite30Sym, "sprite30", 10, ctx);
        }
        if (sprite56Sym) {
          this.root.attach(sprite56Sym, "sprite56", 11, ctx);
        }
        if (sprite57Sym) {
          this.root.attach(sprite57Sym, "sprite57", 12, ctx);
        }
      }

      if (rootFrame === 14) {
        // frame 15 (0-based: 14)
        // Attach sprite_21 — its onLoad fires immediately and sets
        // _parent.apparition = 0 per the canonical CLIPACTIONRECORD.
        // AS: frame_15/PlaceObject2_21_1/CLIPACTIONRECORD onClipEvent(load).as
        const sprite21Sym = this.registry.resolve("sprite_21");
        if (sprite21Sym) {
          this.root.attach(sprite21Sym, "sprite21_1", 13, ctx);
        }
      }

      if (rootFrame === 22) {
        // frame 23 (0-based: 22)
        // Attach sprite_22 — its onLoad fires immediately and sets
        // _parent.apparition = 0 per the canonical CLIPACTIONRECORD.
        // AS: frame_23/PlaceObject2_22_1/CLIPACTIONRECORD onClipEvent(load).as
        const sprite22Sym = this.registry.resolve("sprite_22");
        if (sprite22Sym) {
          this.root.attach(sprite22Sym, "sprite22_1", 14, ctx);
        }
      }

      if (rootFrame === 30) {
        // frame 31 (0-based: 30)
        // Attach sprite_34 at depth 12 — its onLoad fires immediately and checks
        // _parent.apparition per the canonical CLIPACTIONRECORD.
        // AS: frame_31/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(load).as
        const sprite34Sym = this.registry.resolve("sprite_34");
        if (sprite34Sym) {
          this.root.attach(sprite34Sym, "sprite34_12", 12, ctx);
        }
      }

      if (rootFrame === 36) {
        // frame 37 (0-based: 36)
        // Attach sprite_35 at depth 16 — its onLoad fires immediately and checks
        // _parent.apparition per the canonical CLIPACTIONRECORD.
        // AS: frame_37/PlaceObject2_16_1/CLIPACTIONRECORD onClipEvent(load).as
        // Also attach sprite_67 which is the final, longest-lived sprite.
        const sprite35Sym = this.registry.resolve("sprite_35");
        const sprite67Sym = this.registry.resolve("sprite_67");
        if (sprite35Sym) {
          this.root.attach(sprite35Sym, "sprite35_16", 16, ctx);
        }
        if (sprite67Sym) {
          this.root.attach(sprite67Sym, "sprite67", 17, ctx);
        }
        // Stop driving root onEnterFrame after the last placement
        this.root.onEnterFrame = null;
      }
    };
  }
}
