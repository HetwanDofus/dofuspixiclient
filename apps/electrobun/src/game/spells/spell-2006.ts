/**
 * Spell 2006 — (Roublard/Rogue trap-style, likely "Piège Sournois" or similar).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2006/scripts/scripts/
 *
 * displayType=11 (TargetCell). The outer sprite (DefineSprite_26) positions itself
 * at _parent.cellTo in its frame_1 script — the canonical pattern for a target-cell
 * impact. No caster reference, no projectile motion, no duplicate beam.
 *
 * Manifest animations (no librarySymbols[] entries — all symbols in animations[]):
 *   - sprite_16 (54 frames) — rotating gear/wheel child of DefineSprite_18.
 *     frame_1: gotoAndPlay(random(30) + 2) — random entry offset.
 *     frame_52: gotoAndPlay(2) — loop from frame 2 onward.
 *   - sprite_23 (15 frames) — small rotating element placed inside DefineSprite_24.
 *     frame_1: _rotation = -random(180) — random initial rotation.
 *     onLoad (for each placed instance of sprite_23 inside DefineSprite_24):
 *       gotoAndPlay(random(_totalframes + 1)) — random phase offset.
 *     (Three placed instances: depth 3, depth 7, depth 11.)
 *   - sprite_26 (183 frames) — main outer composite timeline anchored at cellTo.
 *     frame_1 (DoAction.as): SOMA.playSound("grina_709")
 *     frame_1 (DoAction_2.as): _X = _parent.cellTo.x; _Y = _parent.cellTo.y
 *     frame_25: SOMA.playSound("wab_2006")
 *     frame_34: this.end() → signalHit
 *     frame_97: _parent.removeMovieClip() → complete
 *
 * DefineSprite_18 is an internal container inside sprite_26 that holds a
 * placed instance of sprite_16 (at depth 1) whose onEnterFrame rotates it:
 *   _rotation = _rotation + 1.67 (degrees/frame)
 *
 * DefineSprite_24 is another internal container inside sprite_26 that holds
 * three placed instances of sprite_23 (at depths 3, 7, 11), each with an
 * onLoad that calls gotoAndPlay(random(_totalframes + 1)).
 *
 * Since librarySymbols[] is empty in the manifest, ALL texture keys use the
 * bare animation name (no "lib_" prefix).
 *
 * Main timeline (frame_2/DoAction.as): stop() — the outer SWF stops on frame 2
 * after placing sprite_26. The sound and child-positioning logic are driven by
 * sprite_26's own timeline from within.
 *
 * Note on sounds: DefineSprite_26/frame_1 plays "grina_709" and
 * DefineSprite_26/frame_25 plays "wab_2006". These are driven from frameScripts
 * inside sprite_26Sym. The onSpellStart only plays the main-timeline sound if
 * present (here the main timeline's frame_2 is just stop(); no sound at top
 * level — the sound is delegated into sprite_26's timeline).
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

// Bounds from manifest animations[] entries (no librarySymbols[]).
const SPRITE_16_BOUNDS = {
  width: 34.5,
  height: 13.4,
  offsetX: -0.7,
  offsetY: -13.4,
};

const SPRITE_23_BOUNDS = {
  width: 56.65,
  height: 2.8,
  offsetX: 18,
  offsetY: -2.75,
};

const SPRITE_26_BOUNDS = {
  width: 162,
  height: 355.3,
  offsetX: -80.95,
  offsetY: -306.55,
};

export class Spell2006 extends RuntimeSpell {
  readonly spellId = 2006;
  readonly displayType = SpellDisplayType.TargetCell;

  // Store sound callback captured in onSpellStart so frameScripts can call it.
  private playSoundFn?: (id: string) => void;

  // Store symbol refs for cross-attach in onSpellStart.
  private sprite26Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite16Anchor = calculateAnchor(SPRITE_16_BOUNDS);
    const sprite23Anchor = calculateAnchor(SPRITE_23_BOUNDS);
    const sprite26Anchor = calculateAnchor(SPRITE_26_BOUNDS);

    // ---- sprite_16 — rotating gear (child of DefineSprite_18) ----
    // AS DefineSprite_16/frame_1/DoAction.as:
    //   gotoAndPlay(random(30) + 2);
    // AS DefineSprite_16/frame_52/DoAction.as:
    //   gotoAndPlay(2);
    const sprite16Sym: SymbolDefinition = {
      name: "sprite_16",
      totalFrames: 54,
      frames: textures.getFrames("sprite_16"),
      anchorX: sprite16Anchor.x,
      anchorY: sprite16Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_16/frame_1/DoAction.as
            clip.gotoAndPlay(Math.floor(Math.random() * 30) + 1); // random(30)+2 → 0-based: +1
          },
        ],
        [
          51,
          (clip) => {
            // AS DefineSprite_16/frame_52/DoAction.as
            clip.gotoAndPlay(1); // gotoAndPlay(2) → 0-based: 1
          },
        ],
      ]),
    };

    // ---- sprite_23 — small rotated element (placed inside DefineSprite_24) ----
    // AS DefineSprite_23/frame_1/DoAction.as:
    //   _rotation = -random(180);
    // onLoad (for placed instances inside DefineSprite_24):
    //   gotoAndPlay(random(_totalframes + 1));
    //
    // The three placed instances (depths 3, 7, 11) each get the onLoad handler.
    // We model the random phase jump in onLoad and the initial rotation in
    // the frame_1 script.
    const sprite23Sym: SymbolDefinition = {
      name: "sprite_23",
      totalFrames: 15,
      frames: textures.getFrames("sprite_23"),
      anchorX: sprite23Anchor.x,
      anchorY: sprite23Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_24/frame_1/PlaceObject2_23_{3,7,11}/CLIPACTIONRECORD onClipEvent(load).as
        // gotoAndPlay(random(_totalframes + 1))
        // _totalframes = 15, so random(16) → [0,15]
        const frame = Math.floor(Math.random() * 16);
        clip.gotoAndPlay(frame);
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_23/frame_1/DoAction.as
            // _rotation = -random(180) (degrees) → radians
            const deg = -Math.floor(Math.random() * 180);
            clip.rotation = (deg * Math.PI) / 180;
          },
        ],
      ]),
    };

    // ---- sprite_16 inner rotating wrapper (DefineSprite_18) ----
    // DefineSprite_18 is a container that holds one placed instance of sprite_16
    // at depth 1 with an onEnterFrame rotating it:
    //   _rotation = _rotation + 1.67 (degrees)
    //
    // We model this as a container-only symbol ("sprite_18_inner") that, on load,
    // attaches sprite_16 at depth 1 with the enterFrame rotation handler wired
    // into the sprite_16 child via onEnterFrame on the PARENT container.
    // However, since the enterFrame is on the PLACED INSTANCE (PlaceObject2_17_1),
    // not on the symbol itself, we model it by overriding the child's onEnterFrame
    // after attach, which requires a wrapper symbol.
    //
    // The cleanest canonical model: define a "sprite_18" container symbol that
    // attaches sprite_16 in its frame_1 and sets up an onEnterFrame on the
    // placed child to do the rotation.
    //
    // Since SpellClip.onEnterFrame is per-clip and can be set after attach,
    // we achieve this inside sprite_18's frame_1 frameScript.
    const sprite18Sym: SymbolDefinition = {
      name: "sprite_18",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Attach sprite_16 at depth 1 inside this container.
            const child = clip.attach(sprite16Sym, "sprite_16_inst", 1, ctx);
            // Wire the canonical onEnterFrame rotation onto the placed instance.
            // AS DefineSprite_18/frame_1/PlaceObject2_17_1/CLIPACTIONRECORD onClipEvent(enterFrame).as:
            //   _rotation = _rotation + 1.67 (degrees)
            child.onEnterFrame = (c) => {
              c.rotation += (1.67 * Math.PI) / 180;
            };
          },
        ],
      ]),
    };

    // ---- sprite_24 — container holding 3 placed sprite_23 instances ----
    // DefineSprite_24/frame_1 places sprite_23 at depths 3, 7, and 11.
    // Each gets the onLoad random-phase jump (handled by sprite23Sym.onLoad).
    const sprite24Sym: SymbolDefinition = {
      name: "sprite_24",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_24/frame_1: places sprite_23 at depths 3, 7, 11.
            // onLoad for each is handled inside sprite23Sym.onLoad.
            clip.attach(sprite23Sym, "sprite_23_3", 3, ctx);
            clip.attach(sprite23Sym, "sprite_23_7", 7, ctx);
            clip.attach(sprite23Sym, "sprite_23_11", 11, ctx);
          },
        ],
      ]),
    };

    // ---- sprite_26 — main outer timeline (183 frames) anchored at cellTo ----
    // AS frame_1/DoAction.as: SOMA.playSound("grina_709")
    // AS frame_1/DoAction_2.as: _X = _parent.cellTo.x; _Y = _parent.cellTo.y
    // AS frame_25/DoAction.as: SOMA.playSound("wab_2006")
    // AS frame_34/DoAction.as: this.end() → signalHit
    // AS frame_97/DoAction.as: _parent.removeMovieClip() → complete
    //
    // sprite_26 is the composite main animation (isComposite: true, 183 frames).
    // It contains authored sub-clips including sprite_18 and sprite_24 containers.
    // For the sprite_26 symbol the frame textures drive the visual composite.
    // Its frame_1 also positions itself and plays a sound (captured via playSoundFn).
    this.sprite26Sym = {
      name: "sprite_26",
      totalFrames: 183,
      frames: textures.getFrames("sprite_26"),
      anchorX: sprite26Anchor.x,
      anchorY: sprite26Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_26/frame_1/DoAction.as: SOMA.playSound("grina_709")
            this.playSoundFn?.("grina_709");

            // AS DefineSprite_26/frame_1/DoAction_2.as:
            //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y
            // For displayType=11 (TargetCell) the container is already anchored
            // at cellTo. sprite_26 is attached as a direct child of root (which
            // sits at cellTo). So we position this clip at (0, 0) in local coords
            // to match the target cell. However the canonical AS reads
            // _parent.cellTo — which is the WORLD coord stored on root.vars.
            // Since root's container origin IS cellTo (anchor resolved by harness
            // to target), local (0,0) equals world cellTo. Set explicitly to
            // match the AS verbatim logic:
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
            if (cellTo) {
              // The root container is positioned at cellTo in world space,
              // so child local coords of (0,0) == cellTo world. But the AS
              // sets _X/_Y to absolute world values. For WorldAbsolute display
              // types this would differ — here (TargetCell) they coincide.
              // We mirror the AS assignment faithfully using the vars:
              clip.x = 0;
              clip.y = 0;
            }

            // Also attach internal sub-containers sprite_18 and sprite_24
            // that are placed on the sprite_26 main timeline in the authored SWF.
            clip.attach(sprite18Sym, "sprite_18_inst", 10, ctx);
            clip.attach(sprite24Sym, "sprite_24_inst", 20, ctx);
          },
        ],
        [
          24,
          (_clip) => {
            // AS DefineSprite_26/frame_25/DoAction.as: SOMA.playSound("wab_2006")
            this.playSoundFn?.("wab_2006");
          },
        ],
        [
          33,
          (_clip) => {
            // AS DefineSprite_26/frame_34/DoAction.as: this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          96,
          (clip) => {
            // AS DefineSprite_26/frame_97/DoAction.as: _parent.removeMovieClip()
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite16Sym);
    this.registry.register(sprite23Sym);
    this.registry.register(sprite18Sym);
    this.registry.register(sprite24Sym);
    this.registry.register(this.sprite26Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture the sound callback so frameScripts inside sprite_26 can use it.
    this.playSoundFn = callbacks.playSound;

    // Main timeline frame_2/DoAction.as: stop()
    // The outer SWF stops on frame 2 after placing sprite_26.
    // We attach sprite_26 as the main child of root here, mirroring the
    // implicit frame_1 placement on the main timeline before the stop().
    this.root.attach(this.sprite26Sym, "sprite_26_inst", 1, context);
  }
}
