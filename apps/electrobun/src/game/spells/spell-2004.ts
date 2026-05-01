/**
 * Spell 2004 — (Cra/Sacrieur fire arrow variant).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2004/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single `shoot` symbol
 * (DefineSprite_20_shoot) that positions itself at _parent.cellTo on frame_1,
 * plays two sounds (dodge_607c at frame 1, jet_903 at frame 22), signals hit
 * at frame 28 via this.end(), and removes the parent at frame 64.
 *
 * There are no library symbols listed in manifest.librarySymbols — `shoot`
 * appears only in `animations[]`, so it uses `textures.getFrames("shoot")`
 * (no `lib_` prefix).
 *
 * The main timeline has a single script at frame_2: `stop()`, meaning the
 * main timeline halts immediately. The `shoot` symbol is the sole authored
 * content and drives the full spell lifecycle.
 *
 * Library symbols: none (empty librarySymbols array).
 *
 * Main timeline: frame_2/DoAction.as → stop(). Implicit frame_1 places shoot.
 *
 * shoot symbol (66 frames):
 *   frame_1 (index 0): SOMA.playSound("dodge_607c"); _X = _parent.cellTo.x; _Y = _parent.cellTo.y
 *   frame_22 (index 21): SOMA.playSound("jet_903")
 *   frame_28 (index 27): this.end() → signalHit
 *   frame_64 (index 63): _parent.removeMovieClip() → complete
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

const SHOOT_BOUNDS = {
  width: 204.8,
  height: 382.95,
  offsetX: -102.35,
  offsetY: -321.45,
};

export class Spell2004 extends RuntimeSpell {
  readonly spellId = 2004;
  readonly displayType = SpellDisplayType.TargetCell;

  private shootSym!: SymbolDefinition;
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- shoot — 66-frame impact animation at target cell --------
    // AS DefineSprite_20_shoot; positions self at cellTo on frame_1,
    // plays sounds at frames 1 and 22, signals hit at frame 28,
    // removes parent at frame 64.
    this.shootSym = {
      name: "shoot",
      totalFrames: 66,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_20_shoot/frame_1/DoAction.as
            this.soundCallback?.("dodge_607c");

            // AS DefineSprite_20_shoot/frame_1/DoAction_2.as
            // _X = _parent.cellTo.x; _Y = _parent.cellTo.y
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
          21,
          (_clip) => {
            // AS DefineSprite_20_shoot/frame_22/DoAction.as
            // SOMA.playSound("jet_903");
            this.soundCallback?.("jet_903");
          },
        ],
        [
          27,
          (_clip) => {
            // AS DefineSprite_20_shoot/frame_28/DoAction.as
            // this.end() → damage popup at target
            this.runtime.signalHit();
          },
        ],
        [
          63,
          (clip) => {
            // AS DefineSprite_20_shoot/frame_64/DoAction.as
            // _parent.removeMovieClip() → spell complete
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // Capture sound callback so frameScripts can access it.
    this.soundCallback = callbacks.playSound;

    // Implicit frame_1 placement of shoot on the main timeline.
    // The main timeline frame_2/DoAction.as calls stop(), meaning the
    // outer timeline halts immediately after placing shoot. We attach
    // shoot here so it starts ticking from the next runtime frame.
    this.root.attach(this.shootSym, "shoot", 1, context);
  }
}
