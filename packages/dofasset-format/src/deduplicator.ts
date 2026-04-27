import type {
  ParsedSvg,
  ParsedNode,
  PathSegment,
  DrawCommand,
  DrawCommandType,
  FillDrawCommand,
  StrokeDrawCommand,
  PatternFillDrawCommand,
  GradientFillDrawCommand,
  GradientStop,
  BodyPart,
  AffineTransform,
  FillRule,
  StrokeWidthMode,
  Frame,
  PartInstance,
  AccessorySlot,
  Animation,
  AtlasJson,
  ExtractedImage,
  CompiledAsset,
} from "./types.js";
import { IDENTITY_TRANSFORM } from "./types.js";

// Pre-allocated buffers for float-to-bits conversion (avoids allocation per hash)
const _f32 = new Float32Array(1);
const _u32 = new Uint32Array(_f32.buffer);

function fnv1a(h: number, val: number): number {
  return Math.imul(h ^ val, 16777619) >>> 0;
}

function fnvFloat(h: number, v: number): number {
  _f32[0] = v;
  return fnv1a(h, _u32[0]!);
}

function hashTransform(t: AffineTransform): number {
  let h = 2166136261;
  h = fnvFloat(h, t[0]); h = fnvFloat(h, t[1]); h = fnvFloat(h, t[2]);
  h = fnvFloat(h, t[3]); h = fnvFloat(h, t[4]); h = fnvFloat(h, t[5]);
  return h;
}

function transformsEqual(a: AffineTransform, b: AffineTransform): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] &&
         a[3] === b[3] && a[4] === b[4] && a[5] === b[5];
}

function composeTransforms(a: AffineTransform, b: AffineTransform): AffineTransform {
  // Use Math.fround to match usvg's f32 transform composition precision.
  // Without this, JavaScript f64 intermediate results produce different f32 values
  // than usvg's native f32 composition, causing sub-pixel rendering differences.
  const f = Math.fround;
  return [
    f(f(a[0] * b[0]) + f(a[2] * b[1])),
    f(f(a[1] * b[0]) + f(a[3] * b[1])),
    f(f(a[0] * b[2]) + f(a[2] * b[3])),
    f(f(a[1] * b[2]) + f(a[3] * b[3])),
    f(f(f(a[0] * b[4]) + f(a[2] * b[5])) + a[4]),
    f(f(f(a[1] * b[4]) + f(a[3] * b[5])) + a[5]),
  ];
}

/** CSS named colors → hex */
const CSS_COLORS: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff",
  yellow: "#ffff00", cyan: "#00ffff", magenta: "#ff00ff", orange: "#ffa500", purple: "#800080",
  pink: "#ffc0cb", brown: "#a52a2a", gray: "#808080", grey: "#808080",
  lime: "#00ff00", navy: "#000080", teal: "#008080", maroon: "#800000", olive: "#808000",
  aqua: "#00ffff", fuchsia: "#ff00ff", silver: "#c0c0c0",
};

/** Parse fill color string to RGBA */
function parseColor(fill: string, opacity: number): { r: number; g: number; b: number; a: number } {
  let hex: string | undefined;
  if (fill.startsWith("#")) {
    hex = fill.slice(1);
  } else if (CSS_COLORS[fill.toLowerCase()]) {
    hex = CSS_COLORS[fill.toLowerCase()]!.slice(1);
  }
  if (hex) {
    if (hex.length === 3) hex = hex[0]! + hex[0]! + hex[1]! + hex[1]! + hex[2]! + hex[2]!;
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: Math.round(opacity * 255),
    };
  }
  return { r: 0, g: 0, b: 0, a: Math.round(opacity * 255) };
}

function lineCapToNum(cap: string): number {
  switch (cap) {
    case "round": return 1;
    case "square": return 2;
    default: return 0; // butt
  }
}

function lineJoinToNum(join: string): number {
  switch (join) {
    case "round": return 1;
    case "bevel": return 2;
    default: return 0; // miter
  }
}

/**
 * Compute the stroke width mode and numeric width for a parsed path, applying
 * Flash-twip semantics:
 *   - `stroke-width="__RESOLUTION__"` legacy placeholder → Resolution mode, width 1.0
 *   - `vector-effect="non-scaling-stroke"` (possibly inherited) → NonScaling mode with original width
 *   - Otherwise → Fixed mode with parsed numeric width
 */
function resolveStrokeMode(
  strokeWidth: string | null,
  vectorEffect: string | null,
): { widthMode: StrokeWidthMode; width: number } {
  if (strokeWidth === "__RESOLUTION__") {
    return { widthMode: 1 as StrokeWidthMode, width: 1.0 };
  }
  const parsed = strokeWidth ? parseFloat(strokeWidth) : NaN;
  const width = Number.isFinite(parsed) && parsed > 0 ? parsed : 1.0;
  if (vectorEffect === "non-scaling-stroke") {
    return { widthMode: 2 as StrokeWidthMode, width };
  }
  return { widthMode: 0 as StrokeWidthMode, width };
}

interface PatternLookup {
  patternId: string;
  imageId: number;
  patternTransform: AffineTransform;
}

interface GradientLookup {
  gradientType: number; // 0 = radial, 1 = linear
  cx: number;
  cy: number;
  fx: number;
  fy: number;
  r: number;
  gradientTransform: AffineTransform;
  stops: GradientStop[];
}

function parseGradientStopColor(color: string, opacity: number): { r: number; g: number; b: number; a: number } {
  if (color.startsWith("#")) {
    let hex = color.slice(1);
    if (hex.length === 3) hex = hex[0]! + hex[0]! + hex[1]! + hex[1]! + hex[2]! + hex[2]!;
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: Math.round(opacity * 255),
    };
  }
  return { r: 0, g: 0, b: 0, a: Math.round(opacity * 255) };
}

/** Try to create a fill command for url(#...) references — patterns or gradients */
function tryCreateUrlFill(
  fillRef: string,
  pathId: number,
  fillRule: FillRule,
  transform: AffineTransform,
  patternLookup: Map<string, PatternLookup>,
  gradientLookup: Map<string, GradientLookup>,
): DrawCommand | null {
  const refId = fillRef.match(/url\(#([^)]+)\)/)?.[1] ?? "";
  const pat = patternLookup.get(refId);
  if (pat) {
    return {
      type: 2 as DrawCommandType.PatternFill,
      pathId,
      fillRule,
      imageId: pat.imageId,
      patternTransform: pat.patternTransform,
      transform,
    } satisfies PatternFillDrawCommand;
  }
  const grad = gradientLookup.get(refId);
  if (grad) {
    return {
      type: 3 as DrawCommandType.GradientFill,
      pathId,
      fillRule,
      gradientType: grad.gradientType,
      cx: grad.cx,
      cy: grad.cy,
      fx: grad.fx,
      fy: grad.fy,
      r: grad.r,
      gradientTransform: grad.gradientTransform,
      stops: grad.stops,
      transform,
    } satisfies GradientFillDrawCommand;
  }
  return null;
}

/**
 * Recursively resolve a definition node into a flat list of draw commands.
 * Follows <use> references and composes transforms along the way.
 */
function resolveToDrawCommands(
  nodeId: string,
  definitions: Map<string, ParsedNode>,
  parentTransform: AffineTransform,
  patternLookup: Map<string, PatternLookup>,
  gradientLookup: Map<string, GradientLookup>,
  pathDedup: Map<number, number[]>,
  allPaths: PathSegment[][],
  visited: Set<string>,
): DrawCommand[] {
  if (visited.has(nodeId)) return []; // prevent cycles
  visited.add(nodeId);

  const node = definitions.get(nodeId);
  if (!node) {
    visited.delete(nodeId);
    return [];
  }

  const commands: DrawCommand[] = [];

  if (node.type === "path") {
    const p = node.data;
    if (p.segments.length === 0) {
      visited.delete(nodeId);
      return [];
    }

    let pathId: number;
    {
      const h = hashPath(p.segments);
      const cands = pathDedup.get(h);
      let found = -1;
      if (cands) { for (const c of cands) { if (pathsEqual(allPaths[c]!, p.segments)) { found = c; break; } } }
      if (found >= 0) { pathId = found; }
      else { pathId = allPaths.length; allPaths.push(p.segments); if (cands) cands.push(pathId); else pathDedup.set(h, [pathId]); }
    }

    const transform = composeTransforms(parentTransform, p.transform);

    // Fill command
    if (p.fill && p.fill !== "none") {
      if (p.fill.startsWith("url(#")) {
        const cmd = tryCreateUrlFill(p.fill, pathId, p.fillRule, transform, patternLookup, gradientLookup);
        if (cmd) commands.push(cmd);
      } else {
        const color = parseColor(p.fill, p.fillOpacity);
        commands.push({
          type: 0 as DrawCommandType.Fill,
          pathId,
          fillRule: p.fillRule,
          color,
          colorZoneId: 0,
          transform,
        } satisfies FillDrawCommand);
      }
    }

    // Stroke command
    if (p.stroke && p.stroke !== "none" && p.strokeWidth) {
      const color = parseColor(p.stroke, p.strokeOpacity);
      const { widthMode, width } = resolveStrokeMode(p.strokeWidth, p.vectorEffect);
      commands.push({
        type: 1 as DrawCommandType.Stroke,
        pathId,
        fillRule: p.fillRule,
        color,
        colorZoneId: 0,
        widthMode,
        width,
        opacity: p.strokeOpacity,
        lineCap: lineCapToNum(p.strokeLinecap),
        lineJoin: lineJoinToNum(p.strokeLinejoin),
        transform,
      } satisfies StrokeDrawCommand);
    }
  } else if (node.type === "group") {
    const g = node.data;
    const groupTransform = composeTransforms(parentTransform, g.transform);
    for (const child of g.children) {
      if (child.type === "path") {
        // Inline path in group
        const p = child.data;
        if (p.segments.length === 0) continue;

        let pathId: number;
        {
          const h = hashPath(p.segments);
          const cands = pathDedup.get(h);
          let found = -1;
          if (cands) { for (const c of cands) { if (pathsEqual(allPaths[c]!, p.segments)) { found = c; break; } } }
          if (found >= 0) { pathId = found; }
          else { pathId = allPaths.length; allPaths.push(p.segments); if (cands) cands.push(pathId); else pathDedup.set(h, [pathId]); }
        }

        const transform = composeTransforms(groupTransform, p.transform);

        if (p.fill && p.fill !== "none") {
          if (p.fill.startsWith("url(#")) {
            const cmd = tryCreateUrlFill(p.fill, pathId, p.fillRule, transform, patternLookup, gradientLookup);
            if (cmd) commands.push(cmd);
          } else {
            const color = parseColor(p.fill, p.fillOpacity);
            commands.push({
              type: 0 as DrawCommandType.Fill,
              pathId,
              fillRule: p.fillRule,
              color,
              colorZoneId: 0,
              transform,
            } satisfies FillDrawCommand);
          }
        }

        if (p.stroke && p.stroke !== "none" && p.strokeWidth) {
          const color = parseColor(p.stroke, p.strokeOpacity);
          const { widthMode, width } = resolveStrokeMode(p.strokeWidth, p.vectorEffect);
          commands.push({
            type: 1 as DrawCommandType.Stroke,
            pathId,
            fillRule: p.fillRule,
            color,
            colorZoneId: 0,
            widthMode,
            width,
            opacity: p.strokeOpacity,
            lineCap: lineCapToNum(p.strokeLinecap),
            lineJoin: lineJoinToNum(p.strokeLinejoin),
            transform,
          } satisfies StrokeDrawCommand);
        }
      } else if (child.type === "use") {
        const useTransform = composeTransforms(groupTransform, child.data.transform);
        const resolved = resolveToDrawCommands(
          child.data.href, definitions, useTransform, patternLookup, gradientLookup, pathDedup, allPaths, visited,
        );
        commands.push(...resolved);
      } else if (child.type === "group") {
        const nestedTransform = composeTransforms(groupTransform, child.data.transform);
        // Process nested group children
        for (const nested of child.data.children) {
          if (nested.type === "path") {
            const p = nested.data;
            if (p.segments.length === 0) continue;
            let pathId: number;
            {
              const h = hashPath(p.segments);
              const cands = pathDedup.get(h);
              let found = -1;
              if (cands) { for (const c of cands) { if (pathsEqual(allPaths[c]!, p.segments)) { found = c; break; } } }
              if (found >= 0) { pathId = found; }
              else { pathId = allPaths.length; allPaths.push(p.segments); if (cands) cands.push(pathId); else pathDedup.set(h, [pathId]); }
            }
            const transform = composeTransforms(nestedTransform, p.transform);
            if (p.fill && p.fill !== "none") {
              if (p.fill.startsWith("url(#")) {
                const cmd = tryCreateUrlFill(p.fill, pathId, p.fillRule, transform, patternLookup, gradientLookup);
                if (cmd) commands.push(cmd);
              } else {
                commands.push({
                  type: 0 as DrawCommandType.Fill, pathId, fillRule: p.fillRule,
                  color: parseColor(p.fill, p.fillOpacity), colorZoneId: 0, transform,
                } satisfies FillDrawCommand);
              }
            }
            if (p.stroke && p.stroke !== "none" && p.strokeWidth) {
              const { widthMode, width } = resolveStrokeMode(p.strokeWidth, p.vectorEffect);
              commands.push({
                type: 1 as DrawCommandType.Stroke, pathId, fillRule: p.fillRule,
                color: parseColor(p.stroke, p.strokeOpacity), colorZoneId: 0,
                widthMode,
                width,
                opacity: p.strokeOpacity,
                lineCap: lineCapToNum(p.strokeLinecap), lineJoin: lineJoinToNum(p.strokeLinejoin),
                transform,
              } satisfies StrokeDrawCommand);
            }
          } else if (nested.type === "use") {
            const resolved = resolveToDrawCommands(
              nested.data.href, definitions,
              composeTransforms(nestedTransform, nested.data.transform),
              patternLookup, gradientLookup, pathDedup, allPaths, visited,
            );
            commands.push(...resolved);
          }
        }
      }
    }
  } else if (node.type === "use") {
    // Alias: resolve the target
    const useTransform = composeTransforms(parentTransform, node.data.transform);
    const resolved = resolveToDrawCommands(
      node.data.href, definitions, useTransform, patternLookup, gradientLookup, pathDedup, allPaths, visited,
    );
    commands.push(...resolved);
  }

  visited.delete(nodeId);
  return commands;
}

function hashPath(segments: PathSegment[]): number {
  let h = 2166136261;
  for (const seg of segments) {
    h = fnv1a(h, seg.type.charCodeAt(0));
    for (const c of seg.coords) h = fnvFloat(h, c);
  }
  return h;
}

function pathsEqual(a: PathSegment[], b: PathSegment[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.type !== b[i]!.type) return false;
    const ac = a[i]!.coords, bc = b[i]!.coords;
    if (ac.length !== bc.length) return false;
    for (let j = 0; j < ac.length; j++) if (ac[j] !== bc[j]) return false;
  }
  return true;
}

function hashDrawCommand(cmd: DrawCommand): number {
  let h = 2166136261;
  h = fnv1a(h, cmd.type);
  h = fnv1a(h, cmd.pathId);
  h = fnv1a(h, cmd.fillRule);
  h = fnv1a(h, hashTransform(cmd.transform));
  if (cmd.type === 0) {
    h = fnv1a(h, cmd.color.r); h = fnv1a(h, cmd.color.g);
    h = fnv1a(h, cmd.color.b); h = fnv1a(h, cmd.color.a);
    h = fnv1a(h, cmd.colorZoneId);
  } else if (cmd.type === 1) {
    h = fnv1a(h, cmd.color.r); h = fnv1a(h, cmd.color.g);
    h = fnv1a(h, cmd.color.b); h = fnv1a(h, cmd.color.a);
    h = fnv1a(h, cmd.colorZoneId);
    h = fnvFloat(h, cmd.width); h = fnvFloat(h, cmd.opacity);
  } else if (cmd.type === 2) {
    h = fnv1a(h, cmd.imageId);
    h = fnv1a(h, hashTransform(cmd.patternTransform));
  } else if (cmd.type === 3) {
    h = fnv1a(h, cmd.gradientType);
    h = fnvFloat(h, cmd.cx); h = fnvFloat(h, cmd.cy);
    h = fnvFloat(h, cmd.fx); h = fnvFloat(h, cmd.fy);
    h = fnvFloat(h, cmd.r);
    h = fnv1a(h, hashTransform(cmd.gradientTransform));
    for (const s of cmd.stops) {
      h = fnvFloat(h, s.offset);
      h = fnv1a(h, s.color.r); h = fnv1a(h, s.color.g);
      h = fnv1a(h, s.color.b); h = fnv1a(h, s.color.a);
    }
  }
  return h;
}

function drawCommandsEqual(a: DrawCommand, b: DrawCommand): boolean {
  if (a.type !== b.type || a.pathId !== b.pathId || a.fillRule !== b.fillRule) return false;
  if (!transformsEqual(a.transform, b.transform)) return false;
  if (a.type === 0 && b.type === 0) {
    return a.color.r === b.color.r && a.color.g === b.color.g && a.color.b === b.color.b && a.color.a === b.color.a && a.colorZoneId === b.colorZoneId;
  }
  if (a.type === 1 && b.type === 1) {
    return a.color.r === b.color.r && a.color.g === b.color.g && a.color.b === b.color.b && a.color.a === b.color.a && a.colorZoneId === b.colorZoneId && a.width === b.width && a.opacity === b.opacity;
  }
  if (a.type === 2 && b.type === 2) {
    return a.imageId === b.imageId && transformsEqual(a.patternTransform, b.patternTransform);
  }
  if (a.type === 3 && b.type === 3) {
    if (a.gradientType !== b.gradientType || a.cx !== b.cx || a.cy !== b.cy || a.fx !== b.fx || a.fy !== b.fy || a.r !== b.r) return false;
    if (!transformsEqual(a.gradientTransform, b.gradientTransform)) return false;
    if (a.stops.length !== b.stops.length) return false;
    for (let i = 0; i < a.stops.length; i++) {
      const sa = a.stops[i]!, sb = b.stops[i]!;
      if (sa.offset !== sb.offset || sa.color.r !== sb.color.r || sa.color.g !== sb.color.g || sa.color.b !== sb.color.b || sa.color.a !== sb.color.a) return false;
    }
    return true;
  }
  return false;
}

export interface AnimationInput {
  name: string;
  svg: ParsedSvg;
  atlas: AtlasJson;
}

/**
 * Main deduplication pipeline.
 * Takes parsed data from all animations and produces a CompiledAsset.
 */
export function deduplicate(
  assetId: number,
  animations: AnimationInput[],
  images: ExtractedImage[],
): CompiledAsset {
  // Shared dedup tables — use numeric hashing for fast lookups
  const pathDedup = new Map<number, number[]>(); // hash → candidate pathIds
  const allPaths: PathSegment[][] = [];

  const drawCmdDedup = new Map<number, number[]>(); // hash → candidate cmdIds
  const allDrawCommands: DrawCommand[] = [];

  const bodyPartDedup = new Map<string, number>(); // cmd list key → bodyPartId (kept as string, small count)
  const allBodyParts: BodyPart[] = [];

  const transformDedup = new Map<number, number[]>(); // hash → candidate transformIds
  const allTransforms: AffineTransform[] = [];

  const frameDedup = new Map<string, number>(); // frame key → frameId (kept as string, small count)
  const allFrames: Frame[] = [];

  const compiledAnimations: Animation[] = [];

  function getOrAddTransform(t: AffineTransform): number {
    const h = hashTransform(t);
    const candidates = transformDedup.get(h);
    if (candidates) {
      for (const cid of candidates) {
        if (transformsEqual(allTransforms[cid]!, t)) return cid;
      }
    }
    const id = allTransforms.length;
    allTransforms.push(t);
    if (candidates) candidates.push(id);
    else transformDedup.set(h, [id]);
    return id;
  }


  function getOrAddDrawCommand(cmd: DrawCommand): number {
    const h = hashDrawCommand(cmd);
    const candidates = drawCmdDedup.get(h);
    if (candidates) {
      for (const cid of candidates) {
        if (drawCommandsEqual(allDrawCommands[cid]!, cmd)) return cid;
      }
    }
    const id = allDrawCommands.length;
    allDrawCommands.push(cmd);
    if (candidates) candidates.push(id);
    else drawCmdDedup.set(h, [id]);
    return id;
  }

  function getOrAddBodyPart(cmdIds: number[]): number {
    const key = cmdIds.join(",");
    let id = bodyPartDedup.get(key);
    if (id === undefined) {
      id = allBodyParts.length;
      allBodyParts.push({ id, drawCommandIds: cmdIds });
      bodyPartDedup.set(key, id);
    }
    return id;
  }

  for (const anim of animations) {
    const { svg, atlas } = anim;

    // Build per-animation pattern and gradient lookups to avoid ID collisions
    // (different animations reuse the same element IDs like d0, d1, d2...)
    const patternLookup = new Map<string, PatternLookup>();
    for (const pattern of svg.patterns) {
      const imageIdx = images.findIndex((img) => {
        const b64 = pattern.imageDataUri.replace(/^data:image\/\w+;base64,/, "");
        const buf = Buffer.from(b64, "base64");
        return buf.equals(Buffer.from(img.pngBytes));
      });
      if (imageIdx >= 0) {
        patternLookup.set(pattern.id, {
          patternId: pattern.id,
          imageId: imageIdx,
          patternTransform: pattern.patternTransform,
        });
      }
    }

    const gradientLookup = new Map<string, GradientLookup>();
    for (const grad of svg.gradients) {
      if (!gradientLookup.has(grad.id)) {
        gradientLookup.set(grad.id, {
          gradientType: grad.type === "radial" ? 0 : 1,
          cx: grad.cx,
          cy: grad.cy,
          fx: grad.fx,
          fy: grad.fy,
          r: grad.r,
          gradientTransform: grad.gradientTransform,
          stops: grad.stops.map((s) => ({
            offset: s.offset,
            color: parseGradientStopColor(s.color, s.opacity),
          })),
        });
      }
    }

    // For each frame in the SVG, resolve body parts
    const svgFrameData: { bodyPartIds: PartInstance[]; accSlots: AccessorySlot[]; frameTransformId: number }[] = [];

    for (const frame of svg.frames) {
      const parts: PartInstance[] = [];
      const accSlots: AccessorySlot[] = [];

      for (const use of frame.uses) {
        // Resolve this body part reference to draw commands
        const drawCmds = resolveToDrawCommands(
          use.href, svg.definitions, [...IDENTITY_TRANSFORM] as AffineTransform,
          patternLookup, gradientLookup, pathDedup, allPaths, new Set(),
        );

        // Dedup draw commands
        const cmdIds = drawCmds.map((cmd) => getOrAddDrawCommand(cmd));

        // Dedup body part
        const bodyPartId = getOrAddBodyPart(cmdIds);

        // Compose frame offset transform with the use element's transform
        // The SVG frame has: <g transform="translate(x,y)"> → <use transform="matrix(...)">
        // We need: frameOffset * useTransform
        const composedTransform = composeTransforms(frame.offsetTransform, use.transform);
        const transformId = getOrAddTransform(composedTransform);
        parts.push({ bodyPartId, transformId });
      }

      for (const slot of frame.accessorySlots) {
        // Store the raw acc-slot matrix WITHOUT frame offset.
        // The renderer will compose the full transform at render time
        // using the accessory's offsetX/offsetY for pivot-point rotation.
        const rawMatrix: AffineTransform = slot.matrix
          ? [...slot.matrix] as AffineTransform
          : [1, 0, 0, 1, slot.tx, slot.ty];
        const transformId = getOrAddTransform(rawMatrix);
        // depthIndex = insertion position: render this slot after parts[0..depthIndex-1]
        accSlots.push({
          slotId: slot.slotId,
          depthIndex: slot.insertAfterPart,
          transformId,
          side: slot.side ?? "",
        });
      }

      const frameTransformId = getOrAddTransform(frame.offsetTransform);
      svgFrameData.push({ bodyPartIds: parts, accSlots, frameTransformId });
    }

    // Map atlas frames to SVG frames by matching clip rect coordinates.
    // This is necessary because when a baseFrame exists, the SVG contains
    // it as an extra <g clip-path> group (usually frame 0), shifting the
    // indices so that atlas.frames[i] no longer corresponds to svg.frames[i].
    const atlasIdToSvgIdx = new Map<string, number>(); // atlas frame id → svg frame index
    const atlasFrameById = new Map<string, (typeof atlas.frames)[0]>();
    for (const af of atlas.frames) {
      atlasFrameById.set(af.id, af);
      const svgIdx = svg.frames.findIndex((f) =>
        Math.abs(f.clipRect.x - af.x) < 1 &&
        Math.abs(f.clipRect.y - af.y) < 1 &&
        Math.abs(f.clipRect.width - af.width) < 1 &&
        Math.abs(f.clipRect.height - af.height) < 1
      );
      if (svgIdx >= 0) {
        atlasIdToSvgIdx.set(af.id, svgIdx);
      }
    }

    // Build compiled frames for this animation's unique frames
    const animFrameIds: number[] = [];
    const localFrameCache = new Map<number, number>(); // svgFrameIdx → global frame id

    for (const frameId of atlas.frameOrder) {
      // Resolve duplicates
      const resolvedId = atlas.duplicates[frameId] ?? frameId;
      const svgFrameIdx = atlasIdToSvgIdx.get(resolvedId);
      const atlasFrame = atlasFrameById.get(resolvedId);
      if (svgFrameIdx === undefined || atlasFrame === undefined || svgFrameIdx >= svgFrameData.length) {
        // Fallback: use first frame
        animFrameIds.push(0);
        continue;
      }

      // Check if we already compiled this SVG frame
      let globalFrameId = localFrameCache.get(svgFrameIdx);
      if (globalFrameId === undefined) {
        const frameData = svgFrameData[svgFrameIdx]!;

        const frame: Frame = {
          clipRect: [atlasFrame.x, atlasFrame.y, atlasFrame.width, atlasFrame.height],
          offsetX: atlasFrame.offsetX,
          offsetY: atlasFrame.offsetY,
          parts: frameData.bodyPartIds,
          accessorySlots: frameData.accSlots,
          frameTransformId: frameData.frameTransformId,
        };

        // Dedup frame globally
        const frameKey = JSON.stringify(frame);
        globalFrameId = frameDedup.get(frameKey);
        if (globalFrameId === undefined) {
          globalFrameId = allFrames.length;
          allFrames.push(frame);
          frameDedup.set(frameKey, globalFrameId);
        }
        localFrameCache.set(svgFrameIdx, globalFrameId);
      }

      animFrameIds.push(globalFrameId);
    }

    // Handle baseFrame if present
    let baseFrameId = -1;
    let baseZOrder = 0;
    const baseFrameMeta = atlas.baseFrame;
    const baseZOrderStr = atlas.baseZOrder;
    if (baseFrameMeta && svg.frames.length > 0) {
      // The base frame is the first <g clip-path> in the SVG that matches baseFrame coordinates
      // It's at index 0 before the animation-specific delta frames
      const baseIdx = svg.frames.findIndex((f) =>
        Math.abs(f.clipRect.x - baseFrameMeta.x) < 1 &&
        Math.abs(f.clipRect.y - baseFrameMeta.y) < 1 &&
        Math.abs(f.clipRect.width - baseFrameMeta.width) < 1 &&
        Math.abs(f.clipRect.height - baseFrameMeta.height) < 1
      );
      if (baseIdx >= 0 && baseIdx < svgFrameData.length) {
        const baseData = svgFrameData[baseIdx]!;
        const baseFrame: Frame = {
          clipRect: [baseFrameMeta.x, baseFrameMeta.y, baseFrameMeta.width, baseFrameMeta.height],
          offsetX: baseFrameMeta.offsetX,
          offsetY: baseFrameMeta.offsetY,
          parts: baseData.bodyPartIds,
          accessorySlots: baseData.accSlots,
          frameTransformId: baseData.frameTransformId,
        };
        const baseKey = JSON.stringify(baseFrame);
        let gid = frameDedup.get(baseKey);
        if (gid === undefined) {
          gid = allFrames.length;
          allFrames.push(baseFrame);
          frameDedup.set(baseKey, gid);
        }
        baseFrameId = gid;
      }
      baseZOrder = baseZOrderStr === "above" ? 1 : 0;
    }

    compiledAnimations.push({
      name: anim.name,
      fps: atlas.fps,
      offsetX: atlas.offsetX,
      offsetY: atlas.offsetY,
      frameIds: animFrameIds,
      baseFrameId,
      baseZOrder,
    });
  }

  return {
    assetId,
    paths: allPaths,
    drawCommands: allDrawCommands,
    bodyParts: allBodyParts,
    transforms: allTransforms,
    images,
    colorZones: [],
    animations: compiledAnimations,
    frames: allFrames,
  };
}
