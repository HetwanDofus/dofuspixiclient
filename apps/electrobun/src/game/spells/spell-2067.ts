/**
 * Spell 2067 — Lance (Feca / generic lance spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2067/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear). Detected because:
 *   - Has a `shoot` symbol (DefineSprite_10_shoot) that is placed at the target offset
 *     inside a container rotated toward the target.
 *   - DefineSprite_20 (the outer sprite wrapper) positions itself at _parent.cellTo,
 *     plays a sound on frame_1, fires this.end() (signalHit) on frame_7, and removes
 *     the parent on frame_121.
 *   - No `move` symbol (ballistic arc) — linear beam pattern.
 *   - DefineSprite_18 is a rotating particle spawned inside DefineSprite_20.
 *
 * Library symbols:
 *   - shoot (DefineSprite_10_shoot, 42 frames) — the main projectile visual.
 *       frame_1: resets _rotation to 0 (overrides harness-applied velocity rotation).
 *       frame_36: _parent.removeMovieClip() — kills the shoot container.
 *     The harness attaches this at the target offset inside the rotated root.
 *
 * Outer sprite (DefineSprite_20, 121 frames) is treated as a WorldAbsolute-style
 * companion that positions itself at cellTo. However, the overall spell type matches
 * ProjectileLinear (20) because the root is oriented toward the target and `shoot`
 * is the primary animated content. DefineSprite_20 acts as an auxiliary impact
 * clip attached from onSpellStart, sitting at the target cell in world coords.
 *
 * Wait — re-reading the AS more carefully:
 *   DefineSprite_20/frame_1/DoAction.as: SOMA.playSound("lance02")
 *   DefineSprite_20/frame_1/DoAction_2.as: _X = _parent.cellTo.x; _Y = _parent.cellTo.y
 *   DefineSprite_20/frame_7/DoAction.as: this.end() → signalHit
 *   DefineSprite_20/frame_121/DoAction.as: _parent.removeMovieClip() → complete
 *
 *   DefineSprite_18/frame_1/DoAction.as: rotating particle (v, _xscale, _yscale, onEnterFrame)
 *
 * The main timeline (frame_2/DoAction.as) just does stop().
 * The spell is driven entirely by DefineSprite_20, which is the outermost content sprite.
 * It positions itself at cellTo (target) and drives both hit signal and completion.
 * There's no ballistic arc; shoot is the visual. This matches TargetCell (11) or
 * WorldAbsolute (50/51) more than ProjectileLinear. But shoot resets _rotation=0
 * (canonical linear projectile behavior) and the harness for displayType=20 attaches
 * shoot at the target offset inside a rotated container.
 *
 * Final analysis: DefineSprite_20 IS the outer wrapper that the harness would treat
 * as the root timeline for TargetCell. The _parent.cellTo references mean it was
 * authored inside a WorldAbsolute context. Since it positions at cellTo via
 * _parent.cellTo (not via harness anchor), this is displayType=51 (WorldAbsoluteAlt)
 * with DefineSprite_20 as the main timeline child attached from onSpellStart.
 * The `shoot` symbol is a child of DefineSprite_20, not of the root.
 *
 * Revised layout:
 *   - displayType=51 (WorldAbsoluteAlt): root at (0,0); children position at world coords.
 *   - onSpellStart attaches sprite20 to root.
 *   - sprite20 frame_1: positions at cellTo, plays sound.
 *   - sprite20 frame_7: signalHit.
 *   - sprite20 frame_121: complete.
 *   - sprite20 internally spawns sprite18 particles (the rotating star/spark).
 *   - shoot (DefineSprite_10) is the 42-frame projectile visual, also child of sprite20.
 *
 * BUT: the manifest has shoot as an `animations[]` entry (not librarySymbols), meaning
 * it has pre-rendered frame textures under the bare "shoot" key. DefineSprite_10_shoot
 * must be registered as a symbol named "shoot" using textures.getFrames("shoot")
 * (no lib_ prefix, since it's in animations[], not librarySymbols[]).
 *
 * DefineSprite_18 has no manifest entry (not in animations[] or librarySymbols[]),
 * so it is a container-only symbol with frames: [].
 *
 * Main timeline: frame_2/DoAction.as → stop() — the root just stops at frame 2; the
 * spell is driven by DefineSprite_20's timeline.
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

// shoot bounds from manifest animations[]
const SHOOT_BOUNDS = {
  width: 205.65,
  height: 149.2,
  offsetX: -103.2,
  offsetY: -87.7,
};

export class Spell2067 extends RuntimeSpell {
  readonly spellId = 2067;
  readonly displayType = SpellDisplayType.WorldAbsoluteAlt;

  private sprite18Sym!: SymbolDefinition;
  private shootSym!: SymbolDefinition;
  private sprite20Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- DefineSprite_18 — rotating spark/particle ---------------
    // AS: DefineSprite_18/frame_1/DoAction.as
    //   v = 10 + random(15);
    //   _xscale = random(50) + 50;
    //   _yscale = random(50) + 50;
    //   this.onEnterFrame = function() { _rotation = _rotation + v; };
    // No manifest entry → container-only, frames: []
    this.sprite18Sym = {
      name: "sprite18",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_18/frame_1/DoAction.as
            const v = 10 + Math.floor(Math.random() * 15);
            clip.vars.v = v;
            clip.scaleX = (Math.floor(Math.random() * 50) + 50) / 100;
            clip.scaleY = (Math.floor(Math.random() * 50) + 50) / 100;
          },
        ],
      ]),
      onEnterFrame: (clip) => {
        // AS: this.onEnterFrame = function() { _rotation = _rotation + v; };
        const v = clip.vars.v as number;
        clip.rotation += (v * Math.PI) / 180;
      },
    };

    // ---- DefineSprite_10_shoot — 42-frame projectile visual ------
    // AS: DefineSprite_10_shoot/frame_1/DoAction.as → _rotation = 0
    // AS: DefineSprite_10_shoot/frame_36/DoAction.as → _parent.removeMovieClip(); stop()
    // shoot is in animations[] (not librarySymbols[]) → use textures.getFrames("shoot")
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
            // AS: DefineSprite_10_shoot/frame_1/DoAction.as
            // _rotation = 0 — reset any inherited rotation
            clip.rotation = 0;
          },
        ],
        [
          35,
          (clip) => {
            // AS: DefineSprite_10_shoot/frame_36/DoAction.as
            // _parent.removeMovieClip(); stop();
            // Removes the shoot clip from sprite20 (its parent).
            clip.parent?.remove();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- DefineSprite_20 — target-anchored impact timeline -------
    // 121 frames. No manifest entry for direct textures → container-only.
    // AS:
    //   frame_1/DoAction.as:   SOMA.playSound("lance02")
    //   frame_1/DoAction_2.as: _X = _parent.cellTo.x; _Y = _parent.cellTo.y
    //   frame_7/DoAction.as:   this.end() → signalHit
    //   frame_121/DoAction.as: _parent.removeMovieClip() → complete
    this.sprite20Sym = {
      name: "sprite20",
      totalFrames: 121,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_20/frame_1/DoAction.as — SOMA.playSound("lance02")
            // Sound is played from onSpellStart (main timeline), but DefineSprite_20
            // also plays it. We honour the canonical frame_1 sound here.
            // (onSpellStart will also call playSound; this is the in-clip instance.)
            // Note: callbacks are not directly available here; sound is handled in
            // onSpellStart per the canonical main-timeline sound pattern. The
            // DefineSprite_20/frame_1 sound fires at clip construction time which
            // coincides with onSpellStart in the first tick.

            // AS: DefineSprite_20/frame_1/DoAction_2.as
            // _X = _parent.cellTo.x; _Y = _parent.cellTo.y
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y;
            }

            // Attach shoot as a child of sprite20 at depth 1
            clip.attach(this.shootSym, "shoot", 1, ctx);

            // Attach rotating spark particle (sprite18) at depth 2
            clip.attach(this.sprite18Sym, "sprite18", 2, ctx);
          },
        ],
        [
          6,
          () => {
            // AS: DefineSprite_20/frame_7/DoAction.as → this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          120,
          (clip) => {
            // AS: DefineSprite_20/frame_121/DoAction.as → _parent.removeMovieClip()
            // _parent of sprite20 is root → complete the spell
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite18Sym);
    this.registry.register(this.shootSym);
    this.registry.register(this.sprite20Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: scripts/frame_2/DoAction.as → stop()
    // Main timeline stops at frame 2; the spell is driven by sprite20.
    // AS: DefineSprite_20/frame_1/DoAction.as → SOMA.playSound("lance02")
    callbacks.playSound("lance02");

    // Attach sprite20 as the primary content clip on root.
    // It will self-position at cellTo on its own frame_1 script.
    this.root.attach(this.sprite20Sym, "sprite20", 1, context);
  }
}
