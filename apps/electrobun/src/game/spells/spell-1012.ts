/**
 * Spell 1012 — (Sadida vine/herb impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1012/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no projectile, no caster reference,
 * no `move`/`shoot`/`duplicate` symbols. Two parallel authored timelines
 * (sprite_17 and sprite_18) are placed on the main timeline; both are
 * anchored at the target cell via sprite_18's frame_1 explicitly reading
 * `_parent.cellTo`, and sprite_17 implicitly renders at the container origin
 * which is already positioned at the target cell by the harness. The harness
 * does not drive hit-signalling for TargetCell; sprite_18 calls `this.end()`
 * at frame_67 (canonical hit), and sprite_18 calls `_parent.removeMovieClip()`
 * at frame_184 (canonical completion).
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
 * Animations:
 *   - sprite_17 — 198-frame herb/vine caster-side effect.
 *       frame_1:  gotoAndPlay(random(60) + 2) — random start offset.
 *       frame_64: SOMA.playSound("herbe").
 *       frame_196: stop().
 *   - sprite_18 — 186-frame target-side impact effect.
 *       frame_1:  position self at _parent.cellTo.
 *       frame_67: this.end() → signalHit.
 *       frame_184: _parent.removeMovieClip() → complete.
 *
 * Main timeline frame_2/DoAction.as: stop() — the main timeline halts at
 * frame 2 after placing the two sprites. No explicit sound on the main
 * timeline; "herbe" is triggered from sprite_17's frame_64.
 *
 * No `lib_` prefix is used anywhere: librarySymbols[] is empty, so all
 * textures are fetched under the bare animation name.
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
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite17Sym!: SymbolDefinition;
  private sprite18Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite17Anchor = calculateAnchor(SPRITE_17_BOUNDS);
    const sprite18Anchor = calculateAnchor(SPRITE_18_BOUNDS);

    // ---- sprite_17 — 198-frame herb effect (random start) --------
    // AS DefineSprite_17 scripts define three frame actions.
    this.sprite17Sym = {
      name: "sprite_17",
      totalFrames: 198,
      frames: textures.getFrames("sprite_17"),
      anchorX: sprite17Anchor.x,
      anchorY: sprite17Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: scripts/DefineSprite_17/frame_1/DoAction.as
            // gotoAndPlay(random(60) + 2);
            clip.gotoAndPlay(Math.floor(Math.random() * 60) + 1);
          },
        ],
        [
          63,
          (_clip) => {
            // AS: scripts/DefineSprite_17/frame_64/DoAction.as
            // SOMA.playSound("herbe");
            // Sound is triggered from within the clip; we capture the
            // callback reference set during onSpellStart.
            if (this.soundCallback) {
              this.soundCallback("herbe");
            }
          },
        ],
        [
          195,
          (clip) => {
            // AS: scripts/DefineSprite_17/frame_196/DoAction.as
            // stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_18 — 186-frame target-side impact effect ---------
    // AS DefineSprite_18 scripts define three frame actions.
    this.sprite18Sym = {
      name: "sprite_18",
      totalFrames: 186,
      frames: textures.getFrames("sprite_18"),
      anchorX: sprite18Anchor.x,
      anchorY: sprite18Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: scripts/DefineSprite_18/frame_1/DoAction.as
            // _X = _parent.cellTo.x;
            // _Y = _parent.cellTo.y;
            // For TargetCell the container origin IS cellTo, but
            // sprite_18 explicitly repositions itself at the absolute
            // world coords of the target cell. We read cellTo from root.
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
          66,
          () => {
            // AS: scripts/DefineSprite_18/frame_67/DoAction.as
            // this.end() → damage popup / hit signal.
            this.runtime.signalHit();
          },
        ],
        [
          183,
          (clip) => {
            // AS: scripts/DefineSprite_18/frame_184/DoAction.as
            // _parent.removeMovieClip(); stop();
            // _parent here is the outer mc (root); signal completion.
            clip.stop();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite17Sym);
    this.registry.register(this.sprite18Sym);
  }

  // Stored so sprite_17's frame_64 can fire it from inside frameScripts.
  private soundCallback: ((id: string) => void) | undefined;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture the sound callback so sprite_17's frame_64 script can use it.
    this.soundCallback = callbacks.playSound;

    // Main timeline frame_1 implicitly places sprite_17 and sprite_18.
    // frame_2/DoAction.as only does stop() — no explicit sound here.
    // Attach both child timelines so they begin ticking from the next frame.
    this.root.attach(this.sprite17Sym, "sprite17", 1, context);
    this.root.attach(this.sprite18Sym, "sprite18", 2, context);
  }
}
