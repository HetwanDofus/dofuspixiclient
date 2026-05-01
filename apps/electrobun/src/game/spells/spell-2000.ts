/**
 * Spell 2000 — Wabbit (WAB).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2000/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). The main timeline has 3 frames:
 *   - frame_1: plays "wab_2000a" sound; implicitly places sprite_13 at depth 1
 *     on frame 2 (via PlaceObject2_3_1).
 *   - frame_2: stop(); sprite_13 (the bouncing ball) is placed on the timeline
 *     with onClipEvent(load) + onClipEvent(enterFrame) handlers.
 *   - frame_3: (gotoAndStop target) — reached when t==66 in the enterFrame handler.
 *
 * Sprite_13 (DefineSprite_13) — the impact sprite at the target cell:
 *   - frame_1: plays "wab_2000b" sound; positions self at _parent.cellTo;
 *     calls this.end() → signalHit.
 *   - frame_40: stop(); _parent.removeMovieClip() → spell complete.
 *   This is a 42-frame animation sprite with authored SVG frames.
 *
 * PlaceObject2_3_1 (the bouncing ball clip on frame_2 of the main timeline):
 *   The clip is placed via PlaceObject2 with CLIPACTIONRECORD handlers.
 *   It references a sub-child "boule" (accessed as clip.children.get("boule")).
 *   Since the manifest has no librarySymbols entry for the ball or boule, we
 *   model the ball as a container-only symbol with full physics in onLoad/
 *   onEnterFrame, and "boule" as a plain container placeholder (sprite_13's
 *   scale properties are applied to the ball's own scaleX/scaleY).
 *
 *   onLoad: seeds x1/y1/x2/y2 from cellFrom/cellTo; initialises px/py; t=0; v=0.
 *   onEnterFrame: at t==21 set intermediate waypoint; t==42 approach target;
 *     t==63 land; t==66 _parent.gotoAndStop(3). Each tick: spring toward px/py,
 *     clamp speed to 6, update boule squash/stretch, update position, rotate
 *     toward velocity direction.
 *
 * The "boule" child referenced by the enterFrame handler controls squash/stretch.
 * Since there are no textures for it in the manifest, it is a frameless container
 * whose scaleX/scaleY are mutated to express the squash. We model it as a
 * zero-frame placeholder attached in the ball's onLoad.
 *
 * The main outer container sits at world (0,0) per WorldAbsolute. The ball
 * positions itself in absolute world coords via _parent.cellFrom / _parent.cellTo
 * (stored on root.vars by the harness).
 *
 * signalHit is fired from sprite_13 frame_1 (this.end() in canonical AS).
 * complete() is fired from sprite_13 frame_40 (_parent.removeMovieClip()).
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

const SPRITE_13_BOUNDS = {
  width: 76.85,
  height: 50.9,
  offsetX: -38.6,
  offsetY: -28.85,
};

export class Spell2000 extends RuntimeSpell {
  readonly spellId = 2000;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private sprite13Sym!: SymbolDefinition;
  private ballSym!: SymbolDefinition;
  private bouleSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite13Anchor = calculateAnchor(SPRITE_13_BOUNDS);

    // ---- bouleSym — squash/stretch child of the ball container ------
    // The "boule" child is referenced inside the enterFrame handler via
    // `boule._xscale` and `boule._yscale`. It has no authored textures;
    // it exists purely so the scaleX/scaleY mutations have a target clip.
    this.bouleSym = {
      name: "boule",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
    };

    // ---- ballSym — the bouncing Wabbit ball on the main timeline -----
    // Placed via PlaceObject2_3_1 on frame_2 of the main timeline.
    // AS scripts:
    //   scripts/frame_2/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(load).as
    //   scripts/frame_2/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // No authored textures in manifest — container-only with full physics.
    this.ballSym = {
      name: "ball",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,

      onLoad: (clip, ctx) => {
        // AS scripts/frame_2/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(load).as
        const root = clip.parent;
        const cellFrom = root?.vars.cellFrom as { x: number; y: number } | undefined;
        const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;

        const x1 = cellFrom?.x ?? 0;
        const y1 = cellFrom?.y ?? 0;
        const x2 = cellTo?.x ?? 0;
        const y2 = cellTo?.y ?? 0;

        clip.vars.x1 = x1;
        clip.vars.y1 = y1;
        clip.vars.x2 = x2;
        clip.vars.y2 = y2;
        clip.vars.px = x1;
        clip.vars.py = y1 - 120;
        clip.vars.t = 0;
        clip.vars.v = 0;

        // AS: _X = x1; _Y = y1 - 70;
        clip.x = x1;
        clip.y = y1 - 70;

        // AS: boule._yscale = 200; boule._xscale = 50;
        // Attach the boule child and set its initial squash state.
        const boule = clip.attach(this.bouleSym, "boule", 1, ctx);
        boule.scaleY = 200 / 100;
        boule.scaleX = 50 / 100;
      },

      onEnterFrame: (clip, _ctx) => {
        // AS scripts/frame_2/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let t = clip.vars.t as number;
        const x1 = clip.vars.x1 as number;
        const y1 = clip.vars.y1 as number;
        const x2 = clip.vars.x2 as number;
        const y2 = clip.vars.y2 as number;

        // AS: if (t++ == 21)  — post-increment: check THEN increment
        if (t === 21) {
          clip.vars.px =
            x1 + (x2 - x1) / 6 + (-0.5 + Math.random()) * 100;
          clip.vars.py =
            y1 + (y2 - y1) / 6 + (-0.5 + Math.random()) * 50 - 50;
        }
        t++;
        clip.vars.t = t;

        if (t === 42) {
          clip.vars.px = x2;
          clip.vars.py = y2 - 100;
        }
        if (t === 63) {
          clip.vars.px = x2;
          clip.vars.py = y2 + 50;
        }
        if (t === 66) {
          // AS: _parent.gotoAndStop(3);
          // The parent is the root (outer mc). Frame 3 in AS = index 2 (0-based).
          const root = clip.parent;
          if (root) {
            root.gotoAndStop(2);
          }
        }

        const px = clip.vars.px as number;
        const py = clip.vars.py as number;

        const vx = (-(clip.x - px)) / 9;
        const vy = (-(clip.y - py)) / 9;
        let v = Math.sqrt(vx * vx + vy * vy);

        // AS: _rotation = Math.atan2(vy, vx) * 57.29746936176985
        // 57.297... = 180/PI so this converts radians→degrees in AS.
        // In our runtime, rotation is in radians, so we just use atan2 directly.
        clip.rotation = Math.atan2(vy, vx);

        if (v > 6) {
          v = 6;
        }
        clip.vars.v = v;

        // AS: boule._xscale = 100 + 3 * v;  boule._yscale = 100 - 3 * v;
        const boule = clip.children.get("boule");
        if (boule) {
          boule.scaleX = (100 + 3 * v) / 100;
          boule.scaleY = (100 - 3 * v) / 100;
        }

        clip.x += vx;
        clip.y += vy;
      },
    };

    // ---- sprite_13 — impact animation at target cell ----------------
    // DefineSprite_13: 42-frame authored animation.
    //   frame_1 (index 0): plays "wab_2000b"; positions self at cellTo; signals hit.
    //   frame_40 (index 39): stop(); _parent.removeMovieClip() → complete.
    //
    // AS scripts:
    //   scripts/DefineSprite_13/frame_1/DoAction.as
    //   scripts/DefineSprite_13/frame_1/DoAction_2.as
    //   scripts/DefineSprite_13/frame_40/DoAction.as
    //
    // Note: DoAction.as and DoAction_2.as are two separate DoAction blocks on
    // the same frame — both run on frame_1 entry.
    this.sprite13Sym = {
      name: "sprite_13",
      totalFrames: 42,
      frames: textures.getFrames("sprite_13"),
      anchorX: sprite13Anchor.x,
      anchorY: sprite13Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, _ctx) => {
            // AS scripts/DefineSprite_13/frame_1/DoAction.as
            // SOMA.playSound("wab_2000b"); — captured via soundCallback
            this.soundCallback?.("wab_2000b");

            // AS scripts/DefineSprite_13/frame_1/DoAction_2.as
            // _X = _parent.cellTo.x;
            // _Y = _parent.cellTo.y;
            // this.end();
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y;
            }
            this.runtime.signalHit();
          },
        ],
        [
          39,
          (clip) => {
            // AS scripts/DefineSprite_13/frame_40/DoAction.as
            // stop(); _parent.removeMovieClip();
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.bouleSym);
    this.registry.register(this.ballSym);
    this.registry.register(this.sprite13Sym);
  }

  // Store so frame_1 of sprite_13 can call playSound (no callbacks ref there).
  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("wab_2000a");
    callbacks.playSound("wab_2000a");

    // Capture for use inside sprite_13's frame_1 script.
    this.soundCallback = callbacks.playSound;

    // The main timeline frame_2 places the ball clip (PlaceObject2_3_1)
    // and calls stop(). Since the root stops on frame_2, we attach the
    // ball now so it starts ticking. It positions itself in absolute
    // world coords via its onLoad handler.
    //
    // The main timeline frame_2 also implicitly places sprite_13 at
    // depth 1 via PlaceObject2. We attach it here so both run in parallel.
    this.root.attach(this.ballSym, "ball", 3, context);
    this.root.attach(this.sprite13Sym, "sprite_13", 1, context);

    // AS frame_2/DoAction.as: stop() — halt the root timeline.
    this.root.stop();
  }
}
