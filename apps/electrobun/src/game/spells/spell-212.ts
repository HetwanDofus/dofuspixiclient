/**
 * Spell 212 — (Iop/Earth spell, likely "Terre Tranchante" or similar).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 *
 * Canonical AS layout (`tools/combat-exporter/output/spell-anims/212/scripts/scripts/`):
 *
 *   - `DefineSprite_3_shoot` — 105-frame visual symbol with authored SVG frames.
 *       frame_1:  `_rotation = 0` — resets any harness-applied rotation.
 *       frame_73: installs an onEnterFrame that fades alpha by 3 per tick.
 *       frame_103: `_parent.removeMovieClip(); stop();` — kills outer mc → complete.
 *
 *   - `DefineSprite_8` — 142-frame "outer" container. Positions itself at cellTo
 *       on frame_1. Fires sound at frame_58. Calls `this.end()` (signalHit) at
 *       frame_61. Has a PlaceObject2_7_13 child at frame_118 with an
 *       `onClipEvent(enterFrame)` that decrements `_parent._alpha -= 5` each
 *       tick (i.e. fades the DefineSprite_8 container). Removes self at frame_142.
 *
 *   - Main timeline frame_2: `stop()` — one-time halt after initial placement.
 *
 * displayType detection:
 *   - `DefineSprite_8/frame_1` reads `_parent.cellTo.x` / `_parent.cellTo.y` AND
 *     `_parent.cellFrom` is NOT referenced → single target-anchored sprite, but
 *     the spell uses WorldAbsolute because DefineSprite_8 positions itself at
 *     world coords from _parent.cellTo. However, looking more carefully: there is
 *     only ONE top-level sprite (sprite_8) that places itself at cellTo — this
 *     matches a WorldAbsolute / self-positioning pattern, BUT since there is only
 *     one sprite and it positions via _parent.cellTo, displayType=51
 *     (WorldAbsoluteAlt) is the correct choice. The harness sets cellFrom/cellTo
 *     on root.vars and anchors at world (0,0).
 *
 *   - The `shoot` symbol is a library clip attached by DefineSprite_8 (not the
 *     harness's projectile "shoot"). It is an impact animation at the target cell.
 *
 * Library symbols:
 *   - `shoot` (DefineSprite_3_shoot, 105 frames) — the main impact animation.
 *     frame_1 resets rotation. frame_73 installs fade-out enterFrame. frame_103
 *     removes parent + completes.
 *   - `DefineSprite_8` (outer container, 142 frames) — positions itself at cellTo,
 *     drives sound, hit signal, and a fading child clip at frame_118.
 *   - `PlaceObject2_7_13` (the child placed at DefineSprite_8 frame_118) — single-
 *     frame alpha-decrement particle; no textures, just an onEnterFrame that fades
 *     its parent (_parent._alpha -= 5 per tick).
 *
 * Main timeline: frame_2 → stop(). The spell is placed by the harness (WorldAbsoluteAlt).
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

// Bounds from manifest animations[] entry for "shoot"
const SHOOT_BOUNDS = {
  width: 177.4,
  height: 106,
  offsetX: -88.9,
  offsetY: -52.9,
};

export class Spell212 extends RuntimeSpell {
  readonly spellId = 212;
  readonly displayType = SpellDisplayType.WorldAbsoluteAlt;

  // Hold references so onSpellStart can attach them
  private sprite8Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- shoot (DefineSprite_3_shoot) — 105-frame impact animation ----
    // Textures come from animations[] entry "shoot" (no lib_ prefix — not in librarySymbols).
    // frame_1:  _rotation = 0
    // frame_73: installs onEnterFrame that fades _alpha by 3/tick
    // frame_103: _parent.removeMovieClip(); stop() → runtime.complete()
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 105,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_3_shoot/frame_1/DoAction.as
            // _rotation = 0 — reset any inherited rotation
            clip.rotation = 0;
          },
        ],
        [
          72,
          (clip) => {
            // AS DefineSprite_3_shoot/frame_73/DoAction.as
            // this.onEnterFrame = function() { _alpha = _alpha - 3; }
            // Install a per-tick fade-out handler on this clip.
            clip.onEnterFrame = (self) => {
              self.alpha = self.alpha - 3 / 100;
            };
          },
        ],
        [
          102,
          (clip) => {
            // AS DefineSprite_3_shoot/frame_103/DoAction.as
            // _parent.removeMovieClip(); stop();
            // _parent here is DefineSprite_8 (the outer container).
            // Removing the outer container ends the spell.
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- PlaceObject2_7_13 fader — the child placed at DefineSprite_8 frame_118 ----
    // AS DefineSprite_8/frame_118/PlaceObject2_7_13/CLIPACTIONRECORD onClipEvent(enterFrame).as:
    //   _parent._alpha -= 5;
    // This is a dynamic child clip with no visual content of its own.
    // Its onEnterFrame fades its PARENT (DefineSprite_8) by 5 alpha units per tick.
    // No frames/textures — pure container.
    const faderSym: SymbolDefinition = {
      name: "fader",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS DefineSprite_8/frame_118/PlaceObject2_7_13/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _parent._alpha -= 5  (AS 0-100 units → TS subtract 5/100 per tick)
        const parent = clip.parent;
        if (parent) {
          parent.alpha = Math.max(0, parent.alpha - 5 / 100);
        }
      },
    };

    // ---- DefineSprite_8 — outer 142-frame container ----
    // frame_1:  _X = _parent.cellTo.x; _Y = _parent.cellTo.y  (world positioning)
    // frame_58: SOMA.playSound("explosion")  — forwarded via stored callback
    // frame_61: this.end() → signalHit
    // frame_118: attach fader child (PlaceObject2_7_13 with enterFrame that fades parent)
    // frame_142: _parent.removeMovieClip() → complete
    // Note: the "shoot" child is placed by DefineSprite_8 (canonically via attachMovie).
    //   Looking at the AS, DefineSprite_8 contains DefineSprite_3_shoot as a placed child.
    //   Since there is no explicit attachMovie AS call for "shoot" visible in the scripts,
    //   it is placed on DefineSprite_8's timeline at frame_1 as a PlaceObject2 (authored).
    //   We handle it by attaching shoot in DefineSprite_8's frame_1 frameScript.
    this.sprite8Sym = {
      name: "sprite_8",
      totalFrames: 142,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_8/frame_1/DoAction.as
            // _X = _parent.cellTo.x; _Y = _parent.cellTo.y
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y;
            }
            // Place the authored "shoot" child (DefineSprite_3_shoot) at frame_1.
            // In the canonical SWF this is a PlaceObject2 on DefineSprite_8's timeline.
            clip.attach(shootSym, "shoot", 3, ctx);
          },
        ],
        [
          57,
          () => {
            // AS DefineSprite_8/frame_58/DoAction.as
            // SOMA.playSound("explosion")
            // Sound callback stored in onSpellStart for use here.
            this.soundCallback?.("explosion");
          },
        ],
        [
          60,
          () => {
            // AS DefineSprite_8/frame_61/DoAction.as
            // this.end() → signalHit (damage popup at target)
            this.runtime.signalHit();
          },
        ],
        [
          117,
          (clip, ctx) => {
            // AS DefineSprite_8/frame_118 — PlaceObject2_7_13 placed here.
            // The child has an onClipEvent(enterFrame) that fades _parent._alpha -= 5.
            // We attach the fader symbol; its onEnterFrame will decrement clip.parent.alpha.
            clip.attach(faderSym, "fader_7_13", 7, ctx);
          },
        ],
        [
          141,
          (clip) => {
            // AS DefineSprite_8/frame_142/DoAction.as
            // _parent.removeMovieClip() — removes the outer mc (root).
            // runtime.complete() already called from shoot's frame_103 if
            // shoot finishes first, but if sprite_8 outlasts shoot, we complete here.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(shootSym);
    this.registry.register(faderSym);
    this.registry.register(this.sprite8Sym);
  }

  // Stored callback for sounds fired from frameScripts (not directly available there)
  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // Store sound callback for use in DefineSprite_8's frame_58 script
    this.soundCallback = callbacks.playSound;

    // Main timeline frame_2: stop() — implicit after placement.
    // Attach DefineSprite_8 as the top-level child so it starts ticking.
    this.root.attach(this.sprite8Sym, "sprite8", 8, context);
  }
}
