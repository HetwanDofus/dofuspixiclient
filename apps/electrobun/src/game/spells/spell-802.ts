/**
 * Spell 802 — Bouclier Féca (hexagonal panel shield).
 *
 * displayType=11 (TargetCell). Three-tier runtime composition matching
 * the canonical SWF tree:
 *
 *   root (anchored at target cell by spell-view)
 *   └─ anim1   (DefineSprite_10, 127 ticks, frame_127 → stop + complete)
 *      └─ sprite_9_clip   (placed once with anim1's PlaceObject2_9_1
 *                          matrix; CLIPACTIONRECORD adds 0.66°/tick;
 *                          frame scripts at 0/3/6/.../30 spawn sprite_7s
 *                          at staggered cocoon positions; frame_61 snaps
 *                          rotation to -40° and signalHit())
 *         └─ sprite_7_d2 .. sprite_7_d22   (one per cocoon cell — its
 *                          own 30-frame baked panel timeline, starting
 *                          at SWF `ratio` so each panel runs its alpha
 *                          shimmer phase-shifted by its placement order)
 *
 * Why this hierarchy and not the baked anim1 strip:
 *
 *   The SVG export rasterizes each frame in isolation — placements
 *   created at frame N don't carry forward to frame N+1, so anim1's
 *   strip looks like panels POPPING IN and disappearing instead of
 *   accumulating. Same applies to sprite_9. sprite_7 IS safe as a baked
 *   strip though: its single PlaceObject2_6_1 stays alive across all
 *   30 internal frames, so each frame shows the panel with the
 *   per-tick alpha the canonical sprite_6 onEnterFrame would have
 *   computed at that index. We use sprite_7 frames as the leaf visual
 *   and drive everything above it as dynamic clips.
 *
 * What this still approximates instead of matches:
 *
 *   - sprite_6's `_alpha = 30 + random(120)` is recorded as a fixed
 *     alpha per sprite_7 frame at extraction time. We get a
 *     deterministic shimmer cycle instead of stochastic, but the
 *     pacing and magnitude match.
 *   - The two ALSO-flickering sprite_6 child handlers (depth 1 and 3
 *     inside sprite_6) baked into the sprite_7 frame and aren't
 *     separable here — a single composite alpha cycle stands in for
 *     the sum of three.
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

const SPRITE7_BOUNDS = {
  width: 159.2,
  height: 155.5,
  offsetX: -61.85,
  offsetY: -71.85,
};

/**
 * sprite_7 placements inside sprite_9 — one PlaceObject2 per row,
 * captured from the manifest. `ratio` is the SWF placement frame used
 * (per Macromedia convention) as the initial playhead for each
 * sprite_7 instance, giving each panel its own shimmer phase.
 */
const SPRITE7_PLACEMENTS = [
  { frame: 0,  depth: 2,  x: -25.3, y: 26.9,  scaleX: -0.310760498046875, scaleY: 0.4036712646484375,  rotateSkew0: -0.0153350830078125, rotateSkew1: 0.2330474853515625,  ratio: 0  },
  { frame: 3,  depth: 4,  x: -30.8, y: 3.4,   scaleX: -0.3571929931640625, scaleY: 0.6367950439453125,  rotateSkew0: -0.230408,           rotateSkew1: 0,                   ratio: 3  },
  { frame: 6,  depth: 6,  x: 4.5,   y: 19.5,  scaleX: 0.6317291259765625,  scaleY: 0.6317291259765625,  rotateSkew0: 0,                   rotateSkew1: 0,                   ratio: 6  },
  { frame: 9,  depth: 8,  x: -12.8, y: -4.6,  scaleX: 0.433929443359375,   scaleY: 0.433929443359375,   rotateSkew0: -0.250518798828125,  rotateSkew1: 0.2505340576171875,  ratio: 9  },
  { frame: 12, depth: 10, x: -23.8, y: -24.1, scaleX: -0.310760498046875,  scaleY: -0.4036712646484375, rotateSkew0: 0.0153350830078125,  rotateSkew1: 0.2330474853515625,  ratio: 12 },
  { frame: 15, depth: 12, x: -0.3,  y: -24.1, scaleX: -0.306182861328125,  scaleY: -0.1602020263671875, rotateSkew0: -0.2773895263671875, rotateSkew1: 0.5978851318359375,  ratio: 15 },
  { frame: 18, depth: 14, x: -0.8,  y: -36.1, scaleX: -0.2305755615234375, scaleY: -0.120635986328125,  rotateSkew0: -0.2089080810546875, rotateSkew1: 0.450225830078125,   ratio: 18 },
  { frame: 21, depth: 16, x: 12.7,  y: -3.6,  scaleX: 0.433929443359375,   scaleY: 0.433929443359375,   rotateSkew0: -0.250518798828125,  rotateSkew1: 0.2505340576171875,  ratio: 21 },
  { frame: 24, depth: 18, x: 25.2,  y: -21.6, scaleX: 0.0656280517578125,  scaleY: 0.32958984375,       rotateSkew0: -0.30413818359375,   rotateSkew1: 0.32958984375,       ratio: 24 },
  { frame: 27, depth: 20, x: 31.2,  y: 7.9,   scaleX: 0.348785400390625,   scaleY: 0.6218109130859375,  rotateSkew0: -0.2249908447265625, rotateSkew1: 0,                   ratio: 27 },
  { frame: 30, depth: 22, x: 23.7,  y: 26.9,  scaleX: 0.0656280517578125,  scaleY: -0.32958984375,      rotateSkew0: 0.30413818359375,    rotateSkew1: 0.32958984375,       ratio: 30 },
] as const;

/** anim1's PlaceObject2_9_1 matrix — the outer placement of sprite_9 inside DefineSprite_10. */
const SPRITE9_OUTER = {
  scaleX: 0.79339599609375,
  scaleY: 0.79339599609375,
  rotateSkew0: -0.606109619140625,
  rotateSkew1: 0.606109619140625,
  tx: 2.3,
  ty: -34.9,
} as const;

/** Decompose a SWF 2x2 matrix `[a,b,c,d]` into Pixi (rotation, scaleX, scaleY) with reflection. */
function decomposeMatrix(a: number, b: number, c: number, d: number): {
  rotation: number;
  scaleX: number;
  scaleY: number;
} {
  const rotation = Math.atan2(c, a);
  const scaleXAbs = Math.sqrt(a * a + c * c);
  const scaleYAbs = Math.sqrt(b * b + d * d);
  const det = a * d - b * c;
  return {
    rotation,
    scaleX: scaleXAbs * (a < 0 || (a === 0 && c < 0) ? -1 : 1),
    scaleY: scaleYAbs * (det < 0 ? -1 : 1),
  };
}

export class Spell802 extends RuntimeSpell {
  readonly spellId = 802;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite7Sym!: SymbolDefinition;
  private sprite9Sym!: SymbolDefinition;
  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite7Anchor = calculateAnchor(SPRITE7_BOUNDS);
    const sprite7Frames = textures.getFrames("sprite_7");
    const anim1Frames = textures.getFrames("anim1");
    const sprite9Frames = textures.getFrames("sprite_9");
    // eslint-disable-next-line no-console
    console.log(
      `[Spell802] frames loaded: anim1=${anim1Frames.length}, sprite_7=${sprite7Frames.length}, sprite_9=${sprite9Frames.length}, sprite7Anchor=(${sprite7Anchor.x.toFixed(3)},${sprite7Anchor.y.toFixed(3)})`,
    );

    // ---- sprite_7 — leaf visual: a single baked panel ----
    // 30 frames; sprite_7's body has one PlaceObject2_6_1 (sprite_6)
    // that stays placed across all internal frames. The exporter
    // baked sprite_6's per-tick `_alpha` randomization into a
    // deterministic alpha cycle across these 30 frames, so simply
    // playing the strip recreates the panel shimmer.
    this.sprite7Sym = {
      name: "sprite_7",
      totalFrames: sprite7Frames.length || 30,
      frames: sprite7Frames,
      anchorX: sprite7Anchor.x,
      anchorY: sprite7Anchor.y,
    };

    // ---- sprite_9 — rotation container + placement scheduler ----
    // No own frames (frames=[] → no Sprite, just a transform Container).
    // 63-frame internal timeline that schedules the 11 sprite_7
    // placements at frames 0,3,6,…,30, then carries the rotation
    // accumulator + the frame_61 snap.
    const sprite9FrameScripts = new Map<
      number,
      (clip: import("@dofus/spell-runtime").SpellClip, ctx: SpellContext) => void
    >();

    for (const p of SPRITE7_PLACEMENTS) {
      const placement = p;
      sprite9FrameScripts.set(placement.frame, (clip, ctx) => {
        const inst = clip.attach(
          this.sprite7Sym,
          `sprite7_d${placement.depth}`,
          placement.depth,
          ctx,
        );
        inst.x = placement.x;
        inst.y = placement.y;
        const dec = decomposeMatrix(
          placement.scaleX,
          placement.rotateSkew0,
          placement.rotateSkew1,
          placement.scaleY,
        );
        inst.rotation = dec.rotation;
        inst.scaleX = dec.scaleX;
        inst.scaleY = dec.scaleY;
        // Macromedia convention: ratio == placement frame index, used
        // as initial playhead so each panel's shimmer is phase-shifted
        // by its place-in-line.
        inst.gotoAndPlay(placement.ratio % (sprite7Frames.length || 30));
      });
    }

    // AS DefineSprite_9/frame_61/DoAction.as: _rotation = -40
    sprite9FrameScripts.set(60, (clip) => {
      clip.rotation = (-40 * Math.PI) / 180;
      // signalHit is idempotent — fires once per spell regardless of
      // sprite_9 wraps.
      this.runtime.signalHit();
    });

    this.sprite9Sym = {
      name: "sprite_9",
      totalFrames: 63,
      frames: [],
      // CLIPACTIONRECORD onClipEvent(enterFrame) on PlaceObject2_9_1:
      //   _rotation += 0.66
      onEnterFrame: (clip) => {
        clip.rotation += (0.66 * Math.PI) / 180;
      },
      frameScripts: sprite9FrameScripts,
    };

    // ---- anim1 — outer timeline (no visual of its own) ----
    // Just a 127-tick container that places sprite_9 at frame 0 with
    // the canonical PlaceObject2_9_1 transform and fires the
    // stop+complete at frame_127 (0-idx 126).
    this.anim1Sym = {
      name: "anim1_runtime",
      totalFrames: 127,
      frames: [],
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            const s9 = clip.attach(this.sprite9Sym, "sprite9_child", 1, ctx, {
              x: SPRITE9_OUTER.tx,
              y: SPRITE9_OUTER.ty,
            });
            const dec = decomposeMatrix(
              SPRITE9_OUTER.scaleX,
              SPRITE9_OUTER.rotateSkew0,
              SPRITE9_OUTER.rotateSkew1,
              SPRITE9_OUTER.scaleY,
            );
            s9.rotation = dec.rotation;
            s9.scaleX = dec.scaleX;
            s9.scaleY = dec.scaleY;
          },
        ],
        [
          126,
          (clip) => {
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite7Sym);
    this.registry.register(this.sprite9Sym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    callbacks.playSound("vlad_802");
    this.root.attach(this.anim1Sym, "anim1", 1, _context);
  }
}
