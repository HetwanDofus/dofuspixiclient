/**
 * Spell 911 — Flèche Enflammée alt visual (Cra fire arrow variant).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/911/scripts/scripts/.
 *
 * Structurally identical to spell 909:
 *   - displayType=51 (WorldAbsoluteAlt)
 *   - Two parallel timelines (sprite_20 caster-side, sprite_29 target-side)
 *   - sprite_20/frame_7 spawns 10 + level*3 `cercle` particles
 *   - sprite_29/frame_34 calls `this.end()` → signalHit
 *   - sprite_29/frame_82 calls `_parent.removeMovieClip()` → complete
 *
 * Differences from 909:
 *   - The cercle particle here is an authored 42-frame animation (sprite_25)
 *     rather than a runtime-physics `lib_cercle`. Its frame_1 randomizes
 *     `_rotation` / `_xscale` / `_yscale`; frame_40 stops the timeline.
 *     No onEnterFrame physics — the playhead drives the visual.
 *   - The manifest exposes the cercle's textures under the animation key
 *     "sprite_25" (no `lib_` prefix because the source SWF carries no
 *     librarySymbols entry for this spell). We register the symbol with
 *     name="cercle" to match the canonical attachMovie string.
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

const CERCLE_BOUNDS = {
  width: 75.05,
  height: 1.05,
  offsetX: 0,
  offsetY: -1.05,
};

const SPRITE20_BOUNDS = {
  width: 152.95,
  height: 41.2,
  offsetX: 5.1,
  offsetY: -25.1,
};

const SPRITE29_BOUNDS = {
  width: 147.8,
  height: 93.75,
  offsetX: -72.85,
  offsetY: -48.4,
};

export class Spell911 extends RuntimeSpell {
  readonly spellId = 911;
  readonly displayType = SpellDisplayType.WorldAbsoluteAlt;

  private cercleSym!: SymbolDefinition;
  private sprite20Sym!: SymbolDefinition;
  private sprite29Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const cercleAnchor = calculateAnchor(CERCLE_BOUNDS);
    const sprite20Anchor = calculateAnchor(SPRITE20_BOUNDS);
    const sprite29Anchor = calculateAnchor(SPRITE29_BOUNDS);

    // ---- cercle — authored 42-frame particle ---------------------
    // AS DefineSprite_25/frame_1/DoAction.as:
    //   _rotation = random(360); t = random(50) + 50;
    //   _xscale = t; _yscale = t;
    // AS DefineSprite_25/frame_40/DoAction.as: stop();
    this.cercleSym = {
      name: "cercle",
      totalFrames: 42,
      frames: textures.getFrames("sprite_25"),
      anchorX: cercleAnchor.x,
      anchorY: cercleAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            const t = Math.floor(Math.random() * 50) + 50;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
          },
        ],
        [
          39,
          (clip) => {
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_20 — caster-side authored timeline (45 frames) ---
    this.sprite20Sym = {
      name: "sprite_20",
      totalFrames: 45,
      frames: textures.getFrames("sprite_20"),
      anchorX: sprite20Anchor.x,
      anchorY: sprite20Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_20/frame_1/DoAction.as:
            //   _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y - 25;
            //   _rotation = _parent.angle;
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y - 25;
            }
            clip.rotation = (angleDeg * Math.PI) / 180;
          },
        ],
        [
          6,
          (clip, ctx) => {
            // AS DefineSprite_20/frame_7/DoAction.as:
            //   nb = 10 + _parent.level * 3;
            //   c = 1; while (c < nb) { attachMovie("cercle","cercle"+c,c); c++; }
            const root = clip.parent;
            const level = (root?.vars.level as number) ?? 1;
            const nb = 10 + level * 3;
            for (let c = 1; c < nb; c++) {
              clip.attach(this.cercleSym, `cercle${c}`, c, ctx);
            }
          },
        ],
        [
          42,
          (clip) => {
            // AS DefineSprite_20/frame_43/DoAction.as: stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_29 — target-side authored timeline (84 frames) ---
    this.sprite29Sym = {
      name: "sprite_29",
      totalFrames: 84,
      frames: textures.getFrames("sprite_29"),
      anchorX: sprite29Anchor.x,
      anchorY: sprite29Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_29/frame_1/DoAction.as:
            //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y - 25;
            //   _rotation = _parent.angle;
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y - 25;
            }
            clip.rotation = (angleDeg * Math.PI) / 180;
          },
        ],
        [
          33,
          () => {
            // AS DefineSprite_29/frame_34/DoAction.as: this.end();
            // → routes to GAC.applyHit → spell hit signal.
            this.runtime.signalHit();
          },
        ],
        [
          81,
          (clip) => {
            // AS DefineSprite_29/frame_82/DoAction.as: _parent.removeMovieClip();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.cercleSym);
    this.registry.register(this.sprite20Sym);
    this.registry.register(this.sprite29Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS frame_2/DoAction.as: SOMA.playSound("jet_903"); stop();
    callbacks.playSound("jet_903");
    // Implicit main-timeline placement of sprite_20 + sprite_29. Attach
    // explicitly so they start ticking from the next runtime frame.
    this.root.attach(this.sprite20Sym, "sprite20", 1, context);
    this.root.attach(this.sprite29Sym, "sprite29", 2, context);
  }
}
