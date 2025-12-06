/**
 * Build the game manifest by combining extraction metadata with atlas info.
 * Outputs to apps/game/public/assets/maps/tilesv2/manifest.json
 */
import * as fs from 'fs';
import * as path from 'path';

const assetsPath = path.resolve(__dirname, '../../assets');
const gameAssetsPath = path.resolve(__dirname, '../../apps/game/public/assets/maps/tilesv2');

interface ExtractionTile {
  id: number;
  type: 'ground' | 'objects';
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  frameCount: number;
  behavior: string;
  fps?: number;
  autoplay?: boolean;
  loop?: boolean;
}

interface AtlasFrame {
  frameIndex: number;
  atlasIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  trimOffsetX: number;
  trimOffsetY: number;
  duplicateOf?: number;
}

interface AtlasTile {
  tileId: number;
  atlases: { filename: string; width: number; height: number }[];
  frames: AtlasFrame[];
}

interface AtlasManifest {
  scales: { [scaleKey: string]: { tiles: { [tileId: string]: AtlasTile } } };
}

interface ExtractionManifest {
  type: 'ground' | 'objects';
  tiles: { [tileId: string]: ExtractionTile };
}

// Game format
interface GameAtlasFrame {
  frame: number;
  x: number;
  y: number;
  w: number;
  h: number;
  trimX?: number;
  trimY?: number;
  origW?: number;
  origH?: number;
  atlas?: number; // For multi-atlas tiles
}

interface GameAtlasData {
  width: number;
  height: number;
  file: string;
  files?: string[]; // For multi-atlas tiles
  frames: GameAtlasFrame[];
}

interface GameTileData {
  id: number;
  type: 'ground' | 'objects';
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  frameCount: number;
  behavior: string | null;
  fps: number | null;
  autoplay: boolean | null;
  loop: boolean | null;
  atlases: Record<string, GameAtlasData>;
}

interface GameManifest {
  scales: number[];
  tiles: Record<string, GameTileData>;
}

function buildManifest() {
  const tileTypes = ['grounds', 'objects'] as const;
  const gameManifest: GameManifest = { scales: [], tiles: {} };
  const scalesSet = new Set<number>();

  for (const tileType of tileTypes) {
    const type = tileType === 'grounds' ? 'ground' : 'objects';
    const extractionPath = path.join(assetsPath, 'rasters', tileType, 'manifest.json');
    const atlasPath = path.join(assetsPath, 'output', tileType, 'atlas-manifest.json');

    if (!fs.existsSync(extractionPath) || !fs.existsSync(atlasPath)) {
      console.warn(`Skipping ${tileType}: missing manifests`);
      continue;
    }

    const extraction: ExtractionManifest = JSON.parse(fs.readFileSync(extractionPath, 'utf-8'));
    const atlas: AtlasManifest = JSON.parse(fs.readFileSync(atlasPath, 'utf-8'));

    for (const [scaleKey, scaleData] of Object.entries(atlas.scales)) {
      const scaleNum = parseFloat(scaleKey.replace('x', ''));
      scalesSet.add(scaleNum);

      for (const [tileId, atlasTile] of Object.entries(scaleData.tiles)) {
        const extractionTile = extraction.tiles[tileId];
        if (!extractionTile) continue;

        const gameKey = `${type}_${tileId}`;
        
        if (!gameManifest.tiles[gameKey]) {
          gameManifest.tiles[gameKey] = {
            id: extractionTile.id,
            type,
            width: extractionTile.width,
            height: extractionTile.height,
            offsetX: extractionTile.offsetX,
            offsetY: extractionTile.offsetY,
            frameCount: extractionTile.frameCount,
            behavior: extractionTile.behavior,
            fps: extractionTile.fps ?? null,
            autoplay: extractionTile.autoplay ?? null,
            loop: extractionTile.loop ?? null,
            atlases: {},
          };
        }

        const hasMultipleAtlases = atlasTile.atlases.length > 1;
        const firstAtlas = atlasTile.atlases[0]!;

        const gameFrames: GameAtlasFrame[] = atlasTile.frames.map(f => {
          const frame: GameAtlasFrame = {
            frame: f.frameIndex,
            x: f.x,
            y: f.y,
            w: f.width,
            h: f.height,
          };
          if (f.trimOffsetX !== 0 || f.trimOffsetY !== 0) {
            frame.trimX = f.trimOffsetX;
            frame.trimY = f.trimOffsetY;
          }
          if (f.sourceWidth !== f.width || f.sourceHeight !== f.height) {
            frame.origW = f.sourceWidth;
            frame.origH = f.sourceHeight;
          }
          if (hasMultipleAtlases) {
            frame.atlas = f.atlasIndex;
          }
          return frame;
        });

        const atlasData: GameAtlasData = {
          width: firstAtlas.width,
          height: firstAtlas.height,
          file: `${type}/${scaleKey}/${firstAtlas.filename}`,
          frames: gameFrames,
        };

        if (hasMultipleAtlases) {
          atlasData.files = atlasTile.atlases.map(a => `${type}/${scaleKey}/${a.filename}`);
        }

        gameManifest.tiles[gameKey]!.atlases[String(scaleNum)] = atlasData;
      }
    }
  }

  gameManifest.scales = Array.from(scalesSet).sort((a, b) => a - b);

  // Write manifest
  fs.mkdirSync(gameAssetsPath, { recursive: true });
  const manifestPath = path.join(gameAssetsPath, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(gameManifest, null, 2));
  console.log(`✅ Game manifest written to ${manifestPath}`);
  console.log(`   Scales: ${gameManifest.scales.join(', ')}`);
  console.log(`   Tiles: ${Object.keys(gameManifest.tiles).length}`);

  // Copy KTX2 files
  console.log('\n📦 Copying KTX2 files...');
  let copied = 0;
  for (const tileType of tileTypes) {
    const type = tileType === 'grounds' ? 'ground' : 'objects';
    const outputDir = path.join(assetsPath, 'output', tileType);

    for (const scaleDir of fs.readdirSync(outputDir)) {
      if (!scaleDir.endsWith('x')) continue;
      const scalePath = path.join(outputDir, scaleDir);
      if (!fs.statSync(scalePath).isDirectory()) continue;

      const destDir = path.join(gameAssetsPath, type, scaleDir);
      fs.mkdirSync(destDir, { recursive: true });

      for (const file of fs.readdirSync(scalePath)) {
        if (!file.endsWith('.ktx2')) continue;
        const src = path.join(scalePath, file);
        const dest = path.join(destDir, file);
        fs.copyFileSync(src, dest);
        copied++;
      }
    }
  }
  console.log(`✅ Copied ${copied} KTX2 files`);
}

buildManifest();

