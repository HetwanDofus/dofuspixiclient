<?php

namespace App\Command;

use App\DynamicSpriteAnalyzer;
use App\EmptyDrawable;
use App\FlashLoopTimeline;
use App\StaggeredSpriteWrapper;
use Arakne\Swf\Error\Errors;
use Arakne\Swf\Extractor\Drawer\Converter\Converter;
use Arakne\Swf\Extractor\Image\ImageCharacterInterface;
use Arakne\Swf\Extractor\Shape\MorphShapeDefinition;
use Arakne\Swf\Extractor\Sprite\SpriteDefinition;
use Arakne\Swf\Extractor\SwfExtractor;
use Arakne\Swf\Extractor\Timeline\Frame;
use Arakne\Swf\Extractor\Timeline\Timeline;
use Arakne\Swf\Parser\Structure\Action\Opcode;
use Arakne\Swf\Parser\Structure\Tag\DoActionTag;
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
    private const SCALE_FACTOR = 1;

    private string $outputBase;
    private array $manifest = [];

    /**
     * Whether to enable the experimental dynamic-symbol pipeline globally.
     * Set from the --dynamic-symbols CLI flag. Off by default so the
     * extractor preserves the original (full-anim1) layout that the
     * existing runtime spell classes were built around.
     */
    private bool $dynamicSymbolsEnabled = false;

    /**
     * Per-spell analysis of which placed sprites carry CLIPACTIONRECORDs.
     * Reset for every SWF processed; used by the timeline rewriter to
     * strip those placements from parent SVGs (so they can be re-attached
     * as live clips by the runtime spell class) and by the manifest
     * builder to declare them as `librarySymbols[]` entries with a
     * placement schedule the AI generator turns into `clip.attach(...)`
     * calls.
     */
    private ?DynamicSpriteAnalyzer $dynamicAnalyzer = null;

    protected function configure(): void
    {
        $this
            ->setName('extract:spell-anims')
            ->setDescription('Extract spell animations from Dofus SWF files to SVG')
            ->addOption('input', 'i', InputOption::VALUE_REQUIRED, 'Input directory containing spell SWF files')
            ->addOption('output', 'o', InputOption::VALUE_OPTIONAL, 'Output directory', './output/spell-anims')
            ->addOption('spell', 's', InputOption::VALUE_OPTIONAL, 'Extract only a specific spell ID')
            ->addOption('clean', null, InputOption::VALUE_NONE, 'Clean output directory before extraction')
            ->addOption('scale', null, InputOption::VALUE_OPTIONAL, 'Scale factor for output (default: 2)', 2)
            ->addOption(
                'dynamic-symbols',
                null,
                InputOption::VALUE_NONE,
                'Enable the experimental dynamic-symbol pipeline (strips CLIPACTIONRECORD-bearing sprites from parent SVGs and emits them as separate library symbols with placement schedules). Off by default — when enabled, requires the runtime spell-{id}.ts to be AI-regenerated against the new manifest, otherwise parent SVGs render empty.',
            )
        ;
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $io = new SymfonyStyle($input, $output);
        $inputDir = $input->getOption('input');
        $this->outputBase = $input->getOption('output');
        $specificSpell = $input->getOption('spell');
        $scale = (float) $input->getOption('scale');
        $this->dynamicSymbolsEnabled = (bool) $input->getOption('dynamic-symbols');

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

            // Export FFDec ActionScript scripts EARLY so the dynamic-
            // symbol detection downstream can scan them for attachMovie
            // calls — those calls indicate the spell uses runtime sprite
            // attachment, in which case the dynamic pipeline must be
            // skipped (its inner-content stripping breaks the hand-
            // perfected `spell-{id}.ts` classes built around full library
            // symbol visuals).
            $earlyAsFiles = $this->exportActionScript($swfPath, $animDir, $io);

            // Walk the raw tag tree once to find every PlaceObject2 that
            // carries CLIPACTIONRECORDs. Those placed sprites become
            // dynamic library symbols (extracted independently, stripped
            // from parent SVGs) so the runtime can attach a live clip
            // with onLoad/onEnterFrame instead of double-rendering on top
            // of a baked frame.
            //
            // EXCEPTION: spells that already export attachMovie-style
            // library symbols (e.g. spell 103's baton/baton2/effet) ship
            // with hand-perfected `spell-{id}.ts` classes that assume
            // every library symbol's frames carry their full inner
            // visual baked in. Stripping inner dynamic content from
            // those symbols' SVGs would silently break those classes.
            // Skip the dynamic-symbol pipeline entirely for those spells
            // — the existing detectLibrarySymbols() path already covers
            // their library-symbol export.
            // Detect whether this spell uses attachMovie at runtime
            // (= has hand-perfected library symbols whose inner content
            // must NOT be stripped by the dynamic-symbol pipeline).
            //
            // Two detection paths — either is sufficient:
            //   1. Any exported SpriteDefinition (SWF Export tag).
            //   2. Any AS script with an `attachMovie("name", …)` call.
            //      Some spells (e.g. 802 Bouclier Féca) call attachMovie
            //      without exporting the symbols via Export tags — they
            //      identify targets via DefineSprite directory naming.
            $hasAttachMovieSymbols = false;
            foreach ($exported as $expName => $expCharId) {
                try {
                    $expCharacter = $extractor->character($expCharId);
                    if ($expCharacter instanceof SpriteDefinition) {
                        $hasAttachMovieSymbols = true;
                        break;
                    }
                } catch (\Throwable $e) {
                    // ignore — non-sprite or unresolvable
                }
            }
            // FFDec scripts have already been exported above. Scan them
            // for attachMovie calls — same regex detectLibrarySymbols
            // uses later, so detection is consistent.
            if (!$hasAttachMovieSymbols && is_dir($animDir . '/scripts')) {
                $iterator = new \RecursiveIteratorIterator(
                    new \RecursiveDirectoryIterator($animDir . '/scripts')
                );
                foreach ($iterator as $file) {
                    if (!$file->isFile() || $file->getExtension() !== 'as') {
                        continue;
                    }
                    $content = @file_get_contents($file->getPathname());
                    if ($content !== false && preg_match('/attachMovie\s*\(/', $content)) {
                        $hasAttachMovieSymbols = true;
                        break;
                    }
                }
            }

            if (!$this->dynamicSymbolsEnabled) {
                // Default path: pipeline is off, render anim1 with full
                // baked content. This preserves existing spell-{id}.ts
                // classes that were written against the original layout
                // (Bouclier Féca / Armures / etc.).
                $this->dynamicAnalyzer = null;
            } elseif ($hasAttachMovieSymbols) {
                $io->text('  Spell exports attachMovie library symbols — skipping dynamic-symbol pipeline (hand-perfected runtime class likely depends on baked inner content)');
                $this->dynamicAnalyzer = null;
            } else {
                $this->dynamicAnalyzer = new DynamicSpriteAnalyzer();
                $this->dynamicAnalyzer->analyze($swf);
                $dynamicCount = count($this->dynamicAnalyzer->getDynamicCharacterIds());
                if ($dynamicCount > 0) {
                    $io->text(sprintf(
                        '  Found %d dynamic sprite(s) with CLIPACTIONRECORDs (%d total placements) — will extract as library symbols',
                        $dynamicCount,
                        count($this->dynamicAnalyzer->getPlacements()),
                    ));
                }
            }

            // animDir + ActionScript export already done above (so the
            // attachMovie detection upstream had .as files to scan).
            // Reuse `$earlyAsFiles` here.

            // Extract main timeline transform (some spells apply a scale on the main timeline)
            $mainTransform = $this->extractMainTimelineTransform($swf);

            $animData = [
                'id' => $animId,
                'fps' => $frameRate,
                'scale' => self::SCALE_FACTOR,
                'mainTimelineScale' => $mainTransform['scaleX'], // Scale applied by main timeline
                'animations' => [],
            ];

            // Log if there's a non-1.0 scale
            if (abs($mainTransform['scaleX'] - 1.0) > 0.001) {
                $io->text(sprintf('  Main timeline scale: %.4f', $mainTransform['scaleX']));
            }

            $asFiles = $earlyAsFiles;
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

            // Detect attachMovie-style library symbols (existing path) if
            // TypeScript is required, AND extract sprites placed with
            // CLIPACTIONRECORDs as a parallel set of "dynamic" library
            // symbols. The latter are sprites that the parent timeline
            // PlaceObject2-s with onClipEvent handlers — historically
            // those were baked into the parent SVG (which froze their
            // dynamics), so this flow strips them and emits standalone
            // frames + a placements schedule the runtime can attach.
            $librarySymbols = [];
            if ($requiresTypeScript) {
                $librarySymbols = $this->detectLibrarySymbols($animDir, $extractor, $io);
            }

            $dynamicSymbols = $this->extractDynamicLibrarySymbols($animId, $extractor, $io);
            if (!empty($dynamicSymbols)) {
                // Mark the spell as TS-required so the runtime loads the
                // generated class (which actually attaches the dynamic
                // clips). PreRenderedSpell would render the parent SVG
                // alone — without the dynamic children — and the spell
                // would visibly miss its particles / spirals / pulses.
                $animData['requiresTypeScript'] = true;
                $requiresTypeScript = true;

                // Merge by name; attachMovie-style entries win on
                // collision because they came with full bounds via
                // detectLibrarySymbols (which reads exported symbol
                // metadata). In practice the two sets shouldn't
                // overlap — attachMovie sprites are runtime-created via
                // AS code; dynamic-placement sprites come from
                // PlaceObject2 tags in the SWF.
                $byName = [];
                foreach ($librarySymbols as $sym) {
                    $byName[$sym['name']] = $sym;
                }
                foreach ($dynamicSymbols as $sym) {
                    if (!isset($byName[$sym['name']])) {
                        $byName[$sym['name']] = $sym;
                    } else {
                        // Carry over the placement schedule onto the
                        // existing entry so the AI generator still gets
                        // the canonical attach-frame info.
                        $byName[$sym['name']]['placements'] = $sym['placements'];
                        $byName[$sym['name']]['kind'] = 'clipEvent';
                    }
                }
                $librarySymbols = array_values($byName);
            }

            if (!empty($librarySymbols)) {
                $animData['librarySymbols'] = $librarySymbols;
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

        $scale = $isRasterImage ? 1 : self::SCALE_FACTOR;

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
        $converter = new Converter();

        // Honor the Macromedia/Adobe staggered-sprite convention: each
        // PlaceObject2 of a sprite is stamped with `ratio == placement_frame`
        // so each instance plays its inner timeline starting from frame 0.
        // Arakne ignores the ratio for sprites, causing every staggered
        // instance to render the same global frame and collapse to empty
        // when the inner sprite RemoveObject2's near its end. Re-render the
        // timeline through wrappers that apply the per-instance offset.
        if ($timeline instanceof Timeline) {
            $timeline = $this->wrapTimelineWithRatioOffsets($timeline);
        }

        for ($i = 0; $i < $frameCount; $i++) {
            $frameFilename = sprintf('%s_%d.svg', $safeAnimName, $i);
            $outputPath = sprintf('%s/%s', $spellDir, $frameFilename);

            try {
                $svg = $converter->toSvg($timeline, $i);

                if (!empty($svg)) {
                    $svg = $this->stripOrphanEmptyDefs($svg);
                    file_put_contents($outputPath, $svg);

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
     * Strip `<g id="X"/>` defs that have no rendered content + every
     * `<use xlink:href="#X" .../>` that points to one. Arakne emits these
     * placeholder pairs whenever a sprite has been RemoveObject2'd from
     * the parent display list mid-timeline (or stripped by our dynamic-
     * library-symbol pipeline). They render nothing in a faithful SVG
     * implementation, but our atlas pipeline runs them through SVGO whose
     * `removeUselessDefs` deletes the def while `cleanupIds` then renames
     * the SURVIVING ids — leaving the body's `<use>` refs pointing to
     * nothing OR (worse) to whatever id the renamer picked next, producing
     * the "weird static fragment frozen on top of the spell" the user
     * observed on Armure Incandescente / Armure Terrestre.
     *
     * Removing both halves of the pair at extraction time is the safest
     * fix: the source SVG no longer carries the ambiguity, every later
     * tool sees a clean tree.
     *
     * Conservative: only strips defs that are TRULY empty (no children,
     * no text node). A def with at least one `<use>`/`<path>`/`<g>` child
     * is kept even if it's "visually" empty after color transforms.
     */
    private function stripOrphanEmptyDefs(string $svg): string
    {
        // Apply BOTH cleanups (orphan-empty-defs + clipPath-strip)
        // tentatively, then keep the result only if the final body
        // still has visible content. Otherwise revert to the original
        // SVG — empty frames trigger an svg-spritesheet bug where the
        // frame is declared in atlas.json but absent from atlas.svg,
        // and the runtime then renders garbage from neighbouring
        // atlas pixels at the declared region (= "stuff that shouldn't
        // be there on the last frame", the user's report).
        //
        // Note: regex delimiter is `~` (not `#`) because the body of
        // these patterns contains literal `#` from `href="#X"`.
        $original = $svg;

        // ── Pass 1: orphan empty `<g id="X"/>` defs + their `<use>` refs ──
        // Arakne emits placeholder pairs whenever a sprite has been
        // RemoveObject2'd from the parent display list. These render
        // nothing but downstream SVGO `removeUselessDefs` deletes the
        // def while `cleanupIds` renames survivors, leaving body
        // `<use>` refs pointing to the wrong canonical id.
        $emptyIds = [];
        if (preg_match_all('~<g\b([^>]*?)\bid="([^"]+)"([^>]*?)/>~', $svg, $m)) {
            foreach ($m[2] as $id) {
                $emptyIds[$id] = true;
            }
        }
        if (preg_match_all('~<g\b([^>]*?)\bid="([^"]+)"([^>]*?)>\s*</g>~', $svg, $m)) {
            foreach ($m[2] as $id) {
                $emptyIds[$id] = true;
            }
        }
        if (!empty($emptyIds)) {
            $svg = preg_replace_callback(
                '~<use\b[^>]*?\b(?:xlink:)?href="#([^"]+)"[^>]*?/>~',
                static function (array $match) use ($emptyIds): string {
                    return isset($emptyIds[$match[1]]) ? '' : $match[0];
                },
                $svg,
            );
            $svg = preg_replace_callback(
                '~<g\b[^>]*?\bid="([^"]+)"[^>]*?/>~',
                static function (array $match) use ($emptyIds): string {
                    return isset($emptyIds[$match[1]]) ? '' : $match[0];
                },
                $svg,
            );
            $svg = preg_replace_callback(
                '~<g\b[^>]*?\bid="([^"]+)"[^>]*?>\s*</g>~',
                static function (array $match) use ($emptyIds): string {
                    return isset($emptyIds[$match[1]]) ? '' : $match[0];
                },
                $svg,
            );
        }

        // ── Pass 2: inline `<clipPath>` constructs + clipped `<g>` ────────
        // svg-spritesheet doesn't model clip-path attributes — when the
        // construct survives, the inner `<use>` is rendered UNCLIPPED at
        // its raw transform, producing the "wrong static shape at
        // offset" the user originally reported on 108/110.
        $clipPathIds = [];
        if (preg_match_all('~<clipPath\b[^>]*?\bid="([^"]+)"[^>]*?>.*?</clipPath>~s', $svg, $m)) {
            foreach ($m[1] as $id) {
                $clipPathIds[$id] = true;
            }
        }
        if (!empty($clipPathIds)) {
            $svg = preg_replace_callback(
                '~<g\b[^>]*?\bclip-path="url\(#([^)]+)\)"[^>]*?>(.*?)</g>~s',
                static function (array $match) use ($clipPathIds): string {
                    return isset($clipPathIds[$match[1]]) ? '' : $match[0];
                },
                $svg,
            );
            $svg = preg_replace('~<clipPath\b[^>]*?>.*?</clipPath>~s', '', $svg);
        }

        // ── Final guard: inject an invisible placeholder when body empty ──
        // svg-spritesheet's atlas writer skips frames with no body
        // content but still declares them in atlas.json — the runtime
        // then renders garbage from adjacent atlas regions at the
        // declared bbox (= "stuff that shouldn't be there on the last
        // frame", the user's report). Inject a transparent 1x1 rect
        // so the frame has SOMETHING to serialize while still rendering
        // visually empty. Atlas writer keeps the slot, runtime sees
        // nothing, no garbage.
        $bodyOnly = preg_replace('~<defs\b.*?</defs>~s', '', $svg);
        $bodyVisible = (preg_match_all('~<use\b~', $bodyOnly) ?: 0)
            + (preg_match_all('~<path\b~', $bodyOnly) ?: 0);
        if ($bodyVisible === 0) {
            // Inject inside the outermost <g> (right after its `>`).
            // Pattern matches the first `<g transform="..."> ` that
            // appears at the body level (Arakne always emits one).
            $placeholder = '<rect width="1" height="1" fill="none" stroke="none"/>';
            $svg = preg_replace(
                '~(<g\s+transform="[^"]+">)~',
                '${1}' . $placeholder,
                $svg,
                1,
            );
        }

        return $svg;
    }

    /**
     * @deprecated Old separate path retained only for the original
     *             stripOrphanEmptyDefs caller compatibility — unused.
     */
    private function unusedLegacyOrphanCleanup(string $svg): string
    {
        $emptyIds = [];

        // Self-closing: <g ... id="X" .../>
        if (preg_match_all('~<g\b([^>]*?)\bid="([^"]+)"([^>]*?)/>~', $svg, $m)) {
            foreach ($m[2] as $idx => $id) {
                $emptyIds[$id] = true;
            }
        }

        // Non-self-closing but empty: <g ... id="X" ...>WS</g>
        if (preg_match_all('~<g\b([^>]*?)\bid="([^"]+)"([^>]*?)>\s*</g>~', $svg, $m)) {
            foreach ($m[2] as $idx => $id) {
                $emptyIds[$id] = true;
            }
        }

        if (empty($emptyIds)) {
            return $svg;
        }

        // Remove every <use ...href="#X" .../> where X is in $emptyIds.
        $svg = preg_replace_callback(
            '~<use\b[^>]*?\b(?:xlink:)?href="#([^"]+)"[^>]*?/>~',
            static function (array $match) use ($emptyIds): string {
                return isset($emptyIds[$match[1]]) ? '' : $match[0];
            },
            $svg,
        );

        // Then remove the empty <g id="X"/> defs themselves.
        $svg = preg_replace_callback(
            '~<g\b[^>]*?\bid="([^"]+)"[^>]*?/>~',
            static function (array $match) use ($emptyIds): string {
                return isset($emptyIds[$match[1]]) ? '' : $match[0];
            },
            $svg,
        );
        $svg = preg_replace_callback(
            '~<g\b[^>]*?\bid="([^"]+)"[^>]*?>\s*</g>~',
            static function (array $match) use ($emptyIds): string {
                return isset($emptyIds[$match[1]]) ? '' : $match[0];
            },
            $svg,
        );

        return $svg;
    }

    /**
     * For every sprite identified as "dynamic" (its placement carries
     * CLIPACTIONRECORDs), export its frames independently as a library
     * symbol and bundle the placement schedule that the runtime uses to
     * attach a live clip at the canonical parent frame.
     *
     * The exported sprite IS itself wrapped via {@see wrapTimelineWithRatioOffsets()}
     * so nested staggers / loops still apply when the runtime steps the
     * dynamic clip's frames at runtime.
     *
     * @return list<array<string, mixed>>
     */
    private function extractDynamicLibrarySymbols(
        int $animId,
        SwfExtractor $extractor,
        SymfonyStyle $io,
    ): array {
        if ($this->dynamicAnalyzer === null) {
            return [];
        }

        $byPlaced = $this->dynamicAnalyzer->getPlacementsByPlacedSprite();
        if (empty($byPlaced)) {
            return [];
        }

        $symbols = [];

        foreach ($byPlaced as $charId => $placements) {
            try {
                $sprite = $extractor->character($charId);
            } catch (\Throwable $e) {
                $io->text(sprintf('    Warning: dynamic char %d not extractable: %s', $charId, $e->getMessage()));
                continue;
            }

            if (!($sprite instanceof SpriteDefinition)) {
                // Shapes/morph shapes can technically carry clip events
                // too, but we have not seen this in practice for spell
                // SWFs. Skip with a note.
                $io->text(sprintf('    Skipping dynamic char %d (not a sprite, type=%s)', $charId, get_class($sprite)));
                continue;
            }

            // Stable name keyed by character id so the AI generator can
            // correlate it with the canonical AS path
            // `scripts/scripts/DefineSprite_<id>/...`. This matches what
            // hand-perfected spell-101.ts already uses (`sprite3`,
            // `sprite9`, `sprite10`, `sprite12`, `sprite13`).
            $name = 'sprite' . $charId;

            try {
                $timeline = $sprite->timeline();
                $frameCount = $timeline->framesCount();
                $bounds = $this->calculateBounds($sprite);

                // Apply the standard rewriting (stagger + loop) to the
                // dynamic sprite's own timeline before rendering — the
                // runtime will step its frames per-tick and we want the
                // same Flash semantics applied here as for any other
                // sprite.
                $wrapped = $this->wrapTimelineWithRatioOffsets($timeline);

                $exportedFrames = $this->exportFrames($animId, 'lib_' . $name, $wrapped, $frameCount);

                $placementsManifest = array_map(
                    static fn ($p) => $p->toManifest(),
                    $placements,
                );

                $symbols[] = [
                    'name' => $name,
                    'characterId' => $charId,
                    // `kind: clipEvent` distinguishes from `attachMovie`-
                    // sourced library symbols (which the existing
                    // detectLibrarySymbols() emits without a kind field).
                    'kind' => 'clipEvent',
                    // `directlyDynamic: true` means this sprite itself
                    // owns a CLIPACTIONRECORD placement and the runtime
                    // class should port its onLoad/onEnterFrame from
                    // the AS files at
                    // scripts/scripts/DefineSprite_<id>/.../CLIPACTIONRECORD onClipEvent(*).as.
                    //
                    // `directlyDynamic: false` means this sprite is just
                    // a wrapper that propagates dynamic descendants —
                    // its SymbolDefinition gets frameScripts that
                    // clip.attach the children at the canonical
                    // sub-placement frames but NO onLoad/onEnterFrame.
                    'directlyDynamic' => $this->dynamicAnalyzer->isDirectlyDynamic($charId),
                    'frameCount' => $frameCount,
                    'width' => $bounds['width'],
                    'height' => $bounds['height'],
                    'offsetX' => $bounds['offsetX'],
                    'offsetY' => $bounds['offsetY'],
                    'frames' => $exportedFrames,
                    'placements' => $placementsManifest,
                ];

                $io->text(sprintf(
                    '    Extracted dynamic lib "%s" (sprite_%d, %s): %d frame(s), %d placement(s)',
                    $name,
                    $charId,
                    $this->dynamicAnalyzer->isDirectlyDynamic($charId) ? 'direct' : 'wrapper',
                    $frameCount,
                    count($placements),
                ));
            } catch (\Throwable $e) {
                $io->text(sprintf('    Error extracting dynamic sprite_%d: %s', $charId, $e->getMessage()));
            }
        }

        return $symbols;
    }

    /**
     * Rebuild a timeline so every sprite-typed FrameObject with a non-null
     * positive `ratio` carries its sprite wrapped in {@see StaggeredSpriteWrapper}.
     * This applies the ratio as a per-instance frame offset at draw time,
     * which is the missing piece in Arakne's rendering of Flash's staggered
     * sprite-placement convention.
     *
     * Wrapping is applied recursively into child sprites so nested staggers
     * survive too. SpriteDefinition is final, so we wrap by replacing the
     * FrameObject's `object` field rather than mutating the SpriteDefinition.
     */
    private function wrapTimelineWithRatioOffsets(Timeline $timeline): Timeline
    {
        // Memo so a nested sprite is rewritten exactly once even if it
        // appears at many depths/frames in the parent — and so we don't
        // recurse infinitely on cyclic graphs (shouldn't happen, but cheap).
        $rewrittenSprites = [];

        $rewriteSprite = function (SpriteDefinition $sprite) use (&$rewrittenSprites, &$rewriteSprite) {
            $key = spl_object_id($sprite);
            if (isset($rewrittenSprites[$key])) {
                return $rewrittenSprites[$key];
            }
            // Tentatively map to the original to break cycles before recursing.
            $rewrittenSprites[$key] = $sprite;
            $originalTimeline = $sprite->timeline();
            $newTimeline = $this->rewriteTimeline($originalTimeline, $rewriteSprite);
            // Detect the sprite's stop frame from its bytecode so the
            // wrapper can clamp (with stop) or loop (without). This is the
            // missing piece for ambient sub-sprites that overrun their own
            // timeline length and should LOOP — Arakne's default Timeline
            // clamps at the last frame.
            $stopFrame = $this->detectStopFrameInTimeline($originalTimeline);
            $loopWrapped = new FlashLoopTimeline($newTimeline, $stopFrame);
            // SpriteDefinition is final; we can't subclass it, so return a
            // wrapper that exposes the rewritten timeline via draw().
            $wrapped = new InlineSpriteWrapper($sprite, $loopWrapped);
            $rewrittenSprites[$key] = $wrapped;
            return $wrapped;
        };

        return $this->rewriteTimeline($timeline, $rewriteSprite);
    }

    /**
     * True if the SWF anywhere references the string "attachMovie" in its
     * ActionScript bytecode — used to detect spells that build their visual
     * via runtime sprite attachment (so we can skip the dynamic-symbol
     * pipeline, which would otherwise strip the symbols' inner content
     * out of the parent SVG and break the hand-perfected spell-{id}.ts).
     *
     * Walks DoActionTag bytecode in the main timeline AND inside every
     * DefineSpriteTag, scanning ActionConstantPool entries and ActionPush
     * value strings.
     */
    private function swfReferencesAttachMovie(SwfFile $swf): bool
    {
        foreach ($swf->tags() as $tag) {
            if ($this->actionsReferenceAttachMovie($tag)) {
                return true;
            }
            if ($tag instanceof \Arakne\Swf\Parser\Structure\Tag\DefineSpriteTag) {
                foreach ($tag->tags as $inner) {
                    if ($this->actionsReferenceAttachMovie($inner)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    /**
     * Inspect a single tag's bytecode (if it has any) for the literal
     * "attachMovie" string in either an ActionConstantPool entry or an
     * ActionPush string operand.
     */
    private function actionsReferenceAttachMovie(object $tag): bool
    {
        if (!($tag instanceof DoActionTag)) {
            return false;
        }
        foreach ($tag->actions as $action) {
            if ($action->opcode === Opcode::ActionConstantPool) {
                $constants = $action->data;
                if (is_array($constants)) {
                    foreach ($constants as $c) {
                        if (is_string($c) && $c === 'attachMovie') {
                            return true;
                        }
                    }
                }
            } elseif ($action->opcode === Opcode::ActionPush) {
                $values = $action->data;
                if (is_array($values)) {
                    foreach ($values as $v) {
                        // ActionPush carries `Value` records — their
                        // string forms appear via the `value` property.
                        $sv = is_object($v) && property_exists($v, 'value') ? $v->value : null;
                        if (is_string($sv) && $sv === 'attachMovie') {
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }

    /**
     * Walk the timeline's per-frame actions and return the smallest 0-indexed
     * frame index that contains an `ActionStop` opcode. Returns null when no
     * frame stops — in which case the sprite should loop (canonical Flash
     * MovieClip default).
     */
    private function detectStopFrameInTimeline(Timeline $timeline): ?int
    {
        foreach ($timeline->frames as $idx => $frame) {
            foreach ($frame->actions as $doAction) {
                if (!$doAction instanceof DoActionTag) {
                    continue;
                }
                foreach ($doAction->actions as $action) {
                    if ($action->opcode === Opcode::ActionStop) {
                        return $idx;
                    }
                }
            }
        }
        return null;
    }

    /**
     * Walk a timeline's frames and rebuild them with rewritten objects.
     *
     * @param Timeline $timeline
     * @param callable(SpriteDefinition):\Arakne\Swf\Extractor\DrawableInterface $rewriteSprite
     */
    private function rewriteTimeline(Timeline $timeline, callable $rewriteSprite): Timeline
    {
        $analyzer = $this->dynamicAnalyzer;
        $newFrames = [];
        foreach ($timeline->frames as $frame) {
            $newObjects = [];
            foreach ($frame->objects as $depth => $obj) {
                $object = $obj->object;

                // If this placement's sprite carries CLIPACTIONRECORDs, do
                // NOT bake it into the parent SVG. Substitute an empty
                // drawable that preserves the original bounds (so the
                // parent's frame bounds don't shrink) but emits no SVG
                // markup. The runtime spell class will attach a live
                // SpellClip at the matching frame via the manifest's
                // `librarySymbols[].placements` schedule.
                if (
                    $analyzer !== null
                    && $object instanceof SpriteDefinition
                    && $analyzer->isDynamic($object->id)
                ) {
                    $newObjects[$depth] = $obj->with(
                        object: new EmptyDrawable($object->bounds()),
                    );
                    continue;
                }

                if ($object instanceof SpriteDefinition) {
                    $object = $rewriteSprite($object);
                }

                if ($obj->ratio !== null && $obj->ratio > 0 && $obj->object instanceof SpriteDefinition) {
                    // Macromedia stamps `ratio == placement_frame` on each
                    // staggered sprite placement; honor it as a draw-time
                    // offset so each instance's inner timeline runs from
                    // its own frame 0.
                    $object = new StaggeredSpriteWrapper($object, $obj->ratio);
                }

                $newObjects[$depth] = $obj->with(object: $object);
            }
            $newFrames[] = new Frame(
                $frame->bounds,
                $newObjects,
                $frame->actions,
                $frame->label,
            );
        }

        return new Timeline($timeline->bounds, ...$newFrames);
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
     * Looks for terminal-action calls in DefineSprite_X/frame_Y/DoAction.as.
     * A terminal action is anything that halts further timeline progression
     * for this clip:
     *   - stop()
     *   - removeMovieClip(), this.removeMovieClip(), _parent.removeMovieClip()
     *
     * Spells like Armure Terrestre (108) / Incandescente (110) end with
     * `_parent.removeMovieClip();` instead of an explicit `stop()` — without
     * recognising that pattern, PreRenderedSpell would play through to the
     * SVG sequence's last rendered frame (frame_count - 1) and leave one or
     * two extra frames of post-removeMovieClip content visible.
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

        // Find frame directories and check for terminal-action calls.
        $frameDirs = glob($scriptDir . '/frame_*');
        $stopFrames = [];

        // Match either:
        //   stop();
        //   removeMovieClip();
        //   <prefix>.removeMovieClip();   (this., _parent., etc.)
        $terminalRegex = '/\b(?:stop|(?:[a-zA-Z_][\w$]*\s*\.\s*)?removeMovieClip)\s*\(\s*\)\s*;/';

        foreach ($frameDirs as $frameDir) {
            $frameName = basename($frameDir);
            if (preg_match('/frame_(\d+)/', $frameName, $matches)) {
                // AS frame numbers are 1-indexed, convert to 0-indexed
                $frameNum = (int)$matches[1] - 1;
                $doActionFile = $frameDir . '/DoAction.as';

                if (file_exists($doActionFile)) {
                    $content = file_get_contents($doActionFile);
                    if (preg_match($terminalRegex, $content)) {
                        $stopFrames[] = $frameNum;
                    }
                }
            }
        }

        // Return the first stop frame (smallest frame number with a terminal action).
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
