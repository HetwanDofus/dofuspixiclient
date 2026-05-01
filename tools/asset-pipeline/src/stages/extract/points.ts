import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gunzipSync, inflateSync } from "node:zlib";

import { logger } from "../../logger.ts";
import { distDofassetPath, paths } from "../../paths.ts";

/**
 * Extract Dofus 1.29 floating-point clips
 * (`clips/points/<style>/<type>.swf`) into per-clip JSON manifests
 * served at `apps/electrobun/public/assets/dofassets/points/`.
 *
 * The original SWF is structurally a 3-deep nested clip:
 *
 *   cid=2  DefineEditText           — single dynamic text field (font 18, color)
 *   cid=3  DefineSprite (1 frame)   — wraps cid=2, plus a 138-byte DoAction
 *                                       script that copies `_parent._value` into
 *                                       the text field at attach time.
 *   cid=4  DefineSprite (1 frame)   — places cid=3 TWICE on the same frame:
 *                                       depth 1 (under): tx=0, ty=+1, cxform
 *                                                        rgb*0.6 → DARKER copy
 *                                                        offset 1 px down.
 *                                       depth 3 (over):  tx=0, ty=0, no cxform
 *                                                        → BRIGHT copy.
 *                                     This pair is the canonical "relief" effect
 *                                     — a 1-px offset darker clone giving each
 *                                     glyph an embossed look. NO Flash filter is
 *                                     involved (the SWF has no PlaceObject3 tag).
 *   cid=5  DefineSprite (52 frames) — places cid=4 once per frame and animates
 *                                     it via per-frame matrix + cxform:
 *                                       sx, sy : non-uniform scale (frame 1
 *                                                = 3.01 × 1.59 → wider than tall
 *                                                pop, both axes converge to 1.0
 *                                                by frame 17)
 *                                       tx, ty : translation (early frames have
 *                                                small tx wobble; ty drifts
 *                                                upward across the clip)
 *                                       cxform : drives the white-flash fade-in
 *                                                (frames 1-17, mul→1, add→0)
 *                                                and the alpha fade-out
 *                                                (frames 38-50).
 *
 * What we record:
 *
 *   - Base font height from DefineEditText (`fontSize`, in points).
 *   - Base text colour from DefineEditText (`color`, packed RGB).
 *   - Per-frame matrix `(sx, sy, tx, ty)` from cid=5's PlaceObject2 chain.
 *   - Per-frame CXform `(rMul/gMul/bMul/aMul, rAdd/gAdd/bAdd, aAdd)` from
 *     cid=5's PlaceObject2 chain.
 *   - `finishFrame` (1-based) — frame where DoAction calls
 *     `_parent.onAnimateFinished(...)` to release the next queued clip.
 *   - The static cid=4 relief offset+darken (`reliefOffsetY`, `reliefMul`) is
 *     ALWAYS `+1` and `0.60..` so we hard-code those constants in the runtime
 *     instead of carrying them per-clip.
 *
 * Style index 0 = normal hits (29 frames), 1 = criticals (52 frames). Type
 * index comes from `dofus.Constants.CLIP_POINT_TYPE_*`:
 *
 *   0 = DAMAGE          (red,    0xFF3300)
 *   1 = ACTION (AP)     (blue,   0x0033FF)
 *   2 = MOVEMENT (MP)   (green,  0x339900)
 *   3 = HEALTH (heal)   (red baked in SWF — runtime overrides to green)
 *   4 = QUANTITY        (orange, 0xCC6600)
 */
export interface PointFrame {
  /** Matrix sx (x-scale). Frame 1 ≈ 3.01 for criticals, 1.0 once settled. */
  sx: number;
  /** Matrix sy (y-scale). Frame 1 ≈ 1.59 for criticals (non-uniform pop). */
  sy: number;
  /** Matrix tx in pixels (post-twip conversion). Carries early wobble. */
  tx: number;
  /** Matrix ty in pixels (post-twip conversion). Drifts upward over time. */
  ty: number;
  /**
   * CXform multiplicative components — `out = clamp(in * mul + add, 0, 255)`.
   * Drive the white-flash fade-in: at frame 1 mul ≈ 0.31, by frame 17 mul = 1.
   * Stored uniformly per channel (the SWFs ship with `rMul=gMul=bMul`); the
   * runtime applies them independently per channel anyway in case future
   * clips break the symmetry.
   */
  rMul: number;
  gMul: number;
  bMul: number;
  /** Alpha multiplier — drives the fade-out (frames 38-50: 1 → 0). */
  aMul: number;
  /** CXform additive components in [-256..256]. Frame 1 ≈ 176, frame 17 = 0. */
  rAdd: number;
  gAdd: number;
  bAdd: number;
}

export interface PointManifest {
  /** Source style index (0 = normal, 1 = critical / extended). */
  style: number;
  /** Source type index (see CLIP_POINT_TYPE_* in the doc above). */
  type: number;
  /** Base font height in points (DefineEditText FontHeight / 20). */
  fontSize: number;
  /** Base text colour as packed RGB hex (alpha is always opaque). */
  color: number;
  /** Original SWF declared frame rate (just metadata; we play at 30 fps). */
  fps: number;
  /** Per-frame matrix + cxform curve; length = total visible frames. */
  frames: PointFrame[];
  /**
   * Frame index (1-based, into `frames`) where the clip's DoAction
   * calls `_parent.onAnimateFinished(...)`. The original PointsHandler
   * uses this signal to start the next queued clip on the same
   * fighter (`__Packages/.../%1B%16%17.as:55`); without it stacked
   * damage / AP / MP numbers all overlap on the same frame instead of
   * playing back-to-back.
   */
  finishFrame: number;
}

/** SWF tag codes we care about. */
const TAG_END = 0;
const TAG_SHOW_FRAME = 1;
const TAG_DO_ACTION = 12;
const TAG_DEFINE_SPRITE = 39;
const TAG_DEFINE_EDIT_TEXT = 37;
const TAG_PLACE_OBJECT_2 = 26;

/**
 * AS2 bytecode walker — returns true iff the script contains a `stop()`
 * (opcode 0x07) at any opcode position. A naive `bytes.includes(0x07)`
 * gives false positives because action records ≥ 0x80 carry a 2-byte
 * length followed by arbitrary payload bytes, any of which can be
 * 0x07. We have to skip past those payloads using the length field.
 */
function bytecodeHasStop(script: Uint8Array): boolean {
  let i = 0;
  while (i < script.length) {
    const op = script[i++];
    if (op === 0) {
      return false; // ActionEndFlag
    }
    if (op === 0x07) {
      return true; // ActionStop
    }
    if (op >= 0x80) {
      if (i + 2 > script.length) {
        return false;
      }
      const len = script[i] | (script[i + 1] << 8);
      i += 2 + len;
    }
    // < 0x80: 1-byte opcode, no payload — already advanced.
  }
  return false;
}

class BitReader {
  constructor(private buf: Uint8Array, private bitOff = 0) {}
  readUB(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byte = this.buf[this.bitOff >> 3] ?? 0;
      v = (v << 1) | ((byte >> (7 - (this.bitOff & 7))) & 1);
      this.bitOff++;
    }
    return v;
  }
  readSB(n: number): number {
    const v = this.readUB(n);
    if (v & (1 << (n - 1))) return v - (1 << n);
    return v;
  }
  consumedBytes(): number {
    return (this.bitOff + 7) >> 3;
  }
}

function decompressSwf(buf: Uint8Array): { body: Uint8Array; fps: number } {
  const sig = String.fromCharCode(buf[0], buf[1], buf[2]);
  let body: Uint8Array;
  if (sig === "CWS") {
    body = inflateSync(buf.subarray(8));
  } else if (sig === "FWS") {
    body = buf.subarray(8);
  } else if (sig === "GWS") {
    body = gunzipSync(buf.subarray(8));
  } else {
    throw new Error(`unsupported SWF signature: ${sig}`);
  }
  const nbits = (body[0] >> 3) & 0x1f;
  const rectBits = 5 + 4 * nbits;
  const rectBytes = (rectBits + 7) >> 3;
  const fpsRaw = body[rectBytes] | (body[rectBytes + 1] << 8);
  const fps = fpsRaw / 256;
  return { body: body.subarray(rectBytes + 4), fps };
}

interface Tag {
  code: number;
  data: Uint8Array;
}

function parseTags(stream: Uint8Array): Tag[] {
  const out: Tag[] = [];
  let pos = 0;
  while (pos < stream.length) {
    if (pos + 2 > stream.length) break;
    const tcl = stream[pos] | (stream[pos + 1] << 8);
    pos += 2;
    const code = tcl >> 6;
    let length = tcl & 0x3f;
    if (length === 0x3f) {
      length =
        stream[pos] |
        (stream[pos + 1] << 8) |
        (stream[pos + 2] << 16) |
        (stream[pos + 3] << 24);
      pos += 4;
    }
    out.push({ code, data: stream.subarray(pos, pos + length) });
    pos += length;
    if (code === TAG_END) break;
  }
  return out;
}

function parseDefineEditText(data: Uint8Array): { fontSize: number; color: number } {
  let off = 2; // skip CharID
  const nbits = (data[off] >> 3) & 0x1f;
  const rectBits = 5 + 4 * nbits;
  off += (rectBits + 7) >> 3;
  const flags1 = data[off];
  const flags2 = data[off + 1];
  off += 2;
  const hasFont = (flags1 & 0x01) !== 0;
  const hasFontClass = (flags2 & 0x80) !== 0;
  const hasMaxLen = (flags1 & 0x02) !== 0;
  const hasTextColor = (flags1 & 0x04) !== 0;

  if (hasFont) off += 2; // FontID
  if (hasFontClass) {
    while (data[off] !== 0) off++;
    off++;
  }
  let fontSize = 0;
  if (hasFont) {
    fontSize = (data[off] | (data[off + 1] << 8)) / 20;
    off += 2;
  }
  let color = 0xffffff;
  if (hasTextColor) {
    const r = data[off];
    const g = data[off + 1];
    const b = data[off + 2];
    color = (r << 16) | (g << 8) | b;
    off += 4;
  }
  void hasMaxLen;
  return { fontSize, color };
}

interface PlaceData {
  flags: number;
  matrix: { sx: number; sy: number; tx: number; ty: number } | null;
  cxform: {
    rMul: number;
    gMul: number;
    bMul: number;
    aMul: number;
    rAdd: number;
    gAdd: number;
    bAdd: number;
    aAdd: number;
  } | null;
}

function parsePlaceObject2(data: Uint8Array): PlaceData {
  const flags = data[0];
  let off = 3; // skip flags + depth UI16
  if ((flags & 0x02) !== 0) off += 2; // HasCharacter → CharID

  let matrix: PlaceData["matrix"] = null;
  if ((flags & 0x04) !== 0) {
    const r = new BitReader(data.subarray(off));
    const hasScale = r.readUB(1);
    let sx = 1;
    let sy = 1;
    if (hasScale) {
      const nb = r.readUB(5);
      sx = r.readSB(nb) / 65536;
      sy = r.readSB(nb) / 65536;
    }
    const hasRot = r.readUB(1);
    if (hasRot) {
      const nb = r.readUB(5);
      r.readSB(nb);
      r.readSB(nb);
    }
    const nbT = r.readUB(5);
    const txTwips = r.readSB(nbT);
    const tyTwips = r.readSB(nbT);
    matrix = { sx, sy, tx: txTwips / 20, ty: tyTwips / 20 };
    off += r.consumedBytes();
  }

  let cxform: PlaceData["cxform"] = null;
  if ((flags & 0x08) !== 0) {
    const r = new BitReader(data.subarray(off));
    const hasAdd = r.readUB(1);
    const hasMul = r.readUB(1);
    const nb = r.readUB(4);
    let rMul = 1, gMul = 1, bMul = 1, aMul = 1;
    let rAdd = 0, gAdd = 0, bAdd = 0, aAdd = 0;
    if (hasMul) {
      // CXForm spec: multiplier values are stored as fixed-point 8.8 where
      // 256 = 1.0×. Divide by 256 to get the multiplier.
      rMul = r.readSB(nb) / 256;
      gMul = r.readSB(nb) / 256;
      bMul = r.readSB(nb) / 256;
      aMul = r.readSB(nb) / 256;
    }
    if (hasAdd) {
      // Additive components are signed 8-bit values in [-256..256].
      rAdd = r.readSB(nb);
      gAdd = r.readSB(nb);
      bAdd = r.readSB(nb);
      aAdd = r.readSB(nb);
    }
    cxform = { rMul, gMul, bMul, aMul, rAdd, gAdd, bAdd, aAdd };
  }

  return { flags, matrix, cxform };
}

async function extractOne(
  swfPath: string,
  style: number,
  type: number
): Promise<PointManifest> {
  const raw = new Uint8Array(await readFile(swfPath));
  const { body, fps } = decompressSwf(raw);
  const tags = parseTags(body);

  // 1. DefineEditText for font size + base colour.
  const editTextTag = tags.find((t) => t.code === TAG_DEFINE_EDIT_TEXT);
  if (!editTextTag) {
    throw new Error(`${swfPath}: no DefineEditText tag`);
  }
  const { fontSize, color } = parseDefineEditText(editTextTag.data);

  // 2. Locate the LARGEST DefineSprite — the one that holds the timeline
  //    animation (cid=5 in the canonical structure). 52 frames for criticals,
  //    29 for normal hits.
  let animSprite: Uint8Array | null = null;
  let animFrameCount = 0;
  for (const t of tags) {
    if (t.code !== TAG_DEFINE_SPRITE) continue;
    const fc = t.data[2] | (t.data[3] << 8);
    if (fc > animFrameCount) {
      animFrameCount = fc;
      animSprite = t.data.subarray(4);
    }
  }
  if (!animSprite) {
    throw new Error(`${swfPath}: no animation sprite`);
  }

  // 3. Walk the sprite's timeline, accumulating per-frame matrix + cxform.
  //    PlaceObject2 with HasMatrix carries forward across frames where it's
  //    not re-set; same for HasColorTransform. Frames after the stop()
  //    DoAction don't display.
  const innerTags = parseTags(animSprite);
  const frames: PointFrame[] = [];
  let curSx = 1, curSy = 1, curTx = 0, curTy = 0;
  let curRMul = 1, curGMul = 1, curBMul = 1, curAMul = 1;
  let curRAdd = 0, curGAdd = 0, curBAdd = 0, curAAdd = 0;
  let pendingDoAction: Uint8Array | null = null;
  let pendingFinishFrame = false;
  let finishFrame = 0;
  let stoppedFrame = 0;

  for (const t of innerTags) {
    if (t.code === TAG_PLACE_OBJECT_2) {
      const { matrix, cxform } = parsePlaceObject2(t.data);
      if (matrix) {
        curSx = matrix.sx;
        curSy = matrix.sy;
        curTx = matrix.tx;
        curTy = matrix.ty;
      }
      if (cxform) {
        curRMul = cxform.rMul;
        curGMul = cxform.gMul;
        curBMul = cxform.bMul;
        curAMul = cxform.aMul;
        curRAdd = cxform.rAdd;
        curGAdd = cxform.gAdd;
        curBAdd = cxform.bAdd;
        curAAdd = cxform.aAdd;
      }
    } else if (t.code === TAG_DO_ACTION) {
      pendingDoAction = t.data;
      pendingFinishFrame = !bytecodeHasStop(t.data);
    } else if (t.code === TAG_SHOW_FRAME) {
      frames.push({
        sx: round(curSx, 4),
        sy: round(curSy, 4),
        tx: round(curTx, 2),
        ty: round(curTy, 2),
        rMul: round(curRMul, 4),
        gMul: round(curGMul, 4),
        bMul: round(curBMul, 4),
        aMul: round(curAMul, 4),
        rAdd: Math.round(curRAdd),
        gAdd: Math.round(curGAdd),
        bAdd: Math.round(curBAdd),
        aAdd: Math.round(curAAdd),
      });
      if (pendingDoAction) {
        if (pendingFinishFrame && finishFrame === 0) {
          finishFrame = frames.length;
        }
        if (bytecodeHasStop(pendingDoAction)) {
          stoppedFrame = frames.length;
          if (finishFrame === 0) {
            finishFrame = frames.length;
          }
          break;
        }
        pendingDoAction = null;
        pendingFinishFrame = false;
      }
    } else if (t.code === TAG_END) {
      break;
    }
  }

  const trimmed = stoppedFrame > 0 ? frames.slice(0, stoppedFrame) : frames;

  return {
    style,
    type,
    fontSize,
    color,
    fps,
    frames: trimmed,
    finishFrame: finishFrame > 0 ? finishFrame : trimmed.length,
  };
}

function round(value: number, decimals: number): number {
  const k = 10 ** decimals;
  return Math.round(value * k) / k;
}

export interface ExtractPointsResult {
  outputDir: string;
  count: number;
}

/**
 * Public entry point — drives extraction across both styles + all 5
 * type indices. Output dir mirrors the source layout one-for-one:
 *
 *   assets/sources/clips/points/0/0.swf  →
 *     assets/dist/dofassets/points/0/0.json
 *     apps/electrobun/public/assets/dofassets/points/0/0.json
 */
export async function extractPoints(): Promise<ExtractPointsResult> {
  const sourceRoot = resolve(paths.sources, "clips/points");
  const outDir = distDofassetPath("points");
  const publicDir = resolve(
    paths.repoRoot,
    "apps/electrobun/public/assets/dofassets/points"
  );
  let count = 0;

  for (const style of [0, 1]) {
    const styleDistDir = resolve(outDir, String(style));
    const stylePublicDir = resolve(publicDir, String(style));
    await mkdir(styleDistDir, { recursive: true });
    await mkdir(stylePublicDir, { recursive: true });
    for (const type of [0, 1, 2, 3, 4]) {
      const swfPath = resolve(sourceRoot, String(style), `${type}.swf`);
      try {
        const manifest = await extractOne(swfPath, style, type);
        const json = JSON.stringify(manifest, null, 2) + "\n";
        await writeFile(resolve(styleDistDir, `${type}.json`), json);
        await writeFile(resolve(stylePublicDir, `${type}.json`), json);
        count++;
        logger.info(
          {
            style,
            type,
            frames: manifest.frames.length,
            fontSize: manifest.fontSize,
            color: `0x${manifest.color.toString(16).padStart(6, "0")}`,
            finishFrame: manifest.finishFrame,
          },
          "extracted point clip"
        );
      } catch (err) {
        logger.warn({ err, style, type, swfPath }, "skip point clip");
      }
    }
  }
  return { outputDir: outDir, count };
}
