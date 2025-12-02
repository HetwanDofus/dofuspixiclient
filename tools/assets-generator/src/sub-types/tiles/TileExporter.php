#!/usr/bin/env php
<?php

declare(strict_types=1);

// Find Arakne autoload relative to this file
// TileExporter.php is at: /tools/assets-generator/src/sub-types/tiles/
// Arakne is at: /ext/ArakneSwf/
$autoloadPaths = [
    __DIR__ . '/../../../../../../../../ext/ArakneSwf/vendor/autoload.php',
    __DIR__ . '/../../../../../ext/ArakneSwf/vendor/autoload.php',
    __DIR__ . '/../../../../ext/ArakneSwf/vendor/autoload.php',
    __DIR__ . '/../../../ext/ArakneSwf/vendor/autoload.php',
    __DIR__ . '/../../ext/ArakneSwf/vendor/autoload.php',
];

$autoloadFound = false;

foreach ($autoloadPaths as $autoloadPath) {
    if (file_exists($autoloadPath)) {
        require_once $autoloadPath;
        $autoloadFound = true;
        break;
    }
}

if (!$autoloadFound) {
    fprintf(STDERR, "❌ Arakne SWF autoload not found\n");

    exit(1);
}

use Arakne\Swf\SwfFile;
use Arakne\Swf\Extractor\SwfExtractor;
use Arakne\Swf\Error\Errors;
use Arakne\Swf\Extractor\Shape\ShapeDefinition;
use Arakne\Swf\Extractor\Sprite\SpriteDefinition;
use Arakne\Swf\Extractor\Image\ImageCharacterInterface;
use Arakne\Swf\Extractor\Drawer\Converter\Converter;
use Arakne\Swf\Extractor\Drawer\Converter\ScaleResizer;
use Arakne\Swf\Parser\Structure\Action\Opcode;

/**
 * Tile exporter: extracts tiles from SWF and generates manifest
 */
final class TileExporter
{
    private string $outputDir;
    private string $tileType; // 'ground' or 'objects'
    private array $manifest = [];
    private array $stats = [];
    /** @var array<float> */
    private array $scales = [1.5, 2, 3];
    /** @var array<int>|null */
    private ?array $filterTileIds = null;

    public function __construct(string $outputDir, string $tileType = 'ground')
    {
        $this->outputDir = rtrim($outputDir, DIRECTORY_SEPARATOR);
        $this->tileType = $tileType;

        // Initialize manifest structure
        $this->manifest = [
            'type' => $tileType,
            'tiles' => [],
            'metadata' => [
                'extractedAt' => date('c'),
                'totalTiles' => 0,
                'uniqueFrames' => 0,
                'duplicateFrames' => 0,
                'totalFrames' => 0,
            ],
        ];

        // Initialize stats
        $this->stats = [
            'processed' => 0,
            'skipped' => 0,
            'vector' => 0,
            'raster' => 0,
            'static' => 0,
            'animated' => 0,
            'random' => 0,
        ];
    }

    /**
     * Filter extraction to specific tile IDs
     * @param array<int> $tileIds
     */
    public function filterTileIds(array $tileIds): self
    {
        $this->filterTileIds = $tileIds;
        return $this;
    }

    /**
     * Extract tiles from SWF file
     */
    public function extractFromSwf(string $swfPath): self
    {
        if (!file_exists($swfPath)) {
            throw new \RuntimeException("SWF file not found: $swfPath");
        }

        printf("📦 Processing %s\n", basename($swfPath));

        try {
            $swf = new SwfFile($swfPath, errors: Errors::IGNORE_INVALID_TAG & ~Errors::EXTRA_DATA);

            if (!$swf->valid()) {
                throw new \RuntimeException('Invalid SWF file');
            }

            $extractor = new SwfExtractor($swf);
            $frameRate = $swf->frameRate();

            foreach ($extractor->exported() as $name => $id) {
                $character = $extractor->character($id);
                $tileId = (int) $name;

                $this->processTile($tileId, $character, $frameRate);
                $extractor->releaseIfOutOfMemory();
            }

            $extractor->release();
        } catch (\Throwable $e) {
            fprintf(STDERR, "❌ Error: %s\n", $e->getMessage());
            throw $e;
        }

        return $this;
    }

    /**
     * Process a single tile
     */
    private function processTile($tileId, $character, float $frameRate): void
    {
        // Skip if tile filtering is enabled and this tile is not in the filter
        if ($this->filterTileIds !== null && !in_array($tileId, $this->filterTileIds, true)) {
            return;
        }

        try {
            // Determine tile properties
            $isSprite = $character instanceof SpriteDefinition;
            $isShape = $character instanceof ShapeDefinition;
            $isImage = $character instanceof ImageCharacterInterface;

            if (!$isSprite && !$isShape && !$isImage) {
                return;
            }

            // Get frame count
            if ($isSprite) {
                $timeline = $character->timeline();
                $frameCount = $timeline->framesCount(true);
                $drawable = $timeline;
            } elseif ($isShape) {
                $frameCount = 1;
                $drawable = $character;
            } else {
                $frameCount = 1;
                $drawable = null;
            }

            // Get bounds
            $bounds = $character->bounds();
            $width = $bounds->width() / 20;
            $height = $bounds->height() / 20;
            $offsetX = $bounds->xmin / 20;
            $offsetY = $bounds->ymin / 20;

            // Analyze behavior
            $behavior = $this->determineBehavior($character, $frameCount);

            // Detect vector vs raster
            $isVector = $this->isVector($character, $drawable);

            // Initialize tile data
            $tileData = [
                'id' => $tileId,
                'type' => $this->tileType,
                'width' => $width,
                'height' => $height,
                'offsetX' => $offsetX,
                'offsetY' => $offsetY,
                'frameCount' => $frameCount,
                'isVector' => $isVector,
                'behavior' => $behavior['type'],
            ];

            if ($behavior['type'] === 'animated') {
                $tileData['fps'] = $frameRate;
                $tileData['autoplay'] = $behavior['autoplay'];
                $tileData['loop'] = $behavior['loop'];
            }

            // Export frames
            if ($drawable !== null) {
                $tileData['frames'] = $this->exportFrames($tileId, $drawable, $frameCount, $isVector, $behavior);
            } elseif ($isImage) {
                $tileData['frames'] = $this->exportImage($tileId, $character);
            } else {
                printf("  ⚠️  Tile #%d: unsupported format\n", $tileId);
                return;
            }

            // Store tile data
            $this->manifest['tiles'][$tileId] = $tileData;
            $this->stats['processed']++;
            $this->updateStats($isVector, $behavior, $frameCount);

            printf(
                "  ✓ Tile #%d: %d frames (%s, %s)\n",
                $tileId,
                $frameCount,
                $isVector ? 'Vector' : 'Raster',
                $behavior['type']
            );

        } catch (\Throwable $e) {
            printf("  ⚠️  Tile #%d: %s\n", $tileId, $e->getMessage());
        }
    }

    /**
     * Determine tile behavior from ActionScript analysis
     *
     * @return array{type: string, autoplay: bool, loop: bool}
     */
    private function determineBehavior($character, int $frameCount): array
    {
        $behavior = ['type' => 'static', 'autoplay' => false, 'loop' => false];

        if ($frameCount <= 1 || !($character instanceof SpriteDefinition)) {
            return $behavior;
        }

        $timeline = $character->timeline();
        $frames = $timeline->frames;

        $hasRandom = false;
        $hasStopOnFirstFrame = false;
        $hasStopOnLastFrame = false;

        foreach ($frames as $frameNum => $frame) {
            foreach ($frame->actions as $doAction) {
                foreach ($doAction->actions as $action) {
                    if ($action->opcode === Opcode::ActionRandomNumber) {
                        $hasRandom = true;
                    }
                    if ($action->opcode === Opcode::ActionStop) {
                        if ($frameNum === 0) {
                            $hasStopOnFirstFrame = true;
                        }
                        if ($frameNum === $frameCount - 1) {
                            $hasStopOnLastFrame = true;
                        }
                    }
                }
            }
        }

        // Ground tiles
        if ($this->tileType === 'ground') {
            if ($hasRandom) {
                return ['type' => 'random', 'autoplay' => false, 'loop' => false];
            } else {
                return ['type' => 'slope', 'autoplay' => false, 'loop' => false];
            }
        }

        // Object tiles
        if ($hasRandom) {
            return ['type' => 'random', 'autoplay' => false, 'loop' => false];
        }

        return [
            'type' => 'animated',
            'autoplay' => !$hasStopOnFirstFrame,
            'loop' => !$hasStopOnLastFrame,
        ];
    }

    /**
     * Check if drawable is vector or rasterized
     */
    private function isVector($character, $drawable = null): bool
    {
        if ($character instanceof ShapeDefinition) {
            return true;
        }

        if ($drawable === null) {
            return false;
        }

        try {
            if ($character instanceof SpriteDefinition) {
                $svgContent = $drawable->toSvg(0);
            } else {
                return false;
            }

            // Check for embedded raster data
            return strpos($svgContent, 'data:image/png;base64') === false &&
                   strpos($svgContent, 'data:image/jpeg;base64') === false;
        } catch (\Throwable $e) {
            return false;
        }
    }

    /**
     * Export frames to files
     *
     * @return array<string>
     */
    private function exportFrames(int $tileId, $drawable, int $frameCount, bool $isVector, array $behavior): array
    {
        $frames = [];

        // Export each scale
        foreach ($this->scales as $scale) {
            $scaleDir = $this->getScaleDir($scale);
            $tileDir = $scaleDir . DIRECTORY_SEPARATOR . 'tile_' . $tileId;
            if (!is_dir($tileDir)) {
                mkdir($tileDir, 0o755, true);
            }

            $resizer = new ScaleResizer($scale);
            $converter = new Converter(
                resizer: $resizer,
                backgroundColor: 'transparent',
                svgRenderer: null,
                subpixelStrokeWidth: false  // Force minimum 1px stroke to prevent invisible borders during rasterization
            );

            for ($i = 0; $i < $frameCount; $i++) {
                // Export as WebP using resvg (Rust SVG renderer with excellent stroke rendering)
                $filename = sprintf('%d_%d.webp', $tileId, $i);
                $filepath = $scaleDir . DIRECTORY_SEPARATOR . $filename;

                // Get SVG from converter
                $svg = $converter->toSvg($drawable, $i);

                // Use resvg for high-quality rendering to PNG, then convert to WebP
                $this->renderSvgToWebp($svg, $filepath);
            }
        }

        // Return frame references with scales (all WebP)
        for ($i = 0; $i < $frameCount; $i++) {
            $frame = ['name' => sprintf('%d_%d', $tileId, $i)];
            $frame['scales'] = [];

            foreach ($this->scales as $scale) {
                $frame['scales'][$scale . 'x'] = $scale . 'x/tile_' . $tileId . '/' . sprintf('%d_%d.webp', $tileId, $i);
            }

            $frames[] = $frame;
        }

        return $frames;
    }

    /**
     * Export image (pure ImageCharacter)
     *
     * @return array<array>
     */
    private function exportImage(int $tileId, ImageCharacterInterface $character): array
    {
        $imgData = $character->toBestFormat();
        $ext = $imgData->type->extension();

        // Export to each scale folder (original data for all scales)
        foreach ($this->scales as $scale) {
            $scaleDir = $this->getScaleDir($scale);
            $tileDir = $scaleDir . DIRECTORY_SEPARATOR . 'tile_' . $tileId;
            if (!is_dir($tileDir)) {
                mkdir($tileDir, 0o755, true);
            }

            $filename = $tileId . '.' . $ext;
            $filepath = $tileDir . DIRECTORY_SEPARATOR . $filename;
            file_put_contents($filepath, $imgData->data);
        }

        // Return frame references with scale paths
        $frame = ['name' => (string) $tileId];
        $frame['scales'] = [];

        foreach ($this->scales as $scale) {
            $frame['scales'][$scale . 'x'] = $scale . 'x/tile_' . $tileId . '/' . $tileId . '.' . $ext;
        }

        return [$frame];
    }

    /**
     * Render SVG to WebP using resvg (Rust SVG renderer) + ImageMagick conversion
     * resvg handles thin strokes much better than rsvg-convert
     */
    private function renderSvgToWebp(string $svg, string $outputPath): void
    {
        // Write SVG to temporary file
        $tmpSvg = tempnam(sys_get_temp_dir(), 'tile_') . '.svg';
        $tmpPng = tempnam(sys_get_temp_dir(), 'tile_') . '.png';
        file_put_contents($tmpSvg, $svg);

        try {
            // Step 1: Use resvg to render SVG to PNG with proper stroke handling
            $resvgCmd = sprintf(
                'resvg %s %s',
                escapeshellarg($tmpSvg),
                escapeshellarg($tmpPng)
            );

            $output = null;
            $returnCode = null;
            exec($resvgCmd, $output, $returnCode);

            if ($returnCode !== 0) {
                throw new \RuntimeException(sprintf(
                    'resvg rendering failed: %s',
                    implode("\n", $output)
                ));
            }

            // Step 2: Convert PNG to WebP using ImageMagick
            $imagick = new \Imagick($tmpPng);
            $imagick->setFormat('webp');
            $imagick->setOption('webp:lossless', 'true');
            file_put_contents($outputPath, $imagick->getImageBlob());
            $imagick->destroy();
        } finally {
            // Clean up temporary files
            if (file_exists($tmpSvg)) {
                unlink($tmpSvg);
            }
            if (file_exists($tmpPng)) {
                unlink($tmpPng);
            }
        }
    }

    /**
     * Get tile directory
     */
    private function getTileDir(int $tileId): string
    {
        return $this->outputDir . DIRECTORY_SEPARATOR . 'tile_' . $tileId;
    }

    /**
     * Update statistics
     */
    private function updateStats(bool $isVector, array $behavior, int $frameCount): void
    {
        if ($isVector) {
            $this->stats['vector']++;
        } else {
            $this->stats['raster']++;
        }

        match ($behavior['type']) {
            'static' => $this->stats['static']++,
            'animated' => $this->stats['animated']++,
            'random' => $this->stats['random']++,
            default => null,
        };
    }

    /**
     * Save manifest to JSON file
     */
    public function saveManifest(string $manifestPath = null): self
    {
        if ($manifestPath === null) {
            $manifestPath = $this->outputDir . DIRECTORY_SEPARATOR . 'manifest.json';
        }

        // Update metadata
        $this->manifest['metadata']['totalTiles'] = count($this->manifest['tiles']);
        $this->manifest['metadata']['stats'] = $this->stats;

        $json = json_encode($this->manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);

        if (json_last_error() !== JSON_ERROR_NONE) {
            throw new \RuntimeException('JSON encoding error: ' . json_last_error_msg());
        }

        if (!file_put_contents($manifestPath, $json)) {
            throw new \RuntimeException("Failed to write manifest to $manifestPath");
        }

        printf("✅ Manifest saved to: %s\n", $manifestPath);

        return $this;
    }

    /**
     * Get statistics
     */
    public function getStats(): array
    {
        return $this->stats;
    }

    /**
     * Get manifest
     */
    public function getManifest(): array
    {
        return $this->manifest;
    }

    /**
     * Get scale directory (resolution-first structure)
     */
    private function getScaleDir(int $scale): string
    {
        $scaleDir = $this->outputDir . DIRECTORY_SEPARATOR . $scale . 'x';
        if (!is_dir($scaleDir)) {
            mkdir($scaleDir, 0o755, true);
        }
        return $scaleDir;
    }
}

// CLI Handler
if (php_sapi_name() === 'cli') {
    $options = getopt('h', ['help', 'swf:', 'output:', 'type:', 'tile:']);

    if (isset($options['h']) || isset($options['help'])) {
        echo <<<'EOT'
Tile Extractor - Extract tiles from SWF files

Usage:
    php TileExporter.php --swf <file> --output <dir> [--type <type>] [--tile <id>]

Options:
    --swf <file>          SWF file to extract (required, repeatable)
    --output <dir>        Output directory (required)
    --type <type>         Tile type: 'ground' or 'objects' (default: ground)
    --tile <id>           Specific tile ID to extract (repeatable, optional)
    --help                Show this help message

Examples:
    # Extract ground tiles
    php TileExporter.php --swf /graphics/ground.swf --output ./output --type ground

    # Extract object tiles
    php TileExporter.php --swf /graphics/objects.swf --output ./output --type objects

    # Extract specific tile
    php TileExporter.php --swf /graphics/objects.swf --output ./output --type objects --tile 245

    # Extract multiple specific tiles
    php TileExporter.php --swf /graphics/objects.swf --output ./output --type objects --tile 245 --tile 250

EOT;
        exit(0);
    }

    // Parse arguments
    $swfFiles = (array)($options['swf'] ?? []);
    $outputDir = $options['output'] ?? null;
    $tileType = $options['type'] ?? 'ground';
    $filterTiles = !empty($options['tile']) ? array_map('intval', (array)$options['tile']) : null;

    // Validate
    if (!$swfFiles || !$outputDir) {
        fprintf(STDERR, "❌ Missing required arguments\n");
        fprintf(STDERR, "Usage: php TileExporter.php --swf <file> --output <dir> [--type <type>]\n");
        exit(1);
    }

    // Create output directory
    @mkdir($outputDir, 0o755, true);

    // Create exporter
    $exporter = new TileExporter($outputDir, $tileType);

    // Apply tile filter if specified
    if ($filterTiles !== null) {
        $exporter->filterTileIds($filterTiles);
        printf("🔍 Filtering to tiles: %s\n", implode(', ', $filterTiles));
    }

    // Extract SWF files
    foreach ($swfFiles as $swfFile) {
        try {
            $exporter->extractFromSwf($swfFile);
        } catch (\Throwable $e) {
            fprintf(STDERR, "❌ Failed to process %s: %s\n", basename($swfFile), $e->getMessage());
        }
    }

    // Save manifest
    $exporter->saveManifest();

    // Exit with appropriate code
    exit($exporter->getStats()['processed'] > 0 ? 0 : 1);
}
