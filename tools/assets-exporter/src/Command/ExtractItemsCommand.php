<?php

namespace App\Command;

use Arakne\Swf\Extractor\Drawer\Converter\Converter;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Console\Style\SymfonyStyle;
use Arakne\Swf\SwfFile;
use Arakne\Swf\Extractor\SwfExtractor;
use Arakne\Swf\Extractor\Shape\ShapeDefinition;
use Arakne\Swf\Extractor\Sprite\SpriteDefinition;

use function sprintf;

/**
 * Extract item icons from SWF files as SVG.
 *
 * Item SWFs live at assets/sources/clips/items/{type}/{itemId}.swf
 * Each produces a single static SVG icon.
 */
class ExtractItemsCommand extends Command
{
    private const CLIENT_PATH = __DIR__ . '/../../../../assets/sources';
    private const ITEMS_PATH = self::CLIENT_PATH . '/clips/items';

    private string $outputBase;

    protected function configure(): void
    {
        $this
            ->setName('items:extract')
            ->setDescription('Extract item icons from SWF files as SVG')
            ->addOption('output', 'o', InputOption::VALUE_REQUIRED, 'Output directory', __DIR__ . '/../../../../apps/electrobun/public/assets/items')
            ->addOption('clean', null, InputOption::VALUE_NONE, 'Clean output directory before extraction')
            ->addOption('type', 't', InputOption::VALUE_OPTIONAL, 'Only extract items of this type (directory name)')
            ->addOption('id', null, InputOption::VALUE_OPTIONAL, 'Only extract a specific item ID');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $io = new SymfonyStyle($input, $output);
        $this->outputBase = $input->getOption('output');
        $filterType = $input->getOption('type');
        $filterId = $input->getOption('id');

        $io->title('Item Icon Extractor (SVG)');

        if ($input->getOption('clean') && is_dir($this->outputBase)) {
            $io->text('Cleaning output directory...');
            $this->cleanDir($this->outputBase);
        }

        @mkdir($this->outputBase, 0755, true);

        $typeDirs = glob(self::ITEMS_PATH . '/*', GLOB_ONLYDIR);
        if (!$typeDirs) {
            $io->error('No item type directories found at ' . self::ITEMS_PATH);
            return Command::FAILURE;
        }

        $extracted = 0;
        $skipped = 0;
        $failed = 0;

        foreach ($typeDirs as $typeDir) {
            $typeName = basename($typeDir);

            if ($filterType !== null && $typeName !== $filterType) {
                continue;
            }

            $swfFiles = glob($typeDir . '/*.swf');
            if (!$swfFiles) continue;

            // Create type subdirectory
            $typeOutDir = sprintf('%s/%s', $this->outputBase, $typeName);
            @mkdir($typeOutDir, 0755, true);

            foreach ($swfFiles as $swfPath) {
                $itemId = (int) basename($swfPath, '.swf');

                if ($filterId !== null && (int) $filterId !== $itemId) {
                    continue;
                }

                $outPath = sprintf('%s/%d.svg', $typeOutDir, $itemId);

                // Skip if already extracted
                if (file_exists($outPath)) {
                    $skipped++;
                    continue;
                }

                try {
                    $svg = $this->extractItemIcon($swfPath);
                    if ($svg) {
                        file_put_contents($outPath, $svg);
                        $extracted++;
                    } else {
                        $failed++;
                    }
                } catch (\Exception $e) {
                    $failed++;
                    if ($output->isVerbose()) {
                        $io->warning("Failed: $swfPath — " . $e->getMessage());
                    }
                }
            }

            if (!$output->isQuiet()) {
                $io->text("Type $typeName: processed " . count($swfFiles) . " files");
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
     * Extract the first frame of the first exported symbol as SVG.
     */
    private function extractItemIcon(string $swfPath): ?string
    {
        $swf = new SwfFile($swfPath);
        $extractor = new SwfExtractor($swf);

        // Item SWFs have no exported symbols — the icon is the root timeline
        $timeline = $extractor->timeline();
        $converter = new Converter(subpixelStrokeWidth: false);
        $svg = $converter->toSvg($timeline, 0);

        $extractor->release();

        if (empty($svg)) return null;

        return $this->cropSvgToContent($svg);
    }

    /**
     * Add a viewBox to crop the SVG to its actual content bounds.
     * The raw SVG uses the full SWF stage size, but the actual icon
     * content occupies only a small region.
     *
     * Strategy: look at the <use> elements in the top-level <g> — their
     * transform matrices give us the placement coordinates, and their
     * width/height give us the size of each placed symbol.
     */
    private function cropSvgToContent(string $svg): string
    {
        // Split at <defs> — only process content before it
        $defsPos = strpos($svg, '<defs>');
        $contentPart = $defsPos !== false ? substr($svg, 0, $defsPos) : $svg;

        $minX = PHP_FLOAT_MAX;
        $minY = PHP_FLOAT_MAX;
        $maxX = -PHP_FLOAT_MAX;
        $maxY = -PHP_FLOAT_MAX;
        $found = false;

        // Match <use> elements with width, height, and transform matrix
        // format: <use ... width="W" height="H" transform="matrix(a,b,c,d, tx, ty)"/>
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

                // Transform all four corners of the symbol's own
                // (0,0,w,h) box. Deriving the extent from sqrt(a^2+b^2)
                // and growing rightwards/downwards from (tx,ty) assumes
                // the matrix neither mirrors nor rotates: a mirrored
                // placement (a < 0) actually runs *leftwards* from tx, so
                // the box was computed on the wrong side of the origin and
                // the crop cut the whole drawing away.
                foreach ([[0.0, 0.0], [$w, 0.0], [0.0, $h], [$w, $h]] as $corner) {
                    $px = $a * $corner[0] + $c * $corner[1] + $tx;
                    $py = $b * $corner[0] + $d * $corner[1] + $ty;
                    $minX = min($minX, $px);
                    $maxX = max($maxX, $px);
                    $minY = min($minY, $py);
                    $maxY = max($maxY, $py);
                }
                $found = true;
            }
        }

        if (!$found || $maxX <= $minX || $maxY <= $minY) {
            return $svg;
        }

        // Add padding
        $pad = 2;
        $vx = $minX - $pad;
        $vy = $minY - $pad;
        $vw = ($maxX - $minX) + $pad * 2;
        $vh = ($maxY - $minY) + $pad * 2;

        // Replace width/height with cropped dimensions + viewBox
        $svg = preg_replace(
            '/(<svg[^>]*)\s+width="[^"]*"\s+height="[^"]*"/',
            sprintf('$1 width="%.1f" height="%.1f" viewBox="%.1f %.1f %.1f %.1f"', $vw, $vh, $vx, $vy, $vw, $vh),
            $svg
        );

        return $svg;
    }

    private function cleanDir(string $dir): void
    {
        // Remove old flat files
        $files = glob($dir . '/*.svg');
        if ($files) {
            foreach ($files as $file) {
                @unlink($file);
            }
        }
        // Remove type subdirectories
        $subdirs = glob($dir . '/*', GLOB_ONLYDIR);
        if ($subdirs) {
            foreach ($subdirs as $subdir) {
                $subFiles = glob($subdir . '/*.svg');
                if ($subFiles) {
                    foreach ($subFiles as $file) {
                        @unlink($file);
                    }
                }
                @rmdir($subdir);
            }
        }
    }
}
