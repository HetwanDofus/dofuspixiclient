/**
 * Spell 2060 — (Unknown Cra/ranged spell, likely Flèche de Recul or similar).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2060/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear). Rationale: the spell has a `shoot` symbol
 * (DefineSprite_17_shoot) whose frame_1 resets `_rotation = 0` — the canonical
 * pattern for a linear projectile whose container is rotated to face the target
 * and whose shoot child is placed at the target-relative offset. There is no
 * `move` symbol and no ballistic arc, ruling out displayType 30/31. The outer
 * sprite (DefineSprite_22) is a 121-frame composite that positions itself at
 * `_parent.cellTo` on frame 4, fires sounds, signals hit at frame 49, and
 * removes itself at frame 121 — consistent with a target-anchored impact driven
 * from inside a WorldAbsolute or LinearProjectile container. Because the main
 * timeline only has a `stop()` on frame_2 and the single animation in
 * `animations[]` is named "shoot", the canonical pattern is:
 *   - harness attaches `shoot` at the target-local offset, rotated to face target
 *   - shoot's frame_1 overrides rotation to 0 (upright on arrival)
 *   - shoot plays 36 frames then removes its parent (the outer mc, which is root)
 *
 * However, the outer DefineSprite_22 (121 frames) is a SEPARATE authored sprite
 * that self-positions at cellTo (frame_4) and has its own sound / hit / removal
 * timeline. This is the WorldAbsolute pattern (displayType 50/51): two sprites
 * both anchored to world coordinates, with the container at (0,0).
 *
 * On closer inspection: `animations[]` only lists "shoot" (no "move", no
 * "duplicate"), and DefineSprite_22 positions itself via `_parent.cellTo` —
 * which requires root.vars.cellTo, set by configureHarness for all displayTypes.
 * The `shoot` symbol resets rotation, which is consistent with ProjectileLinear
 * placing it at the target offset inside a rotated container. DefineSprite_22
 * is the main authored sprite anchored at target; `shoot` is a sub-effect.
 *
 * Final classification: displayType=11 (TargetCell). The container is placed at
 * cellTo by the harness. DefineSprite_22 positions itself at _parent.cellTo
 * which in TargetCell coords = (0,0) — so it just stays at the container origin.
 * The `shoot` symbol (42 frames of SVG) is attached by `onSpellStart` as the
 * visible projectile-impact animation. Sounds and hit signal come from
 * DefineSprite_22's frame scripts.
 *
 * Library symbols:
 *   - "shoot" (DefineSprite_17_shoot, 42 frames): the animated impact burst.
 *     frame_1: _rotation = 0 (reset any harness rotation).
 *     frame_36: _parent.removeMovieClip() + stop() — removes the outer sprite.
 *
 *   - "sprite_22" (DefineSprite_22, 121 frames): main timeline, container-only.
 *     frame_4: positions self at _parent.cellTo.
 *     frame_7: SOMA.playSound("lance02").
 *     frame_49: SOMA.playSound("explosion") + this.end() → signalHit.
 *     frame_73: SOMA.playSound("licrounch_1003").
 *     frame_121: _parent.removeMovieClip() → complete.
 *
 * Main timeline (frame_2/DoAction.as): stop() — no sounds at root level.
 *
 * Sound scheduling: sounds are on DefineSprite_22's internal frames. We capture
 * the callbacks reference in onSpellStart and use it from frameScripts.
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

  private shootSym!: SymbolDefinition;
  private sprite22Sym!: SymbolDefinition;
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- shoot — 42-frame animated impact burst ------------------
    // Textures come from animations["shoot"] (no lib_ prefix — this
    // symbol lives in animations[], not librarySymbols[]).
    // AS: DefineSprite_17_shoot/frame_1/DoAction.as → _rotation = 0
    // AS: DefineSprite_17_shoot/frame_36/DoAction.as → _parent.removeMovieClip(); stop()
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
            // _rotation = 0 — reset any rotation applied by harness or parent.
            clip.rotation = 0;
          },
        ],
        [
          35,
          (clip) => {
            // AS DefineSprite_17_shoot/frame_36/DoAction.as
            // _parent.removeMovieClip(); stop();
            // shoot's parent is sprite_22; removing sprite_22 here.
            clip.parent?.remove();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_22 — 121-frame main composite, container-only ----
    // Positions itself at _parent.cellTo (= container origin for TargetCell).
    // Drives sounds, hit signal, and spell completion.
    // AS: DefineSprite_22/frame_4/DoAction.as  → _X = _parent.cellTo.x; _Y = _parent.cellTo.y
    // AS: DefineSprite_22/frame_7/DoAction.as  → SOMA.playSound("lance02")
    // AS: DefineSprite_22/frame_49/DoAction.as → SOMA.playSound("explosion")
    // AS: DefineSprite_22/frame_49/DoAction_2.as → this.end() → signalHit
    // AS: DefineSprite_22/frame_73/DoAction.as → SOMA.playSound("licrounch_1003")
    // AS: DefineSprite_22/frame_121/DoAction.as → _parent.removeMovieClip()
    this.sprite22Sym = {
      name: "sprite_22",
      totalFrames: 121,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          3,
          (clip) => {
            // AS DefineSprite_22/frame_4/DoAction.as
            // _X = _parent.cellTo.x; _Y = _parent.cellTo.y
            // For TargetCell the container origin IS cellTo, so
            // the child should be at (0, 0) in local coords.
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
            this.soundCallback?.("lance02");
          },
        ],
        [
          48,
          (clip, ctx) => {
            // AS DefineSprite_22/frame_49/DoAction.as
            // SOMA.playSound("explosion")
            this.soundCallback?.("explosion");
            // AS DefineSprite_22/frame_49/DoAction_2.as
            // this.end() → signal hit (damage popup at target)
            this.runtime.signalHit();
            // Attach the shoot impact animation at this clip's position.
            clip.attach(this.shootSym, "shoot", 1, ctx);
          },
        ],
        [
          72,
          () => {
            // AS DefineSprite_22/frame_73/DoAction.as
            // SOMA.playSound("licrounch_1003")
            this.soundCallback?.("licrounch_1003");
          },
        ],
        [
          120,
          (clip) => {
            // AS DefineSprite_22/frame_121/DoAction.as
            // _parent.removeMovieClip() — removes the outer mc (root).
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
    // Capture callbacks so frameScripts can fire sounds.
    this.soundCallback = callbacks.playSound;

    // Main timeline frame_2/DoAction.as: stop()
    // No sound at the root level; sprite_22 drives all audio.

    // Attach sprite_22 as the main authored timeline.
    this.root.attach(this.sprite22Sym, "sprite22", 1, context);
  }
}
