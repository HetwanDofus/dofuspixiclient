/**
 * Spell 515 — (Sacrieur / Roublard rock-fall type spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/515/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no `move` or `shoot` projectile
 * symbol with a harness-driven arc, no `duplicate` for a beam, and no
 * dual-anchor worldAbsolute pattern. The single `shoot` symbol is
 * positioned at the target cell (its frame_4 script sets
 * `_X = _parent.cellFrom.x; _Y = _parent.cellFrom.y`, but that is
 * the initial splash-back position which is still relative to the
 * target anchor). The spell is a single 150-frame impact composite at
 * the target cell — TargetCell is correct.
 *
 * Library symbols (from AS):
 *   - `shoot` (DefineSprite_55_shoot, 150 frames): the main impact
 *     timeline. Lives in `animations[]` (no `librarySymbols[]` entry).
 *     frame_4:  SOMA.playSound("many_501"); positions self at cellFrom
 *     frame_61: this.end() → signalHit
 *     frame_109: SOMA.playSound("many_502")
 *     frame_148: _parent.removeMovieClip(); stop() → complete
 *
 *   - `pierres` (DefineSprite_3_pierres): a rock-particle wrapper. It
 *     has a PlaceObject2 child (inner sprite) with onClipEvent(load) +
 *     onClipEvent(enterFrame) driving per-particle bouncing physics.
 *     The `shoot` timeline attaches multiple `pierres` instances.
 *     No `librarySymbols[]` entry — textures under bare "pierres" key
 *     (but it's a container; frames may be empty). The inner dynamic
 *     child is DefineSprite_41.
 *
 *   - DefineSprite_41 (the inner particle inside `pierres`): its
 *     frame_1/DoAction.as defines `vr`, `va` and an `onEnterFrame`
 *     that fades alpha and rotates. Since this sprite is placed by
 *     the pierres wrapper's authored timeline via PlaceObject2 with
 *     CLIPACTIONRECORD handlers, we model it as a SymbolDefinition
 *     named "pierresInner" with onLoad + onEnterFrame.
 *
 *   - DefineSprite_23 (58-frame sub-sprite within shoot): frame_58
 *     just calls stop(). It is an authored sub-animation of shoot
 *     that terminates at frame 58. We register it but it has no
 *     dynamic behavior beyond stopping.
 *
 * Main timeline (frame_2/DoAction.as): stop(). No sound at root level.
 * Sounds are emitted from inside the `shoot` frameScripts.
 *
 * Because the `shoot` symbol is in `animations[]` (not `librarySymbols[]`),
 * we use textures.getFrames("shoot") (no lib_ prefix) for its frames.
 * The `pierres` and inner sprites are container-only; frames: [].
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

// shoot is in animations[] — bounds from manifest animations[0]
const SHOOT_BOUNDS = {
  width: 119.9,
  height: 116.7,
  offsetX: -72.15,
  offsetY: -81.35,
};

export class Spell515 extends RuntimeSpell {
  readonly spellId = 515;
  readonly displayType = SpellDisplayType.TargetCell;

  // Cached symbol refs for cross-symbol attaches
  private pierresInnerSym!: SymbolDefinition;
  private pierresSym!: SymbolDefinition;
  private shootSym!: SymbolDefinition;

  // Sound callback captured in onSpellStart for use inside frameScripts
  private _playSound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- DefineSprite_41 — inner rock particle (child of pierres) ----
    // AS: scripts/DefineSprite_41/frame_1/DoAction.as
    //   vr = 5 * Math.random();
    //   va = 1 + 2.5 * Math.random();
    //   this.onEnterFrame = function() {
    //     _alpha -= va;
    //     _rotation += (vr *= 0.9);
    //   };
    //
    // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
    //   var vx = 5 * (Math.random() - 0.5);
    //   var vy = 2 * (Math.random() - 0.5);
    //   _parent._x = 20 * (Math.random() - 0.5);
    //   _parent._y = 10 * (Math.random() - 0.5);
    //   var t = 60 + 40 * Math.random();
    //   _xscale = t; _yscale = t;
    //   _alpha = 20 + random(90);
    //   var v = -15 * Math.random() - 5;
    //   var vr = 140 * (-0.5 + Math.random());
    //
    // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _parent._x += vx;
    //   _parent._y += vy;
    //   if (t != 1) {
    //     _Y += v;
    //     _rotation += vr;
    //     v += 1.5;
    //     if (_Y > 0) {
    //       vx /= 2; vy /= 2;
    //       _rotation = 0; _Y = 0;
    //       v = (-v) / 4;
    //       if (Math.abs(v) < 1) { vx = 0; vy = 0; t = 1; }
    //     }
    //   }
    //
    // The onClipEvent(load/enterFrame) scripts in DefineSprite_3_pierres are
    // attached to the PlaceObject2 child (the inner sprite = DefineSprite_41).
    // In that context: `this` refers to the inner sprite, `_parent` is the
    // pierres wrapper. So:
    //   - vx/vy/v/vr/t belong to the INNER clip's vars (they are var-locals in
    //     onClipEvent scope, but captured across the enterFrame closure).
    //   - `_parent._x += vx` mutates the pierres wrapper's position.
    //   - `_Y` / `_rotation` / `_xscale` / `_yscale` / `_alpha` are on the
    //     inner clip itself.
    //   - DefineSprite_41/frame_1/DoAction.as also defines vr and va plus an
    //     onEnterFrame — but the CLIPACTIONRECORD enterFrame is what's actually
    //     wired at placement. We consolidate both into one onLoad/onEnterFrame.
    this.pierresInnerSym = {
      name: "pierresInner",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,

      onLoad: (clip) => {
        // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
        const vx = 5 * (Math.random() - 0.5);
        const vy = 2 * (Math.random() - 0.5);

        // Position the parent (pierres wrapper) randomly around origin
        if (clip.parent) {
          clip.parent.x = 20 * (Math.random() - 0.5);
          clip.parent.y = 10 * (Math.random() - 0.5);
        }

        const t = 60 + 40 * Math.random();
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (20 + Math.floor(Math.random() * 90)) / 100;

        const v = -15 * Math.random() - 5;
        const vr = 140 * (-0.5 + Math.random());

        clip.vars.vx = vx;
        clip.vars.vy = vy;
        clip.vars.v = v;
        clip.vars.vr = vr;
        // t == 1 means "settled". Start as 0 (not settled).
        clip.vars.t = 0;

        // Also apply DefineSprite_41/frame_1/DoAction.as vars
        // (vr is already set above from the clipEvent; va for fade)
        clip.vars.va = 1 + 2.5 * Math.random();
      },

      onEnterFrame: (clip) => {
        // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        let v = clip.vars.v as number;
        let vr = clip.vars.vr as number;
        const t = clip.vars.t as number;
        const va = clip.vars.va as number;

        // _parent._x += vx; _parent._y += vy
        if (clip.parent) {
          clip.parent.x += vx;
          clip.parent.y += vy;
        }

        if (t !== 1) {
          clip.y += v;
          // AS: _rotation += vr (degrees) → radians delta
          clip.rotation += (vr * Math.PI) / 180;
          v += 1.5;

          if (clip.y > 0) {
            vx /= 2;
            vy /= 2;
            clip.rotation = 0;
            clip.y = 0;
            v = (-v) / 4;

            if (Math.abs(v) < 1) {
              vx = 0;
              vy = 0;
              clip.vars.t = 1;
            }
          }
        }

        // DefineSprite_41 fade from its own onEnterFrame:
        //   _alpha -= va; _rotation += (vr *= 0.9)
        // (Only applies when t !== 1 — rock is still "bouncing/falling")
        if (t !== 1) {
          const newAlpha = clip.alpha - va / 100;
          clip.alpha = newAlpha < 0 ? 0 : newAlpha;
          vr *= 0.9;
        }

        clip.vars.vx = vx;
        clip.vars.vy = vy;
        clip.vars.v = v;
        clip.vars.vr = vr;
      },
    };

    // ---- DefineSprite_3_pierres — rock wrapper (container) ----
    // This is a thin wrapper that hosts the inner particle via a
    // PlaceObject2 at frame_1. It is a container-only symbol; its
    // own rendered content is empty. The frame_1 script attaches
    // the dynamic inner child.
    this.pierresSym = {
      name: "pierres",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,

      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: PlaceObject2_2_1 at frame_1 of DefineSprite_3_pierres
            // Places the inner particle child (DefineSprite_41) at depth 1.
            clip.attach(this.pierresInnerSym, "inner", 1, ctx);
          },
        ],
      ]),
    };

    // ---- DefineSprite_55_shoot — 150-frame main impact composite ----
    // AS: scripts/DefineSprite_55_shoot/frame_4/DoAction.as      → playSound("many_501")
    // AS: scripts/DefineSprite_55_shoot/frame_4/DoAction_2.as    → position self at cellFrom
    // AS: scripts/DefineSprite_55_shoot/frame_61/DoAction.as     → this.end() → signalHit
    // AS: scripts/DefineSprite_55_shoot/frame_109/DoAction.as    → playSound("many_502")
    // AS: scripts/DefineSprite_55_shoot/frame_148/DoAction.as    → _parent.removeMovieClip(); stop()
    //
    // shoot is in animations[] (not librarySymbols[]), so use bare "shoot" key.
    this.shootSym = {
      name: "shoot",
      totalFrames: 150,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,

      frameScripts: new Map([
        [
          3,
          (clip) => {
            // AS: DefineSprite_55_shoot/frame_4/DoAction.as
            // SOMA.playSound("many_501");
            this._playSound?.("many_501");

            // AS: DefineSprite_55_shoot/frame_4/DoAction_2.as
            // _X = _parent.cellFrom.x;
            // _Y = _parent.cellFrom.y;
            // For displayType=11 (TargetCell), the container is anchored
            // at cellTo in world space. cellFrom in container-local coords
            // is cellFrom - cellTo (the anchor). We read from root.vars.
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            if (cellFrom && cellTo) {
              clip.x = cellFrom.x - cellTo.x;
              clip.y = cellFrom.y - cellTo.y;
            }
          },
        ],
        [
          60,
          () => {
            // AS: DefineSprite_55_shoot/frame_61/DoAction.as
            // this.end() → damage popup / hit signal
            this.runtime.signalHit();
          },
        ],
        [
          108,
          () => {
            // AS: DefineSprite_55_shoot/frame_109/DoAction.as
            // SOMA.playSound("many_502");
            this._playSound?.("many_502");
          },
        ],
        [
          147,
          (clip) => {
            // AS: DefineSprite_55_shoot/frame_148/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.pierresInnerSym);
    this.registry.register(this.pierresSym);
    this.registry.register(this.shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for use inside frameScripts
    this._playSound = callbacks.playSound;

    // AS: frame_2/DoAction.as → stop()
    // Main timeline just stops. No root-level sound.
    // Attach the shoot symbol at the root (displayType=11, anchored at target).
    this.root.attach(this.shootSym, "shoot", 1, context);
  }
}
