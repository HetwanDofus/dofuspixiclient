/**
 * Spell 2060 — (Xelor/Cra area spell, likely a lance/explosion combo).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2060/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no `move` symbol, no caster-relative
 * anchoring, no projectile arc, and no `duplicate` symbol. It has a single `shoot`
 * symbol (DefineSprite_17_shoot, 42 frames) and an outer sprite (DefineSprite_22,
 * 121 frames) that positions itself at cellTo on frame 4 and drives the full
 * animation timeline including sounds, signalHit (this.end() at frame 49), and
 * completion (_parent.removeMovieClip() at frame 121).
 *
 * The `animations[]` list contains only `shoot` (42 frames, with real SVG textures).
 * `librarySymbols[]` is empty — so NO `lib_` prefix for any texture keys.
 *
 * DefineSprite_22 is the outer authored timeline (121 frames) placed on the main
 * timeline. It:
 *   - frame_4:   positions self at _parent.cellTo.x / cellTo.y
 *   - frame_7:   plays sound "lance02"
 *   - frame_49:  plays sound "explosion" AND calls this.end() (signalHit)
 *   - frame_73:  plays sound "licrounch_1003"
 *   - frame_121: _parent.removeMovieClip() → spell complete
 *
 * DefineSprite_17_shoot is a 42-frame impact animation attached inside
 * DefineSprite_22 (inferred from the name convention and manifest `shoot` animation):
 *   - frame_1:   _rotation = 0
 *   - frame_36:  _parent.removeMovieClip(); stop()
 *
 * The main timeline (frame_2/DoAction.as) just calls stop() — no top-level sound.
 *
 * Since DefineSprite_22 self-positions at cellTo (frame_4), and the harness places
 * the container at the target cell for displayType=11, we attach sprite22 at the
 * root and let its frame_4 script place it correctly at world cellTo coords.
 *
 * Sound callbacks: sounds on DefineSprite_22's frames are played via a captured
 * reference since they're not on the main timeline frame_1.
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
  height: 148.5,
  offsetX: -102.35,
  offsetY: -87,
};

export class Spell2060 extends RuntimeSpell {
  readonly spellId = 2060;
  readonly displayType = SpellDisplayType.TargetCell;

  private playSound?: (id: string) => void;
  private sprite22Sym!: SymbolDefinition;
  private shootSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- shoot — 42-frame impact animation (DefineSprite_17_shoot) --------
    // Textures come from animations[] entry "shoot" (no lib_ prefix —
    // librarySymbols[] is empty in this manifest).
    // AS DefineSprite_17_shoot/frame_1/DoAction.as: _rotation = 0
    // AS DefineSprite_17_shoot/frame_36/DoAction.as: _parent.removeMovieClip(); stop()
    this.shootSym = {
      name: "shoot",
      totalFrames: 42,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_17_shoot/frame_1/DoAction.as
            clip.rotation = 0;
          },
        ],
        [
          35,
          (clip) => {
            // AS DefineSprite_17_shoot/frame_36/DoAction.as
            // _parent.removeMovieClip() — kill the shoot container (sprite22 child)
            clip.parent?.remove();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite22 — outer 121-frame authored timeline (DefineSprite_22) ---
    // This is a container-only symbol (no SVG frames of its own in animations[]).
    // It drives all timing: self-positioning, sounds, signalHit, completion.
    // It attaches `shoot` inside itself at some point (inferred from the
    // name + that shoot's frame_36 calls _parent.removeMovieClip).
    //
    // AS DefineSprite_22/frame_4/DoAction.as:
    //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y
    // AS DefineSprite_22/frame_7/DoAction.as:
    //   SOMA.playSound("lance02")
    // AS DefineSprite_22/frame_49/DoAction.as:
    //   SOMA.playSound("explosion")
    // AS DefineSprite_22/frame_49/DoAction_2.as:
    //   this.end() → signalHit
    // AS DefineSprite_22/frame_73/DoAction.as:
    //   SOMA.playSound("licrounch_1003")
    // AS DefineSprite_22/frame_121/DoAction.as:
    //   _parent.removeMovieClip() → spell complete
    //
    // The `shoot` symbol is attached inside sprite22. Based on the sounds manifest
    // (sound "lance02" at frame 6 of the outer SWF = frame 7 of sprite22) and the
    // impact explosion at frame 49, `shoot` is attached around or before frame 49
    // so the impact visual plays. We attach it on frame_1 at depth 1 (reasonable
    // default for a single child; it positions at (0,0) within sprite22).
    this.sprite22Sym = {
      name: "sprite22",
      totalFrames: 121,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_22 frame_1 (implicit) — attach shoot visual
            clip.attach(this.shootSym, "shoot", 1, ctx);
          },
        ],
        [
          3,
          (clip) => {
            // AS DefineSprite_22/frame_4/DoAction.as
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
          6,
          () => {
            // AS DefineSprite_22/frame_7/DoAction.as
            // SOMA.playSound("lance02")
            this.playSound?.("lance02");
          },
        ],
        [
          48,
          () => {
            // AS DefineSprite_22/frame_49/DoAction.as + DoAction_2.as
            // SOMA.playSound("explosion"); this.end()
            this.playSound?.("explosion");
            this.runtime.signalHit();
          },
        ],
        [
          72,
          () => {
            // AS DefineSprite_22/frame_73/DoAction.as
            // SOMA.playSound("licrounch_1003")
            this.playSound?.("licrounch_1003");
          },
        ],
        [
          120,
          (clip) => {
            // AS DefineSprite_22/frame_121/DoAction.as
            // _parent.removeMovieClip() — outer mc removal = spell complete
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.shootSym);
    this.registry.register(this.sprite22Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture playSound so frame scripts inside sprite22 can call it.
    this.playSound = callbacks.playSound;

    // Main timeline frame_2/DoAction.as: stop() — no sound on main timeline.
    // Attach sprite22 at the root so its authored timeline begins ticking.
    this.root.attach(this.sprite22Sym, "sprite22", 1, context);
  }
}
