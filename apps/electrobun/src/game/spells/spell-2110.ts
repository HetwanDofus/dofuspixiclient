/**
 * Spell 2110 — (Cra/Iop linear projectile).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2110/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear). Detection rationale:
 *   - The manifest has a single `shoot` animation in `animations[]` (no `librarySymbols[]`).
 *   - DefineSprite_4_shoot/frame_1/DoAction.as resets `_rotation = 0`, the canonical
 *     override pattern for linear-projectile shoot symbols.
 *   - DefineSprite_13 positions itself at `_parent.cellTo` (target), acting as the
 *     impact/explosion composite that the harness attaches at the target offset.
 *   - There is no `move` symbol and no ballistic arc logic — purely linear.
 *   - The pattern (shoot rotated to face target, lands at target, impact plays) matches
 *     displayType=20 (ProjectileLinear).
 *
 * Symbols:
 *   - `shoot`      — 105-frame animated projectile (textures from `animations[]` entry
 *                    "shoot"). frame_1 resets rotation to 0. frame_73 begins alpha fade
 *                    via onEnterFrame (-10/frame). frame_103 removes parent + stops.
 *                    The harness attaches this at the target-local offset inside the
 *                    rotated root container.
 *   - `DefineSprite_13` (attached as "sprite13") — 91-frame impact composite (no textures,
 *                    container-only). frame_1 positions self at cellTo. frame_37 plays
 *                    "explosion" sound. frame_40 signals hit (`this.end()`). frame_91
 *                    removes parent → spell complete.
 *
 * Main timeline: frame_2 → stop(). No sound on the main timeline.
 *
 * NOTE: DefineSprite_13 is NOT in `librarySymbols[]` (that array is empty). It appears
 * only in the scripts. The harness for displayType=20 attaches `shoot` automatically;
 * we attach `sprite13` (DefineSprite_13) from `onSpellStart` so it runs in parallel
 * at the root (it positions itself at cellTo in its own frame_1).
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

// `shoot` lives in animations[] (not librarySymbols[]), so bounds come from that entry.
const SHOOT_BOUNDS = {
  width: 177.75,
  height: 106.15,
  offsetX: -89.05,
  offsetY: -52.95,
};

export class Spell2110 extends RuntimeSpell {
  readonly spellId = 2110;
  readonly displayType = SpellDisplayType.ProjectileLinear;

  private sprite13Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- shoot — 105-frame linear projectile --------------------
    // Textures come from animations[] entry "shoot" (NO lib_ prefix —
    // this symbol is in animations[], not librarySymbols[]).
    //
    // The harness (displayType=20) attaches this at the target-local
    // offset inside the rotated root container.
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
            // AS: DefineSprite_4_shoot/frame_1/DoAction.as
            // _rotation = 0;
            // Canonical override: resets any velocity-angle rotation the
            // harness applied when attaching shoot, so the projectile
            // sprite appears upright / axis-aligned.
            clip.rotation = 0;
          },
        ],
        [
          72,
          (clip) => {
            // AS: DefineSprite_4_shoot/frame_73/DoAction.as
            // this.onEnterFrame = function() { _alpha = _alpha - 10; };
            // Installs a fade-out handler starting at frame 73.
            clip.onEnterFrame = (self) => {
              self.alpha = self.alpha - 10 / 100;
            };
          },
        ],
        [
          102,
          (clip) => {
            // AS: DefineSprite_4_shoot/frame_103/DoAction.as
            // _parent.removeMovieClip(); stop();
            // `shoot` is attached directly to root by the harness, so
            // _parent is root — signal completion here.
            clip.parent?.remove();
            clip.stop();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- DefineSprite_13 — impact/explosion composite -----------
    // Container-only (no authored textures in manifest). Positioned at
    // cellTo in its own frame_1. Plays explosion sound at frame_37,
    // signals hit at frame_40, removes parent at frame_91.
    //
    // This symbol is not in librarySymbols[] — it is attached from
    // onSpellStart directly onto root so it runs in parallel with the
    // harness-driven shoot.
    this.sprite13Sym = {
      name: "sprite13",
      totalFrames: 91,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_13/frame_1/DoAction.as
            // _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
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
          (_clip, _ctx) => {
            // AS: DefineSprite_13/frame_37/DoAction.as
            // SOMA.playSound("explosion");
            // Sound must be routed through the callbacks captured at
            // onSpellStart time (see soundCallback below).
            this.soundCallback?.("explosion");
          },
        ],
        [
          39,
          () => {
            // AS: DefineSprite_13/frame_40/DoAction.as
            // this.end() → damage popup / signalHit.
            this.runtime.signalHit();
          },
        ],
        [
          90,
          (clip) => {
            // AS: DefineSprite_13/frame_91/DoAction.as
            // _parent.removeMovieClip();
            // _parent of sprite13 is root → spell complete.
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(shootSym);
    this.registry.register(this.sprite13Sym);
  }

  private soundCallback: ((id: string) => void) | undefined;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture callbacks so frame scripts inside sprite13 can play sounds.
    this.soundCallback = callbacks.playSound;

    // Main timeline frame_2: stop(). No sound on main timeline.
    // Attach DefineSprite_13 at root so it runs its own timeline
    // (positions at cellTo, plays explosion, signals hit, completes).
    this.root.attach(this.sprite13Sym, "sprite13", 1, context);
  }
}
