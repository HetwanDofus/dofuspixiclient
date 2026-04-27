/**
 * Spell 2045 — (Unknown name, likely a Pandawa or misc spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2045/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). The main timeline's frame_2 places
 * sprite_10 (the animated projectile) on the stage with clip events that
 * read `_parent.cellFrom` and `_parent.cellTo` to compute linear motion
 * from caster to target over 45 frames. This is the hallmark of
 * WorldAbsolute: the child positions itself using absolute world coords
 * from `_parent.cellFrom` / `_parent.cellTo`. There is no `move`/`shoot`
 * ballistic pattern, no linear rotation-to-target pattern, and the
 * container must be at world origin (0,0) so the cellFrom/cellTo coords
 * are meaningful.
 *
 * Canonical AS layout:
 *
 *   - Main timeline frame_2 (`scripts/frame_2/DoAction.as`):
 *       stop();
 *     PlaceObject2_10_1 places sprite_10 with clip events:
 *       onClipEvent(load): position at cellFrom, compute dx/dy toward
 *                          cellTo over 45 frames (with a -20 y bias).
 *       onClipEvent(enterFrame): move by dx/dy for 45 frames.
 *
 *   - DefineSprite_10 — 99-frame composite animation (the projectile):
 *       frame_46 (`DoAction.as`): SOMA.playSound("pok");
 *       frame_46 (`DoAction_2.as`): this.end() → signalHit
 *       frame_88 (`DoAction.as`): _parent.removeMovieClip() → complete
 *
 *   - DefineSprite_3 — single-frame spinning sub-sprite (embedded in
 *       sprite_10's authored content; placed via PlaceObject2_2_1):
 *       onClipEvent(load): r = random(90) — seeds random spin rate
 *       onClipEvent(enterFrame): _rotation += r — spins at random rate
 *     NOTE: DefineSprite_3 is NOT in librarySymbols[] (the manifest has
 *     no librarySymbols entries). It is authored as embedded content
 *     INSIDE sprite_10's composite timeline frames (already baked into
 *     the sprite_10_N.svg frames). We do not need to register it as a
 *     separate SymbolDefinition; its visual is captured in the SVG
 *     frames. However, the spin clip event DOES affect a child placed
 *     on sprite_10's authored timeline — since we represent sprite_10
 *     as a frame-animated sprite with no runtime-spawned children, we
 *     skip DefineSprite_3 registration (it only existed to spin an
 *     internal sub-clip that is baked into the composite frames).
 *
 * Library symbols: none in manifest.json `librarySymbols[]`. The only
 * symbol we register is sprite_10 itself from `animations[]`, treated
 * as a 99-frame animated container with frame scripts at frames 45 and 87.
 *
 * Sounds:
 *   - "pok" at frame 46 (AS) = frameScripts index 45.
 *
 * signalHit: fired at frame_46 `this.end()` → frameScripts index 45
 *            (same frame as the sound — canonical DoAction_2.as).
 * complete:  fired at frame_88 → frameScripts index 87.
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

const SPRITE10_BOUNDS = {
  width: 124.95,
  height: 185,
  offsetX: -65.55,
  offsetY: -157.6,
};

export class Spell2045 extends RuntimeSpell {
  readonly spellId = 2045;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private sprite10Sym!: SymbolDefinition;
  private savedCallbacks?: SpellCallbacks;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite10Anchor = calculateAnchor(SPRITE10_BOUNDS);

    // ---- sprite_10 — 99-frame projectile composite ---------------
    // From animations[] in manifest; NOT in librarySymbols[], so we
    // use the bare name "sprite_10" (no lib_ prefix).
    //
    // Clip events from scripts/frame_2/PlaceObject2_10_1:
    //   onClipEvent(load): position at cellFrom, compute dx/dy over 45 frames
    //   onClipEvent(enterFrame): translate by dx/dy for t < 45
    //
    // Frame scripts:
    //   frame_46/DoAction.as:   SOMA.playSound("pok")
    //   frame_46/DoAction_2.as: this.end() → signalHit
    //   frame_88/DoAction.as:   _parent.removeMovieClip() → complete
    this.sprite10Sym = {
      name: "sprite_10",
      totalFrames: 99,
      frames: textures.getFrames("sprite_10"),
      anchorX: sprite10Anchor.x,
      anchorY: sprite10Anchor.y,

      // AS scripts/frame_2/PlaceObject2_10_1/CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip) => {
        const root = clip.parent;
        const cellFrom = root?.vars.cellFrom as { x: number; y: number } | undefined;
        const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;

        const fromX = cellFrom?.x ?? 0;
        const fromY = cellFrom?.y ?? 0;
        const toX = cellTo?.x ?? 0;
        const toY = cellTo?.y ?? 0;

        clip.x = fromX;
        clip.y = fromY;
        clip.vars.dx = (-fromX + toX) / 45;
        clip.vars.dy = (-fromY - 20 + toY) / 45;
        clip.vars.t = 0;
      },

      // AS scripts/frame_2/PlaceObject2_10_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
      onEnterFrame: (clip) => {
        let t = clip.vars.t as number;
        if (t < 45) {
          const dx = clip.vars.dx as number;
          const dy = clip.vars.dy as number;
          clip.x += dx;
          clip.y += dy;
        }
        clip.vars.t = t + 1;
      },

      frameScripts: new Map([
        [
          // AS DefineSprite_10/frame_46/DoAction.as: SOMA.playSound("pok");
          // AS DefineSprite_10/frame_46/DoAction_2.as: this.end();
          45,
          (_clip) => {
            if (this.savedCallbacks) {
              this.savedCallbacks.playSound("pok");
            }
            this.runtime.signalHit();
          },
        ],
        [
          // AS DefineSprite_10/frame_88/DoAction.as: _parent.removeMovieClip();
          87,
          (clip) => {
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite10Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Save callbacks so frame scripts can call playSound("pok").
    this.savedCallbacks = callbacks;

    // Main timeline frame_2/DoAction.as: stop();
    // PlaceObject2_10_1 places sprite_10 on the stage.
    // We attach it here so it starts ticking from the next runtime frame.
    this.root.attach(this.sprite10Sym, "sprite10", 1, context);
  }
}
