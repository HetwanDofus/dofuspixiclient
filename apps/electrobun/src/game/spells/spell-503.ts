/**
 * Spell 503 — Many (Osamodas multi-target impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/503/scripts/scripts/
 *
 * displayType=11 (TargetCell). Single composite impact at target cell, no
 * projectile, no caster reference. The outer DefineSprite_15 plays 220 frames
 * and calls `_parent.removeMovieClip(); stop();` → complete().
 *
 * Library symbols (both directlyDynamic: true):
 *
 *   - sprite5 (DefineSprite_5, characterId=5) — single-frame rotating glyph.
 *     onEnterFrame: `_rotation += 3.3` deg/tick (continuous spin).
 *     Placed inside sprite12 at 4 depths (1, 12, 23, 34) with different
 *     initial transforms/alpha values. Attached from sprite12's frameScripts[0].
 *
 *   - sprite12 (DefineSprite_12, characterId=12) — ring/circle composite.
 *     Two placements in DefineSprite_15 at different depths:
 *       depth 45 (PlaceObject2_8_45): onLoad seeds `i=0`;
 *         onEnterFrame: `if (i++ % 8 == 1) { _rotation -= 13.4; }`
 *       depth 49 (PlaceObject2_11_49): onEnterFrame: `_rotation += 1;`
 *     Registered as a single SymbolDefinition "sprite12"; behavior is
 *     selected at attach time via `clip.vars.behavior` flag set in
 *     the parent's frameScripts before the clip's first onLoad fires.
 *     Driven through a 97-keyframe tween (frames 3–216) in the outer container.
 *
 * Main timeline: SOMA.playSound("many_503"); — that's all.
 * The outer container (anim1 / DefineSprite_15) is attached from onSpellStart.
 *
 * signalHit: fired at frame index 3 (first frame where sprite12 appears).
 * complete(): fired at frame index 219 (AS frame_220).
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

// ---- Manifest bounds -------------------------------------------------------

const SPRITE5_BOUNDS = {
  width: 143.45,
  height: 143.95,
  offsetX: -49.75,
  offsetY: -93.95,
};

const SPRITE12_BOUNDS = {
  width: 187.9,
  height: 187.9,
  offsetX: -93.95,
  offsetY: -93.85,
};

const ANIM1_BOUNDS = {
  width: 453.25,
  height: 464.05,
  offsetX: -54.4,
  offsetY: -414.65,
};

// ---- Keyframe table for sprite12 tween inside DefineSprite_15 -------------
// Extracted verbatim from manifest.librarySymbols[1].placements[].
// Each entry covers one "place" or "move" record on depth 1 of DefineSprite_15.
// rotateSkew0 is already in radians (Flash affine matrix field).
// alpha = colorTransform.alphaMult / 256 (256 → 1.0, 0 → 0.0).
interface Keyframe {
  frame: number;  // 0-based parent frame index
  tx: number;
  ty: number;
  sx: number;     // scaleX (= scaleY, uniform)
  sk: number;     // rotateSkew0 (radians)
  alpha: number;  // 0-1
}

const SPRITE12_KEYFRAMES: Keyframe[] = [
  { frame: 3,   tx: 236.4,  ty: -252.7,  sx:  1.343231201171875,   sk:  0,                   alpha: 1.0 },
  { frame: 4,   tx: 229.9,  ty: -245.75, sx:  1.1475372314453125,  sk:  0.65167236328125,     alpha: 1.0 },
  { frame: 5,   tx: 223.5,  ty: -238.9,  sx:  0.6708984375,        sk:  1.1116485595703125,   alpha: 1.0 },
  { frame: 6,   tx: 217.25, ty: -232.3,  sx:  0.061737060546875,   sk:  1.277801513671875,    alpha: 1.0 },
  { frame: 7,   tx: 211.25, ty: -225.8,  sx: -0.528411865234375,   sk:  1.1412353515625,      alpha: 1.0 },
  { frame: 8,   tx: 205.25, ty: -219.5,  sx: -0.97723388671875,    sk:  0.7589569091796875,   alpha: 1.0 },
  { frame: 9,   tx: 199.45, ty: -213.3,  sx: -1.19647216796875,    sk:  0.23797607421875,     alpha: 1.0 },
  { frame: 10,  tx: 193.8,  ty: -207.15, sx: -1.1614990234375,     sk: -0.301605224609375,    alpha: 1.0 },
  { frame: 11,  tx: 188.2,  ty: -201.25, sx: -0.9033203125,        sk: -0.76007080078125,     alpha: 1.0 },
  { frame: 12,  tx: 182.95, ty: -195.45, sx: -0.4969940185546875,  sk: -1.0514068603515625,   alpha: 1.0 },
  { frame: 13,  tx: 177.55, ty: -189.8,  sx: -0.0250244140625,     sk: -1.146453857421875,    alpha: 1.0 },
  { frame: 14,  tx: 172.5,  ty: -184.35, sx:  0.4240570068359375,  sk: -1.045684814453125,    alpha: 1.0 },
  { frame: 15,  tx: 167.45, ty: -179.05, sx:  0.7870330810546875,  sk: -0.7870330810546875,   alpha: 1.0 },
  { frame: 16,  tx: 162.6,  ty: -173.85, sx:  1.0099639892578125,  sk: -0.424468994140625,    alpha: 1.0 },
  { frame: 17,  tx: 157.85, ty: -168.8,  sx:  1.080780029296875,   sk: -0.0200042724609375,   alpha: 1.0 },
  { frame: 18,  tx: 153.3,  ty: -163.9,  sx:  1.0031585693359375,  sk:  0.3565673828125,      alpha: 1.0 },
  { frame: 19,  tx: 148.85, ty: -159.1,  sx:  0.8050689697265625,  sk:  0.6728515625,         alpha: 1.0 },
  { frame: 20,  tx: 144.55, ty: -154.6,  sx:  0.52239990234375,    sk:  0.893524169921875,    alpha: 1.0 },
  { frame: 21,  tx: 140.35, ty: -150.1,  sx:  0.199493408203125,   sk:  1.002960205078125,    alpha: 1.0 },
  { frame: 22,  tx: 136.35, ty: -145.75, sx: -0.123779296875,      sk:  1.001068115234375,    alpha: 1.0 },
  { frame: 23,  tx: 132.4,  ty: -141.6,  sx: -0.420989990234375,   sk:  0.9013824462890625,   alpha: 1.0 },
  { frame: 24,  tx: 128.65, ty: -137.65, sx: -0.658721923828125,   sk:  0.7282257080078125,   alpha: 1.0 },
  { frame: 25,  tx: 125.0,  ty: -133.75, sx: -0.828826904296875,   sk:  0.5039825439453125,   alpha: 1.0 },
  { frame: 26,  tx: 121.55, ty: -130.0,  sx: -0.9250946044921875,  sk:  0.2526702880859375,   alpha: 1.0 },
  { frame: 27,  tx: 118.2,  ty: -126.45, sx: -0.9485931396484375,  sk:  0,                   alpha: 1.0 },
  { frame: 28,  tx: 114.95, ty: -122.95, sx: -0.907012939453125,   sk: -0.235565185546875,    alpha: 1.0 },
  { frame: 29,  tx: 111.9,  ty: -119.7,  sx: -0.811767578125,      sk: -0.4461517333984375,   alpha: 1.0 },
  { frame: 30,  tx: 108.9,  ty: -116.6,  sx: -0.67950439453125,    sk: -0.614654541015625,    alpha: 1.0 },
  { frame: 31,  tx: 106.15, ty: -113.5,  sx: -0.52105712890625,    sk: -0.7424163818359375,   alpha: 1.0 },
  { frame: 32,  tx: 103.55, ty: -110.7,  sx: -0.3480682373046875,  sk: -0.8282928466796875,   alpha: 1.0 },
  { frame: 33,  tx: 101.0,  ty: -108.0,  sx: -0.173828125,         sk: -0.873931884765625,    alpha: 1.0 },
  { frame: 34,  tx:  98.6,  ty: -105.4,  sx: -0.004119873046875,   sk: -0.883026123046875,    alpha: 1.0 },
  { frame: 35,  tx:  96.35, ty: -102.95, sx:  0.1491851806640625,  sk: -0.8622283935546875,   alpha: 1.0 },
  { frame: 36,  tx:  94.2,  ty: -100.75, sx:  0.290557861328125,   sk: -0.81744384765625,     alpha: 1.0 },
  { frame: 37,  tx:  92.2,  ty:  -98.65, sx:  0.414520263671875,   sk: -0.7541961669921875,   alpha: 1.0 },
  { frame: 38,  tx:  90.4,  ty:  -96.65, sx:  0.5155181884765625,  sk: -0.6812286376953125,   alpha: 1.0 },
  { frame: 39,  tx:  88.6,  ty:  -94.75, sx:  0.600982666015625,   sk: -0.600982666015625,    alpha: 1.0 },
  { frame: 40,  tx:  87.15, ty:  -93.1,  sx:  0.666046142578125,   sk: -0.5173187255859375,   alpha: 1.0 },
  { frame: 41,  tx:  85.6,  ty:  -91.6,  sx:  0.718017578125,      sk: -0.433349609375,       alpha: 1.0 },
  { frame: 42,  tx:  84.35, ty:  -90.2,  sx:  0.7544403076171875,  sk: -0.35662841796875,     alpha: 1.0 },
  { frame: 43,  tx:  83.3,  ty:  -88.95, sx:  0.78057861328125,    sk: -0.2844696044921875,   alpha: 1.0 },
  { frame: 44,  tx:  82.15, ty:  -87.9,  sx:  0.798309326171875,   sk: -0.21807861328125,     alpha: 1.0 },
  { frame: 45,  tx:  81.25, ty:  -86.95, sx:  0.809417724609375,   sk: -0.1609954833984375,   alpha: 1.0 },
  { frame: 46,  tx:  80.5,  ty:  -86.15, sx:  0.8148345947265625,  sk: -0.111175537109375,    alpha: 1.0 },
  { frame: 47,  tx:  79.9,  ty:  -85.45, sx:  0.8175811767578125,  sk: -0.06884765625,        alpha: 1.0 },
  { frame: 48,  tx:  79.4,  ty:  -84.95, sx:  0.818023681640625,   sk: -0.039520263671875,    alpha: 1.0 },
  { frame: 49,  tx:  79.05, ty:  -84.6,  sx:  0.81768798828125,    sk: -0.017852783203125,    alpha: 1.0 },
  { frame: 50,  tx:  78.85, ty:  -84.35, sx:  0.8172607421875,     sk: -0.0037689208984375,   alpha: 1.0 },
  { frame: 51,  tx:  78.8,  ty:  -84.3,  sx:  0.817047119140625,   sk:  0,                   alpha: 1.0 },
  // frames 52–158: resting state — same as frame 51, no move entries in manifest
  { frame: 159, tx:  76.85, ty:  -82.2,  sx:  0.8682098388671875,  sk:  0,                   alpha: 1.0 },
  { frame: 160, tx:  76.35, ty:  -81.65, sx:  0.88739013671875,    sk:  0.046783447265625,    alpha: 1.0 },
  { frame: 161, tx:  75.95, ty:  -81.1,  sx:  0.902984619140625,   sk:  0.0916290283203125,   alpha: 1.0 },
  { frame: 162, tx:  75.5,  ty:  -80.7,  sx:  0.9149932861328125,  sk:  0.137054443359375,    alpha: 1.0 },
  { frame: 163, tx:  75.1,  ty:  -80.25, sx:  0.9246673583984375,  sk:  0.176666259765625,    alpha: 1.0 },
  { frame: 164, tx:  74.7,  ty:  -79.85, sx:  0.931427001953125,   sk:  0.216094970703125,    alpha: 1.0 },
  { frame: 165, tx:  74.3,  ty:  -79.5,  sx:  0.93621826171875,    sk:  0.2520599365234375,   alpha: 1.0 },
  { frame: 166, tx:  74.05, ty:  -79.15, sx:  0.9385223388671875,  sk:  0.2873077392578125,   alpha: 1.0 },
  { frame: 167, tx:  73.75, ty:  -78.85, sx:  0.9405364990234375,  sk:  0.315521240234375,    alpha: 1.0 },
  { frame: 168, tx:  73.55, ty:  -78.6,  sx:  0.941864013671875,   sk:  0.3396148681640625,   alpha: 1.0 },
  { frame: 169, tx:  73.35, ty:  -78.45, sx:  0.941558837890625,   sk:  0.3625335693359375,   alpha: 1.0 },
  { frame: 170, tx:  73.25, ty:  -78.3,  sx:  0.9410400390625,     sk:  0.381134033203125,    alpha: 1.0 },
  { frame: 171, tx:  73.1,  ty:  -78.1,  sx:  0.940521240234375,   sk:  0.39532470703125,     alpha: 1.0 },
  { frame: 172, tx:  73.0,  ty:  -78.05, sx:  0.940185546875,      sk:  0.405059814453125,    alpha: 1.0 },
  { frame: 173, tx:  73.0,  ty:  -77.95, sx:  0.94024658203125,    sk:  0.4102783203125,      alpha: 1.0 },
  { frame: 174, tx:  72.95, ty:  -78.0,  sx:  0.940521240234375,   sk:  0.41448974609375,     alpha: 1.0 },
  { frame: 175, tx:  73.0,  ty:  -78.0,  sx:  0.9404449462890625,  sk:  0.410552978515625,    alpha: 1.0 },
  { frame: 176, tx:  72.95, ty:  -78.05, sx:  0.939697265625,      sk:  0.4091949462890625,   alpha: 255 / 256 },
  { frame: 177, tx:  73.0,  ty:  -78.1,  sx:  0.941131591796875,   sk:  0.400787353515625,    alpha: 254 / 256 },
  { frame: 178, tx:  73.0,  ty:  -78.1,  sx:  0.9419708251953125,  sk:  0.3914794921875,      alpha: 253 / 256 },
  { frame: 179, tx:  73.05, ty:  -78.1,  sx:  0.9421844482421875,  sk:  0.38134765625,        alpha: 252 / 256 },
  { frame: 180, tx:  73.1,  ty:  -78.15, sx:  0.9429931640625,     sk:  0.3672332763671875,   alpha: 250 / 256 },
  { frame: 181, tx:  73.15, ty:  -78.25, sx:  0.9441986083984375,  sk:  0.349212646484375,    alpha: 248 / 256 },
  { frame: 182, tx:  73.2,  ty:  -78.25, sx:  0.9445037841796875,  sk:  0.3304443359375,      alpha: 245 / 256 },
  { frame: 183, tx:  73.25, ty:  -78.35, sx:  0.9448699951171875,  sk:  0.307861328125,       alpha: 242 / 256 },
  { frame: 184, tx:  73.3,  ty:  -78.4,  sx:  0.9441070556640625,  sk:  0.2845458984375,      alpha: 239 / 256 },
  { frame: 185, tx:  73.4,  ty:  -78.45, sx:  0.9429931640625,     sk:  0.2575531005859375,   alpha: 236 / 256 },
  { frame: 186, tx:  73.5,  ty:  -78.6,  sx:  0.9412384033203125,  sk:  0.227020263671875,    alpha: 232 / 256 },
  { frame: 187, tx:  73.55, ty:  -78.75, sx:  0.937835693359375,   sk:  0.196044921875,       alpha: 228 / 256 },
  { frame: 188, tx:  73.7,  ty:  -78.75, sx:  0.932769775390625,   sk:  0.1648101806640625,   alpha: 223 / 256 },
  { frame: 189, tx:  73.8,  ty:  -79.0,  sx:  0.926361083984375,   sk:  0.1303558349609375,   alpha: 218 / 256 },
  { frame: 190, tx:  73.95, ty:  -79.1,  sx:  0.9182281494140625,  sk:  0.0929107666015625,   alpha: 213 / 256 },
  { frame: 191, tx:  74.05, ty:  -79.2,  sx:  0.9078521728515625,  sk:  0.055694580078125,    alpha: 207 / 256 },
  { frame: 192, tx:  74.2,  ty:  -79.35, sx:  0.8952484130859375,  sk:  0.0159912109375,      alpha: 201 / 256 },
  { frame: 193, tx:  74.3,  ty:  -79.55, sx:  0.8799285888671875,  sk: -0.0230560302734375,   alpha: 195 / 256 },
  { frame: 194, tx:  74.5,  ty:  -79.7,  sx:  0.862030029296875,   sk: -0.0611572265625,      alpha: 189 / 256 },
  { frame: 195, tx:  74.65, ty:  -79.9,  sx:  0.8409423828125,     sk: -0.1036834716796875,   alpha: 182 / 256 },
  { frame: 196, tx:  74.75, ty:  -80.0,  sx:  0.8169403076171875,  sk: -0.1445465087890625,   alpha: 175 / 256 },
  { frame: 197, tx:  74.95, ty:  -80.25, sx:  0.78948974609375,    sk: -0.18609619140625,     alpha: 167 / 256 },
  { frame: 198, tx:  75.15, ty:  -80.4,  sx:  0.7590484619140625,  sk: -0.2252655029296875,   alpha: 159 / 256 },
  { frame: 199, tx:  75.3,  ty:  -80.6,  sx:  0.725921630859375,   sk: -0.26177978515625,     alpha: 151 / 256 },
  { frame: 200, tx:  75.55, ty:  -80.8,  sx:  0.688232421875,      sk: -0.299896240234375,    alpha: 142 / 256 },
  { frame: 201, tx:  75.7,  ty:  -80.95, sx:  0.64788818359375,    sk: -0.334320068359375,    alpha: 133 / 256 },
  { frame: 202, tx:  75.95, ty:  -81.2,  sx:  0.6051177978515625,  sk: -0.36474609375,        alpha: 124 / 256 },
  { frame: 203, tx:  76.15, ty:  -81.5,  sx:  0.5590362548828125,  sk: -0.39276123046875,     alpha: 114 / 256 },
  { frame: 204, tx:  76.35, ty:  -81.7,  sx:  0.5112457275390625,  sk: -0.416015625,          alpha: 105 / 256 },
  { frame: 205, tx:  76.65, ty:  -82.0,  sx:  0.4593353271484375,  sk: -0.43731689453125,     alpha:  94 / 256 },
  { frame: 206, tx:  76.9,  ty:  -82.25, sx:  0.4080047607421875,  sk: -0.451507568359375,    alpha:  84 / 256 },
  { frame: 207, tx:  77.1,  ty:  -82.5,  sx:  0.35491943359375,    sk: -0.4613037109375,      alpha:  73 / 256 },
  { frame: 208, tx:  77.4,  ty:  -82.75, sx:  0.3007049560546875,  sk: -0.4662017822265625,   alpha:  61 / 256 },
  { frame: 209, tx:  77.65, ty:  -83.1,  sx:  0.246063232421875,   sk: -0.4656829833984375,   alpha:  50 / 256 },
  { frame: 210, tx:  77.9,  ty:  -83.4,  sx:  0.1947784423828125,  sk: -0.4581146240234375,   alpha:  38 / 256 },
  { frame: 211, tx:  78.2,  ty:  -83.65, sx:  0.1431427001953125,  sk: -0.4457244873046875,   alpha:  26 / 256 },
  { frame: 212, tx:  78.5,  ty:  -84.0,  sx:  0.095062255859375,   sk: -0.4272003173828125,   alpha:  13 / 256 },
  { frame: 213, tx:  78.8,  ty:  -84.3,  sx:  0.0513763427734375,  sk: -0.4032440185546875,   alpha:   0 / 256 },
  { frame: 214, tx:  78.8,  ty:  -84.3,  sx: -0.185272216796875,   sk: -0.316314697265625,    alpha:   0 / 256 },
  { frame: 215, tx:  78.8,  ty:  -84.3,  sx: -0.303955078125,      sk: -0.1214599609375,      alpha:   0 / 256 },
  { frame: 216, tx:  78.8,  ty:  -84.3,  sx: -0.2771453857421875,  sk:  0.0793914794921875,   alpha:   0 / 256 },
];

// Pre-build a sorted array for binary-search-style lookup
const KF_FRAMES_SORTED = SPRITE12_KEYFRAMES.map((kf) => kf.frame).sort(
  (a, b) => a - b
);

/** Return the keyframe whose frame index is <= frameIdx (floor lookup). */
function getKeyframeFloor(frameIdx: number): Keyframe | null {
  let best: Keyframe | null = null;
  for (const kf of SPRITE12_KEYFRAMES) {
    if (kf.frame <= frameIdx) {
      if (best === null || kf.frame > best.frame) {
        best = kf;
      }
    }
  }
  return best;
}
// suppress unused-variable warning on KF_FRAMES_SORTED — it's a module-level
// precompute kept for documentation; getKeyframeFloor is the runtime path.
void KF_FRAMES_SORTED;

export class Spell503 extends RuntimeSpell {
  readonly spellId = 503;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite5Sym!: SymbolDefinition;
  private sprite12Sym!: SymbolDefinition;
  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const sprite5Anchor = calculateAnchor(SPRITE5_BOUNDS);
    const sprite12Anchor = calculateAnchor(SPRITE12_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ----------------------------------------------------------------
    // sprite5 — single-frame rotating glyph
    // ----------------------------------------------------------------
    // onEnterFrame:
    //   AS DefineSprite_5/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation = _rotation + 3.3;
    this.sprite5Sym = {
      name: "sprite5",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite5"),
      anchorX: sprite5Anchor.x,
      anchorY: sprite5Anchor.y,
      onEnterFrame: (clip) => {
        // AS DefineSprite_5/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _rotation = _rotation + 3.3;
        clip.rotation += (3.3 * Math.PI) / 180;
      },
    };

    // ----------------------------------------------------------------
    // sprite12 — ring composite with two placement-dependent behaviors
    // ----------------------------------------------------------------
    // Two placements in DefineSprite_15 at different depths:
    //
    //   depth 45 (PlaceObject2_8_45):
    //     onLoad:       i = 0;
    //     onEnterFrame: if (i++ % 8 == 1) { _rotation -= 13.4; }
    //
    //   depth 49 (PlaceObject2_11_49):
    //     onEnterFrame: _rotation = _rotation + 1;
    //
    // We use clip.vars.behavior to select which handler runs:
    //   "depth45" → stepped jerk rotation
    //   "depth49" → continuous +1 deg/tick
    // The outer container sets vars.behavior before attach so that
    // onLoad sees it on the first tick.
    //
    // sprite12 also hosts 4 instances of sprite5 (at depths 1, 12, 23, 34)
    // placed on its own frame 0 — these are attached from frameScripts[0].
    const sprite5SymRef = this;  // capture for closure below

    this.sprite12Sym = {
      name: "sprite12",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite12"),
      anchorX: sprite12Anchor.x,
      anchorY: sprite12Anchor.y,

      onLoad: (clip) => {
        // AS DefineSprite_12/frame_1/PlaceObject2_8_45/CLIPACTIONRECORD onClipEvent(load).as
        // (only applies to the depth-45 placement)
        // i = 0;
        clip.vars.i = 0;
      },

      onEnterFrame: (clip) => {
        const behavior = clip.vars.behavior as string | undefined;
        if (behavior === "depth45") {
          // AS DefineSprite_12/frame_1/PlaceObject2_8_45/CLIPACTIONRECORD onClipEvent(enterFrame).as
          // if (i++ % 8 == 1) { _rotation = _rotation - 13.4; }
          const i = clip.vars.i as number;
          if (i % 8 === 1) {
            clip.rotation -= (13.4 * Math.PI) / 180;
          }
          clip.vars.i = i + 1;
        } else if (behavior === "depth49") {
          // AS DefineSprite_12/frame_1/PlaceObject2_11_49/CLIPACTIONRECORD onClipEvent(enterFrame).as
          // _rotation = _rotation + 1;
          clip.rotation += (1.0 * Math.PI) / 180;
        }
      },

      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Attach 4 sprite5 instances as per sprite5.placements[]
            // (parentSpriteId = 12 = DefineSprite_12).
            // All placed at frame 0 of DefineSprite_12.
            //
            // depth 1: scaleX=1, scaleY=1, tx=0, ty=0.1, alphaMult=26 → alpha=26/256
            const s1 = clip.attach(sprite5SymRef.sprite5Sym, "sprite5_d1", 1, ctx);
            s1.x = 0;
            s1.y = 0.1;
            s1.scaleX = 1;
            s1.scaleY = 1;
            s1.rotation = 0;
            s1.alpha = 26 / 256;

            // depth 12: scaleX=0, scaleY=0, rotateSkew0=1, rotateSkew1=-1
            //   tx=0, ty=0.1, alphaMult=115 → alpha=115/256
            //   rotation = atan2(rotateSkew0, scaleX) = atan2(1, 0) = π/2
            const s12 = clip.attach(sprite5SymRef.sprite5Sym, "sprite5_d12", 12, ctx);
            s12.x = 0;
            s12.y = 0.1;
            s12.scaleX = 0;
            s12.scaleY = 0;
            s12.rotation = Math.PI / 2;
            s12.alpha = 115 / 256;

            // depth 23: scaleX=-1, scaleY=-1, tx=0, ty=0.1, no colorTransform → alpha=1
            const s23 = clip.attach(sprite5SymRef.sprite5Sym, "sprite5_d23", 23, ctx);
            s23.x = 0;
            s23.y = 0.1;
            s23.scaleX = -1;
            s23.scaleY = -1;
            s23.rotation = 0;
            s23.alpha = 1.0;

            // depth 34: scaleX=0, scaleY=0, rotateSkew0=-1, rotateSkew1=1
            //   tx=0, ty=0.1, alphaMult=115 → alpha=115/256
            //   rotation = atan2(-1, 0) = -π/2
            const s34 = clip.attach(sprite5SymRef.sprite5Sym, "sprite5_d34", 34, ctx);
            s34.x = 0;
            s34.y = 0.1;
            s34.scaleX = 0;
            s34.scaleY = 0;
            s34.rotation = -Math.PI / 2;
            s34.alpha = 115 / 256;
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // anim1 — outer container (DefineSprite_15), 222 frames
    // ----------------------------------------------------------------
    // Drives the sprite12 keyframe tween each frame via onEnterFrame.
    // Attaches sprite12 (depth45) and sprite12 (depth49) at frame index 3
    // (AS frame 4, first "place" in placements[]).
    // frame 219 (AS frame_220): _parent.removeMovieClip(); stop();
    const sprite12SymRef = this;
    const runtimeRef = this;

    this.anim1Sym = {
      name: "anim1",
      totalFrames: 222,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,

      onEnterFrame: (clip) => {
        // Drive the sprite12 tween by looking up the current frame in the
        // keyframe table and applying the canonical matrix to both sprite12
        // instances. This mirrors the "move" PlaceObject2 records that Flash
        // would apply each frame in DefineSprite_15.
        const cf = clip.currentFrame;
        const kf = getKeyframeFloor(cf);
        if (kf === null) {
          return;
        }
        // Both instances share the same positional tween (same depth=1 in the
        // manifest's placements). Rotation is atan2(sk, sx) per Flash affine
        // matrix decomposition.
        const tweenRotation = Math.atan2(kf.sk, kf.sx);

        const child45 = clip.children.get("sprite12_d45");
        if (child45) {
          child45.x = kf.tx;
          child45.y = kf.ty;
          child45.scaleX = kf.sx;
          child45.scaleY = kf.sy;
          child45.rotation = tweenRotation;
          child45.alpha = kf.alpha;
        }
        const child49 = clip.children.get("sprite12_d49");
        if (child49) {
          child49.x = kf.tx;
          child49.y = kf.ty;
          child49.scaleX = kf.sx;
          child49.scaleY = kf.sy;
          child49.rotation = tweenRotation;
          child49.alpha = kf.alpha;
        }
      },

      frameScripts: new Map([
        [
          3,
          (clip, ctx) => {
            // AS DefineSprite_15 places sprite12 at frame 4 (0-based 3).
            // First "place" entry: depth=1, tx=236.4, ty=-252.7,
            // scaleX=1.343231201171875, rotateSkew0=0, alphaMult=256.
            //
            // Attach depth-45 variant (behavior: stepped jerk rotation).
            if (!clip.children.has("sprite12_d45")) {
              // Set behavior flag before attach so onLoad sees it.
              const sym45 = sprite12SymRef.sprite12Sym;
              // We pre-set vars.behavior via a wrapper: create the clip then
              // set the flag. onLoad runs after attach inside clip.attach(),
              // so we set behavior on the returned clip right after.
              const s45 = clip.attach(sym45, "sprite12_d45", 1, ctx);
              s45.vars.behavior = "depth45";
              // Seed i=0 explicitly since onLoad already ran (behavior wasn't set yet).
              s45.vars.i = 0;
              // Initial tween transform from keyframe frame=3
              s45.x = 236.4;
              s45.y = -252.7;
              s45.scaleX = 1.343231201171875;
              s45.scaleY = 1.343231201171875;
              s45.rotation = 0;
              s45.alpha = 1.0;
            }

            // Attach depth-49 variant (behavior: continuous +1 deg/tick).
            if (!clip.children.has("sprite12_d49")) {
              const sym49 = sprite12SymRef.sprite12Sym;
              const s49 = clip.attach(sym49, "sprite12_d49", 2, ctx);
              s49.vars.behavior = "depth49";
              // Initial tween transform (same starting position)
              s49.x = 236.4;
              s49.y = -252.7;
              s49.scaleX = 1.343231201171875;
              s49.scaleY = 1.343231201171875;
              s49.rotation = 0;
              s49.alpha = 1.0;
            }

            // Signal hit when the composite first appears.
            runtimeRef.runtime.signalHit();
          },
        ],
        [
          219,
          (clip) => {
            // AS DefineSprite_15/frame_220/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.stop();
            clip.remove();
            runtimeRef.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite5Sym);
    this.registry.register(this.sprite12Sym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS scripts/frame_1/DoAction.as
    // SOMA.playSound("many_503");
    callbacks.playSound("many_503");

    // Attach the outer container so it starts ticking from the next frame.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
