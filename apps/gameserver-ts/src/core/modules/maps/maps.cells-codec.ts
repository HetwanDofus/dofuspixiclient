// Port of apps/gameserver/pkg/exploration/domain/cells_decoder.go — decodes
// the StarLoco / Dofus 1.29 HASH_CELL 10-char-per-cell payload stored as-is
// in maps.cells into the bit-field shape proto MapCell expects.

const HASH_CELL =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";

const HASH_CELL_INDEX = (() => {
  const table = new Int8Array(256).fill(-1);

  for (let i = 0; i < HASH_CELL.length; i++) {
    table[HASH_CELL.charCodeAt(i)] = i;
  }

  return table;
})();

const CELL_CHAR_LEN = 10;

export interface DecodedCell {
  id: number;
  active: boolean;
  ground: number;
  layer1: number;
  layer2: number;
  groundLevel: number;
  groundSlope: number;
  walkable: boolean;
  movement: number;
  lineOfSight: boolean;
  layerGroundRot: number;
  layerGroundFlip: boolean;
  layerObject1Rot: number;
  layerObject1Flip: boolean;
  layerObject2Rot: number;
  layerObject2Flip: boolean;
  /**
   * The 1.29 `layerObject2Interactive` bit — Compressor.as:76. It, and not the
   * gfx id, is what separates a harvestable tree from a decorative copy of the
   * same sprite: both carry the same `layer2`, only the armed one is an
   * interactive element the client may click.
   */
  layerObject2Interactive: boolean;
}

export function decodeCells(raw: Uint8Array): DecodedCell[] {
  if (raw.length % CELL_CHAR_LEN !== 0) {
    throw new Error(
      `cells-decoder: payload length ${raw.length} is not a multiple of ${CELL_CHAR_LEN}`
    );
  }

  const count = raw.length / CELL_CHAR_LEN;
  const out: DecodedCell[] = new Array(count);

  for (let i = 0; i < count; i++) {
    out[i] = decodeOne(i, unpack60(raw, i * CELL_CHAR_LEN));
  }

  return out;
}

function hashAt(raw: Uint8Array, offset: number): bigint {
  const byte = raw[offset];

  if (byte === undefined) {
    throw new Error(`cells-decoder: offset ${offset} out of range`);
  }

  const idx = HASH_CELL_INDEX[byte];

  if (idx === undefined || idx < 0) {
    throw new Error(
      `cells-decoder: invalid HASH_CELL byte ${byte} at offset ${offset}`
    );
  }

  return BigInt(idx);
}

function unpack60(raw: Uint8Array, offset: number): bigint {
  const d0 = hashAt(raw, offset + 0);
  const d1 = hashAt(raw, offset + 1);
  const d2 = hashAt(raw, offset + 2);
  const d3 = hashAt(raw, offset + 3);
  const d4 = hashAt(raw, offset + 4);
  const d5 = hashAt(raw, offset + 5);
  const d6 = hashAt(raw, offset + 6);
  const d7 = hashAt(raw, offset + 7);
  const d8 = hashAt(raw, offset + 8);
  const d9 = hashAt(raw, offset + 9);

  const active = (d0 & 0x20n) >> 5n;
  const lineOfSight = d0 & 0x1n;
  const movement = (d2 & 0x38n) >> 3n;
  const groundLevel = d1 & 0xfn;
  const groundSlope = (d4 & 0x3cn) >> 2n;
  const groundNum = ((d0 & 0x18n) << 6n) | ((d2 & 0x7n) << 6n) | (d3 & 0x3fn);
  const groundFlip = (d4 & 0x2n) >> 1n;
  const groundRot = (d1 & 0x30n) >> 4n;
  const obj1Num =
    ((d0 & 0x4n) << 11n) |
    ((d4 & 0x1n) << 12n) |
    ((d5 & 0x3fn) << 6n) |
    (d6 & 0x3fn);
  const obj1Flip = (d7 & 0x8n) >> 3n;
  const obj1Rot = (d7 & 0x30n) >> 4n;
  const obj2Num =
    ((d0 & 0x2n) << 12n) |
    ((d7 & 0x1n) << 12n) |
    ((d8 & 0x3fn) << 6n) |
    (d9 & 0x3fn);
  const obj2Flip = (d7 & 0x4n) >> 2n;
  const obj2Interactive = (d7 & 0x2n) >> 1n;

  // Pack into 60 bits — CellsDataProvider.java:110-127.
  let r = 0n;
  r = (r << 1n) | obj2Interactive;
  r = (r << 1n) | obj2Flip;
  r = (r << 14n) | obj2Num;
  r = (r << 2n) | obj1Rot;
  r = (r << 1n) | obj1Flip;
  r = (r << 14n) | obj1Num;
  r = (r << 2n) | groundRot;
  r = (r << 1n) | groundFlip;
  r = (r << 11n) | groundNum;
  r = (r << 4n) | groundSlope;
  r = (r << 4n) | groundLevel;
  r = (r << 3n) | movement;
  r = (r << 1n) | lineOfSight;
  r = (r << 1n) | active;

  return r;
}

function decodeOne(id: number, p: bigint): DecodedCell {
  const movement = Number((p >> 2n) & 0x7n);

  return {
    id,
    active: (p & 0x1n) !== 0n,
    lineOfSight: ((p >> 1n) & 0x1n) !== 0n,
    movement,
    walkable: movement !== 0,
    groundLevel: Number((p >> 5n) & 0xfn),
    groundSlope: Number((p >> 9n) & 0xfn),
    ground: Number((p >> 13n) & 0x7ffn),
    layerGroundFlip: ((p >> 24n) & 0x1n) !== 0n,
    layerGroundRot: Number((p >> 25n) & 0x3n),
    layer1: Number((p >> 27n) & 0x3fffn),
    layerObject1Flip: ((p >> 41n) & 0x1n) !== 0n,
    layerObject1Rot: Number((p >> 42n) & 0x3n),
    layer2: Number((p >> 44n) & 0x3fffn),
    layerObject2Flip: ((p >> 58n) & 0x1n) !== 0n,
    layerObject2Rot: 0,
    layerObject2Interactive: ((p >> 59n) & 0x1n) !== 0n,
  };
}
