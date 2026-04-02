<?php

namespace App\Command;

use Arakne\Swf\Extractor\Drawer\Converter\Converter;
use Arakne\Swf\Extractor\Sprite\SpriteDefinition;
use Arakne\Swf\Extractor\Shape\ShapeDefinition;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Console\Style\SymfonyStyle;
use Arakne\Swf\SwfFile;
use Arakne\Swf\Extractor\SwfExtractor;

use function sprintf;

/**
 * Extract accessory sprites from SWF files as SVG frames.
 *
 * Accessory SWFs: assets/sources/clips/sprites/accessories/{a1..a8,accessories,accessories_autres}.swf
 * Each contains symbols named "{type}_{gfxId}" (e.g., "16_10" = hat type, gfx 10).
 * Each symbol has 15 frames with labels: R(0), L(3), F(6), B(9), S(12) — 3 frames per direction.
 *
 * Output: {outputDir}/{type}_{gfxId}/{direction}/frame_{n}.svg + atlas.json
 * Direction names: R, L, F, B, S (matching character sprite suffixes)
 */
class ExtractAccessoriesCommand extends Command
{
    private const ACCESSORIES_PATH = __DIR__ . '/../../../../assets/sources/clips/sprites/accessories';

    /** Direction label → start frame index */
    private const DIRECTIONS = [
        'R' => 0,
        'L' => 3,
        'F' => 6,
        'B' => 9,
        'S' => 12,
    ];

    private string $outputBase;

    protected function configure(): void
    {
        $this
            ->setName('accessories:extract')
            ->setDescription('Extract accessory sprites from SWF files as SVG')
            ->addOption('output', 'o', InputOption::VALUE_REQUIRED, 'Output directory', __DIR__ . '/../../../../apps/electrobun/public/assets/spritesheets/accessories')
            ->addOption('clean', null, InputOption::VALUE_NONE, 'Clean output directory before extraction')
            ->addOption('symbol', null, InputOption::VALUE_OPTIONAL, 'Only extract a specific symbol (e.g., "16_10")');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $io = new SymfonyStyle($input, $output);
        $this->outputBase = $input->getOption('output');
        $filterSymbol = $input->getOption('symbol');

        $io->title('Accessory Sprite Extractor (SVG)');

        if ($input->getOption('clean') && is_dir($this->outputBase)) {
            $io->text('Cleaning output directory...');
            $this->cleanDir($this->outputBase);
        }

        @mkdir($this->outputBase, 0755, true);

        $swfFiles = glob(self::ACCESSORIES_PATH . '/*.swf');
        if (!$swfFiles) {
            $io->error('No accessory SWF files found at ' . self::ACCESSORIES_PATH);
            return Command::FAILURE;
        }

        $extracted = 0;
        $skipped = 0;
        $failed = 0;

        foreach ($swfFiles as $swfPath) {
            $swfName = basename($swfPath);
            $swf = new SwfFile($swfPath);
            $ext = new SwfExtractor($swf);
            $exported = $ext->exported();

            foreach ($exported as $symbolName => $characterId) {
                // Symbol names like "16_10", "BrasD_1" etc.
                // Only process numeric type_gfxId patterns
                $parts = explode('_', $symbolName, 2);
                if (count($parts) !== 2 || !is_numeric($parts[0])) {
                    continue;
                }

                if ($filterSymbol !== null && $symbolName !== $filterSymbol) {
                    continue;
                }

                $outDir = sprintf('%s/%s', $this->outputBase, $symbolName);

                // Skip if already extracted (check for atlas.json)
                if (is_file("$outDir/R/atlas.json")) {
                    $skipped++;
                    continue;
                }

                try {
                    $character = $ext->character($characterId);
                    if (!($character instanceof SpriteDefinition)) {
                        continue;
                    }

                    $success = $this->extractAccessory($character, $symbolName, $outDir);
                    if ($success) {
                        $extracted++;
                    } else {
                        $failed++;
                    }
                } catch (\Exception $e) {
                    $failed++;
                    if ($output->isVerbose()) {
                        $io->warning("Failed: $symbolName from $swfName — " . $e->getMessage());
                    }
                }

                $ext->releaseIfOutOfMemory();
            }

            $ext->release();

            if (!$output->isQuiet()) {
                $io->text("$swfName: " . count($exported) . " symbols processed");
            }
        }

        $io->success(sprintf(
            'Done: %d extracted, %d skipped (already exist), %d failed',
            $extracted,
            $skipped,
            $failed
        ));

        return Command::SUCCESS;
    }

    /**
     * Extract all direction frames of an accessory symbol.
     */
    private function extractAccessory(SpriteDefinition $sprite, string $symbolName, string $outDir): bool
    {
        $totalFrames = $sprite->framesCount();
        $converter = new Converter(subpixelStrokeWidth: false);
        $anySuccess = false;

        // Get frame labels to confirm direction mapping
        $timeline = $sprite->timeline();
        $rc = new \ReflectionClass($timeline);
        $fp = $rc->getProperty('frames');
        $fp->setAccessible(true);
        $frames = $fp->getValue($timeline);

        // Build label → frame index map from actual labels
        $labelMap = [];
        foreach ($frames as $i => $frame) {
            if ($frame->label !== null) {
                $labelMap[$frame->label] = $i;
            }
        }

        // Use actual labels if available, fall back to defaults
        $directions = !empty($labelMap) ? $labelMap : self::DIRECTIONS;

        foreach ($directions as $dirLabel => $startFrame) {
            // Only process our known direction labels
            if (!isset(self::DIRECTIONS[$dirLabel])) {
                continue;
            }

            $dirDir = "$outDir/$dirLabel";
            @mkdir($dirDir, 0755, true);

            // Determine how many frames this direction has
            // (distance to next label, or remaining frames)
            $sortedStarts = array_values($directions);
            sort($sortedStarts);
            $idx = array_search($startFrame, $sortedStarts);
            $nextStart = ($idx !== false && $idx + 1 < count($sortedStarts))
                ? $sortedStarts[$idx + 1]
                : $totalFrames;
            $dirFrameCount = $nextStart - $startFrame;

            $svgFrames = [];
            $maxW = 0;
            $maxH = 0;

            for ($f = 0; $f < $dirFrameCount; $f++) {
                $frameIdx = $startFrame + $f;
                if ($frameIdx >= $totalFrames) break;

                try {
                    $svg = $converter->toSvg($sprite, $frameIdx);
                    if (empty($svg)) continue;

                    // Use SWF bounds for metadata (offset = registration point)
                    $bounds = $sprite->bounds($frameIdx);
                    $brc = new \ReflectionClass($bounds);
                    $bxmin = $brc->getProperty('xmin'); $bxmin->setAccessible(true);
                    $bymin = $brc->getProperty('ymin'); $bymin->setAccessible(true);

                    $vx = $bxmin->getValue($bounds) / 20;
                    $vy = $bymin->getValue($bounds) / 20;
                    $w = $bounds->width() / 20;
                    $h = $bounds->height() / 20;

                    if ($w <= 0 || $h <= 0) continue;

                    // The Converter already produces correct width/height
                    // with a root transform that places content at (0,0).
                    // Do NOT add a viewBox — it conflicts with the transform.

                    $frameFile = "frame_$f.svg";
                    file_put_contents("$dirDir/$frameFile", $svg);

                    $svgFrames[] = [
                        'id' => "frame_$f",
                        'file' => $frameFile,
                        'width' => round($w, 2),
                        'height' => round($h, 2),
                        'offsetX' => round($vx, 2),
                        'offsetY' => round($vy, 2),
                    ];

                    $maxW = max($maxW, $w);
                    $maxH = max($maxH, $h);
                } catch (\Exception $e) {
                    continue;
                }
            }

            if (!empty($svgFrames)) {
                // Write atlas.json for this direction
                $atlas = [
                    'symbol' => $symbolName,
                    'direction' => $dirLabel,
                    'width' => round($maxW, 1),
                    'height' => round($maxH, 1),
                    'frames' => $svgFrames,
                    'fps' => 12,
                ];
                file_put_contents("$dirDir/atlas.json", json_encode($atlas, JSON_PRETTY_PRINT));
                $anySuccess = true;
            }
        }

        return $anySuccess;
    }

    /**
     * Crop SVG to content bounds (same logic as ExtractItemsCommand).
     */
    private function cropSvgToContent(string $svg): string
    {
        $defsPos = strpos($svg, '<defs>');
        $contentPart = $defsPos !== false ? substr($svg, 0, $defsPos) : $svg;

        $minX = PHP_FLOAT_MAX;
        $minY = PHP_FLOAT_MAX;
        $maxX = PHP_FLOAT_MIN;
        $maxY = PHP_FLOAT_MIN;
        $found = false;

        if (preg_match_all(
            '/<use[^>]+width="([^"]+)"[^>]+height="([^"]+)"[^>]+transform="matrix\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)"/',
            $contentPart, $matches, PREG_SET_ORDER
        )) {
            foreach ($matches as $m) {
                $w = (float) $m[1];
                $h = (float) $m[2];
                $a = (float) $m[3];
                $b = (float) $m[4];
                $c = (float) $m[5];
                $d = (float) $m[6];
                $tx = (float) $m[7];
                $ty = (float) $m[8];

                $scaleX = sqrt($a * $a + $b * $b);
                $scaleY = sqrt($c * $c + $d * $d);
                $sw = $w * $scaleX;
                $sh = $h * $scaleY;

                $minX = min($minX, $tx, $tx + $sw);
                $maxX = max($maxX, $tx, $tx + $sw);
                $minY = min($minY, $ty, $ty + $sh);
                $maxY = max($maxY, $ty, $ty + $sh);
                $found = true;
            }
        }

        if (!$found || $maxX <= $minX || $maxY <= $minY) {
            return $svg;
        }

        $pad = 2;
        $vx = $minX - $pad;
        $vy = $minY - $pad;
        $vw = ($maxX - $minX) + $pad * 2;
        $vh = ($maxY - $minY) + $pad * 2;

        $svg = preg_replace(
            '/(<svg[^>]*)\s+width="[^"]*"\s+height="[^"]*"/',
            sprintf('$1 width="%.1f" height="%.1f" viewBox="%.1f %.1f %.1f %.1f"', $vw, $vh, $vx, $vy, $vw, $vh),
            $svg
        );

        return $svg;
    }

    private function cleanDir(string $dir): void
    {
        $it = new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS);
        $ri = new \RecursiveIteratorIterator($it, \RecursiveIteratorIterator::CHILD_FIRST);
        foreach ($ri as $file) {
            if ($file->isDir()) {
                @rmdir($file->getRealPath());
            } else {
                @unlink($file->getRealPath());
            }
        }
    }
}
