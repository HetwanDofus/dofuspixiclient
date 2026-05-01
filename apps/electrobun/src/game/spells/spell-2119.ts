/**
 * Spell 2119 — Unknown impact spell.
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2119/scripts/scripts/
 *
 * displayType=11 (TargetCell). DefineSprite_14/frame_1/DoAction.as sets
 * `_X = _parent.cellTo.x; _Y = _parent.cellTo.y; _rotation = 0;` — the
 * canonical self-placement pattern for a target-cell impact sprite.
 *
 * Library symbols:
 *   - sprite3 (characterId=3, directlyDynamic=true) — a rotating ellipse/ring
 *     particle. onEnterFrame: `_rotation += 23.3` degrees per frame.
 *     Placed by sprite_14 at depths 1 and 4 on frame 0, with a long authored
 *     tween over ~135 frames (fade-in 0-23, hold 24-83, white-flash 84-90,
 *     fade-out 106-132).
 *
 *   - sprite_14 — 144-frame outer container (the main impact animation).
 *     frame_1  (index 0):   position at cellTo, reset rotation, attach sprite3 ×2.
 *     frame_85 (index 84):  this.end() → signalHit.
 *     frame_136 (index 135): _parent.removeMovieClip(); stop() → complete.
 *
 * Main timeline (frame_2/DoAction.as): stop() — no sound.
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

const SPRITE3_BOUNDS = {
  width: 300,
  height: 305.95,
  offsetX: -147.8,
  offsetY: -153.25,
};

const SPRITE14_BOUNDS = {
  width: 186.7,
  height: 220.2,
  offsetX: -92.65,
  offsetY: -173.7,
};

export class Spell2119 extends RuntimeSpell {
  readonly spellId = 2119;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite14Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite3Anchor = calculateAnchor(SPRITE3_BOUNDS);
    const sprite14Anchor = calculateAnchor(SPRITE14_BOUNDS);

    // ---- sprite3 — rotating ring particle ----------------------------------------
    // AS: scripts/DefineSprite_3/frame_1/PlaceObject2_2_1/
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation = _rotation + 23.3;
    const sprite3Sym: SymbolDefinition = {
      name: "sprite3",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite3"),
      anchorX: sprite3Anchor.x,
      anchorY: sprite3Anchor.y,
      onEnterFrame: (clip) => {
        // AS: _rotation = _rotation + 23.3  (degrees → radians delta)
        clip.rotation += (23.3 * Math.PI) / 180;
      },
    };

    // ---- sprite_14 — 144-frame outer container -----------------------------------
    // Build frameScripts programmatically to avoid duplicate-key issues.

    // Combined tween table for frames 1-22.
    // Columns: [frameIdx, d1Alpha(0-256|null), d1ScaleX, d1ScaleY, d1X,
    //           d4Alpha(0-256|null), d4ScaleX, d4ScaleY, d4Y]
    type TweenRow = [
      number,
      number | null, number, number, number,
      number | null, number, number, number,
    ];
    const fadeInTween: TweenRow[] = [
      [ 1,   4, 0.5288, 0.2644, -1.60,  21, 0.5952, 0.2976, -126.55],
      [ 2,   8, 0.5149, 0.2575, -1.50,  41, 0.5757, 0.2879, -126.55],
      [ 3,  12, 0.5017, 0.2509, -1.40,  60, 0.5571, 0.2786, -126.55],
      [ 4,  16, 0.4891, 0.2445, -1.40,  78, 0.5393, 0.2697, -126.55],
      [ 5,  19, 0.4771, 0.2385, -1.35,  96, 0.5224, 0.2612, -126.55],
      [ 6,  22, 0.4657, 0.2328, -1.30, 112, 0.5064, 0.2532, -126.55],
      [ 7,  25, 0.4549, 0.2275, -1.25, 128, 0.4912, 0.2456, -126.60],
      [ 8,  28, 0.4447, 0.2224, -1.20, 142, 0.4769, 0.2385, -126.55],
      [ 9,  31, 0.4352, 0.2176, -1.10, 156, 0.4635, 0.2318, -126.60],
      [10,  34, 0.4263, 0.2132, -1.10, 169, 0.4509, 0.2255, -126.55],
      [11,  36, 0.4180, 0.2090, -1.05, 181, 0.4392, 0.2196, -126.55],
      [12,  38, 0.4103, 0.2051, -1.00, 192, 0.4284, 0.2142, -126.55],
      [13,  40, 0.4032, 0.2016, -0.95, 202, 0.4184, 0.2092, -126.55],
      [14,  42, 0.3967, 0.1984, -0.95, 212, 0.4093, 0.2047, -126.55],
      [15,  44, 0.3909, 0.1955, -0.90, 220, 0.4011, 0.2005, -126.55],
      [16,  45, 0.3857, 0.1928, -0.85, 228, 0.3937, 0.1969, -126.55],
      [17,  47, 0.3810, 0.1905, -0.85, 234, 0.3872, 0.1936, -126.55],
      [18,  48, 0.3770, 0.1885, -0.85, 240, 0.3816, 0.1908, -126.55],
      [19,  49, 0.3736, 0.1868, -0.85, 245, 0.3768, 0.1884, -126.55],
      [20,  50, 0.3709, 0.1854, -0.80, 249, 0.3729, 0.1864, -126.55],
      [21,  null, 0.3687, 0.1844, -0.80, 252, 0.3699, 0.1849, -126.55],
      [22,  51, 0.3672, 0.1836, -0.80, 254, 0.3677, 0.1839, -126.55],
    ];

    // Depth-1 scale-only tween frames 23-54 (no further alpha changes for d1).
    // Depth-4 reaches alphaMult=256 at frame 23 and holds through frame 83.
    type D1Row = [number, number | null, number, number, number];
    const d1ScaleTween: D1Row[] = [
      [23,  null, 0.3663, 0.1831, -0.80],
      [24,  null, 0.3660, 0.1830, -0.80],
      [25,  null, 0.3609, 0.1805, -0.80],
      [26,  null, 0.3561, 0.1781, -0.80],
      [27,  null, 0.3514, 0.1757, -0.75],
      [28,  null, 0.3469, 0.1735, -0.75],
      [29,  null, 0.3426, 0.1713, -0.75],
      [30,  null, 0.3384, 0.1692, -0.75],
      [31,  null, 0.3344, 0.1672, -0.75],
      [32,  null, 0.3306, 0.1653, -0.70],
      [33,  null, 0.3270, 0.1635, -0.70],
      [34,  null, 0.3235, 0.1617, -0.70],
      [35,  null, 0.3201, 0.1601, -0.70],
      [36,  null, 0.3170, 0.1585, -0.70],
      [37,  null, 0.3140, 0.1570, -0.70],
      [38,  null, 0.3112, 0.1556, -0.70],
      [39,  null, 0.3086, 0.1543, -0.65],
      [40,  null, 0.3061, 0.1531, -0.70],
      [41,  null, 0.3038, 0.1519, -0.70],
      [42,  null, 0.3017, 0.1509, -0.65],
      [43,  null, 0.2998, 0.1499, -0.65],
      [44,  null, 0.2980, 0.1490, -0.65],
      [45,  null, 0.2964, 0.1482, -0.65],
      [46,  null, 0.2949, 0.1475, -0.65],
      [47,  null, 0.2936, 0.1468, -0.65],
      [48,  null, 0.2925, 0.1463, -0.65],
      [49,  null, 0.2916, 0.1458, -0.65],
      [50,  null, 0.2908, 0.1454, -0.65],
      [51,  null, 0.2902, 0.1451, -0.65],
      [52,  null, 0.2898, 0.1449, -0.65],
      [53,  null, 0.2896, 0.1448, -0.65],
      [54,  null, 0.2895, 0.1447, -0.65],
    ];

    // Depth-4 fade-out tween frames 106-132.
    // alphaMult goes from 247 → 0; scaleX/Y also shrinks.
    type D4FadeRow = [number, number, number, number];
    const d4FadeOut: D4FadeRow[] = [
      [105, 247, 0.2858, 0.1429],
      [106, 237, 0.2821, 0.1410],
      [107, 228, 0.2783, 0.1392],
      [108, 218, 0.2746, 0.1373],
      [109, 209, 0.2709, 0.1355],
      [110, 199, 0.2672, 0.1336],
      [111, 190, 0.2635, 0.1318],
      [112, 180, 0.2598, 0.1299],
      [113, 171, 0.2561, 0.1281],
      [114, 161, 0.2524, 0.1262],
      [115, 152, 0.2487, 0.1243],
      [116, 142, 0.2449, 0.1225],
      [117, 133, 0.2412, 0.1206],
      [118, 123, 0.2375, 0.1188],
      [119, 114, 0.2338, 0.1169],
      [120, 104, 0.2301, 0.1151],
      [121,  95, 0.2264, 0.1132],
      [122,  85, 0.2227, 0.1113],
      [123,  76, 0.2190, 0.1095],
      [124,  66, 0.2153, 0.1076],
      [125,  57, 0.2115, 0.1058],
      [126,  47, 0.2078, 0.1039],
      [127,  38, 0.2041, 0.1021],
      [128,  28, 0.2004, 0.1002],
      [129,  19, 0.1967, 0.0983],
      [130,   9, 0.1930, 0.0965],
      [131,   0, 0.1893, 0.0946],
    ];

    const fs = new Map<number, (clip: ReturnType<typeof Object.create>, ctx: SpellContext) => void>();

    // frame 0 — position sprite_14 + attach both sprite3 instances
    // AS: DefineSprite_14/frame_1/DoAction.as
    //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y; _rotation = 0;
    // Plus PlaceObject2 "place" at depth 1 and depth 4 (frame 0).
    fs.set(0, (clip, ctx) => {
      clip.x = 0;
      clip.y = 0;
      clip.rotation = 0;

      // depth 1: shadow ellipse — scaleX=0.5432, scaleY=0.2716, translateX=-1.65, translateY=0.45, alpha=0
      const d1 = clip.attach(sprite3Sym, "sprite3_d1", 1, ctx, { x: -1.65, y: 0.45 });
      if (d1) {
        d1.scaleX = 0.5432;
        d1.scaleY = 0.2716;
        d1.alpha = 0;
      }

      // depth 4: upper glow ring — scaleX=0.6156, scaleY=0.3078, translateX=-1.65, translateY=-126.55, alpha=0
      const d4 = clip.attach(sprite3Sym, "sprite3_d4", 4, ctx, { x: -1.65, y: -126.55 });
      if (d4) {
        d4.scaleX = 0.6156;
        d4.scaleY = 0.3078;
        d4.alpha = 0;
      }
    });

    // frames 1-22 — combined d1 + d4 fade-in tween
    // AS: PlaceObject2 "move" entries (depth 1 and depth 4) inside sprite_14.
    for (const [fi, d1Alpha, d1Sx, d1Sy, d1X, d4Alpha, d4Sx, d4Sy, d4Y] of fadeInTween) {
      fs.set(fi, (clip) => {
        const d1 = clip.children.get("sprite3_d1");
        if (d1) {
          if (d1Alpha !== null) {
            d1.alpha = d1Alpha / 256;
          }
          d1.scaleX = d1Sx;
          d1.scaleY = d1Sy;
          d1.x = d1X;
          d1.y = 0.45;
        }
        const d4 = clip.children.get("sprite3_d4");
        if (d4) {
          if (d4Alpha !== null) {
            d4.alpha = d4Alpha / 256;
          }
          d4.scaleX = d4Sx;
          d4.scaleY = d4Sy;
          d4.y = d4Y;
        }
      });
    }

    // frame 23 — d4 reaches full opacity (alphaMult=256); d1 scale-only
    // AS: PlaceObject2 "move" depth 1 (no colorTransform) + depth 4 alphaMult=256
    fs.set(23, (clip) => {
      const d1 = clip.children.get("sprite3_d1");
      if (d1) {
        d1.scaleX = 0.3663;
        d1.scaleY = 0.1831;
        d1.x = -0.8;
      }
      const d4 = clip.children.get("sprite3_d4");
      if (d4) {
        d4.alpha = 1;
        d4.scaleX = 0.3664;
        d4.scaleY = 0.1832;
        d4.y = -126.55;
      }
    });

    // frames 24-54 — d1 scale-only tween (d4 held fully opaque, no further placements until 84)
    // AS: PlaceObject2 "move" entries for depth 1 only.
    for (const [fi, , d1Sx, d1Sy, d1X] of d1ScaleTween) {
      if (fi <= 23) {
        continue;
      }
      fs.set(fi, (clip) => {
        const d1 = clip.children.get("sprite3_d1");
        if (d1) {
          d1.scaleX = d1Sx;
          d1.scaleY = d1Sy;
          d1.x = d1X;
        }
      });
    }

    // frame 84 — depth-4 white flash (colorTransform: all-white additive)
    // AND signalHit (this.end() in canonical AS DefineSprite_14/frame_85/DoAction.as)
    // AS: DefineSprite_14/frame_85/DoAction.as: this.end();
    // AS: placements[] depth 4 frame 84: colorTransform {redAdd:255,greenAdd:255,blueAdd:255,alphaMult:256}
    // The runtime has no full colorTransform API; we represent the flash visually
    // by noting it resolves back to normal at frame 90 (identity colorTransform).
    fs.set(84, (clip) => {
      // AS: DefineSprite_14/frame_85/DoAction.as — this.end() signals hit.
      this.runtime.signalHit();
      // The white-flash colorTransform at depth 4 cannot be fully reproduced
      // without a colorTransform API, but the clip continues playing normally.
      // frame 90 restores identity; no alpha mutation needed here.
    });

    // frame 89 — depth-4 color restored to identity
    // AS: placements[] depth 4 frame 90: colorTransform {identity}
    fs.set(89, (_clip) => {
      // colorTransform restored to identity — no alpha change needed
      // (alpha was already 1.0 during the flash period).
    });

    // frames 105-131 — depth-4 fade-out tween
    // AS: PlaceObject2 "move" entries for depth 4 (alphaMult + scale decay).
    for (const [fi, d4Alpha, d4Sx, d4Sy] of d4FadeOut) {
      fs.set(fi, (clip) => {
        const d4 = clip.children.get("sprite3_d4");
        if (d4) {
          d4.alpha = d4Alpha / 256;
          d4.scaleX = d4Sx;
          d4.scaleY = d4Sy;
        }
      });
    }

    // frame 135 — _parent.removeMovieClip(); stop()
    // AS: DefineSprite_14/frame_136/DoAction.as
    fs.set(135, (clip) => {
      clip.remove();
      this.runtime.complete();
    });

    this.sprite14Sym = {
      name: "sprite_14",
      totalFrames: 144,
      frames: textures.getFrames("sprite_14"),
      anchorX: sprite14Anchor.x,
      anchorY: sprite14Anchor.y,
      frameScripts: fs,
    };

    this.registry.register(sprite3Sym);
    this.registry.register(this.sprite14Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Main timeline frame_2/DoAction.as: stop() — no sound.
    // Attach sprite_14 as the sole child of root so it begins ticking.
    this.root.attach(this.sprite14Sym, "sprite14", 1, context);
  }
}
