<?php

namespace App\Command;

use Arakne\Swf\Extractor\DrawableInterface;
use Arakne\Swf\Extractor\Drawer\Converter\Converter;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Console\Style\SymfonyStyle;
use Arakne\Swf\SwfFile;
use Arakne\Swf\Extractor\SwfExtractor;
use Arakne\Swf\Error\Errors;
use Arakne\Swf\Extractor\Shape\ShapeDefinition;
use Arakne\Swf\Extractor\Timeline\Timeline;
use Arakne\Swf\Extractor\Sprite\SpriteDefinition;
use Arakne\Swf\Parser\Structure\Action\Opcode;
use App\Swf\InteractiveStateResolver;
use App\Swf\VariantFrameModifier;
use App\Swf\VariantFrameResolver;

use function sprintf;

class ExtractTileCommand extends Command
{
    private const CLIENT_PATH = __DIR__ . '/../../../../assets/sources';
    private const GFX_PATH = self::CLIENT_PATH . '/clips/gfx';

    private string $outputBase;
    private array $manifest = [];
    /** @var list<int>|null Tile ids to extract; null extracts everything. */
    private ?array $only = null;

    protected function configure(): void
    {
        $this
            ->setName('tiles:extract')
            ->setDescription('Extract tiles from SWF files as SVG')
            ->addOption('output', 'o', InputOption::VALUE_REQUIRED, 'Output directory', __DIR__ . '/../../../../assets/rasters/tiles')
            ->addOption('clean', null, InputOption::VALUE_NONE, 'Clean output directory before extraction')
            ->addOption('only', null, InputOption::VALUE_REQUIRED, 'Comma-separated tile ids to extract; the rest are left as they are');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $io = new SymfonyStyle($input, $output);
        $this->outputBase = $input->getOption('output');

        $only = $input->getOption('only');
        $this->only = $only === null || $only === ''
            ? null
            : array_map('intval', array_filter(explode(',', (string) $only), 'strlen'));

        $io->title('Tile Extractor (SVG)');

        if ($this->only !== null) {
            $io->text(sprintf('Restricted to %d tile id(s)', count($this->only)));
        }

        $totalStats = [
            'ground' => ['processed' => 0, 'skipped' => 0, 'animated' => 0, 'random' => 0],
            'objects' => ['processed' => 0, 'skipped' => 0, 'animated' => 0, 'random' => 0],
        ];

        // Setup directories
        $this->setupDirectories($input->getOption('clean'));

        // Load existing manifest
        $oldManifest = $this->loadManifest();

        // Initialize manifest
        $this->initializeManifest();

        // Check if pcntl is available for parallel processing
        $useParallel = function_exists('pcntl_fork');

        // Extract ground tiles
        $io->section('Extracting Ground Tiles');
        $groundFiles = glob(self::GFX_PATH . '/g*.swf');

        if ($useParallel && count($groundFiles) > 1) {
            $numWorkers = min(8, count($groundFiles));

            $io->text(sprintf('Using parallel processing with %d workers', $numWorkers));

            $groundStats = $this->extractTilesParallel($groundFiles, 'ground', $oldManifest, $numWorkers, $io);

            foreach ($groundStats as $key => $value) {
                $totalStats['ground'][$key] += $value;
            }
        } else {
            foreach ($groundFiles as $swfFile) {
                $stats = $this->extractTiles($swfFile, 'ground', $oldManifest, $io);

                foreach ($stats as $key => $value) {
                    $totalStats['ground'][$key] += $value;
                }
            }
        }

        // Extract object tiles
        $io->section('Extracting Object Tiles');
        $objectFiles = glob(self::GFX_PATH . '/o*.swf');

        if ($useParallel && count($objectFiles) > 1) {
            $numWorkers = min(8, count($objectFiles));
            $io->text(sprintf('Using parallel processing with %d workers', $numWorkers));

            $objectStats = $this->extractTilesParallel($objectFiles, 'objects', $oldManifest, $numWorkers, $io);

            foreach ($objectStats as $key => $value) {
                $totalStats['objects'][$key] += $value;
            }
        } else {
            foreach ($objectFiles as $swfFile) {
                $stats = $this->extractTiles($swfFile, 'objects', $oldManifest, $io);

                foreach ($stats as $key => $value) {
                    $totalStats['objects'][$key] += $value;
                }
            }
        }

        // Save manifest
        $this->saveManifest();

        // Display summary
        $this->displaySummary($totalStats, $io);

        return Command::SUCCESS;
    }

    private function setupDirectories(bool $clean): void
    {
        if ($clean && is_dir($this->outputBase)) {
            $this->recursiveRemoveDirectory($this->outputBase);
        }

        // SVG directory (vector graphics are resolution independent)
        @mkdir(sprintf('%s/svg/ground', $this->outputBase), 0755, true);
        @mkdir(sprintf('%s/svg/objects', $this->outputBase), 0755, true);
    }

    private function loadManifest(): array
    {
        $manifestPath = sprintf('%s/manifest.json', $this->outputBase);

        if (file_exists($manifestPath)) {
            return json_decode(file_get_contents($manifestPath), true) ?? [];
        }

        return ['ground' => [], 'objects' => []];
    }

    private function initializeManifest(): void
    {
        $this->manifest = [];

        // SVG manifest (vector graphics)
        $this->manifest['svg'] = ['ground' => [], 'objects' => []];
    }

    private function analyzeFrameActions(array $actions): array
    {
        $result = [
            'hasRandom' => false,
            'hasGotoFrame' => false,
            'hasPlay' => false,
            'hasStop' => false,
            'constants' => [],
        ];

        foreach ($actions as $doActionTag) {
            foreach ($doActionTag->actions as $action) {
                switch ($action->opcode) {
                    case Opcode::ActionRandomNumber:
                        $result['hasRandom'] = true;
                        break;
                    case Opcode::ActionGotoFrame:
                    case Opcode::ActionGotoFrame2:
                        $result['hasGotoFrame'] = true;
                        break;
                    case Opcode::ActionPlay:
                        $result['hasPlay'] = true;
                        break;
                    case Opcode::ActionStop:
                        $result['hasStop'] = true;
                        break;
                    case Opcode::ActionConstantPool:
                        if (is_array($action->data)) {
                            $result['constants'] = array_merge($result['constants'], $action->data);
                        }
                        break;
                }
            }
        }

        return $result;
    }

    private function determineTileBehavior(SpriteDefinition $sprite, int $frameCount): array
    {
        if ($frameCount <= 1) {
            return ['type' => 'static', 'autoplay' => false, 'loop' => false];
        }

        $timeline = $sprite->timeline();
        $frames = $timeline->frames;
        $frameAnalyses = [];

        foreach ($frames as $frameNum => $frame) {
            $frameAnalyses[$frameNum] = $this->analyzeFrameActions($frame->actions);
        }

        $firstFrame = $frameAnalyses[0] ?? null;

        // Check for random pattern
        if ($firstFrame && $firstFrame['hasRandom']) {
            return ['type' => 'random', 'autoplay' => false, 'loop' => false];
        }

        // Check all frames for random
        foreach ($frameAnalyses as $analysis) {
            if ($analysis['hasRandom']) {
                return ['type' => 'random', 'autoplay' => false, 'loop' => false];
            }
        }

        // Multi-frame without random = animated
        $hasStopOnFirstFrame = $firstFrame && $firstFrame['hasStop'];
        $lastFrame = $frameAnalyses[$frameCount - 1] ?? null;
        $hasStopOnLastFrame = $lastFrame && $lastFrame['hasStop'];

        return [
            'type' => 'animated',
            'autoplay' => !$hasStopOnFirstFrame,
            'loop' => !$hasStopOnLastFrame,
        ];
    }

    private function calculateBounds($character): array
    {
        $bounds = $character->bounds();

        return [
            'width' => $bounds->width() / 20,
            'height' => $bounds->height() / 20,
            'offsetX' => $bounds->xmin / 20,
            'offsetY' => $bounds->ymin / 20,
        ];
    }

    /**
     * Extract tiles in parallel using pcntl_fork
     */
    private function extractTilesParallel(array $swfFiles, string $type, array $oldManifest, int $numWorkers, SymfonyStyle $io): array
    {
        $totalStats = ['processed' => 0, 'skipped' => 0, 'animated' => 0, 'random' => 0];

        // Split files into chunks for each worker
        $chunks = array_chunk($swfFiles, (int) ceil(count($swfFiles) / $numWorkers));
        $tempDir = sys_get_temp_dir();
        $children = [];

        foreach ($chunks as $workerId => $chunk) {
            $pid = pcntl_fork();

            if ($pid === -1) {
                // Fork failed, fall back to sequential
                $io->warning('Fork failed, processing sequentially');
                foreach ($chunk as $swfFile) {
                    $stats = $this->extractTiles($swfFile, $type, $oldManifest, $io);
                    foreach ($stats as $key => $value) {
                        $totalStats[$key] += $value;
                    }
                }
            } elseif ($pid === 0) {
                // Child process
                $childStats = ['processed' => 0, 'skipped' => 0, 'animated' => 0, 'random' => 0];

                foreach ($chunk as $swfFile) {
                    $stats = $this->extractTiles($swfFile, $type, $oldManifest, $io);
                    foreach ($stats as $key => $value) {
                        $childStats[$key] += $value;
                    }
                }

                // Write stats to temp file
                $statsFile = sprintf('%s/tile_stats_%s_%d.json', $tempDir, $type, $workerId);
                file_put_contents($statsFile, json_encode($childStats));

                // Write manifest data to temp file
                $manifestFile = sprintf('%s/tile_manifest_%s_%d.json', $tempDir, $type, $workerId);
                file_put_contents($manifestFile, json_encode($this->manifest));

                exit(0);
            } else {
                // Parent process
                $children[$workerId] = $pid;
            }
        }

        // Parent waits for all children
        foreach ($children as $workerId => $pid) {
            pcntl_waitpid($pid, $status);

            // Read stats from temp file
            $statsFile = sprintf('%s/tile_stats_%s_%d.json', $tempDir, $type, $workerId);

            if (file_exists($statsFile)) {
                $childStats = json_decode(file_get_contents($statsFile), true);

                foreach ($childStats as $key => $value) {
                    $totalStats[$key] += $value;
                }

                unlink($statsFile);
            }

            // Merge manifest data
            $manifestFile = sprintf('%s/tile_manifest_%s_%d.json', $tempDir, $type, $workerId);
            if (file_exists($manifestFile)) {
                $childManifest = json_decode(file_get_contents($manifestFile), true);

                foreach ($childManifest as $dir => $data) {
                    if (is_array($data)) {
                        foreach ($data as $tileType => $tiles) {
                            if (is_array($tiles)) {
                                foreach ($tiles as $tileId => $tileData) {
                                    $this->manifest[$dir][$tileType][$tileId] = $tileData;
                                }
                            }
                        }
                    }
                }

                unlink($manifestFile);
            }
        }

        return $totalStats;
    }

    private function extractTiles(string $swfPath, string $type, array $oldManifest, SymfonyStyle $io): array
    {
        $stats = ['processed' => 0, 'skipped' => 0, 'animated' => 0, 'random' => 0];

        $filename = basename($swfPath);
        $source = pathinfo($filename, PATHINFO_FILENAME);
        $io->text(sprintf('Processing %s (%s)', $filename, $type));

        try {
            $swf = new SwfFile($swfPath, errors: Errors::IGNORE_INVALID_TAG & ~Errors::EXTRA_DATA & ~Errors::UNPROCESSABLE_DATA);

            if (!$swf->valid()) {
                $io->warning(sprintf('Invalid SWF file: %s', $filename));
                return $stats;
            }

            $extractor = new SwfExtractor($swf);
            $exported = $extractor->exported();

            if (empty($exported)) {
                $io->warning(sprintf('No exported symbols found in: %s', $filename));
                return $stats;
            }

            $frameRate = $swf->frameRate();

            foreach ($exported as $name => $characterId) {
                $tileId = (int) $name;

                if ($this->only !== null && !in_array($tileId, $this->only, true)) {
                    $stats['skipped']++;
                    continue;
                }

                $character = $extractor->character($characterId);

                if (
                    !($character instanceof SpriteDefinition ||
                        $character instanceof ShapeDefinition)
                ) {
                    continue;
                }

                $isSprite = $character instanceof SpriteDefinition;

                if ($isSprite) {
                    // A family of resources (the nine tree essences, the nine
                    // ores, the cereals…) is one piece of art plus a variant
                    // number the wrapper assigns. Replay that selection, or
                    // every member publishes as the default variant — QA-144.
                    $variantFrames = VariantFrameResolver::resolve($extractor, $character);

                    if ($variantFrames !== []) {
                        $character = $character->modify(new VariantFrameModifier($variantFrames));
                    }
                }

                // An interactive element is a state machine, not an
                // animation: its root frames are the states the server names
                // in `GDF` and the art is in the clip each one places. Export
                // it state by state — see InteractiveStateResolver.
                $states = $isSprite ? InteractiveStateResolver::resolve($character) : null;

                try {
                    // Get frame count and drawable
                    if ($isSprite) {
                        $timeline = $character->timeline();
                        $frameCount = $timeline->framesCount(true);
                        $drawable = $timeline;
                    } else {
                        $frameCount = 1;
                        $drawable = $character;
                    }
                } catch (\Throwable $_) {
                    echo "Error processing {$name}";
                    continue;
                }

                // Analyze behavior
                $behavior = ['type' => 'static', 'autoplay' => false, 'loop' => false];

                if ($states !== null) {
                    $behavior = ['type' => 'resource', 'autoplay' => false, 'loop' => false];
                    $frameCount = array_sum(array_column($states, 'count'));
                } elseif ($character instanceof SpriteDefinition && $frameCount > 1) {
                    $behavior = $this->determineTileBehavior($character, $frameCount);
                }

                // Ground-specific behavior adjustment
                if ($type === 'ground' && $frameCount > 1) {
                    $behavior['type'] = $behavior['type'] === 'random' ? 'random' : 'slope';
                }

                // Export as SVG (vector graphics)
                $result = $this->processVectorTile(
                    $type,
                    $tileId,
                    $character,
                    $drawable,
                    $frameCount,
                    $behavior,
                    $frameRate,
                    $source,
                    $states
                );

                if ($result) {
                    $this->manifest['svg'][$type][$tileId] = $result;
                    $stats['processed']++;

                    if ($behavior['type'] === 'animated') {
                        $stats['animated']++;
                    }
                    if ($behavior['type'] === 'random') {
                        $stats['random']++;
                    }

                    $io->text("  [SVG] Tile #$tileId: {$frameCount} frame(s)");
                }

                $extractor->releaseIfOutOfMemory();
            }

            $extractor->release();

        } catch (\Exception $e) {
            $io->error("Failed to process $filename: " . $e->getMessage());
        }

        return $stats;
    }

    /**
     * Process vector tile - export as SVG
     */
    private function processVectorTile(
        string $type,
        int $tileId,
        $character,
        $drawable,
        int $frameCount,
        array $behavior,
        float $frameRate,
        string $source,
        ?array $states = null
    ): ?array {
        $bounds = $this->calculateBounds($character);

        $tileData = [
            'id' => $tileId,
            'type' => $type,
            'source' => $source,
            'format' => 'svg',
            'width' => $bounds['width'],
            'height' => $bounds['height'],
            'offsetX' => $bounds['offsetX'],
            'offsetY' => $bounds['offsetY'],
            'frameCount' => $frameCount,
            'behavior' => $behavior['type'],
        ];

        if ($behavior['type'] === 'animated') {
            $tileData['fps'] = $frameRate;
            $tileData['autoplay'] = $behavior['autoplay'];
            $tileData['loop'] = $behavior['loop'];
        }

        try {
            $frames = $states !== null && $drawable instanceof Timeline
                ? $this->exportStateFrames($type, $tileId, $drawable, $states, $tileData)
                : $this->exportSvgFrames($type, $tileId, $drawable, $frameCount);

            if (empty($frames)) {
                return null;
            }

            $tileData['frames'] = $frames;
            return $tileData;
        } catch (\Exception $e) {
            return null;
        }
    }

    /**
     * Export an interactive element state by state.
     *
     * The frames of every state are written end to end — the still of one
     * state is a single frame, a transition is all of its clip's — and
     * `$tileData['states']` records where each state's run starts and how
     * long it is, keyed by the frame number the server sends in `GDF`.
     * Without those ranges the flat frame list means nothing: state 3 of a
     * tree is 23 frames of it falling and state 4 is the stump it leaves.
     *
     * @param list<array{frame:int, nested:int, count:int}> $states
     */
    private function exportStateFrames(
        string $type,
        int $tileId,
        Timeline $timeline,
        array $states,
        array &$tileData
    ): array {
        $tileDir = sprintf('%s/svg/%s/%d', $this->outputBase, $type, $tileId);
        @mkdir($tileDir, 0755, true);

        $frames = [];
        $ranges = [];
        $index = 0;

        foreach ($states as $state) {
            $start = $index;

            for ($i = 0; $i < $state['count']; $i++) {
                $frameFilename = sprintf('tile_%d.svg', $index);
                $outputPath = sprintf('%s/%s', $tileDir, $frameFilename);

                // The root frame *is* the state; the nested tick is where
                // its clip stands. Drawing the Timeline itself would clamp
                // the root to `min(tick, lastFrame)` and mix the two.
                $rootFrame = $timeline->frames[$state['frame'] - 1] ?? null;

                if ($rootFrame === null) {
                    continue;
                }

                try {
                    $converter = new Converter(subpixelStrokeWidth: false);
                    $svgContent = $converter->toSvg($rootFrame, $state['nested'] + $i);
                } catch (\Exception $e) {
                    continue;
                }

                if (empty($svgContent)) {
                    continue;
                }

                file_put_contents($outputPath, $svgContent);

                $frames[] = [
                    'index' => $index,
                    'file' => sprintf('%s/%d/%s', $type, $tileId, $frameFilename),
                ];

                $index++;
            }

            $ranges[] = [
                'frame' => $state['frame'],
                'start' => $start,
                'count' => $index - $start,
            ];
        }

        $tileData['frameCount'] = $index;
        $tileData['states'] = $ranges;

        return $frames;
    }

    /**
     * Export vector frames as SVG files (in subdirectory per tile)
     * Files named tile_{frame}.svg for sprite compatibility
     */
    private function exportSvgFrames(string $type, int $tileId, DrawableInterface $drawable, int $frameCount): array
    {
        $frames = [];

        // Create tile subdirectory
        $tileDir = sprintf('%s/svg/%s/%d', $this->outputBase, $type, $tileId);
        @mkdir($tileDir, 0755, true);

        for ($i = 0; $i < $frameCount; $i++) {
            // Sprite-compatible naming: tile_{frame}.svg (groups all frames as "tile" animation)
            $frameFilename = sprintf('tile_%d.svg', $i);
            $outputPath = sprintf('%s/%s', $tileDir, $frameFilename);

            try {
                $converter = new Converter(subpixelStrokeWidth: false);
                $svgContent = $converter->toSvg($drawable, $i);

                if (!empty($svgContent)) {
                    file_put_contents($outputPath, $svgContent);

                    $frames[] = [
                        'index' => $i,
                        'file' => sprintf('%s/%d/%s', $type, $tileId, $frameFilename),
                    ];
                }
            } catch (\Exception $e) {
                // Skip frames that fail to export
                continue;
            }
        }

        return $frames;
    }

    private function saveManifest(): void
    {
        // Save SVG manifest (vector graphics)
        $this->saveTileManifest('ground');
        $this->saveTileManifest('objects');
    }

    private function saveTileManifest(string $type): void
    {
        $tiles = $this->manifest['svg'][$type] ?? [];

        $manifest = [
            'metadata' => [
                'generatedAt' => date('c'),
                'version' => '1.47',
                'format' => 'svg',
                'totalTiles' => count($tiles)
            ]
        ];

        foreach ($tiles as $tile) {
            $tileEntry = [
                'id' => $tile['id'],
                'source' => $tile['source'],
                'format' => $tile['format'] ?? 'svg',
                'behavior' => $tile['behavior'],
                'frameCount' => $tile['frameCount'],
                'width' => $tile['width'],
                'height' => $tile['height'],
                'offsetX' => $tile['offsetX'],
                'offsetY' => $tile['offsetY'],
            ];

            if (isset($tile['fps'])) {
                $tileEntry['fps'] = $tile['fps'];
            }
            if (isset($tile['autoplay'])) {
                $tileEntry['autoplay'] = $tile['autoplay'];
            }
            if (isset($tile['loop'])) {
                $tileEntry['loop'] = $tile['loop'];
            }
            if (isset($tile['states'])) {
                $tileEntry['states'] = $tile['states'];
            }

            $manifest[sprintf('tile-%d', $tile['id'])] = $tileEntry;

            if (isset($tile['frames'])) {
                $manifest[sprintf('tile-%d', $tile['id'])]['frames'] = [];

                foreach ($tile['frames'] as $frame) {
                    $manifest[sprintf('tile-%d', $tile['id'])]['frames'][] = [
                        'index' => $frame['index'],
                        'file' => $frame['file']
                    ];
                }
            }
        }

        // Save manifest at the type level (ground/objects). A filtered run
        // only re-extracted a handful of tiles; the entries it did not touch
        // are still valid and must survive, or the compile stage loses the
        // Flash bounds of every other tile.
        $manifestPath = sprintf('%s/svg/%s/manifest.json', $this->outputBase, $type);

        if ($this->only !== null && file_exists($manifestPath)) {
            $existing = json_decode(file_get_contents($manifestPath), true) ?? [];
            $manifest = array_merge($existing, $manifest);
            $manifest['metadata']['totalTiles'] = count($manifest) - 1;
        }

        file_put_contents($manifestPath, json_encode($manifest, JSON_PRETTY_PRINT));
    }

    private function displaySummary(array $totalStats, SymfonyStyle $io): void
    {
        $io->success('Tile extraction completed!');

        $io->table(['Type', 'Processed', 'Skipped', 'Animated', 'Random'], [
            ['Ground', $totalStats['ground']['processed'], $totalStats['ground']['skipped'], $totalStats['ground']['animated'], $totalStats['ground']['random']],
            ['Objects', $totalStats['objects']['processed'], $totalStats['objects']['skipped'], $totalStats['objects']['animated'], $totalStats['objects']['random']],
        ]);

        $io->note([
            'Vector graphics exported as SVG (resolution-independent)',
        ]);
    }

    private function recursiveRemoveDirectory(string $dir): void
    {
        if (!is_dir($dir)) {
            return;
        }

        $files = array_diff(scandir($dir), ['.', '..']);

        foreach ($files as $file) {
            $path = sprintf('%s/%s', $dir, $file);

            if (is_dir($path)) {
                $this->recursiveRemoveDirectory($path);
            } else {
                unlink($path);
            }
        }

        rmdir($dir);
    }
}
