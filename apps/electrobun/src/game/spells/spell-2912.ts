/**
 * Spell 2912 — Unknown spell (likely a Cra or Iop fire/explosion attack).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2912/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). Evidence:
 *   - Has a `shoot` symbol in animations[] — the harness attaches `shoot`
 *     at the landing point of a parabolic arc.
 *   - DefineSprite_3_shoot/frame_1/DoAction.as does `_rotation = 0` —
 *     the canonical override pattern seen in ballistic shoot symbols
 *     (cancels the velocity-angle rotation applied by the harness).
 *   - DefineSprite_3_shoot/frame_103/DoAction.as calls
 *     `_parent.removeMovieClip()` — completes the spell after the burn.
 *   - DefineSprite_3_shoot/frame_73 sets up a fade-out enterFrame.
 *   - DefineSprite_8 is a secondary explosion composite anchored at
 *     cellTo (frame_1: `_X = _parent.cellTo.x; _Y = _parent.cellTo.y`).
 *     It plays a 91-frame timeline with an explosion sound at frame_37,
 *     `this.end()` (signalHit) at frame_40, and self-removal at frame_91.
 *   - No `move` symbol is present in animations[]; the harness will skip
 *     attaching it gracefully (attachIfRegistered checks registry). The
 *     shoot symbol IS present and will be attached at impact.
 *   - The main timeline frame_2 calls `stop()` — standard pattern.
 *
 * Library symbols:
 *   - `shoot` (animations entry, 105 frames) — the impact burn. frame_1
 *     resets rotation to 0. frame_73 installs a fade-out enterFrame
 *     (alpha -= 5 per tick). frame_103 removes parent + signals complete.
 *   - `DefineSprite_8` is attached by the shoot symbol (or the main
 *     timeline). Looking at the scripts, DefineSprite_8 reads
 *     `_parent.cellTo.x/y` in its frame_1, meaning it positions itself
 *     at the world target cell — it must be a child of the root (outer mc).
 *     There is no explicit `attachMovie` call visible, but the manifest
 *     `scripts[]` lists it and the `frame_2/DoAction.as` just calls
 *     `stop()`. In canonical Flash, DefineSprite_8 is likely placed on
 *     the main timeline via PlaceObject2 (authored), not via attachMovie.
 *     We model it as a symbol attached from `onSpellStart` at the root.
 *
 * Main timeline: frame_2 → stop(). No explicit sound on the main timeline
 * (the explosion sound is in DefineSprite_8/frame_37). onSpellStart
 * attaches DefineSprite_8 to root so it runs its authored timeline.
 *
 * Signal contract:
 *   - displayType=30: harness fires signalHit automatically on landing.
 *     DefineSprite_8/frame_40 calls `this.end()` which is a secondary
 *     signalHit — but since signalHit is idempotent the harness beat it.
 *     We still implement the frame_40 handler for correctness (no-op if
 *     already called).
 *   - complete() is called from shoot/frame_103 (_parent.removeMovieClip).
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
  width: 177.4,
  height: 106,
  offsetX: -88.9,
  offsetY: -52.9,
};

export class Spell2912 extends RuntimeSpell {
  readonly spellId = 2912;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  private sprite8Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- DefineSprite_8 — explosion composite anchored at cellTo ----
    // Positions itself at _parent.cellTo in frame_1 (world coords, since
    // the root is at world origin for displayType 30 the anchor is
    // caster.y-10, so cellTo is stored on root.vars.cellTo in world coords).
    // frame_37: SOMA.playSound("explosion")
    // frame_40: this.end() → signalHit (idempotent — harness already fired it)
    // frame_91: _parent.removeMovieClip() → self-remove
    //
    // Sound from a frame script — capture the callbacks reference so we
    // can call playSound from inside the frame script.
    let playSoundFn: ((id: string) => void) | undefined;

    this.sprite8Sym = {
      name: "sprite8",
      totalFrames: 91,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_8/frame_1/DoAction.as
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
          36,
          () => {
            // AS DefineSprite_8/frame_37/DoAction.as
            // SOMA.playSound("explosion")
            if (playSoundFn) {
              playSoundFn("explosion");
            }
          },
        ],
        [
          39,
          () => {
            // AS DefineSprite_8/frame_40/DoAction.as
            // this.end() → signalHit. Idempotent — harness already fired it
            // at landing for displayType 30, but we call it anyway for
            // canonical correctness.
            this.runtime.signalHit();
          },
        ],
        [
          90,
          (clip) => {
            // AS DefineSprite_8/frame_91/DoAction.as
            // _parent.removeMovieClip() — remove self (not the outer mc)
            clip.remove();
          },
        ],
      ]),
    };

    // ---- shoot — 105-frame impact burn at target -----------------
    // animations[] entry (no lib_ prefix — it's in animations[], not
    // librarySymbols[]). The harness attaches this at impact via
    // attachIfRegistered("shoot").
    //
    // frame_1: _rotation = 0 — override harness velocity-angle rotation
    //          so the burn stands upright regardless of arc angle.
    // frame_73: install onEnterFrame fade-out (_alpha -= 5 per tick).
    // frame_103: _parent.removeMovieClip() + stop() → spell complete.
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
            // _rotation = 0
            clip.rotation = 0;
          },
        ],
        [
          72,
          (clip) => {
            // AS DefineSprite_3_shoot/frame_73/DoAction.as
            // this.onEnterFrame = function() { _alpha = _alpha - 5; };
            clip.onEnterFrame = (c) => {
              c.alpha = c.alpha - 5 / 100;
            };
          },
        ],
        [
          102,
          (clip) => {
            // AS DefineSprite_3_shoot/frame_103/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite8Sym);
    this.registry.register(shootSym);

    // Expose the sound callback for use in sprite8's frame_37 script.
    // We do this via a closure variable set in onSpellStart below.
    this._playSoundSetter = (fn) => {
      playSoundFn = fn;
    };
  }

  private _playSoundSetter?: (fn: (id: string) => void) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Wire the sound callback into sprite8's frame_37 closure.
    if (this._playSoundSetter) {
      this._playSoundSetter(callbacks.playSound);
    }

    // Main timeline frame_2: stop(). No sound on main timeline.
    // DefineSprite_8 is authored on the main timeline (PlaceObject2) —
    // attach it explicitly here so it starts ticking from the next frame.
    this.root.attach(this.sprite8Sym, "sprite8", 1, context);
  }
}
