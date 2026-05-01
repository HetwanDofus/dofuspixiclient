/**
 * Spell 2021 — Lance-Flammes (Roublard / Rogue fire lance spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2021/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no `move` symbol and no
 * caster-side projectile; there is only a `shoot` symbol that plays at
 * the target cell. No `librarySymbols[]` entries — `shoot` lives in
 * `animations[]` only, so textures are fetched without the `lib_` prefix.
 *
 * The main outer sprite is DefineSprite_19 (119-frame container). It:
 *   frame_1  : (implicit — harness already placed root at target cell)
 *   frame_4  : positions itself at _parent.cellTo (redundant here since
 *               harness already anchors at target, but we honour it)
 *   frame_7  : SOMA.playSound("lance02")
 *   frame_47 : SOMA.playSound("explosion") + this.end() → signalHit
 *   frame_71 : SOMA.playSound("licrounch_1003")
 *   frame_119: _parent.removeMovieClip() → spell complete
 *
 * Inside DefineSprite_19 at its frame_1 (or via placement), DefineSprite_10_shoot
 * is attached. DefineSprite_10_shoot is the 56-frame visual animation:
 *   frame_1  : _rotation = 0
 *   frame_47 : _parent.removeMovieClip(); stop() — removes itself (not the outer)
 *
 * There is also a DefineSprite_15 (referenced in scripts) with frame_64: stop().
 * This appears to be an inner authored timeline inside DefineSprite_19.
 *
 * Architecture decision: We model this as:
 *   - `shoot` (56-frame visual, matches `animations: [{name:"shoot"}]`)
 *     with frame_1 resetting rotation, frame_47 removing self.
 *   - `sprite19` (119-frame outer container) that:
 *     - attaches `shoot` at frame_1 (depth 1)
 *     - plays sounds at frames 7, 47, 71
 *     - signals hit at frame 47
 *     - completes at frame 119
 *   We attach sprite19 from onSpellStart.
 *
 * Sounds are captured from onSpellStart and forwarded via a class-level
 * reference so frameScripts can call them.
 *
 * Library symbols: none (animations[] only, no librarySymbols[]).
 * Texture key for shoot: "shoot" (no lib_ prefix).
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
  width: 205.4,
  height: 149.05,
  offsetX: -103.2,
  offsetY: -87.7,
};

export class Spell2021 extends RuntimeSpell {
  readonly spellId = 2021;
  readonly displayType = SpellDisplayType.TargetCell;

  private shootSym!: SymbolDefinition;
  private sprite19Sym!: SymbolDefinition;

  /** Captured in onSpellStart so frameScripts can trigger sounds. */
  private _playSound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- shoot — 56-frame visual impact animation ----------------
    // Texture key: "shoot" (animations[] entry, no lib_ prefix).
    // AS DefineSprite_10_shoot/frame_1/DoAction.as: _rotation = 0
    // AS DefineSprite_10_shoot/frame_47/DoAction.as: _parent.removeMovieClip(); stop()
    this.shootSym = {
      name: "shoot",
      totalFrames: 56,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_10_shoot/frame_1/DoAction.as
            clip.rotation = 0;
          },
        ],
        [
          46,
          (clip) => {
            // AS DefineSprite_10_shoot/frame_47/DoAction.as
            // _parent.removeMovieClip() removes the shoot clip from sprite19.
            // stop() halts its own timeline.
            clip.parent?.remove();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite19 — 119-frame outer container --------------------
    // This is DefineSprite_19, the top-level authored timeline. No textures
    // of its own — it is a container-only symbol driven by frame scripts.
    // frames: [] because no visual content directly on this symbol.
    this.sprite19Sym = {
      name: "sprite19",
      totalFrames: 119,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // frame_1: implicit — attach the shoot visual as a child.
            // The harness has already placed the root at cellTo for
            // displayType=11; sprite19 is at root (0,0).
            // Also port AS DefineSprite_19/frame_4 positioning redundancy
            // by anchoring at (0,0) — the root is already at cellTo.
            clip.attach(this.shootSym, "shoot", 1, ctx);
          },
        ],
        [
          3,
          (clip) => {
            // AS DefineSprite_19/frame_4/DoAction.as
            // _X = _parent.cellTo.x; _Y = _parent.cellTo.y
            // The harness anchors root at cellTo for TargetCell display type,
            // and sprite19 is a direct child of root at (0,0). The cellTo
            // reference in the AS is the outer mc property. Since root is
            // already at cellTo, self-positioning to (0,0) in local space
            // matches the canonical intent.
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            const anchor = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            if (cellTo && anchor) {
              // For WorldAbsolute that would be clip.x = cellTo.x.
              // For TargetCell the container IS at cellTo, so local (0,0) is correct.
              // We simply ensure position is (0,0) as canonical.
              clip.x = 0;
              clip.y = 0;
            }
          },
        ],
        [
          6,
          () => {
            // AS DefineSprite_19/frame_7/DoAction.as
            // SOMA.playSound("lance02")
            this._playSound?.("lance02");
          },
        ],
        [
          46,
          () => {
            // AS DefineSprite_19/frame_47/DoAction.as
            // SOMA.playSound("explosion")
            this._playSound?.("explosion");
            // AS DefineSprite_19/frame_47/DoAction_2.as
            // this.end() → signalHit (damage popup at target)
            this.runtime.signalHit();
          },
        ],
        [
          70,
          () => {
            // AS DefineSprite_19/frame_71/DoAction.as
            // SOMA.playSound("licrounch_1003")
            this._playSound?.("licrounch_1003");
          },
        ],
        [
          118,
          (clip) => {
            // AS DefineSprite_19/frame_119/DoAction.as
            // _parent.removeMovieClip() — outer mc removal → spell complete.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.shootSym);
    this.registry.register(this.sprite19Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // Capture sound callback for use in frameScripts.
    this._playSound = callbacks.playSound;

    // AS scripts/frame_2/DoAction.as: stop() on the main timeline.
    // The main timeline itself just stops; the authored content is
    // DefineSprite_19 which we attach here as the primary child.
    this.root.attach(this.sprite19Sym, "sprite19", 1, context);
  }
}
