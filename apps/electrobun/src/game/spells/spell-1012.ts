/**
 * Spell 1012 — (Unknown name, likely a nature/earth spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1012/scripts/scripts/
 *
 * displayType=51 (WorldAbsoluteAlt). The spell has two parallel authored
 * timelines (sprite_17 and sprite_18) that position themselves using
 * `_parent.cellTo`. This is the WorldAbsolute pattern — the container sits
 * at world (0,0) and per-sprite frame_1 scripts set absolute positions.
 *
 * Library symbols (animations[] entries only — no librarySymbols[]):
 *   - sprite_17 — 198-frame caster/ambient timeline. frame_1 jumps to a
 *     random starting frame (gotoAndPlay(random(60)+2)). frame_64 plays
 *     sound "herbe". frame_196 stops.
 *   - sprite_18 — 186-frame target-side impact timeline. frame_1 positions
 *     self at _parent.cellTo. frame_67 calls this.end() → signalHit.
 *     frame_184 calls _parent.removeMovieClip() → spell complete.
 *
 * Main timeline (frame_2/DoAction.as): stop(). Implicit frame_1 places
 * sprite_17 and sprite_18. We attach them in onSpellStart.
 *
 * Sound: the manifest lists sound "herbe" at frame 63, which corresponds
 * to DefineSprite_17/frame_64/DoAction.as (0-based index 63 → AS frame 64).
 * The sound is played from within sprite_17's frame script.
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

const SPRITE_17_BOUNDS = {
  width: 57.5,
  height: 62.15,
  offsetX: -28,
  offsetY: -55.15,
};

const SPRITE_18_BOUNDS = {
  width: 169.5,
  height: 104.4,
  offsetX: -85.55,
  offsetY: -59.3,
};

export class Spell1012 extends RuntimeSpell {
  readonly spellId = 1012;
  readonly displayType = SpellDisplayType.WorldAbsoluteAlt;

  private sprite17Sym!: SymbolDefinition;
  private sprite18Sym!: SymbolDefinition;

  // Capture the play-sound callback so frame scripts inside sprite_17 can use it.
  private playSound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite17Anchor = calculateAnchor(SPRITE_17_BOUNDS);
    const sprite18Anchor = calculateAnchor(SPRITE_18_BOUNDS);

    // ---- sprite_17 — ambient / caster-side timeline (198 frames) -------
    // No librarySymbols entry → textures.getFrames("sprite_17") (no lib_ prefix).
    // Anchor from animations[] bounds.
    //
    // AS DefineSprite_17/frame_1/DoAction.as:
    //   gotoAndPlay(random(60) + 2);
    //
    // AS DefineSprite_17/frame_64/DoAction.as:
    //   SOMA.playSound("herbe");
    //
    // AS DefineSprite_17/frame_196/DoAction.as:
    //   stop();
    this.sprite17Sym = {
      name: "sprite_17",
      totalFrames: 198,
      frames: textures.getFrames("sprite_17"),
      anchorX: sprite17Anchor.x,
      anchorY: sprite17Anchor.y,
      frameScripts: new Map([
        [
          // AS DefineSprite_17/frame_1/DoAction.as: gotoAndPlay(random(60) + 2)
          0,
          (clip) => {
            const target = Math.floor(Math.random() * 60) + 2;
            clip.gotoAndPlay(target - 1);
          },
        ],
        [
          // AS DefineSprite_17/frame_64/DoAction.as: SOMA.playSound("herbe")
          63,
          () => {
            if (this.playSound) {
              this.playSound("herbe");
            }
          },
        ],
        [
          // AS DefineSprite_17/frame_196/DoAction.as: stop()
          195,
          (clip) => {
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_18 — target-side impact timeline (186 frames) ----------
    // No librarySymbols entry → textures.getFrames("sprite_18") (no lib_ prefix).
    // Anchor from animations[] bounds.
    //
    // AS DefineSprite_18/frame_1/DoAction.as:
    //   _X = _parent.cellTo.x;
    //   _Y = _parent.cellTo.y;
    //
    // AS DefineSprite_18/frame_67/DoAction.as:
    //   this.end();   → signalHit
    //
    // AS DefineSprite_18/frame_184/DoAction.as:
    //   _parent.removeMovieClip();
    //   stop();
    this.sprite18Sym = {
      name: "sprite_18",
      totalFrames: 186,
      frames: textures.getFrames("sprite_18"),
      anchorX: sprite18Anchor.x,
      anchorY: sprite18Anchor.y,
      frameScripts: new Map([
        [
          // AS DefineSprite_18/frame_1/DoAction.as:
          //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
          0,
          (clip) => {
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y;
            }
          },
        ],
        [
          // AS DefineSprite_18/frame_67/DoAction.as: this.end() → signalHit
          66,
          () => {
            this.runtime.signalHit();
          },
        ],
        [
          // AS DefineSprite_18/frame_184/DoAction.as:
          //   _parent.removeMovieClip(); stop();
          183,
          (clip) => {
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite17Sym);
    this.registry.register(this.sprite18Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture playSound for use inside sprite_17's frame_64 script.
    this.playSound = callbacks.playSound;

    // Main timeline frame_1 implicitly places sprite_17 and sprite_18.
    // Main timeline frame_2/DoAction.as: stop() — the main timeline stops
    // after placing children; children run independently.
    // Attach both sprites so they start ticking from the next runtime frame.
    this.root.attach(this.sprite17Sym, "sprite17", 1, context);
    this.root.attach(this.sprite18Sym, "sprite18", 2, context);
  }
}
