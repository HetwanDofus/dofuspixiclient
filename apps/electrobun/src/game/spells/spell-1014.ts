/**
 * Spell 1014 — Licorne (Ecaflip lizard bite / unicorn strike).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1014/scripts/scripts/
 *
 * displayType=11 (TargetCell). The only authored child is sprite_17, which
 * positions itself at _parent.cellTo on frame_1 — a single impact anchored
 * at the target cell. No projectile, no caster reference, no beams.
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
 * Animations:
 *   - sprite_11 — 21-frame particle / decoration element.
 *       frame_1: set rotation to random(360) degrees, scale to random [50,100]%,
 *                if first visit jump to random frame in [1,27].
 *   - sprite_17 — 120-frame composite impact timeline (main content).
 *       frame_1:   position self at _parent.cellTo.
 *       frame_28:  SOMA.playSound("licrounch_1014").
 *       frame_88:  this.end() → signalHit.
 *       frame_106: SOMA.playSound("jump").
 *       frame_118: _parent.removeMovieClip() → complete.
 *
 * Main timeline: frame_2/DoAction.as → stop().
 * The main timeline implicitly places sprite_17 at depth 1; we attach it
 * in onSpellStart after the harness configures the container.
 *
 * Sounds are driven from sprite_17's frame scripts to stay canonical;
 * the main-timeline stop() has no runtime effect beyond halting a 2-frame
 * outer clip (irrelevant once sprite_17 drives everything).
 *
 * NOTE: sprite_11 appears in animations[] but is never referenced by an
 * attachMovie call in any script — it is placed by the authored timeline
 * inside sprite_17 (a composite). We register it so the runtime can
 * drive its frame_1 script if the composite rendering pipeline attaches it.
 * For completeness it is registered, but the primary spell driver is
 * sprite_17.
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

// Bounds from manifest animations[] entries (no librarySymbols[] present).
const SPRITE_11_BOUNDS = {
  width: 75.05,
  height: 1,
  offsetX: 9.7,
  offsetY: -0.5,
};

const SPRITE_17_BOUNDS = {
  width: 107.95,
  height: 85.85,
  offsetX: -21.55,
  offsetY: -79.75,
};

export class Spell1014 extends RuntimeSpell {
  readonly spellId = 1014;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite17Sym!: SymbolDefinition;

  // Capture sound callback so frame scripts inside sprite_17 can play sounds.
  private playSound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite11Anchor = calculateAnchor(SPRITE_11_BOUNDS);
    const sprite17Anchor = calculateAnchor(SPRITE_17_BOUNDS);

    // ---- sprite_11 — particle / decoration element inside sprite_17 composite ----
    // AS: scripts/scripts/DefineSprite_11/frame_1/DoAction.as
    //   _rotation = random(360);
    //   t = random(50) + 50;
    //   _xscale = t;
    //   _yscale = t;
    //   if (c != 1) { c = 1; gotoAndPlay(random(27) + 1); }
    const sprite11Sym: SymbolDefinition = {
      name: "sprite_11",
      totalFrames: 21,
      frames: textures.getFrames("sprite_11"),
      anchorX: sprite11Anchor.x,
      anchorY: sprite11Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_11/frame_1/DoAction.as
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            const t = Math.floor(Math.random() * 50) + 50;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            const c = clip.vars.c as number | undefined;
            if (c !== 1) {
              clip.vars.c = 1;
              // AS: gotoAndPlay(random(27) + 1) → 0-based: random(27) + 0
              clip.gotoAndPlay(Math.floor(Math.random() * 27));
            }
          },
        ],
      ]),
    };

    // ---- sprite_17 — 120-frame composite impact timeline (primary driver) ----
    // AS frame scripts:
    //   frame_1/DoAction.as  : _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
    //   frame_28/DoAction.as : SOMA.playSound("licrounch_1014");
    //   frame_88/DoAction.as : this.end();  → signalHit
    //   frame_106/DoAction.as: SOMA.playSound("jump");
    //   frame_118/DoAction.as: _parent.removeMovieClip();  → complete
    this.sprite17Sym = {
      name: "sprite_17",
      totalFrames: 120,
      frames: textures.getFrames("sprite_17"),
      anchorX: sprite17Anchor.x,
      anchorY: sprite17Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_17/frame_1/DoAction.as
            // Position self at _parent.cellTo (world coords stored on root.vars).
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
          27,
          () => {
            // AS DefineSprite_17/frame_28/DoAction.as
            // SOMA.playSound("licrounch_1014");
            this.playSound?.("licrounch_1014");
          },
        ],
        [
          87,
          () => {
            // AS DefineSprite_17/frame_88/DoAction.as
            // this.end() → damage popup at target.
            this.runtime.signalHit();
          },
        ],
        [
          105,
          () => {
            // AS DefineSprite_17/frame_106/DoAction.as
            // SOMA.playSound("jump");
            this.playSound?.("jump");
          },
        ],
        [
          117,
          (clip) => {
            // AS DefineSprite_17/frame_118/DoAction.as
            // _parent.removeMovieClip() → spell complete.
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite11Sym);
    this.registry.register(this.sprite17Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for use from frame scripts.
    this.playSound = callbacks.playSound;

    // Main timeline frame_2/DoAction.as: stop() — no action needed at runtime
    // since the outer 2-frame clip stopping is irrelevant once sprite_17 drives
    // the spell. The implicit frame_1 placement of sprite_17 is replicated here.
    this.root.attach(this.sprite17Sym, "sprite17", 1, context);
  }
}
