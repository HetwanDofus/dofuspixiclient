<?php

namespace App\Command;

use App\Swf\BodyPartVariantModifier;
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
            ->addOption('manifest-only', null, InputOption::VALUE_NONE, 'Only generate manifests without extracting SVGs')
            ->addOption('input', 'i', InputOption::VALUE_REQUIRED, 'Custom input directory (default: clips/sprites)');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $io = new SymfonyStyle($input, $output);
        $this->outputBase = $input->getOption('output');
        $manifestOnly = $input->getOption('manifest-only');
        $inputDir = $input->getOption('input') ?: self::SPRITES_PATH;

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
            $spriteFiles = glob($inputDir . '/*.swf');

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
            $spriteFiles = glob($inputDir . '/*.swf');

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

    /**
     * Re-stamp an SVG rendered from the inner sprite's native bounds with
     * the wrapper FrameObject's matrix so the visible result matches what
     * the canonical client draws when it `attachMovie`s the wrapper.
     *
     * The downstream dofasset compiler (packages/dofasset-format
     * `buildSyntheticFrame`) parses each per-frame SVG by reading the
     * FIRST top-level `<g>` and iterating its DIRECT children for
     * `<use>` / `<rect>` body parts. So we must NOT introduce another
     * `<g>` wrapper around the existing root group — that would push the
     * `<use>` elements one level too deep and the compiler would see no
     * body parts (invisible sprite).
     *
     * Strategy: compose the wrapper's PlaceObject matrix into the
     * EXISTING root `<g transform="matrix(1, 0, 0, 1, -inner.xmin,
     * -inner.ymin)">` that Arakne's SvgBuilder always emits, replacing
     * its transform attribute with the composed value M_outer * M_root.
     *
     * Math: the Arakne `FrameObject->matrix` is the raw SWF matrix
     * already pre-composed with `translate(inner.xmin, inner.ymin)` —
     * see TimelineProcessor::placeNewObject which calls
     * `$tag->matrix->translate(inner.xmin, inner.ymin)`. So
     *
     *     M_frame * V = M_swf * (V + inner_origin)
     *
     * where V is a point in viewBox-origin coords and `M_swf` is the
     * raw placement matrix. We want our composed root transform M_root'
     * to satisfy
     *
     *     M_root' * P_native = (M_swf * P_native) - wrapper_origin
     *
     * for raw native points P_native (which is what SvgBuilder feeds the
     * existing root group). This collapses to
     *
     *     a' = M_swf.a, b' = M_swf.b, c' = M_swf.c, d' = M_swf.d
     *     tx' = M_swf.tx_css - wrapper.xmin
     *     ty' = M_swf.ty_css - wrapper.ymin
     *
     * Because the existing M_root translation is `(-inner.xmin,
     * -inner.ymin)` and Arakne pre-composed those into M_frame's
     * translation, we have
     *
     *     M_swf.tx_css = M_frame.translateX/20 - (a*inner.xmin + c*inner.ymin)
     *     M_swf.ty_css = M_frame.translateY/20 - (b*inner.xmin + d*inner.ymin)
     *
     * giving the formula below.
     */
    private function applyWrapperTransform(
        string $svgContent,
        $wrapperFrameObject,
        array $wrapperBounds,
        array $innerBounds
    ): string {
        $matrix = $wrapperFrameObject->matrix;
        $a = $matrix->scaleX;
        $d = $matrix->scaleY;
        $b = $matrix->rotateSkew0;
        $c = $matrix->rotateSkew1;
        $mtxCss = $matrix->translateX / 20;
        $mtyCss = $matrix->translateY / 20;
        $xminI = $innerBounds['offsetX'];
        $yminI = $innerBounds['offsetY'];

        // Recover raw SWF translation, then re-apply with native input
        // coords (no inner-origin shift from the existing root group).
        $swfTx = $mtxCss - ($a * $xminI + $c * $yminI);
        $swfTy = $mtyCss - ($b * $xminI + $d * $yminI);

        // Final composed root transform (canvas-coord output, then shifted
        // to wrapper-viewBox origin).
        $tx = $swfTx - $wrapperBounds['offsetX'];
        $ty = $swfTy - $wrapperBounds['offsetY'];

        $transform = sprintf(
            'matrix(%s %s %s %s %s %s)',
            $this->fmt($a), $this->fmt($b), $this->fmt($c),
            $this->fmt($d), $this->fmt($tx), $this->fmt($ty)
        );

        $w = $wrapperBounds['width'];
        $h = $wrapperBounds['height'];

        // 1) Replace the <svg ...> opening tag's width / height / viewBox
        //    with the wrapper's post-matrix bounds. We re-stamp the
        //    namespace attributes (some SvgCanvas outputs strip them on
        //    the fragment we capture) so the file is always self-contained.
        $svgContent = preg_replace(
            '/<svg\b[^>]*>/',
            sprintf(
                '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="%s" height="%s" viewBox="0 0 %s %s">',
                $this->fmt($w),
                $this->fmt($h),
                $this->fmt($w),
                $this->fmt($h)
            ),
            $svgContent,
            1
        );

        // 2) Replace the FIRST `<g transform="…">` (the SvgBuilder's
        //    inner-origin shift group) with our composed transform. The
        //    parser reads the first non-clip-path `<g>` as the root, and
        //    we leave its `<use>` children untouched.
        $svgContent = preg_replace(
            '/<g transform="[^"]*"/',
            sprintf('<g transform="%s"', $transform),
            $svgContent,
            1
        );

        return $svgContent;
    }

    private function fmt(float $n): string
    {
        // 4-decimal precision is enough for display; trailing-zero strip
        // keeps SVG attribute strings short.
        $s = rtrim(rtrim(sprintf('%.4f', $n), '0'), '.');
        return $s === '' || $s === '-' ? '0' : $s;
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

                // A body part that carries several frames is a set of
                // alternatives, not an animation — the head's hair-worn /
                // hair-under-a-hat pair is the only one. Nothing here plays
                // the ActionScript that chooses between them, so the clip has
                // to be held on its first frame or it drifts forward with the
                // pose. See {@see BodyPartVariantModifier} and QA-149.
                $character = $character->modify(new BodyPartVariantModifier());

                $spriteId = (int) $source;
                $timeline = $character->timeline();
                $totalFrameCount = $timeline->framesCount(true);

                // The exported symbol name is the animation name
                // If there's a wrapper with a child sprite, use the child sprite for frame extraction
                $spriteToUse = $character;
                $animationName = (string) $name;

                // Check if this is a wrapper with a single frame containing a
                // child sprite.
                //
                // A minority of animations place their body parts flat on the
                // exported clip instead of wrapping them — `9073/staticR`
                // (the auction-house vendor, 55 placements) places fourteen.
                // Descending into the first sprite child there renders body
                // part #1 alone and throws away the other thirteen, so the
                // frame comes out a few pixels wide. Take the richer reading:
                // a real wrapper holds at least as many objects as sit beside
                // it. Mirrors resolveBodyPartFrames() in
                // ExtractSpriteMetadataCommand. See QA-100.
                $wrapperFrameObject = null;
                if (count($timeline->frames) === 1) {
                    $firstFrame = $timeline->frames[0];
                    $placedCount = count($firstFrame->objects);
                    foreach ($firstFrame->objects as $obj) {
                        if (!($obj->object instanceof SpriteDefinition)) {
                            continue;
                        }
                        $innerFrames = $obj->object->timeline()->frames;
                        if (empty($innerFrames)) {
                            break;
                        }
                        if (count($innerFrames[0]->objects) < $placedCount) {
                            break;
                        }
                        $spriteToUse = $obj->object;
                        $wrapperFrameObject = $obj;
                        break;
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
                //
                // Use the WRAPPER'S bounds (or wrapper FrameObject's
                // already-matrix-transformed bounds) when we walked into a
                // child sprite. The wrapper places the child via a
                // PlaceObject transform that may scale it (Pious for example
                // are placed at ~33% inside their wrapper, which is what
                // makes them so small canonically). Reading the inner
                // sprite's native `bounds()` here ignores that matrix and
                // produces a frame that's 2-3× the canonical visible size —
                // every monster wrapped this way ends up too big in the
                // rendered atlas.
                if ($wrapperFrameObject !== null) {
                    // FrameObject->bounds is post-matrix in twips.
                    $rect = $wrapperFrameObject->bounds;
                    $bounds = [
                        'width' => ($rect->xmax - $rect->xmin) / 20,
                        'height' => ($rect->ymax - $rect->ymin) / 20,
                        'offsetX' => $rect->xmin / 20,
                        'offsetY' => $rect->ymin / 20,
                    ];
                } else {
                    $bounds = $this->calculateBounds($spriteToUse);
                }

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
                $innerBounds = $wrapperFrameObject !== null
                    ? $this->calculateBounds($spriteToUse)
                    : null;
                foreach ($animations as $animation) {
                    $animationData = $this->processVectorAnimation(
                        $spriteId,
                        $animation,
                        $timeline,
                        $manifestOnly,
                        $wrapperFrameObject,
                        $bounds,
                        $innerBounds
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
    private function processVectorAnimation(int $spriteId, array $animation, DrawableInterface $timeline, bool $manifestOnly = false, $wrapperFrameObject = null, ?array $wrapperBounds = null, ?array $innerBounds = null): ?array
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
                $manifestOnly,
                $wrapperFrameObject,
                $wrapperBounds,
                $innerBounds
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
    private function exportSvgFrames(int $spriteId, string $animationName, DrawableInterface $timeline, int $startFrame, int $endFrame, bool $manifestOnly = false, $wrapperFrameObject = null, ?array $wrapperBounds = null, ?array $innerBounds = null): array
    {
        $frames = [];
        $safeAnimName = preg_replace('/[^a-zA-Z0-9_-]/', '_', $animationName);
        $spriteDir = sprintf('%s/svg/%d', $this->outputBase, $spriteId);

        if (!$manifestOnly) {
            @mkdir($spriteDir, 0755, true);
        }

        for ($i = $startFrame; $i <= $endFrame; $i++) {
            $frameIndex = $i - $startFrame;
            $frameFilename = sprintf('%s_%d.svg', $safeAnimName, $frameIndex);

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

                    // If we walked into a wrapper's child sprite, the
                    // converter rendered the inner sprite at its native
                    // size — but the canonical visible size is the wrapper's
                    // post-matrix bounds (the wrapper places the child via
                    // a PlaceObject transform that often scales it down,
                    // which is why Pious / smaller monsters render too big
                    // when we forget the matrix). Re-frame the SVG to the
                    // wrapper's bounds and wrap its content in a <g> with
                    // the inverse-translate so the child draws into the
                    // correct viewport.
                    if (
                        !empty($svgContent)
                        && $wrapperFrameObject !== null
                        && $wrapperBounds !== null
                        && $innerBounds !== null
                    ) {
                        $svgContent = $this->applyWrapperTransform(
                            $svgContent,
                            $wrapperFrameObject,
                            $wrapperBounds,
                            $innerBounds
                        );
                    }

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
