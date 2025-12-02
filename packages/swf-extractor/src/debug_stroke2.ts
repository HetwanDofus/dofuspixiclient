import { Swf } from "./parser/swf.ts";
import { SwfExtractor } from "./extractor/swf-extractor.ts";
import { SvgCanvas } from "./extractor/drawer/svg/svg-canvas.ts";
import { drawFrame } from "./extractor/timeline/frame.ts";

const data = await Bun.file("../../assets/sources/clips/gfx/o1.swf").arrayBuffer();
const swf = Swf.fromBuffer(new Uint8Array(data));
const extractor = new SwfExtractor(swf);

// Get the exported asset "245"
let sprite: any = null;
for (const asset of extractor.exported()) {
  if (asset.name === "245") {
    sprite = extractor.getSprite(asset.id);
    break;
  }
}
if (!sprite) {
  console.log("Sprite not found");
  process.exit(1);
}

const timeline = sprite.timeline();
const frame = timeline.getFrame(0);
if (!frame) {
  console.log("Frame not found");
  process.exit(1);
}

// Create canvas with default options (should be subpixelStrokeWidth = false)
const canvas = new SvgCanvas();
console.log("Canvas subpixelStrokeWidth:", (canvas as any).subpixelStrokeWidth);

drawFrame(frame, canvas, 0);
const svg = canvas.render();

// Check for vector-effect
const vectorEffectCount = (svg.match(/vector-effect/g) || []).length;
console.log("vector-effect count:", vectorEffectCount);

// Check for stroke-width values
const strokeWidths = svg.match(/stroke-width="([^"]+)"/g) || [];
const subpixelStrokes = strokeWidths.filter(s => {
  const val = parseFloat(s.match(/stroke-width="([^"]+)"/)?.[1] || "0");
  return val > 0 && val < 1;
});
console.log("Total strokes:", strokeWidths.length);
console.log("Subpixel strokes (< 1):", subpixelStrokes.length);
if (subpixelStrokes.length > 0) {
  console.log("First 5 subpixel strokes:", subpixelStrokes.slice(0, 5));
}
