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

use function sprintf;

/**
 * Generic static SWF → SVG extractor for flat category directories.
 *
 * Walks <input>/*.swf and writes <output>/<id>.svg where id is the file
 * stem. Reuses the same per-file logic as extract-items: read the root
 * timeline of the first exported symbol and convert frame 0 to SVG, then
 * crop the viewBox to the actual content bounds.
 *
 * Handles every static flat category: artworks/{big,breeds,faces,illu,mini},
 * emblems/*, alignments, challenges, jobs, extra, points, auras, emotes,
 * smileys, and loose root bundles.
 */
class ExtractStaticCommand extends Command
{
    private string $inputDir;
    private string $outputDir;

    protected function configure(): void
    {
        $this
            ->setName('static:extract')
            ->setDescription('Extract a flat directory of static SWF files as SVG')
            ->addOption('input', 'i', InputOption::VALUE_REQUIRED, 'Input directory containing *.swf')
            ->addOption('output', 'o', InputOption::VALUE_REQUIRED, 'Output directory for SVGs')
            ->addOption('clean', null, InputOption::VALUE_NONE, 'Wipe output directory first')
            ->addOption('id', null, InputOption::VALUE_OPTIONAL, 'Only extract a specific file stem');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $io = new SymfonyStyle($input, $output);
        $this->inputDir = (string) $input->getOption('input');
        $this->outputDir = (string) $input->getOption('output');
        $filterId = $input->getOption('id');

        if (!$this->inputDir || !is_dir($this->inputDir)) {
            $io->error('Missing or invalid --input directory');
            return Command::FAILURE;
        }
        if (!$this->outputDir) {
            $io->error('Missing --output directory');
            return Command::FAILURE;
        }

        if ($input->getOption('clean') && is_dir($this->outputDir)) {
            foreach (glob($this->outputDir . '/*.svg') ?: [] as $f) {
                @unlink($f);
            }
        }
        @mkdir($this->outputDir, 0755, true);

        $swfFiles = glob($this->inputDir . '/*.swf') ?: [];
        if (!$swfFiles) {
            $io->warning('No *.swf files found in ' . $this->inputDir);
            return Command::SUCCESS;
        }

        $extracted = 0;
        $skipped = 0;
        $failed = 0;

        foreach ($swfFiles as $swfPath) {
            $id = pathinfo($swfPath, PATHINFO_FILENAME);
            if ($filterId !== null && $id !== (string) $filterId) {
                continue;
            }

            $outPath = sprintf('%s/%s.svg', $this->outputDir, $id);
            if (file_exists($outPath)) {
                $skipped++;
                continue;
            }

            try {
                $svg = $this->extractStaticSvg($swfPath);
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

        $io->success(sprintf(
            'Done: %d extracted, %d skipped (already exist), %d failed',
            $extracted, $skipped, $failed
        ));

        return Command::SUCCESS;
    }

    private function extractStaticSvg(string $swfPath): ?string
    {
        $swf = new SwfFile($swfPath);
        $extractor = new SwfExtractor($swf);

        $timeline = $extractor->timeline();
        $converter = new Converter(subpixelStrokeWidth: false);
        $svg = $converter->toSvg($timeline, 0);

        $extractor->release();

        if (empty($svg)) {
            return null;
        }

        return $this->cropSvgToContent($svg);
    }

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

        return preg_replace(
            '/(<svg[^>]*)\s+width="[^"]*"\s+height="[^"]*"/',
            sprintf('$1 width="%.1f" height="%.1f" viewBox="%.1f %.1f %.1f %.1f"', $vw, $vh, $vx, $vy, $vw, $vh),
            $svg
        );
    }
}
