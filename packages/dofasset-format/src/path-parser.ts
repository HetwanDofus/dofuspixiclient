import type { PathSegment } from "./types.js";

/**
 * Tokenize an SVG path `d` attribute into commands and numbers.
 * Handles compact notation like "M1.5-4.2q.8 0 2.5 2.6"
 */
function tokenize(d: string): (string | number)[] {
  const tokens: (string | number)[] = [];
  const re = /([MmLlHhVvQqTtCcSsAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(d)) !== null) {
    if (match[1] !== undefined) {
      tokens.push(match[1]);
    } else if (match[2] !== undefined) {
      tokens.push(parseFloat(match[2]));
    }
  }
  return tokens;
}

/**
 * Parse an SVG path `d` attribute into normalized PathSegments.
 * All commands are converted to absolute: M, L, Q, C, Z.
 * - H/V → L
 * - S → C (smooth cubic)
 * - T → Q (smooth quadratic)
 * - A → approximated as L (arcs are rare in these sprites)
 * - Relative variants → absolute
 */
export function parsePath(d: string): PathSegment[] {
  const tokens = tokenize(d);
  const segments: PathSegment[] = [];

  let i = 0;
  let curX = 0;
  let curY = 0;
  let startX = 0;
  let startY = 0;
  let lastCmd = "";
  let lastControlX = 0;
  let lastControlY = 0;

  function num(): number {
    const val = tokens[i];
    if (typeof val !== "number") {
      throw new Error(`Expected number at index ${i}, got: ${String(val)}`);
    }
    i++;
    return val;
  }

  function hasMoreNumbers(): boolean {
    return i < tokens.length && typeof tokens[i] === "number";
  }

  while (i < tokens.length) {
    let cmd: string;
    if (typeof tokens[i] === "string") {
      cmd = tokens[i] as string;
      i++;
    } else {
      // Implicit repeat of last command
      cmd = lastCmd;
    }

    const isRel = cmd === cmd.toLowerCase() && cmd !== "Z" && cmd !== "z";
    const absCmd = cmd.toUpperCase();

    do {
      switch (absCmd) {
        case "M": {
          const x = num() + (isRel ? curX : 0);
          const y = num() + (isRel ? curY : 0);
          segments.push({ type: "M", coords: [x, y] });
          curX = x;
          curY = y;
          startX = x;
          startY = y;
          lastControlX = curX;
          lastControlY = curY;
          // After M/m, implicit coordinates are L/l (SVG spec).
          // Process them here to avoid the do-while reusing "M".
          while (hasMoreNumbers()) {
            const lx = num() + (isRel ? curX : 0);
            const ly = num() + (isRel ? curY : 0);
            segments.push({ type: "L", coords: [lx, ly] });
            curX = lx;
            curY = ly;
          }
          lastCmd = isRel ? "l" : "L";
          break;
        }
        case "L": {
          const x = num() + (isRel ? curX : 0);
          const y = num() + (isRel ? curY : 0);
          segments.push({ type: "L", coords: [x, y] });
          curX = x;
          curY = y;
          lastControlX = curX;
          lastControlY = curY;
          lastCmd = cmd;
          break;
        }
        case "H": {
          const x = num() + (isRel ? curX : 0);
          segments.push({ type: "L", coords: [x, curY] });
          curX = x;
          lastControlX = curX;
          lastControlY = curY;
          lastCmd = cmd;
          break;
        }
        case "V": {
          const y = num() + (isRel ? curY : 0);
          segments.push({ type: "L", coords: [curX, y] });
          curY = y;
          lastControlX = curX;
          lastControlY = curY;
          lastCmd = cmd;
          break;
        }
        case "Q": {
          const cx = num() + (isRel ? curX : 0);
          const cy = num() + (isRel ? curY : 0);
          const x = num() + (isRel ? curX : 0);
          const y = num() + (isRel ? curY : 0);
          segments.push({ type: "Q", coords: [cx, cy, x, y] });
          lastControlX = cx;
          lastControlY = cy;
          curX = x;
          curY = y;
          lastCmd = cmd;
          break;
        }
        case "T": {
          // Smooth quadratic: reflect last control point
          const prevCmd = lastCmd.toUpperCase();
          let cx: number;
          let cy: number;
          if (prevCmd === "Q" || prevCmd === "T") {
            cx = 2 * curX - lastControlX;
            cy = 2 * curY - lastControlY;
          } else {
            cx = curX;
            cy = curY;
          }
          const x = num() + (isRel ? curX : 0);
          const y = num() + (isRel ? curY : 0);
          segments.push({ type: "Q", coords: [cx, cy, x, y] });
          lastControlX = cx;
          lastControlY = cy;
          curX = x;
          curY = y;
          lastCmd = cmd;
          break;
        }
        case "C": {
          const c1x = num() + (isRel ? curX : 0);
          const c1y = num() + (isRel ? curY : 0);
          const c2x = num() + (isRel ? curX : 0);
          const c2y = num() + (isRel ? curY : 0);
          const x = num() + (isRel ? curX : 0);
          const y = num() + (isRel ? curY : 0);
          segments.push({ type: "C", coords: [c1x, c1y, c2x, c2y, x, y] });
          lastControlX = c2x;
          lastControlY = c2y;
          curX = x;
          curY = y;
          lastCmd = cmd;
          break;
        }
        case "S": {
          // Smooth cubic: reflect last control point
          const prevCmdS = lastCmd.toUpperCase();
          let c1x: number;
          let c1y: number;
          if (prevCmdS === "C" || prevCmdS === "S") {
            c1x = 2 * curX - lastControlX;
            c1y = 2 * curY - lastControlY;
          } else {
            c1x = curX;
            c1y = curY;
          }
          const c2x = num() + (isRel ? curX : 0);
          const c2y = num() + (isRel ? curY : 0);
          const x = num() + (isRel ? curX : 0);
          const y = num() + (isRel ? curY : 0);
          segments.push({ type: "C", coords: [c1x, c1y, c2x, c2y, x, y] });
          lastControlX = c2x;
          lastControlY = c2y;
          curX = x;
          curY = y;
          lastCmd = cmd;
          break;
        }
        case "A": {
          // Arc — approximate as line to endpoint (arcs extremely rare in these sprites).
          // Skip rx, ry, rotation, largeArc, sweep.
          num(); num(); num(); num(); num();
          const x = num() + (isRel ? curX : 0);
          const y = num() + (isRel ? curY : 0);
          segments.push({ type: "L", coords: [x, y] });
          curX = x;
          curY = y;
          lastControlX = curX;
          lastControlY = curY;
          lastCmd = cmd;
          break;
        }
        case "Z": {
          segments.push({ type: "Z", coords: [] });
          curX = startX;
          curY = startY;
          lastControlX = curX;
          lastControlY = curY;
          lastCmd = cmd;
          break;
        }
        default:
          throw new Error(`Unknown SVG path command: ${cmd}`);
      }
    } while (absCmd !== "Z" && hasMoreNumbers());
  }

  return segments;
}

/**
 * Serialize PathSegments back to a canonical string for hashing/dedup.
 * Uses fixed precision to avoid floating-point noise.
 */
export function serializePath(segments: PathSegment[]): string {
  return segments
    .map((s) => {
      const coords = s.coords.map((c) => round4(c)).join(",");
      return coords ? `${s.type}${coords}` : s.type;
    })
    .join(";");
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
