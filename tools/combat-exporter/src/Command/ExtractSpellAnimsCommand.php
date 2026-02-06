<?php

namespace App\Command;

use App\Renderer\Supersampled6xRsvgRenderer;
use Arakne\Swf\Error\Errors;
use Arakne\Swf\Extractor\Drawer\Converter\Converter;
use Arakne\Swf\Extractor\Image\ImageCharacterInterface;
use Arakne\Swf\Extractor\Shape\MorphShapeDefinition;
use Arakne\Swf\Extractor\Sprite\SpriteDefinition;
use Arakne\Swf\Extractor\SwfExtractor;
use Arakne\Swf\Parser\Structure\Tag\PlaceObject2Tag;
use Arakne\Swf\SwfFile;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Console\Style\SymfonyStyle;

/**
 * Extracts spell animations from Dofus SWF files.
 *
 * Spell animations are stored in individual SWF files per spell.
 * Each spell SWF contains exported symbols for different animation phases:
 * - Cast animation (caster performs the spell)
 * - Projectile animation (travels to target)
 * - Impact animation (effect at target location)
 *
 * Usage:
 *   php bin/console extract:spell-anims --input /path/to/spells/ --output ./output/spells
 */
final class ExtractSpellAnimsCommand extends Command
{
    private const SUPERSAMPLE_FACTOR = 6;

    private string $outputBase;
    private array $manifest = [];

    protected function configure(): void
    {
        $this
            ->setName('extract:spell-anims')
            ->setDescription('Extract spell animations from Dofus SWF files to WebP')
            ->addOption('input', 'i', InputOption::VALUE_REQUIRED, 'Input directory containing spell SWF files')
            ->addOption('output', 'o', InputOption::VALUE_OPTIONAL, 'Output directory', './output/spell-anims')
            ->addOption('spell', 's', InputOption::VALUE_OPTIONAL, 'Extract only a specific spell ID')
            ->addOption('clean', null, InputOption::VALUE_NONE, 'Clean output directory before extraction')
            ->addOption('scale', null, InputOption::VALUE_OPTIONAL, 'Scale factor for output (default: 2)', 2)
        ;
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $io = new SymfonyStyle($input, $output);
        $inputDir = $input->getOption('input');
        $this->outputBase = $input->getOption('output');
        $specificSpell = $input->getOption('spell');
        $scale = (float) $input->getOption('scale');

        if (!$inputDir) {
            $io->error('Please provide an input directory with --input');
            return Command::FAILURE;
        }

        if (!is_dir($inputDir)) {
            $io->error('Input directory not found: ' . $inputDir);
            return Command::FAILURE;
        }

        $io->title('Dofus Spell Animation Extractor');

        // Setup directories
        $this->setupDirectories($input->getOption('clean'));

        // Initialize manifest
        $this->manifest = ['spells' => []];

        $totalStats = [
            'processed' => 0,
            'skipped' => 0,
            'total_animations' => 0,
            'total_frames' => 0,
        ];

        // Find spell SWF files
        $pattern = $specificSpell
            ? sprintf('%s/%d.swf', $inputDir, $specificSpell)
            : sprintf('%s/*.swf', $inputDir);

        $swfFiles = glob($pattern);

        if (empty($swfFiles)) {
            $io->warning('No SWF files found matching pattern: ' . $pattern);
            return Command::FAILURE;
        }

        $io->section(sprintf('Processing %d spell files', count($swfFiles)));

        foreach ($swfFiles as $swfFile) {
            $stats = $this->extractSpellAnimations($swfFile, $scale, $io);
            $totalStats['processed'] += $stats['processed'];
            $totalStats['skipped'] += $stats['skipped'];
            $totalStats['total_animations'] += $stats['animations'];
            $totalStats['total_frames'] += $stats['frames'];
        }

        // Save global manifest
        $this->saveManifest($totalStats);

        // Display summary
        $this->displaySummary($totalStats, $io);

        return Command::SUCCESS;
    }

    private function setupDirectories(bool $clean): void
    {
        if ($clean && is_dir($this->outputBase)) {
            $this->recursiveRemoveDirectory($this->outputBase);
        }

        @mkdir($this->outputBase, 0755, true);
    }

    private function extractSpellAnimations(string $swfPath, float $scale, SymfonyStyle $io): array
    {
        $stats = ['processed' => 0, 'skipped' => 0, 'animations' => 0, 'frames' => 0];

        $filename = basename($swfPath);
        $animId = (int) pathinfo($filename, PATHINFO_FILENAME);

        $io->text(sprintf('Processing animation #%d (%s)', $animId, $filename));

        try {
            $swf = new SwfFile($swfPath, errors: Errors::IGNORE_INVALID_TAG & ~Errors::EXTRA_DATA & ~Errors::UNPROCESSABLE_DATA);

            if (!$swf->valid()) {
                $io->warning(sprintf('  Invalid SWF file: %s', $filename));
                $stats['skipped']++;
                return $stats;
            }

            $extractor = new SwfExtractor($swf);
            $exported = $extractor->exported();
            $frameRate = $swf->frameRate();

            $animDir = sprintf('%s/%d', $this->outputBase, $animId);
            @mkdir($animDir, 0755, true);

            // Extract main timeline transform (some spells apply a scale on the main timeline)
            $mainTransform = $this->extractMainTimelineTransform($swf);

            $animData = [
                'id' => $animId,
                'fps' => $frameRate,
                'scale' => self::SUPERSAMPLE_FACTOR, // Always 6x - actual rendering scale
                'mainTimelineScale' => $mainTransform['scaleX'], // Scale applied by main timeline
                'animations' => [],
            ];

            // Log if there's a non-1.0 scale
            if (abs($mainTransform['scaleX'] - 1.0) > 0.001) {
                $io->text(sprintf('  Main timeline scale: %.4f', $mainTransform['scaleX']));
            }

            // Export ActionScript using FFDec (decompiled)
            $asFiles = $this->exportActionScript($swfPath, $animDir, $io);
            if (!empty($asFiles)) {
                $animData['scripts'] = $asFiles;
            }

            // Detect if this spell requires TypeScript implementation
            $requiresTypeScript = $this->detectRequiresTypeScript($animDir);
            $animData['requiresTypeScript'] = $requiresTypeScript;
            if ($requiresTypeScript) {
                $io->text('  Requires TypeScript implementation (has dynamic behavior)');
            }

            // Detect sound triggers from ActionScript (for pre-rendered spells)
            $soundTriggers = $this->detectSoundTriggers($animDir);
            if (!empty($soundTriggers)) {
                $animData['sounds'] = $soundTriggers;
                $io->text(sprintf('  Found %d sound trigger(s): %s',
                    count($soundTriggers),
                    implode(', ', array_map(fn($s) => sprintf('%s@%d', $s['soundId'], $s['frame']), $soundTriggers))
                ));
            }

            // List exported symbols for debugging
            if (!empty($exported)) {
                $io->text(sprintf('  Exported symbols: %s', implode(', ', array_keys($exported))));
            }

            // STRATEGY: Find animated sprites in the SWF
            // Spell SWFs typically have a single-frame main timeline that contains an animated sprite
            // We need to export the child sprite's frames, not the main timeline

            $animatedSprites = [];

            // First, check for exported symbols (preferred)
            if (!empty($exported)) {
                foreach ($exported as $name => $characterId) {
                    try {
                        $character = $extractor->character($characterId);
                        if ($character instanceof SpriteDefinition) {
                            $timeline = $character->timeline();
                            $frameCount = $timeline->framesCount();

                            if ($frameCount > 1) {
                                $animatedSprites[$name] = $character;
                            }
                        }
                    } catch (\Throwable $e) {
                        // Skip problematic characters
                    }
                }
            }

            // If no exported animated symbols, look at sprites on the main timeline
            if (empty($animatedSprites)) {
                try {
                    $mainTimeline = $swf->timeline();
                    if (!empty($mainTimeline->frames)) {
                        // Check sprites placed on frame 0
                        foreach ($mainTimeline->frames[0]->objects as $obj) {
                            if ($obj->object instanceof SpriteDefinition) {
                                $childTimeline = $obj->object->timeline();
                                $frameCount = $childTimeline->framesCount();
                                if ($frameCount > 1) {
                                    $animatedSprites['anim' . $obj->depth] = $obj->object;
                                }
                            }
                        }
                    }
                } catch (\Throwable $e) {
                    $io->text(sprintf('  Error checking main timeline: %s', $e->getMessage()));
                }
            }

            // If still no animated sprites, scan all sprites in the SWF
            if (empty($animatedSprites)) {
                try {
                    $allSprites = $extractor->sprites();
                    $io->text(sprintf('  Scanning %d sprites for animation...', count($allSprites)));

                    foreach ($allSprites as $spriteId => $sprite) {
                        $timeline = $sprite->timeline();
                        $frameCount = $timeline->framesCount();
                        if ($frameCount > 1) {
                            $animatedSprites['sprite_' . $spriteId] = $sprite;
                        }
                    }
                } catch (\Throwable $e) {
                    $io->text(sprintf('  Error scanning sprites: %s', $e->getMessage()));
                }
            }

            $io->text(sprintf('  Found %d animated sprites', count($animatedSprites)));

            // Only detect and export library symbols if TypeScript is required
            if ($requiresTypeScript) {
                $librarySymbols = $this->detectLibrarySymbols($animDir, $extractor, $io);
                if (!empty($librarySymbols)) {
                    $animData['librarySymbols'] = $librarySymbols;
                }
            }

            // Track extracted child sprites to avoid duplicates
            $extractedChildren = [];

            // Export each animated sprite
            foreach ($animatedSprites as $name => $sprite) {
                try {
                    $timeline = $sprite->timeline();
                    $frameCount = $timeline->framesCount();
                    $bounds = $this->calculateBounds($sprite);

                    $io->text(sprintf('    %s: %d frames', $name, $frameCount));

                    // Analyze if this is a composite sprite
                    $composition = $this->analyzeComposition($sprite, $extractor);

                    $animationData = [
                        'name' => (string) $name,
                        'frameCount' => $frameCount,
                        'width' => $bounds['width'],
                        'height' => $bounds['height'],
                        'offsetX' => $bounds['offsetX'],
                        'offsetY' => $bounds['offsetY'],
                    ];

                    // Detect stop frame for this sprite and calculate fading frame
                    // The fading frame is the frame before stop() - the last frame with visible content
                    $spriteStopFrame = $this->detectStopFrame($animId, $sprite->id);
                    if ($spriteStopFrame !== null) {
                        // Fading frame is one before the stop frame (but not less than 0)
                        $fadingFrame = max(0, $spriteStopFrame - 1);
                        $animationData['stopFrame'] = $spriteStopFrame;
                        $animationData['fadingFrame'] = $fadingFrame;
                        $io->text(sprintf('      Stop frame: %d, fading frame: %d', $spriteStopFrame, $fadingFrame));
                    }

                    // Detect morph shapes (shape tweens) which require pre-rendered frames
                    $morphShapes = $this->detectMorphShapes($sprite);
                    if (!empty($morphShapes)) {
                        $animationData['hasMorphShapes'] = true;
                        $animationData['morphShapeCount'] = count($morphShapes);
                        $io->text(sprintf('      Contains %d morph shapes (shape tweens) - requires pre-rendered frames', count($morphShapes)));
                    }

                    if ($composition !== null) {
                        // This is a composite sprite
                        $io->text(sprintf('      Composite with %d unique child sprites', count($composition['children'])));

                        $animationData['isComposite'] = true;

                        // Only extract child sprites if TypeScript implementation is required
                        if ($requiresTypeScript) {
                            // Extract each unique child sprite's frames
                            foreach ($composition['children'] as $childInfo) {
                                $childCharId = $childInfo['characterId'];

                                // Skip if already extracted
                                if (isset($extractedChildren[$childCharId])) {
                                    continue;
                                }

                                // Find and extract the child sprite
                                try {
                                    $childSprite = $extractor->character($childCharId);
                                    if ($childSprite instanceof SpriteDefinition) {
                                        $childData = $this->extractChildSprite($animId, $childCharId, $childSprite, $io);
                                        $extractedChildren[$childCharId] = $childData;
                                        $stats['frames'] += count($childData['frames']);
                                    }
                                } catch (\Throwable $e) {
                                    $io->text(sprintf('        Error extracting child %d: %s', $childCharId, $e->getMessage()));
                                }
                            }
                        }

                        // Export the main animation frames (no stop frame wrapping needed for pre-render)
                        $animationData['frames'] = $this->exportFrames($animId, (string) $name, $timeline, $frameCount);
                        $stats['frames'] += count($animationData['frames']);
                    } else {
                        // Simple sprite - export frames directly
                        $animationData['isComposite'] = false;
                        $animationData['frames'] = $this->exportFrames($animId, (string) $name, $timeline, $frameCount);
                        $stats['frames'] += count($animationData['frames']);
                    }

                    if (!empty($animationData['frames'])) {
                        $animData['animations'][] = $animationData;
                        $stats['animations']++;
                    }
                } catch (\Throwable $e) {
                    $io->text(sprintf('    Skipping %s: %s', $name, $e->getMessage()));
                    continue;
                }

                $extractor->releaseIfOutOfMemory();
            }

            if (!empty($animData['animations'])) {
                $this->manifest['spells'][$animId] = $animData;
                $stats['processed']++;

                // Write per-animation manifest
                $manifestPath = sprintf('%s/manifest.json', $animDir);
                file_put_contents($manifestPath, json_encode($animData, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

                $io->text(sprintf('  ✓ Extracted %d animations, %d frames', count($animData['animations']), $stats['frames']));
            } else {
                $stats['skipped']++;
            }

            $extractor->release();

        } catch (\Throwable $e) {
            $io->warning(sprintf('  Skipped %s: %s', $filename, $e->getMessage()));
            $stats['skipped']++;
        }

        return $stats;
    }

    private function calculateBounds($character): array
    {
        $bounds = $character->bounds();
        $isRasterImage = $character instanceof ImageCharacterInterface;

        $scale = $isRasterImage ? 1 : self::SUPERSAMPLE_FACTOR;

        return [
            'width' => ($bounds->width() / 20) * $scale,
            'height' => ($bounds->height() / 20) * $scale,
            'offsetX' => ($bounds->xmin / 20) * $scale,
            'offsetY' => ($bounds->ymin / 20) * $scale,
        ];
    }

    private function exportFrames(int $spellId, string $animationName, $timeline, int $frameCount): array
    {
        $frames = [];
        $safeAnimName = preg_replace('/[^a-zA-Z0-9_-]/', '_', $animationName);
        $spellDir = sprintf('%s/%d', $this->outputBase, $spellId);

        for ($i = 0; $i < $frameCount; $i++) {
            $frameFilename = sprintf('%s_%d.webp', $safeAnimName, $i);
            $outputPath = sprintf('%s/%s', $spellDir, $frameFilename);

            try {
                $converter = new Converter(svgRenderer: new Supersampled6xRsvgRenderer());
                $webpBlob = $converter->toWebp($timeline, $i, ['lossless' => true]);

                if (!empty($webpBlob)) {
                    file_put_contents($outputPath, $webpBlob);

                    $frames[] = [
                        'index' => $i,
                        'file' => $frameFilename,
                    ];
                }
            } catch (\Exception $e) {
                // Skip frames that fail to render
                continue;
            }
        }

        return $frames;
    }

    /**
     * Export ActionScript using FFDec (decompiled and deobfuscated).
     * Returns list of exported file names.
     */
    private function exportActionScript(string $swfPath, string $outputDir, SymfonyStyle $io): array
    {
        $files = [];
        $ffdec = '/Applications/FFDec.app/Contents/Resources/ffdec.sh';

        if (!file_exists($ffdec)) {
            $io->text('  FFDec not found, skipping ActionScript export');
            return $files;
        }

        $scriptDir = "$outputDir/scripts";

        try {
            // Export scripts with FFDec (decompiled AS2)
            $cmd = sprintf(
                '%s -export script %s %s 2>&1',
                escapeshellarg($ffdec),
                escapeshellarg($scriptDir),
                escapeshellarg($swfPath)
            );

            exec($cmd, $output, $returnCode);

            if ($returnCode === 0 && is_dir($scriptDir)) {
                // Find all .as files recursively
                $iterator = new \RecursiveIteratorIterator(
                    new \RecursiveDirectoryIterator($scriptDir)
                );

                foreach ($iterator as $file) {
                    if ($file->isFile() && $file->getExtension() === 'as') {
                        $files[] = str_replace("$outputDir/", '', $file->getPathname());
                    }
                }

                if (!empty($files)) {
                    $io->text(sprintf('  Exported %d ActionScript files (FFDec)', count($files)));
                }
            }
        } catch (\Throwable $e) {
            $io->text(sprintf('  Error exporting ActionScript: %s', $e->getMessage()));
        }

        return $files;
    }

    private function saveManifest(array $stats): void
    {
        $manifestData = [
            'version' => '1.0',
            'generated' => date('c'),
            'statistics' => [
                'processed' => $stats['processed'],
                'skipped' => $stats['skipped'],
                'total_animations' => $stats['total_animations'],
                'total_frames' => $stats['total_frames'],
            ],
            'spells' => $this->manifest['spells'],
        ];

        $manifestPath = sprintf('%s/manifest.json', $this->outputBase);
        file_put_contents($manifestPath, json_encode($manifestData, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
    }

    private function displaySummary(array $stats, SymfonyStyle $io): void
    {
        $io->success('Spell animation extraction completed!');

        $io->table(['Metric', 'Value'], [
            ['Spells Processed', $stats['processed']],
            ['Spells Skipped', $stats['skipped']],
            ['Total Animations', $stats['total_animations']],
            ['Total Frames', $stats['total_frames']],
        ]);

        $io->text(sprintf('Output directory: %s', $this->outputBase));
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

    /**
     * Detect morph shapes (shape tweens) in a sprite's timeline.
     * Returns array of unique morph shape character IDs.
     */
    private function detectMorphShapes(SpriteDefinition $sprite): array
    {
        $morphShapes = [];
        $timeline = $sprite->timeline();

        foreach ($timeline->frames as $frameIndex => $frame) {
            foreach ($frame->objects as $obj) {
                if ($obj->object instanceof MorphShapeDefinition) {
                    $key = $obj->object->id;
                    if (!isset($morphShapes[$key])) {
                        $morphShapes[$key] = [
                            'characterId' => $obj->object->id,
                            'firstAppearance' => $frameIndex,
                        ];
                    }
                }
            }
        }

        return array_values($morphShapes);
    }

    /**
     * Analyze a sprite and extract its hierarchy (child sprites and their transforms).
     * Returns the composition data if it's a composite sprite, null otherwise.
     *
     * IMPORTANT: Scans ALL frames to find children that may appear on different frames.
     */
    private function analyzeComposition(SpriteDefinition $sprite, SwfExtractor $extractor): ?array
    {
        $timeline = $sprite->timeline();
        if (empty($timeline->frames)) {
            return null;
        }

        // Scan ALL frames to find all unique children
        // Children may appear on different frames, not just frame 0
        $allChildSprites = [];
        $seenInstances = []; // Track unique depth+characterId combinations

        foreach ($timeline->frames as $frameIndex => $frame) {
            foreach ($frame->objects as $obj) {
                if (!($obj->object instanceof SpriteDefinition)) {
                    continue;
                }

                // Create a unique key for this instance (depth determines identity in Flash)
                $instanceKey = $obj->depth . '_' . $obj->object->id;

                // Only record first appearance of each instance
                if (isset($seenInstances[$instanceKey])) {
                    continue;
                }

                $seenInstances[$instanceKey] = true;

                $childTimeline = $obj->object->timeline();
                $childFrameCount = $childTimeline->framesCount();

                // Extract transform matrix data
                $matrix = $obj->matrix;
                $transform = [
                    'scaleX' => $matrix->scaleX,
                    'scaleY' => $matrix->scaleY,
                    'rotateSkew0' => $matrix->rotateSkew0,
                    'rotateSkew1' => $matrix->rotateSkew1,
                    'translateX' => $matrix->translateX / 20, // Convert twips to pixels
                    'translateY' => $matrix->translateY / 20,
                ];

                // Extract color transform if present
                $colorTransform = null;
                if ($obj->colorTransform !== null) {
                    $ct = $obj->colorTransform;
                    $colorTransform = [
                        'redMult' => $ct->redMult,
                        'greenMult' => $ct->greenMult,
                        'blueMult' => $ct->blueMult,
                        'alphaMult' => $ct->alphaMult,
                        'redAdd' => $ct->redAdd,
                        'greenAdd' => $ct->greenAdd,
                        'blueAdd' => $ct->blueAdd,
                        'alphaAdd' => $ct->alphaAdd,
                    ];
                }

                $allChildSprites[] = [
                    'characterId' => $obj->object->id,
                    'depth' => $obj->depth,
                    'name' => $obj->name,
                    'frameCount' => $childFrameCount,
                    'transform' => $transform,
                    'colorTransform' => $colorTransform,
                    'blendMode' => $obj->blendMode->name,
                    'firstAppearance' => $frameIndex,
                ];

                // Also check for nested children recursively
                $nestedChildren = $this->extractNestedChildren($obj->object, $extractor, $frameIndex);
                
                foreach ($nestedChildren as $nested) {
                    $nestedKey = 'nested_' . $nested['characterId'];

                    if (!isset($seenInstances[$nestedKey])) {
                        $seenInstances[$nestedKey] = true;
                        $allChildSprites[] = $nested;
                    }
                }
            }
        }

        if (empty($allChildSprites)) {
            return null;
        }

        // Group children by characterId to find unique child sprites
        $uniqueChildren = [];
        foreach ($allChildSprites as $child) {
            $charId = $child['characterId'];
            if (!isset($uniqueChildren[$charId])) {
                $uniqueChildren[$charId] = [
                    'characterId' => $charId,
                    'frameCount' => $child['frameCount'],
                    'instances' => [],
                ];
            }
            $uniqueChildren[$charId]['instances'][] = [
                'depth' => $child['depth'],
                'name' => $child['name'],
                'transform' => $child['transform'],
                'colorTransform' => $child['colorTransform'],
                'blendMode' => $child['blendMode'],
                'firstAppearance' => $child['firstAppearance'] ?? 0,
            ];
        }

        return [
            'parentFrameCount' => count($timeline->frames),
            'children' => array_values($uniqueChildren),
        ];
    }

    /**
     * Recursively extract nested children from a sprite.
     * This handles sprites that contain other sprites.
     */
    private function extractNestedChildren(SpriteDefinition $sprite, SwfExtractor $extractor, int $parentFrame = 0): array
    {
        $nested = [];
        $timeline = $sprite->timeline();

        if (empty($timeline->frames)) {
            return $nested;
        }

        // Check all frames of this sprite for nested sprite children
        foreach ($timeline->frames as $frame) {
            foreach ($frame->objects as $obj) {
                if (!($obj->object instanceof SpriteDefinition)) {
                    continue;
                }

                $childTimeline = $obj->object->timeline();
                $childFrameCount = $childTimeline->framesCount();

                // Only include sprites with multiple frames (actual animations)
                if ($childFrameCount <= 1) {
                    continue;
                }

                $matrix = $obj->matrix;
                $transform = [
                    'scaleX' => $matrix->scaleX,
                    'scaleY' => $matrix->scaleY,
                    'rotateSkew0' => $matrix->rotateSkew0,
                    'rotateSkew1' => $matrix->rotateSkew1,
                    'translateX' => $matrix->translateX / 20,
                    'translateY' => $matrix->translateY / 20,
                ];

                $colorTransform = null;
                if ($obj->colorTransform !== null) {
                    $ct = $obj->colorTransform;
                    $colorTransform = [
                        'redMult' => $ct->redMult,
                        'greenMult' => $ct->greenMult,
                        'blueMult' => $ct->blueMult,
                        'alphaMult' => $ct->alphaMult,
                        'redAdd' => $ct->redAdd,
                        'greenAdd' => $ct->greenAdd,
                        'blueAdd' => $ct->blueAdd,
                        'alphaAdd' => $ct->alphaAdd,
                    ];
                }

                $nested[] = [
                    'characterId' => $obj->object->id,
                    'depth' => $obj->depth,
                    'name' => $obj->name,
                    'frameCount' => $childFrameCount,
                    'transform' => $transform,
                    'colorTransform' => $colorTransform,
                    'blendMode' => $obj->blendMode->name,
                    'firstAppearance' => $parentFrame,
                    'isNested' => true,
                ];
            }
        }

        return $nested;
    }

    /**
     * Extract a child sprite's frames and return its manifest data.
     */
    private function extractChildSprite(
        int $animId,
        int $characterId,
        SpriteDefinition $sprite,
        SymfonyStyle $io
    ): array {
        $timeline = $sprite->timeline();
        $frameCount = $timeline->framesCount();
        $bounds = $this->calculateBounds($sprite);

        $childName = 'sprite_' . $characterId;
        $io->text(sprintf('      Extracting child %s: %d frames', $childName, $frameCount));

        $frames = $this->exportFrames($animId, $childName, $timeline, $frameCount);

        // Detect stop frame from ActionScript
        $stopFrame = $this->detectStopFrame($animId, $characterId);

        $result = [
            'characterId' => $characterId,
            'name' => $childName,
            'frameCount' => $frameCount,
            'width' => $bounds['width'],
            'height' => $bounds['height'],
            'offsetX' => $bounds['offsetX'],
            'offsetY' => $bounds['offsetY'],
            'frames' => $frames,
        ];

        if ($stopFrame !== null) {
            $result['stopFrame'] = $stopFrame;
            $io->text(sprintf('        Stop frame: %d', $stopFrame));
        }

        return $result;
    }

    /**
     * Detect stop frame from exported ActionScript files.
     * Looks for stop() calls in DefineSprite_X/frame_Y/DoAction.as
     *
     * Returns a 0-indexed frame number for use with the renderer.
     * ActionScript frame numbers are 1-indexed (frame_1 = first frame),
     * but the renderer uses 0-indexed frames.
     */
    private function detectStopFrame(int $animId, int $characterId): ?int
    {
        $scriptDir = sprintf('%s/%d/scripts/scripts/DefineSprite_%d', $this->outputBase, $animId, $characterId);

        if (!is_dir($scriptDir)) {
            return null;
        }

        // Find frame directories and check for stop() calls
        $frameDirs = glob($scriptDir . '/frame_*');
        $stopFrames = [];

        foreach ($frameDirs as $frameDir) {
            $frameName = basename($frameDir);
            if (preg_match('/frame_(\d+)/', $frameName, $matches)) {
                // AS frame numbers are 1-indexed, convert to 0-indexed
                $frameNum = (int)$matches[1] - 1;
                $doActionFile = $frameDir . '/DoAction.as';

                if (file_exists($doActionFile)) {
                    $content = file_get_contents($doActionFile);
                    // Check if this frame has a stop() call
                    if (preg_match('/\bstop\s*\(\s*\)\s*;/', $content)) {
                        $stopFrames[] = $frameNum;
                    }
                }
            }
        }

        // Return the first stop frame (smallest frame number with stop())
        if (!empty($stopFrames)) {
            sort($stopFrames);
            return $stopFrames[0];
        }

        return null;
    }

    /**
     * Detect sound triggers from exported ActionScript files.
     * Looks for SOMA.playSound("soundId") calls in DefineSprite_X/frame_Y/DoAction.as
     *
     * Returns an array of sound triggers with frame numbers (0-indexed) and sound IDs.
     * For pre-rendered spells, we want sounds from the main animated sprite.
     *
     * @param string $animDir The animation output directory
     * @return array<array{frame: int, soundId: string}>
     */
    private function detectSoundTriggers(string $animDir): array
    {
        $sounds = [];
        $scriptDir = "$animDir/scripts";

        if (!is_dir($scriptDir)) {
            return $sounds;
        }

        // Recursively scan all AS files for SOMA.playSound() calls
        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($scriptDir)
        );

        foreach ($iterator as $file) {
            if (!$file->isFile() || $file->getExtension() !== 'as') {
                continue;
            }

            $content = file_get_contents($file->getPathname());

            // Match SOMA.playSound("soundId") calls
            if (preg_match_all('/SOMA\s*\.\s*playSound\s*\(\s*["\']([^"\']+)["\']/', $content, $matches)) {
                // Extract frame number from path
                // Pattern: scripts/scripts/DefineSprite_X/frame_Y/DoAction.as
                // or: scripts/scripts/frame_Y/DoAction.as (main timeline)
                $path = $file->getPathname();

                $frameNum = null;
                if (preg_match('/frame_(\d+)/', $path, $frameMatch)) {
                    // ActionScript frames are 1-indexed, convert to 0-indexed
                    $frameNum = (int)$frameMatch[1] - 1;
                }

                if ($frameNum !== null) {
                    foreach ($matches[1] as $soundId) {
                        $sounds[] = [
                            'frame' => $frameNum,
                            'soundId' => $soundId,
                        ];
                    }
                }
            }
        }

        // Sort by frame number
        usort($sounds, fn($a, $b) => $a['frame'] - $b['frame']);

        // Remove duplicates (same frame + soundId)
        $unique = [];
        $seen = [];
        foreach ($sounds as $sound) {
            $key = $sound['frame'] . '_' . $sound['soundId'];
            if (!isset($seen[$key])) {
                $seen[$key] = true;
                $unique[] = $sound;
            }
        }

        return $unique;
    }

    /**
     * Detect library symbols used via attachMovie() in ActionScript and export them.
     * These are sprites that exist only in the library and are instantiated dynamically.
     *
     * @param string $animDir Output directory for this animation
     * @param SwfExtractor $extractor The SWF extractor
     * @param SymfonyStyle $io Console output
     * @return array Array of library symbol data
     */
    private function detectLibrarySymbols(string $animDir, SwfExtractor $extractor, SymfonyStyle $io): array
    {
        $librarySymbols = [];
        $scriptDir = "$animDir/scripts";

        if (!is_dir($scriptDir)) {
            return $librarySymbols;
        }

        // Find all attachMovie() calls in ActionScript files
        $attachMovieCalls = [];
        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($scriptDir)
        );

        foreach ($iterator as $file) {
            if (!$file->isFile() || $file->getExtension() !== 'as') {
                continue;
            }

            $content = file_get_contents($file->getPathname());

            // Match attachMovie("symbolName", ...) calls
            // The symbol name is exported with a linkage identifier like "cercle", "particle", etc.
            if (preg_match_all('/attachMovie\s*\(\s*["\']([^"\']+)["\']/', $content, $matches)) {
                foreach ($matches[1] as $symbolName) {
                    $attachMovieCalls[$symbolName] = true;
                }
            }
        }

        if (empty($attachMovieCalls)) {
            return $librarySymbols;
        }

        $io->text(sprintf('  Found %d attachMovie() symbols: %s', count($attachMovieCalls), implode(', ', array_keys($attachMovieCalls))));

        // Get the exported symbols map (name => characterId)
        $exportedSymbols = $extractor->exported();

        // Also scan for symbols by their script directory name (DefineSprite_X_symbolName)
        // The scripts directory structure tells us the mapping
        $symbolToCharId = [];
        foreach ($exportedSymbols as $name => $charId) {
            $symbolToCharId[$name] = $charId;
        }

        // Check script directory names for DefineSprite_X_symbolName patterns
        $scriptDirs = glob($scriptDir . '/scripts/DefineSprite_*', GLOB_ONLYDIR);
        foreach ($scriptDirs as $dir) {
            $dirName = basename($dir);
            // Pattern: DefineSprite_X_symbolName
            if (preg_match('/DefineSprite_(\d+)_(.+)/', $dirName, $matches)) {
                $charId = (int)$matches[1];
                $symbolName = $matches[2];
                $symbolToCharId[$symbolName] = $charId;
            }
        }

        // Export each library symbol that was found in attachMovie() calls
        foreach ($attachMovieCalls as $symbolName => $_) {
            if (!isset($symbolToCharId[$symbolName])) {
                $io->text(sprintf('    Warning: Symbol "%s" not found in exports', $symbolName));
                continue;
            }

            $charId = $symbolToCharId[$symbolName];

            try {
                $sprite = $extractor->character($charId);

                if (!($sprite instanceof SpriteDefinition)) {
                    $io->text(sprintf('    Warning: Character %d (%s) is not a sprite', $charId, $symbolName));
                    continue;
                }

                $timeline = $sprite->timeline();
                $frameCount = $timeline->framesCount();
                $bounds = $this->calculateBounds($sprite);

                $io->text(sprintf('    Exporting library symbol "%s" (sprite_%d): %d frame(s)', $symbolName, $charId, $frameCount));

                // Export the sprite frames
                $spellId = (int) basename(dirname($animDir) === 'scripts' ? dirname(dirname($animDir)) : $animDir);
                if ($spellId === 0) {
                    $spellId = (int) basename($animDir);
                }
                $frames = $this->exportFrames($spellId, 'lib_' . $symbolName, $timeline, $frameCount);

                $librarySymbols[] = [
                    'name' => $symbolName,
                    'characterId' => $charId,
                    'internalName' => 'sprite_' . $charId,
                    'frameCount' => $frameCount,
                    'width' => $bounds['width'],
                    'height' => $bounds['height'],
                    'offsetX' => $bounds['offsetX'],
                    'offsetY' => $bounds['offsetY'],
                    'frames' => $frames,
                ];

            } catch (\Throwable $e) {
                $io->text(sprintf('    Error exporting symbol "%s": %s', $symbolName, $e->getMessage()));
            }
        }

        return $librarySymbols;
    }

    /**
     * Extract the main timeline's transform scale.
     *
     * Some spell SWFs place their animated content with a scale transform on the main timeline.
     * This scale factor must be applied when displaying the pre-rendered frames.
     *
     * @param SwfFile $swf The SWF file
     * @return array{scaleX: float, scaleY: float, translateX: float, translateY: float}
     */
    private function extractMainTimelineTransform(SwfFile $swf): array
    {
        $transform = [
            'scaleX' => 1.0,
            'scaleY' => 1.0,
            'translateX' => 0.0,
            'translateY' => 0.0,
        ];

        foreach ($swf->tags() as $tag) {
            if ($tag instanceof PlaceObject2Tag && $tag->depth === 1) {
                if ($tag->matrix) {
                    $transform['scaleX'] = $tag->matrix->scaleX;
                    $transform['scaleY'] = $tag->matrix->scaleY;
                    $transform['translateX'] = $tag->matrix->translateX / 20;
                    $transform['translateY'] = $tag->matrix->translateY / 20;
                }

                break;
            }
        }

        return $transform;
    }

    /**
     * Detect if the spell requires a TypeScript implementation.
     *
     * A spell requires TypeScript if its ActionScript contains dynamic behavior
     * that cannot be pre-rendered, such as:
     * - random() or Math.random() calls
     * - Math functions (sin, cos, etc.) for dynamic calculations
     * - attachMovie() for dynamic sprite instantiation
     * - Variable-based positioning using _parent.level, _parent.angle, etc.
     * - Conditional logic affecting animation
     *
     * @param string $animDir The animation output directory
     * @return bool True if TypeScript implementation is required
     */
    private function detectRequiresTypeScript(string $animDir): bool
    {
        $scriptDir = "$animDir/scripts";

        if (!is_dir($scriptDir)) {
            return false;
        }

        // Patterns that indicate dynamic behavior requiring TypeScript
        $dynamicPatterns = [
            // Random functions
            '/\brandom\s*\(/',
            '/Math\s*\.\s*random\s*\(/',

            // Math functions for dynamic calculations
            '/Math\s*\.\s*(sin|cos|tan|atan|atan2|sqrt|pow|abs|floor|ceil|round)\s*\(/',

            // Dynamic sprite creation
            '/attachMovie\s*\(/',
            '/createEmptyMovieClip\s*\(/',
            '/duplicateMovieClip\s*\(/',

            // Dynamic property access that affects positioning/behavior
            '/_parent\s*\.\s*(level|angle|distance|params)/',
            '/_root\s*\.\s*(i|_currentframe)/',

            // Loops that generate dynamic content
            '/\bwhile\s*\(/',
            '/\bfor\s*\(/',

            // Dynamic color/transform manipulation
            '/new\s+Color\s*\(/',
            '/setTransform\s*\(/',
            '/ColorTransform/',
        ];

        // Scan all AS files
        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($scriptDir)
        );

        foreach ($iterator as $file) {
            if (!$file->isFile() || $file->getExtension() !== 'as') {
                continue;
            }

            $content = file_get_contents($file->getPathname());

            // Skip files that only contain stop() or simple frame actions
            // These are just playback control, not dynamic behavior
            $trimmedContent = preg_replace('/\/\/.*$/m', '', $content); // Remove comments
            $trimmedContent = preg_replace('/\/\*.*?\*\//s', '', $trimmedContent); // Remove block comments
            $trimmedContent = preg_replace('/\s+/', ' ', $trimmedContent); // Normalize whitespace
            $trimmedContent = trim($trimmedContent);

            // If the file only contains stop(), gotoAndStop(), or SOMA.playSound(), it's not dynamic
            if (preg_match('/^(stop\s*\(\s*\)\s*;?\s*|gotoAndStop\s*\([^)]+\)\s*;?\s*|SOMA\s*\.\s*playSound\s*\([^)]+\)\s*;?\s*)+$/', $trimmedContent)) {
                continue;
            }

            // Check for dynamic patterns
            foreach ($dynamicPatterns as $pattern) {
                if (preg_match($pattern, $content)) {
                    return true;
                }
            }
        }

        return false;
    }
}
