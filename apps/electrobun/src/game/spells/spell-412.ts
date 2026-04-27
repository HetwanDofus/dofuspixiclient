/**
 * Spell 412 — (Unknown name, likely a Sacrier/Iop wind/earth impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/412/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single composite timeline
 * (DefineSprite_14 / sprite_14) that positions itself at _parent.cellTo on
 * frame_1 and runs for 136 frames total. There are no projectile symbols
 * (no move/shoot/duplicate), no librarySymbols[], and the container places
 * itself at the target cell — all indicators of a TargetCell impact.
 *
 * The manifest has no `librarySymbols[]` array, only a single `animations[]`
 * entry ("sprite_14"). The AS does NOT use attachMovie anywhere — the
 * sprite_14 timeline is placed on the main timeline directly. We attach it
 * from onSpellStart.
 *
 * The inner DefineSprite_3 has a rotating child (23.3 deg/frame) accessed
 * via PlaceObject2_2_1 inside DefineSprite_14. Since sprite_3 is authored
 * as a placed child inside sprite_14's timeline (not via attachMovie), we
 * model it as a sub-symbol registered under its internal clip name and
 * attached in sprite_14's frame_1 script. However, looking at the manifest
 * more carefully: DefineSprite_3 only has a single placed object with an
 * onEnterFrame, no DoAction scripts, and is NOT in librarySymbols. It is an
 * authored child of DefineSprite_14. We represent it as a sub-SymbolDefinition
 * that sprite_14's frame_1 attaches.
 *
 * Library symbols:
 *   None in manifest.json librarySymbols[]. The sole animation is "sprite_14"
 *   (144 frames, with content frames 0–135 then fading). sprite_14 embeds
 *   DefineSprite_3 which has a single rotating child.
 *
 * Main timeline (frame_2/DoAction.as):
 *   stop() — main SWF halts at frame 2. No SOMA.playSound call present.
 *
 * DefineSprite_14 frame scripts:
 *   frame_1:  _X = _parent.cellTo.x; _Y = _parent.cellTo.y; _rotation = 0
 *   frame_85: this.end() → signalHit
 *   frame_136: _parent.removeMovieClip(); stop() → complete
 *
 * DefineSprite_3 clip event:
 *   onEnterFrame: _rotation += 23.3 (degrees) → each tick rotate child
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

const SPRITE_14_BOUNDS = {
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
    const sprite14Anchor = calculateAnchor(SPRITE_14_BOUNDS);

    // ---- DefineSprite_3 — inner rotating child of sprite_14 ------
    // This symbol has no authored textures visible from the manifest
    // (it is an inner composite inside sprite_14, not a top-level
    // animation). It carries a single placed object (PlaceObject2_2_1)
    // whose only behaviour is the onEnterFrame rotation below.
    // We register it as a container-only symbol so sprite_14's frame_1
    // can attach it.
    // AS: DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    const sprite3Sym: SymbolDefinition = {
      name: "sprite_3",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS: _rotation = _rotation + 23.3;  (degrees → radians delta)
        clip.rotation += (23.3 * Math.PI) / 180;
      },
    };

    // ---- sprite_14 — main impact composite, 144 frames -----------
    // Positioned at target cell on frame_1. frame_85 fires signalHit.
    // frame_136 removes outer mc + signals completion.
    // The authored animation frames are exposed under the bare name
    // "sprite_14" (no lib_ prefix — this is an animations[] entry,
    // not a librarySymbols[] entry).
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
            // _X = _parent.cellTo.x; _Y = _parent.cellTo.y; _rotation = 0
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y;
            }
            clip.rotation = 0;
            // The canonical authored timeline has DefineSprite_3 placed
            // inside sprite_14. Attach it here so its onEnterFrame fires
            // each tick. Placed at local (0,0) with no transform.
            clip.attach(sprite3Sym, "sprite_3", 1, ctx);
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
            clip.remove();
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
    // Main timeline frame_2/DoAction.as: stop()
    // No SOMA.playSound call in the canonical AS.
    // Attach sprite_14 as the main impact timeline at the root.
    this.root.attach(this.sprite14Sym, "sprite_14", 1, context);
  }
}
