import { SwfParser } from "@/parser/swf-parser.ts";
import { SwfExtractor } from "@/extractor/swf-extractor.ts";
import { SvgCanvas } from "@/extractor/drawer/svg/svg-canvas.ts";

const data = await Bun.file("../../assets/sources/clips/gfx/o1.swf").arrayBuffer();
const parser = new SwfParser(new Uint8Array(data));
const swf = parser.parse();
const extractor = new SwfExtractor(swf);

// Get the exported asset "245"
const char = extractor.exportedCharacter("245");
if (!char) {
  console.log("Character not found");
  process.exit(1);
}

// Create canvas with explicit subpixelStrokeWidth = false
const canvas = new SvgCanvas({ subpixelStrokeWidth: false });
console.log("Canvas subpixelStrokeWidth:", (canvas as any).subpixelStrokeWidth);

char.draw(canvas, 0);
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
