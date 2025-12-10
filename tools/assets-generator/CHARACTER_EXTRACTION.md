# Character Animation Extraction

This tool extracts character animations from Dofus SWF files and packs them into optimized WebP atlases.

## Features

- **Character IDs**: Extracts 12 classes × 2 variants = 24 characters (IDs: 10, 11, 20, 21, ..., 120, 121)
- **Multiple Scales**: Generates x1.5, x2, and x3 scaled versions
- **Animation Detection**: Automatically identifies and extracts all animations from each character
- **Static Animation Handling**: Groups all "static" animations into a single combined atlas (first frame only)
- **Region-based Deduplication**: Uses 32x32 pixel regions to deduplicate across frames
- **Frame Deduplication**: Eliminates duplicate frames within animations
- **One Atlas Per Animation**: Each animation gets its own optimized atlas (except static ones)

## Usage

### Basic Extraction

```bash
cd tools/assets-generator
bun run extract-characters.ts
```

This will:
1. Find all character SWF files in `assets/sources/clips/sprites/`
2. Extract all animations at x1.5, x2, and x3 scales
3. Pack animations into WebP atlases with region deduplication
4. Generate manifests for each character
5. Create a combined manifest at `assets/output/characters/manifest.json`

### Copy to Game Assets

To automatically copy the generated atlases to your game's public assets:

```bash
bun run extract-characters.ts --copy-to-game
```

This will copy:
- All WebP atlas files
- The combined manifest
To: `apps/game/public/assets/characters/`

## Output Structure

```
assets/output/characters/
├── manifest.json                    # Combined manifest for all characters
├── char_10/
│   ├── characters-manifest.json     # Manifest for character 10
│   ├── 1.5x/
│   │   └── char_10/
│   │       ├── AnimAttaque/
│   │       │   ├── frame_0.webp
│   │       │   ├── frame_1.webp
│   │       │   └── ...
│   │       ├── AnimMarche/
│   │       └── ...
│   ├── 2x/
│   │   └── ...
│   ├── 3x/
│   │   └── ...
│   └── atlases/
│       ├── 1.5x/
│       │   ├── char_10_AnimAttaque.webp     # One atlas per animation
│       │   ├── char_10_AnimMarche.webp
│       │   └── char_10_static.webp          # Combined static atlas
│       ├── 2x/
│       └── 3x/
├── char_11/
└── ...
```

## Character Extractor API

You can also use the extractor programmatically:

```typescript
import { extractAndPackCharacters, CharacterExtractor } from './src/sub-types/characters/index.ts';

// Extract and pack in one go
const result = await extractAndPackCharacters(
  'assets/sources/clips/sprites/10.swf',
  'output/char_10',
  [1.5, 2, 3],  // scales
  90,           // quality
  32            // region size
);

// Or use the class for more control
const extractor = new CharacterExtractor([1.5, 2, 3], 90);

// Extract only
const extractResult = await extractor.extract({
  swfFile: 'assets/sources/clips/sprites/10.swf',
  outputDir: 'output/char_10',
  regionSize: 32,
});

// Pack separately
await extractor.packAnimations(extractResult, 32);
```

## Configuration Options

### Extraction Config

- **swfFile**: Path to the character SWF file
- **outputDir**: Where to save extracted frames and atlases
- **scales**: Array of scale factors (default: `[1.5, 2, 3]`)
- **quality**: WebP quality 0-100 (default: 90)
- **regionSize**: Size of regions for deduplication (default: 32)
- **parallelism**: Number of parallel workers (default: CPU cores)
- **safeMode**: Use subprocess rendering to prevent crashes (default: true)
- **filterCharacterIds**: Extract only specific character IDs (default: all)

### Packing Options

- **regionSize**: Region size for deduplication (default: 32)
- **maxAtlasSize**: Maximum atlas dimensions (default: 4096)
- **padding**: Padding between regions (default: 1)
- **effort**: WebP encoding effort 0-6 (default: 4, lower = faster)
- **parallelism**: Number of parallel workers (default: CPU cores)

## Animation Types

The extractor automatically detects two types of animations:

### 1. Regular Animations
- Named animations like "AnimAttaque", "AnimMarche", etc.
- All frames are extracted and packed into individual atlases
- Each animation gets its own optimized WebP atlas

### 2. Static Animations
- Animations whose name starts with "static" (case-insensitive)
- Only the first frame is extracted
- All static animations are combined into a single atlas per character

## Region-based Deduplication

The packer divides each frame into a 32x32 pixel grid and deduplicates identical regions:

1. **Frame Analysis**: Each frame is divided into 32×32 pixel regions
2. **Content Detection**: Empty (transparent) regions are skipped
3. **Border Padding**: 4px border is added to each region for compression quality
4. **Hashing**: Each region is hashed to detect duplicates
5. **Packing**: Only unique regions are packed into the atlas
6. **Reconstruction**: Frames are reconstructed from regions at runtime

This dramatically reduces atlas size for animations where only small portions change between frames.

## Manifest Format

### Character Manifest

```json
{
  "characters": {
    "10": {
      "id": 10,
      "fps": 24,
      "animations": [
        {
          "name": "AnimAttaque",
          "frameCount": 12,
          "isStatic": false
        },
        {
          "name": "StaticIdle",
          "frameCount": 1,
          "isStatic": true
        }
      ]
    }
  },
  "metadata": {
    "extractedAt": "2024-12-09T...",
    "totalCharacters": 24,
    "totalAnimations": 240,
    "staticAnimations": 48
  }
}
```

### Combined Manifest

```json
{
  "version": 1,
  "format": "webp-regions",
  "extractedAt": "2024-12-09T...",
  "scales": [1.5, 2, 3],
  "characters": {
    "10": { /* character data */ },
    "11": { /* character data */ },
    ...
  }
}
```

## Performance Tips

1. **Safe Mode**: Keep enabled (default) to prevent crashes from resvg panics
2. **Parallelism**: Uses all CPU cores by default - reduce if memory constrained
3. **Region Size**: 32px is optimal for character sprites - smaller = more deduplication but more regions
4. **Quality**: 90 provides excellent quality with good compression - increase for critical animations
5. **Effort**: Level 4 balances speed and compression - increase for smaller files (slower)

## Troubleshooting

### Character not found
- Check that the SWF file exists: `assets/sources/clips/sprites/{id}.swf`
- Verify the character ID is in the expected range (10, 11, 20, 21, ..., 120, 121)

### Extraction fails
- Enable safe mode (default) to prevent crashes
- Check available memory - character extraction can be memory-intensive
- Reduce parallelism if experiencing memory issues

### Animations not detected
- Verify the SWF contains named child sprites representing animations
- Check the SWF structure - animations should be named sprites within the character sprite

### Atlas too large
- Reduce `maxAtlasSize` to force multiple smaller atlases
- Increase `regionSize` to reduce the number of regions (less deduplication)
- Check if animations have many unique frames

## Requirements

- Node.js or Bun
- Sharp (image processing)
- MaxRects Packer (bin packing)
- SWF Extractor (included)

## Related Tools

- `src/sub-types/index.ts` - Tile extractor (ground and object tiles)
- `src/lib/webp-packer.ts` - WebP atlas packer with region deduplication
- `src/lib/frame-deduplicator.ts` - Frame deduplication utility
