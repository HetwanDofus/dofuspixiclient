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
use Arakne\Swf\Extractor\Sprite\SpriteDefinition;

use function sprintf;

class ExtractSpriteCommand extends Command
{
    private const CLIENT_PATH = __DIR__ . '/../../../../assets/sources';
    private const SPRITES_PATH = self::CLIENT_PATH . '/clips/sprites';

    private string $outputBase;
    private array $manifest = [];

    protected function configure(): void
    {
        $this
            ->setName('sprites:extract')
            ->setDescription('Extract sprites from SWF files as SVG')
            ->addOption('output', 'o', InputOption::VALUE_REQUIRED, 'Output directory', __DIR__ . '/../../../../assets/rasters/sprites')
            ->addOption('clean', null, InputOption::VALUE_NONE, 'Clean output directory before extraction')
            ->addOption('manifest-only', null, InputOption::VALUE_NONE, 'Only generate manifests without extracting SVGs');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $io = new SymfonyStyle($input, $output);
        $this->outputBase = $input->getOption('output');
        $manifestOnly = $input->getOption('manifest-only');

        $io->title('Sprite Extractor (SVG)');

        $totalStats = [
            'processed' => 0,
            'skipped' => 0,
            'total_animations' => 0,
            'total_frames' => 0,
        ];

        if ($manifestOnly) {
            $io->text('Generating manifests only (no SVG extraction)...');

            // Initialize manifest
            $this->initializeManifest();

            // Extract sprites (manifest only mode)
            $io->section('Building Manifests');
            $spriteFiles = glob(self::SPRITES_PATH . '/*.swf');

            foreach ($spriteFiles as $swfFile) {
                $stats = $this->extractSprites($swfFile, $io, true);
                $totalStats['processed'] += $stats['processed'];
                $totalStats['skipped'] += $stats['skipped'];
                $totalStats['total_animations'] += $stats['animations'];
                $totalStats['total_frames'] += $stats['frames'];
            }

            // Save manifest
            $this->saveManifest($totalStats);

            // Display summary
            $this->displaySummary($totalStats, $io);
        } else {
            // Setup directories
            $this->setupDirectories($input->getOption('clean'));

            // Initialize manifest
            $this->initializeManifest();

            // Extract sprites
            $io->section('Extracting Sprites');
            $spriteFiles = glob(self::SPRITES_PATH . '/*.swf');

            // Check if pcntl is available for parallel processing
            $useParallel = function_exists('pcntl_fork') && count($spriteFiles) > 1;
            $numWorkers = $useParallel ? min(8, count($spriteFiles)) : 1;

            if ($useParallel) {
                $io->text(sprintf('Using parallel processing with %d workers', $numWorkers));
                $totalStats = $this->extractSpritesParallel($spriteFiles, $numWorkers, $io);
            } else {
                foreach ($spriteFiles as $swfFile) {
                    $stats = $this->extractSprites($swfFile, $io, false);
                    $totalStats['processed'] += $stats['processed'];
                    $totalStats['skipped'] += $stats['skipped'];
                    $totalStats['total_animations'] += $stats['animations'];
                    $totalStats['total_frames'] += $stats['frames'];
                }
            }

            // Save manifest
            $this->saveManifest($totalStats);

            // Display summary
            $this->displaySummary($totalStats, $io);
        }

        return Command::SUCCESS;
    }

    private function setupDirectories(bool $clean): void
    {
        if ($clean && is_dir($this->outputBase)) {
            $this->recursiveRemoveDirectory($this->outputBase);
        }

        // SVG directory (vector graphics are resolution independent)
        @mkdir(sprintf('%s/svg', $this->outputBase), 0755, true);
    }

    private function initializeManifest(): void
    {
        $this->manifest = [];

        // SVG manifest (vector graphics)
        $this->manifest['svg'] = ['sprites' => []];
    }


    /**
     * Extract sprites in parallel using pcntl_fork
     */
    private function extractSpritesParallel(array $spriteFiles, int $numWorkers, SymfonyStyle $io): array
    {
        $totalStats = [
            'processed' => 0,
            'skipped' => 0,
            'total_animations' => 0,
            'total_frames' => 0,
        ];

        // Split files into chunks for each worker
        $chunks = array_chunk($spriteFiles, (int) ceil(count($spriteFiles) / $numWorkers));
        $tempDir = sys_get_temp_dir();
        $children = [];

        foreach ($chunks as $workerId => $chunk) {
            $pid = pcntl_fork();

            if ($pid === -1) {
                // Fork failed, fall back to sequential
                $io->warning('Fork failed, processing sequentially');
                foreach ($chunk as $swfFile) {
                    $stats = $this->extractSprites($swfFile, $io);
                    $totalStats['processed'] += $stats['processed'];
                    $totalStats['skipped'] += $stats['skipped'];
                    $totalStats['total_animations'] += $stats['animations'];
                    $totalStats['total_frames'] += $stats['frames'];
                }
            } elseif ($pid === 0) {
                // Child process
                $childStats = [
                    'processed' => 0,
                    'skipped' => 0,
                    'total_animations' => 0,
                    'total_frames' => 0,
                ];

                foreach ($chunk as $swfFile) {
                    $stats = $this->extractSprites($swfFile, $io);
                    $childStats['processed'] += $stats['processed'];
                    $childStats['skipped'] += $stats['skipped'];
                    $childStats['total_animations'] += $stats['animations'];
                    $childStats['total_frames'] += $stats['frames'];
                }

                // Write stats to temp file
                $statsFile = sprintf('%s/sprite_stats_%d.json', $tempDir, $workerId);
                file_put_contents($statsFile, json_encode($childStats));

                // Write manifest data to temp file
                $manifestFile = sprintf('%s/sprite_manifest_%d.json', $tempDir, $workerId);
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
            $statsFile = sprintf('%s/sprite_stats_%d.json', $tempDir, $workerId);
            if (file_exists($statsFile)) {
                $childStats = json_decode(file_get_contents($statsFile), true);
                $totalStats['processed'] += $childStats['processed'];
                $totalStats['skipped'] += $childStats['skipped'];
                $totalStats['total_animations'] += $childStats['total_animations'];
                $totalStats['total_frames'] += $childStats['total_frames'];
                unlink($statsFile);
            }

            // Merge manifest data
            $manifestFile = sprintf('%s/sprite_manifest_%d.json', $tempDir, $workerId);
            if (file_exists($manifestFile)) {
                $childManifest = json_decode(file_get_contents($manifestFile), true);
                foreach ($childManifest as $dir => $data) {
                    if (isset($data['sprites'])) {
                        foreach ($data['sprites'] as $spriteId => $spriteData) {
                            $this->manifest[$dir]['sprites'][$spriteId] = $spriteData;
                        }
                    }
                }
                unlink($manifestFile);
            }
        }

        return $totalStats;
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

    private function extractSprites(string $swfPath, SymfonyStyle $io, bool $manifestOnly = false): array
    {
        $stats = ['processed' => 0, 'skipped' => 0, 'animations' => 0, 'frames' => 0];

        $filename = basename($swfPath);
        $source = pathinfo($filename, PATHINFO_FILENAME);
        $io->text(sprintf('Processing %s', $filename));

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
                $character = $extractor->character($characterId);

                // Sprites must be SpriteDefinition to have animations
                if (!($character instanceof SpriteDefinition)) {
                    continue;
                }

                $spriteId = (int) $source;
                $timeline = $character->timeline();
                $totalFrameCount = $timeline->framesCount(true);

                // The exported symbol name is the animation name
                // If there's a wrapper with a child sprite, use the child sprite for frame extraction
                $spriteToUse = $character;
                $animationName = (string) $name;

                // Check if this is a wrapper with a single frame containing a child sprite
                if (count($timeline->frames) === 1) {
                    $firstFrame = $timeline->frames[0];
                    foreach ($firstFrame->objects as $obj) {
                        if ($obj->object instanceof SpriteDefinition) {
                            $spriteToUse = $obj->object;
                            break;
                        }
                    }
                }

                // Extract animation as a single unit with the exported symbol name
                $animationTimeline = $spriteToUse->timeline();
                $frameCount = count($animationTimeline->frames);

                $animations = [[
                    'name' => $animationName,
                    'startFrame' => 0,
                    'endFrame' => $frameCount - 1,
                    'frameCount' => $frameCount,
                ]];

                $timeline = $animationTimeline;

                // Sprites are vector graphics (SpriteDefinition) - export as SVG
                $bounds = $this->calculateBounds($spriteToUse);

                $spriteData = [
                    'id' => $spriteId,
                    'source' => $source,
                    'format' => 'svg',
                    'width' => $bounds['width'],
                    'height' => $bounds['height'],
                    'offsetX' => $bounds['offsetX'],
                    'offsetY' => $bounds['offsetY'],
                    'totalFrameCount' => $totalFrameCount,
                    'fps' => $frameRate,
                    'animations' => [],
                ];

                // Process each animation as SVG
                foreach ($animations as $animation) {
                    $animationData = $this->processVectorAnimation(
                        $spriteId,
                        $animation,
                        $timeline,
                        $manifestOnly
                    );

                    if ($animationData) {
                        $spriteData['animations'][] = $animationData;
                    }
                }

                if (!empty($spriteData['animations'])) {
                    // Merge animations if sprite already exists, otherwise create new entry
                    if (isset($this->manifest['svg']['sprites'][$spriteId])) {
                        // Merge animations into existing sprite
                        foreach ($spriteData['animations'] as $anim) {
                            $this->manifest['svg']['sprites'][$spriteId]['animations'][] = $anim;
                        }
                        $this->manifest['svg']['sprites'][$spriteId]['totalFrameCount'] += $totalFrameCount;
                    } else {
                        $this->manifest['svg']['sprites'][$spriteId] = $spriteData;
                    }

                    $stats['processed']++;
                    $stats['animations'] += count($animations);
                    $stats['frames'] += $frameCount;

                    $io->text(sprintf("  [SVG] Sprite #%d / %s: %d frame(s)",
                        $spriteId, $animationName, $frameCount));
                } else {
                    $stats['skipped']++;
                }

                $extractor->releaseIfOutOfMemory();
            }

            // Write per-sprite manifest after all animations are processed
            $spriteId = (int) $source;
            if (isset($this->manifest['svg']['sprites'][$spriteId])) {
                $spriteDir = sprintf('%s/svg/%d', $this->outputBase, $spriteId);
                @mkdir($spriteDir, 0755, true);
                $spriteManifestPath = sprintf('%s/manifest.json', $spriteDir);
                file_put_contents($spriteManifestPath, json_encode(
                    $this->manifest['svg']['sprites'][$spriteId],
                    JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES
                ));
            }

            $extractor->release();

        } catch (\Exception $e) {
            $io->error("Failed to process $filename: " . $e->getMessage());
        }

        return $stats;
    }

    /**
     * Process animation as vector graphics (SVG)
     */
    private function processVectorAnimation(int $spriteId, array $animation, DrawableInterface $timeline, bool $manifestOnly = false): ?array
    {
        $animationData = [
            'name' => $animation['name'],
            'startFrame' => $animation['startFrame'],
            'endFrame' => $animation['endFrame'],
            'frameCount' => $animation['frameCount'],
            'format' => 'svg',
            'frames' => [],
        ];

        try {
            // Export frames as SVG
            $animationData['frames'] = $this->exportSvgFrames(
                $spriteId,
                $animation['name'],
                $timeline,
                $animation['startFrame'],
                $animation['endFrame'],
                $manifestOnly
            );

            if (empty($animationData['frames'])) {
                return null;
            }

            return $animationData;
        } catch (\Exception $e) {
            return null;
        }
    }

    /**
     * Export animation frames as SVG files
     */
    private function exportSvgFrames(int $spriteId, string $animationName, DrawableInterface $timeline, int $startFrame, int $endFrame, bool $manifestOnly = false): array
    {
        $frames = [];
        $safeAnimName = preg_replace('/[^a-zA-Z0-9_-]/', '-', $animationName);
        $spriteDir = sprintf('%s/svg/%d', $this->outputBase, $spriteId);

        if (!$manifestOnly) {
            @mkdir($spriteDir, 0755, true);
        }

        for ($i = $startFrame; $i <= $endFrame; $i++) {
            $frameIndex = $i - $startFrame;
            $frameFilename = sprintf('%s-%d.svg', $safeAnimName, $frameIndex);

            if ($manifestOnly) {
                // In manifest-only mode, just build the frame list without generating files
                $frames[] = [
                    'index' => $frameIndex,
                    'file' => $frameFilename,
                ];
            } else {
                $outputPath = sprintf('%s/%s', $spriteDir, $frameFilename);

                try {
                    // Use Converter to generate SVG
                    $converter = new Converter(subpixelStrokeWidth: false);
                    $svgContent = $converter->toSvg($timeline, $i);

                    if (!empty($svgContent)) {
                        file_put_contents($outputPath, $svgContent);

                        $frames[] = [
                            'index' => $frameIndex,
                            'file' => $frameFilename,
                        ];
                    }
                } catch (\Exception $e) {
                    // Skip frames that fail to export
                    continue;
                }
            }
        }

        return $frames;
    }

    private function saveManifest(array $stats): void
    {
        // Save SVG manifest (vector graphics)
        $this->saveSpriteManifest($stats);
    }

    private function saveSpriteManifest(array $stats): void
    {
        $sprites = $this->manifest['svg']['sprites'] ?? [];

        if (empty($sprites)) {
            return;
        }

        // Save as JSON for easier parsing
        $manifest = [
            'metadata' => [
                'generatedAt' => date('c'),
                'version' => '1.47',
                'format' => 'svg',
                'totalSprites' => count($sprites),
                'processed' => $stats['processed'],
                'skipped' => $stats['skipped'],
                'totalAnimations' => $stats['total_animations'],
                'totalFrames' => $stats['total_frames'],
            ]
        ];

        foreach ($sprites as $sprite) {
            $spriteEntry = [
                'id' => $sprite['id'],
                'source' => $sprite['source'],
                'format' => $sprite['format'] ?? 'svg',
                'totalFrameCount' => $sprite['totalFrameCount'],
                'fps' => $sprite['fps'],
                'width' => $sprite['width'],
                'height' => $sprite['height'],
                'offsetX' => $sprite['offsetX'],
                'offsetY' => $sprite['offsetY'],
            ];

            $spriteEntry['animations'] = [];

            // Add animations
            foreach ($sprite['animations'] as $animation) {
                $animEntry = [
                    'name' => $animation['name'],
                    'startFrame' => $animation['startFrame'],
                    'endFrame' => $animation['endFrame'],
                    'frameCount' => $animation['frameCount'],
                    'frames' => $animation['frames'],
                ];

                $spriteEntry['animations'][] = $animEntry;
            }

            $manifest[sprintf('sprite-%d', $sprite['id'])] = $spriteEntry;
        }

        file_put_contents(
            sprintf('%s/svg/manifest.json', $this->outputBase),
            json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)
        );
    }

    private function displaySummary(array $stats, SymfonyStyle $io): void
    {
        $io->success('Sprite extraction completed!');

        $io->table(['Metric', 'Value'], [
            ['Sprites Processed', $stats['processed']],
            ['Sprites Skipped', $stats['skipped']],
            ['Total Animations', $stats['total_animations']],
            ['Total Frames', $stats['total_frames']],
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
