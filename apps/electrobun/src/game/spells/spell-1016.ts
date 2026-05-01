/**
 * Spell 1016 — Lichen (Sadida-family earth/nature spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1016/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile motion, no
 * caster-anchored content, and no WorldAbsolute dual-timeline. It is a
 * single impact animation playing at the target cell. The manifest's
 * `animations[]` contains `anim1` (and level-variants anim146/anim291/
 * anim436/anim581) but NO `librarySymbols[]` entries for a `move` or
 * `shoot` symbol, confirming TargetCell (11) as the correct displayType.
 *
 * Canonical AS layout:
 *   - Main timeline frame_1: SOMA.playSound("licrounch_1001")
 *   - DefineSprite_23 (first variant, presumably spell level 1):
 *       frame_1:   SOMA.playSound("licrounch_1001")
 *       frame_37:  SOMA.playSound("licrounch_1001b")
 *       frame_109: this.end() → signalHit; places a child sprite
 *                  (PlaceObject2_22_144) with onClipEvent(enterFrame)
 *                  that decrements _parent._alpha by 10 each tick
 *                  (fade-out effect).
 *       frame_148: _parent.removeMovieClip(); stop() → spell complete.
 *   - DefineSprite_38 (second variant, same structure):
 *       frame_109: this.end() → signalHit; same fade child.
 *       frame_148: _parent.removeMovieClip(); stop() → spell complete.
 *   - DefineSprite_4: frame_28 → stop()
 *   - DefineSprite_3: frame_49 → stop()
 *
 * The PlaceObject2_22_144 clip in DefineSprite_23 and DefineSprite_38
 * is a fade overlay: once frame_109 fires, a child is placed that
 * continuously reduces its parent's alpha by 10 per tick until the
 * clip is removed at frame_148. This MUST be ported as a live runtime
 * clip with an onEnterFrame handler — it is NOT baked into the SVGs.
 *
 * Because the manifest has no `librarySymbols[]`, the animations
 * (`anim1`, `anim146`, `anim291`, `anim436`, `anim581`) are referenced
 * directly by their bare names (NO `lib_` prefix). The spell selects
 * the appropriate animation variant based on the spell level at runtime.
 *
 * Library symbols registered:
 *   - anim1    — 150-frame composite for level 1. frame_109 signals hit
 *                + places fade child; frame_148 removes self + completes.
 *   - anim146  — 150-frame composite for level 2 (same structure).
 *   - anim291  — 150-frame composite for level 3 (same structure).
 *   - anim436  — 150-frame composite for level 4 (same structure).
 *   - anim581  — 150-frame composite for level 5+ (same structure).
 *   - fadeChild — virtual single-frame symbol with onEnterFrame that
 *                 decrements _parent._alpha by 10 per tick.
 *
 * Main timeline: SOMA.playSound("licrounch_1001"); (onSpellStart)
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

// All five animation variants share the same bounds.
const ANIM_BOUNDS = {
  width: 131.1,
  height: 108.15,
  offsetX: -62.75,
  offsetY: -63.45,
};

export class Spell1016 extends RuntimeSpell {
  readonly spellId = 1016;
  readonly displayType = SpellDisplayType.TargetCell;

  // Captured so onSpellStart can reference them after registerSymbols.
  private anim1Sym!: SymbolDefinition;
  private anim146Sym!: SymbolDefinition;
  private anim291Sym!: SymbolDefinition;
  private anim436Sym!: SymbolDefinition;
  private anim581Sym!: SymbolDefinition;

  // Sound callback captured for use inside frame scripts.
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const animAnchor = calculateAnchor(ANIM_BOUNDS);

    // ---- fadeChild — alpha-decrement overlay child ---------------
    // Canonical: DefineSprite_23/frame_109/PlaceObject2_22_144/
    //   CLIPACTIONRECORD onClipEvent(enterFrame).as
    // and DefineSprite_38/frame_109/PlaceObject2_22_144/
    //   CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // In AS: `_parent._alpha -= 10;` — each tick the parent clip's
    // alpha drops by 10 (out of 100), i.e. 0.1 in decimal units.
    // This child has no visual content of its own; it is placed solely
    // to run its onEnterFrame against the parent sprite.
    const fadeChildSym: SymbolDefinition = {
      name: "fadeChild",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS: _parent._alpha -= 10;  (AS 0-100 units → TS 0-1 units)
        const parent = clip.parent;
        if (parent) {
          parent.alpha = Math.max(0, parent.alpha - 10 / 100);
        }
      },
    };

    // ---- Helper: build a per-level anim symbol -------------------
    // All five variants share the same frame script logic at the same
    // canonical frame indices (frame_109 → signalHit + place fade child,
    // frame_148 → removeMovieClip + complete). They differ only in their
    // texture atlas.
    const buildAnimSym = (name: string, frames: ReturnType<SpellTextureProvider["getFrames"]>): SymbolDefinition => {
      return {
        name,
        totalFrames: 150,
        frames,
        anchorX: animAnchor.x,
        anchorY: animAnchor.y,
        frameScripts: new Map([
          [
            0,
            (clip) => {
              // AS DefineSprite_23/frame_1/DoAction.as:
              //   SOMA.playSound("licrounch_1001");
              // Sound is also played on the main timeline at frame_1 via
              // onSpellStart. Here we mirror the per-sprite copy so the
              // sound plays if only this sprite is playing independently.
              // In practice with displayType=11 the root clip plays this
              // via onSpellStart; the per-clip copy is a no-op at the
              // same frame, but we keep it 1:1 with the canonical AS.
              this.soundCallback?.("licrounch_1001");
            },
          ],
          [
            36,
            () => {
              // AS DefineSprite_23/frame_37/DoAction.as:
              //   SOMA.playSound("licrounch_1001b");
              this.soundCallback?.("licrounch_1001b");
            },
          ],
          [
            108,
            (clip, ctx) => {
              // AS DefineSprite_23/frame_109/DoAction.as:
              //   this.end();
              // `this.end()` is the canonical hit signal (damage popup).
              this.runtime.signalHit();
              // Place the fade child. The PlaceObject2_22_144 in the
              // canonical SWF attaches a child at depth 144 on this
              // frame with onClipEvent(enterFrame) that runs
              // `_parent._alpha -= 10`. We model this as a live clip.
              if (!clip.children.has("fadeChild")) {
                clip.attach(fadeChildSym, "fadeChild", 144, ctx);
              }
            },
          ],
          [
            147,
            (clip) => {
              // AS DefineSprite_23/frame_148/DoAction.as:
              //   _parent.removeMovieClip();
              //   stop();
              clip.stop();
              clip.remove();
              this.runtime.complete();
            },
          ],
        ]),
      };
    };

    // ---- Register all five level-variant animations --------------
    // No `lib_` prefix: these are in `animations[]`, not `librarySymbols[]`.
    this.anim1Sym   = buildAnimSym("anim1",   textures.getFrames("anim1"));
    this.anim146Sym = buildAnimSym("anim146", textures.getFrames("anim146"));
    this.anim291Sym = buildAnimSym("anim291", textures.getFrames("anim291"));
    this.anim436Sym = buildAnimSym("anim436", textures.getFrames("anim436"));
    this.anim581Sym = buildAnimSym("anim581", textures.getFrames("anim581"));

    this.registry.register(fadeChildSym);
    this.registry.register(this.anim1Sym);
    this.registry.register(this.anim146Sym);
    this.registry.register(this.anim291Sym);
    this.registry.register(this.anim436Sym);
    this.registry.register(this.anim581Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture the sound callback so frame scripts inside symbol
    // definitions can call it.
    this.soundCallback = callbacks.playSound;

    // Main timeline frame_1/DoAction.as:
    //   SOMA.playSound("licrounch_1001");
    callbacks.playSound("licrounch_1001");

    // Select the animation variant based on spell level.
    // Level 1 → anim1, level 2 → anim146, level 3 → anim291,
    // level 4 → anim436, level 5+ → anim581.
    const level = context.level;
    let chosenSym: SymbolDefinition;
    if (level <= 1) {
      chosenSym = this.anim1Sym;
    } else if (level === 2) {
      chosenSym = this.anim146Sym;
    } else if (level === 3) {
      chosenSym = this.anim291Sym;
    } else if (level === 4) {
      chosenSym = this.anim436Sym;
    } else {
      chosenSym = this.anim581Sym;
    }

    // Attach the chosen animation at the root. The harness has already
    // positioned root at the target cell (displayType=11 / TargetCell).
    this.root.attach(chosenSym, "anim", 1, context);
  }
}
