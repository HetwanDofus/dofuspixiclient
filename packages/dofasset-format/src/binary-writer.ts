import { match } from "ts-pattern";
import type { CompiledAsset, PathSegment, DrawCommand, BodyPart, AffineTransform, Frame, Animation, ExtractedImage, ColorZone, ExtrasPayload } from "./types.js";
import { MAGIC, FORMAT_VERSION, SectionType, AssetType } from "./types.js";

class BinaryBuffer {
  private buffer: Buffer;
  private offset: number;

  constructor(initialSize: number = 1024 * 64) {
    this.buffer = Buffer.alloc(initialSize);
    this.offset = 0;
  }

  private ensure(bytes: number): void {
    while (this.offset + bytes > this.buffer.length) {
      const newBuf = Buffer.alloc(this.buffer.length * 2);
      this.buffer.copy(newBuf);
      this.buffer = newBuf;
    }
  }

  writeU8(v: number): void {
    this.ensure(1);
    this.buffer.writeUInt8(v, this.offset);
    this.offset += 1;
  }

  writeU16(v: number): void {
    this.ensure(2);
    this.buffer.writeUInt16LE(v, this.offset);
    this.offset += 2;
  }

  writeU32(v: number): void {
    this.ensure(4);
    this.buffer.writeUInt32LE(v, this.offset);
    this.offset += 4;
  }

  writeF32(v: number): void {
    this.ensure(4);
    this.buffer.writeFloatLE(v, this.offset);
    this.offset += 4;
  }

  writeBytes(data: Uint8Array): void {
    this.ensure(data.length);
    Buffer.from(data).copy(this.buffer, this.offset);
    this.offset += data.length;
  }

  writeTransform(t: AffineTransform): void {
    for (const v of t) this.writeF32(v);
  }

  writeColor(c: { r: number; g: number; b: number; a: number }): void {
    this.writeU8(c.r);
    this.writeU8(c.g);
    this.writeU8(c.b);
    this.writeU8(c.a);
  }

  toBuffer(): Buffer {
    return this.buffer.subarray(0, this.offset);
  }
}

const PATH_TYPE_MAP: Record<string, number> = { M: 0, L: 1, Q: 2, C: 3, Z: 4 };

function writePathTable(buf: BinaryBuffer, paths: PathSegment[][]): void {
  buf.writeU32(paths.length);
  for (const segments of paths) {
    buf.writeU16(segments.length);
    for (const seg of segments) {
      buf.writeU8(PATH_TYPE_MAP[seg.type] ?? 0);
      for (const coord of seg.coords) buf.writeF32(coord);
    }
  }
}

function writeDrawCmdTable(buf: BinaryBuffer, commands: DrawCommand[]): void {
  buf.writeU32(commands.length);
  for (const cmd of commands) {
    buf.writeU8(cmd.type);
    buf.writeU32(cmd.pathId);
    buf.writeU8(cmd.fillRule);
    buf.writeTransform(cmd.transform);

    match(cmd)
      .with({ type: 0 }, (c) => {
        buf.writeColor(c.color);
        buf.writeU8(c.colorZoneId);
      })
      .with({ type: 1 }, (c) => {
        buf.writeColor(c.color);
        buf.writeU8(c.colorZoneId);
        buf.writeU8(c.widthMode);
        buf.writeF32(c.width);
        buf.writeF32(c.opacity);
        buf.writeU8(c.lineCap);
        buf.writeU8(c.lineJoin);
      })
      .with({ type: 2 }, (c) => {
        buf.writeU16(c.imageId);
        buf.writeTransform(c.patternTransform);
      })
      .with({ type: 3 }, (c) => {
        buf.writeU8(c.gradientType);
        buf.writeF32(c.cx);
        buf.writeF32(c.cy);
        buf.writeF32(c.fx);
        buf.writeF32(c.fy);
        buf.writeF32(c.r);
        buf.writeTransform(c.gradientTransform);
        buf.writeU8(c.stops.length);
        for (const stop of c.stops) {
          buf.writeF32(stop.offset);
          buf.writeColor(stop.color);
        }
      })
      .exhaustive();
  }
}

function writeBodyPartTable(buf: BinaryBuffer, parts: BodyPart[]): void {
  buf.writeU16(parts.length);
  for (const part of parts) {
    buf.writeU16(part.drawCommandIds.length);
    for (const cmdId of part.drawCommandIds) buf.writeU32(cmdId);
  }
}

function writeTransformTable(buf: BinaryBuffer, transforms: AffineTransform[]): void {
  buf.writeU32(transforms.length);
  for (const t of transforms) buf.writeTransform(t);
}

function writeImageTable(buf: BinaryBuffer, images: ExtractedImage[]): void {
  buf.writeU16(images.length);
  for (const img of images) {
    buf.writeU32(img.width);
    buf.writeU32(img.height);
    buf.writeU32(img.pngBytes.length);
    buf.writeBytes(img.pngBytes);
  }
}

function writeColorZoneTable(buf: BinaryBuffer, zones: ColorZone[]): void {
  buf.writeU8(zones.length);
  for (const zone of zones) {
    buf.writeU8(zone.zoneId);
    buf.writeU8(zone.playerColorIndex);
    // tint_mode: 0=Player, 1=Guild, 2=AlignmentLevel, 3=Spell
    buf.writeU8(zone.tintMode);
    buf.writeU16(zone.originalColors.length);
    for (const c of zone.originalColors) {
      buf.writeU8(c.r);
      buf.writeU8(c.g);
      buf.writeU8(c.b);
    }
  }
}

function writeStringTable(buf: BinaryBuffer, strings: string[]): void {
  buf.writeU16(strings.length);
  const encoded = strings.map((s) => Buffer.from(s, "utf-8"));
  let offset = 0;
  for (const enc of encoded) {
    buf.writeU32(offset);
    buf.writeU16(enc.length);
    offset += enc.length;
  }
  for (const enc of encoded) buf.writeBytes(new Uint8Array(enc));
}

function writeAnimationTable(buf: BinaryBuffer, animations: Animation[], stringIds: Map<string, number>): void {
  buf.writeU16(animations.length);
  for (const anim of animations) {
    buf.writeU16(stringIds.get(anim.name) ?? 0);
    buf.writeU16(anim.fps);
    buf.writeF32(anim.offsetX);
    buf.writeF32(anim.offsetY);
    buf.writeU16(anim.frameIds.length);
    buf.writeU32(anim.baseFrameId === -1 ? 0xFFFFFFFF : anim.baseFrameId);
    buf.writeU8(anim.baseZOrder);
    for (const fid of anim.frameIds) buf.writeU32(fid);
  }
}

function writeFrameTable(buf: BinaryBuffer, frames: Frame[]): void {
  buf.writeU32(frames.length);
  for (const frame of frames) {
    buf.writeF32(frame.clipRect[0]);
    buf.writeF32(frame.clipRect[1]);
    buf.writeF32(frame.clipRect[2]);
    buf.writeF32(frame.clipRect[3]);
    buf.writeF32(frame.offsetX);
    buf.writeF32(frame.offsetY);
    buf.writeU32(frame.frameTransformId);
    buf.writeU16(frame.parts.length);
    buf.writeU8(frame.accessorySlots.length);
    for (const part of frame.parts) {
      buf.writeU16(part.bodyPartId);
      buf.writeU32(part.transformId);
    }
    for (const acc of frame.accessorySlots) {
      buf.writeU8(acc.slotId);
      buf.writeU8(acc.depthIndex);
      buf.writeU32(acc.transformId);
      // Side frame name captured from the AS2 `applyAccessory(mc, slot, side,
      // …)` call. Renderer uses this as the accessory's own animation-map
      // key when present. Capped at 255 bytes; empty string = no override.
      const sideBytes = new TextEncoder().encode(acc.side ?? "");
      buf.writeU8(sideBytes.length);
      if (sideBytes.length > 0) buf.writeBytes(sideBytes);
    }
  }
}

function writeExtrasSection(b: BinaryBuffer, extras: ExtrasPayload): void {
  const json = JSON.stringify(extras.data ?? null);
  const bytes = new TextEncoder().encode(json);
  b.writeU16(extras.kind);
  b.writeU32(bytes.length);
  b.writeBytes(bytes);
}

/**
 * Serialize a CompiledAsset to .dofasset binary format.
 */
export function writeBinary(asset: CompiledAsset): Buffer {
  const strings = asset.animations.map((a) => a.name);
  const stringIds = new Map<string, number>();
  strings.forEach((s, i) => stringIds.set(s, i));

  const sectionBuffers: { type: SectionType; data: Buffer }[] = [];

  const sections: { type: SectionType; writer: (buf: BinaryBuffer) => void }[] = [
    { type: SectionType.PathTable, writer: (b) => writePathTable(b, asset.paths) },
    { type: SectionType.DrawCmdTable, writer: (b) => writeDrawCmdTable(b, asset.drawCommands) },
    { type: SectionType.BodyPartTable, writer: (b) => writeBodyPartTable(b, asset.bodyParts) },
    { type: SectionType.TransformTable, writer: (b) => writeTransformTable(b, asset.transforms) },
    { type: SectionType.ImageTable, writer: (b) => writeImageTable(b, asset.images) },
    { type: SectionType.ColorZoneTable, writer: (b) => writeColorZoneTable(b, asset.colorZones) },
    { type: SectionType.StringTable, writer: (b) => writeStringTable(b, strings) },
    { type: SectionType.AnimationTable, writer: (b) => writeAnimationTable(b, asset.animations, stringIds) },
    { type: SectionType.FrameTable, writer: (b) => writeFrameTable(b, asset.frames) },
  ];

  if (asset.extras) {
    sections.push({
      type: SectionType.Extras,
      writer: (b) => writeExtrasSection(b, asset.extras!),
    });
  }

  for (const section of sections) {
    const buf = new BinaryBuffer();
    section.writer(buf);
    sectionBuffers.push({ type: section.type, data: buf.toBuffer() });
  }

  const out = new BinaryBuffer();

  // Header (20 bytes)
  out.writeBytes(MAGIC);
  out.writeU16(FORMAT_VERSION);
  out.writeU16(AssetType.Sprite);
  out.writeU32(asset.assetId);
  out.writeU16(sectionBuffers.length);
  out.writeU16(0); // flags
  out.writeU32(0); // reserved

  // Section directory (10 bytes per entry)
  const headerSize = 20;
  const dirSize = sectionBuffers.length * 10;
  let dataOffset = headerSize + dirSize;

  for (const section of sectionBuffers) {
    out.writeU16(section.type);
    out.writeU32(dataOffset);
    out.writeU32(section.data.length);
    dataOffset += section.data.length;
  }

  for (const section of sectionBuffers) {
    out.writeBytes(new Uint8Array(section.data));
  }

  return out.toBuffer();
}
