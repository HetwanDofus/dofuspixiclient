/**
 * Spell 2021 — (Unknown name, likely a Cra or Iop spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2021/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear). The manifest has a single `shoot` animation
 * in `animations[]` (no librarySymbols), and DefineSprite_10_shoot/frame_1/DoAction.as
 * resets `_rotation = 0` — the canonical linear-projectile pattern where the harness
 * rotates the container to face the target, and the shoot symbol resets its own
 * rotation to remain upright. There is no `move` symbol, no ballistic arc, and no
 * `duplicate` symbol, so ProjectileBallistic and BeamLine are ruled out.
 *
 * The outer sprite (DefineSprite_19) is a 119-frame authored timeline that acts as
 * the main driving clip. It:
 *   frame_4:   positions itself at _parent.cellTo (x/y).
 *   frame_7:   plays sound "lance02".
 *   frame_47:  plays sound "explosion" AND signals hit (this.end()).
 *   frame_71:  plays sound "licrounch_1003".
 *   frame_119: _parent.removeMovieClip → spell complete.
 *
 * DefineSprite_15 is an inner authored timeline (64 frames) that stops at frame_64.
 *
 * DefineSprite_10_shoot is the named "shoot" symbol (56 frames):
 *   frame_1:   _rotation = 0 (override harness rotation).
 *   frame_47:  _parent.removeMovieClip(); stop() — removes shoot from its parent.
 *
 * The top-level main timeline (frame_2/DoAction.as) just does stop().
 *
 * Because displayType=20 (ProjectileLinear), the harness:
 *   1. Rotates root to face target.
 *   2. Attaches "shoot" at the target-relative offset inside the rotated container.
 *
 * The outer sprite_19 and sprite_15 need to be attached from onSpellStart.
 *
 * Sounds in this spell are played from frameScripts inside DefineSprite_19,
 * so we capture the callbacks reference in onSpellStart for use in those handlers.
 *
 * Library symbols:
 *   - shoot (animations[] entry, 56 frames) — linear projectile impact.
 *       frame_1: _rotation = 0 (resets harness-applied rotation).
 *       frame_47: removes itself from its parent; stops.
 *   - sprite_19 (animations[] — NOT in librarySymbols, container-only) — main
 *       driving timeline (119 frames). Positions at target, plays sounds, signals
 *       hit at frame_47, removes outer mc at frame_119.
 *   - sprite_15 (animations[] — container-only, 64 frames). Stops at frame_64.
 *
 * Main timeline: frame_2/DoAction.as → stop(). No sound at top level. Children
 * (sprite_19, sprite_15, shoot) are placed by the harness (shoot) and onSpellStart
 * (sprite_19, sprite_15).
 *
 * Note: Because displayType=20, `this.runtime.signalHit()` must be called from
 * the canonical hit frame (DefineSprite_19/frame_47/DoAction_2.as → this.end()).
 * The harness does NOT auto-signal for linear projectiles.
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
  readonly displayType = SpellDisplayType.ProjectileLinear;

  private soundCallbacks?: SpellCallbacks;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- shoot — 56-frame linear projectile impact ---------------
    // Textures come from animations[] entry "shoot" (no lib_ prefix since
    // there are no librarySymbols in this manifest).
    const shootSym: SymbolDefinition = {
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
            // _rotation = 0; — override the harness-applied velocity-angle rotation
            // so the impact stays upright regardless of target direction.
            clip.rotation = 0;
          },
        ],
        [
          46,
          (clip) => {
            // AS DefineSprite_10_shoot/frame_47/DoAction.as
            // _parent.removeMovieClip(); stop();
            // Removes the shoot clip from its parent (root).
            clip.parent?.remove();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_19 — main driving timeline (119 frames) ----------
    // Container-only (no authored frame textures in animations[], only scripts).
    // Drives sounds, hit signal, and spell completion.
    const sprite19Sym: SymbolDefinition = {
      name: "sprite_19",
      totalFrames: 119,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          3,
          (clip) => {
            // AS DefineSprite_19/frame_4/DoAction.as
            // _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
            // Position this sprite at the target cell in world coords.
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
          6,
          () => {
            // AS DefineSprite_19/frame_7/DoAction.as
            // SOMA.playSound("lance02");
            this.soundCallbacks?.playSound("lance02");
          },
        ],
        [
          46,
          () => {
            // AS DefineSprite_19/frame_47/DoAction.as
            // SOMA.playSound("explosion");
            this.soundCallbacks?.playSound("explosion");
            // AS DefineSprite_19/frame_47/DoAction_2.as
            // this.end(); — signal hit (damage popup at target).
            this.runtime.signalHit();
          },
        ],
        [
          70,
          () => {
            // AS DefineSprite_19/frame_71/DoAction.as
            // SOMA.playSound("licrounch_1003");
            this.soundCallbacks?.playSound("licrounch_1003");
          },
        ],
        [
          118,
          (clip) => {
            // AS DefineSprite_19/frame_119/DoAction.as
            // _parent.removeMovieClip(); — kills the outer mc = spell complete.
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- sprite_15 — inner authored timeline (64 frames) ---------
    // Container-only. Stops at frame_64.
    const sprite15Sym: SymbolDefinition = {
      name: "sprite_15",
      totalFrames: 64,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          63,
          (clip) => {
            // AS DefineSprite_15/frame_64/DoAction.as
            // stop();
            clip.stop();
          },
        ],
      ]),
    };

    this.registry.register(shootSym);
    this.registry.register(sprite19Sym);
    this.registry.register(sprite15Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture callbacks so frameScripts inside sprite_19 can play sounds.
    this.soundCallbacks = callbacks;

    // top-level main timeline: frame_2/DoAction.as → stop();
    // No sound at the top level. The harness has already attached "shoot"
    // via configureHarness (displayType=20 ProjectileLinear). We now attach
    // sprite_19 and sprite_15 as authored parallel timelines on the root.
    this.root.attach(this.registry.resolve("sprite_19")!, "sprite19", 3, context);
    this.root.attach(this.registry.resolve("sprite_15")!, "sprite15", 4, context);
  }
}
