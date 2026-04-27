/**
 * Spell 2055.
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2055/scripts/scripts/
 *
 * displayType=11 (TargetCell).
 *   - No move/shoot/duplicate symbols — not a projectile or beam.
 *   - No cellFrom/cellTo reads in scripts — not WorldAbsolute.
 *   - No caster-side anchor — not CasterCell.
 *   - Single impact at target cell matches TargetCell.
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
 *
 * Animations:
 *   - anim1 (144 frames) — the top-level DefineSprite_18 timeline.
 *     frame_1  (idx 0)  : SOMA.playSound("gonfle")
 *     frame_4  (idx 3)  : PlaceObject2_10_22 placed; onEnterFrame rotates +2.5 deg/tick
 *     frame_28 (idx 27) : same enterFrame re-stated (idempotent)
 *     frame_43 (idx 42) : same
 *     frame_49 (idx 48) : same
 *     frame_61 (idx 60) : same
 *     frame_112(idx 111): this.end() — signalHit
 *     frame_142(idx 141): stop(); _parent.removeMovieClip() — complete
 *
 * The PlaceObject2_10_22 child is modelled as a container-only sub-clip
 * ("inner22") attached at anim1 frame_4 (idx 3). Its onEnterFrame mirrors
 * the repeated `_rotation = _rotation + 2.5` handler from all five
 * canonical keyframes.
 *
 * Main timeline: SOMA.playSound("gonfle") then anim1 attached to root.
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

const ANIM1_BOUNDS = {
  width: 518,
  height: 391.85,
  offsetX: -249.15,
  offsetY: -278.25,
};

export class Spell2055 extends RuntimeSpell {
  readonly spellId = 2055;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;
  private inner22Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- inner22 — rotating sub-clip at depth 22 ----------------
    // Ports all five identical enterFrame handlers:
    //   DefineSprite_18/frame_4/PlaceObject2_10_22/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   DefineSprite_18/frame_28/PlaceObject2_10_22/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   DefineSprite_18/frame_43/PlaceObject2_10_22/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   DefineSprite_18/frame_49/PlaceObject2_10_22/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   DefineSprite_18/frame_61/PlaceObject2_10_22/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   AS: _rotation = _rotation + 2.5;
    this.inner22Sym = {
      name: "inner22",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS: _rotation = _rotation + 2.5  (degrees → radians delta)
        clip.rotation += (2.5 * Math.PI) / 180;
      },
    };

    // ---- anim1 — DefineSprite_18 top-level timeline --------------
    // Textures come from animations[] entry "anim1" (no lib_ prefix;
    // this symbol is not in librarySymbols[]).
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 144,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          // DefineSprite_18/frame_1/DoAction.as
          // SOMA.playSound("gonfle") — fired in onSpellStart instead so
          // the callback reference is available. Index 0 has no other work.
          0,
          (_clip, _ctx) => {
            // sound handled in onSpellStart
          },
        ],
        [
          // DefineSprite_18/frame_4 places PlaceObject2_10_22.
          // frame_4 → index 3
          3,
          (clip, ctx) => {
            if (!clip.children.has("inner22")) {
              clip.attach(this.inner22Sym, "inner22", 22, ctx);
            }
          },
        ],
        [
          // DefineSprite_18/frame_112/DoAction.as
          // this.end() → signalHit
          // frame_112 → index 111
          111,
          (_clip) => {
            this.runtime.signalHit();
          },
        ],
        [
          // DefineSprite_18/frame_142/DoAction.as
          // stop(); _parent.removeMovieClip();
          // frame_142 → index 141
          141,
          (clip) => {
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.inner22Sym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // DefineSprite_18/frame_1/DoAction.as: SOMA.playSound("gonfle");
    callbacks.playSound("gonfle");

    // Attach the main timeline to root. displayType=11 (TargetCell)
    // places the container at the target cell; anim1 at (0,0) is
    // canonically correct.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
