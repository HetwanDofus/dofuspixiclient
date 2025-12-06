import { TileExtractor } from "./src/sub-types";

const assetsPath = `${__dirname}/../../`;

// Extract tiles to WebP frames (quality 100 for lossless)
const extractor = new TileExtractor([1.5, 2, 3], 100);
const result = await Promise.all([extractor.extract({
  swfFiles: [`${assetsPath}/assets/sources/clips/gfx/g1.swf`, `${assetsPath}/assets/sources/clips/gfx/g2.swf`],
  outputDir: `${assetsPath}/assets/rasters/grounds`,
  tileType: 'ground',
}), extractor.extract({
  swfFiles: [
    `${assetsPath}/assets/sources/clips/gfx/o1.swf`, 
    `${assetsPath}/assets/sources/clips/gfx/o2.swf`,
    `${assetsPath}/assets/sources/clips/gfx/o3.swf`,
    `${assetsPath}/assets/sources/clips/gfx/o4.swf`,
    `${assetsPath}/assets/sources/clips/gfx/o5.swf`,
    `${assetsPath}/assets/sources/clips/gfx/o6.swf`,
    `${assetsPath}/assets/sources/clips/gfx/o7.swf`,
    `${assetsPath}/assets/sources/clips/gfx/o8.swf`,
    `${assetsPath}/assets/sources/clips/gfx/o9.swf`,
    `${assetsPath}/assets/sources/clips/gfx/o10.swf`,
    `${assetsPath}/assets/sources/clips/gfx/o11.swf`,
    `${assetsPath}/assets/sources/clips/gfx/o12.swf`
  ],
  outputDir: `${assetsPath}/assets/rasters/objects`,
  tileType: 'objects',
})]);