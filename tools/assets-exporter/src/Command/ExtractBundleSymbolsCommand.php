<?php

namespace App\Command;

use Arakne\Swf\Extractor\Drawer\Converter\Converter;
use Arakne\Swf\Extractor\Shape\ShapeDefinition;
use Arakne\Swf\Extractor\Sprite\SpriteDefinition;
use Arakne\Swf\Extractor\SwfExtractor;
use Arakne\Swf\SwfFile;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Console\Style\SymfonyStyle;

use function sprintf;

/**
 * Extract every exported symbol from a single SWF as its own SVG.
 *
 * Dofus 1.29 ships a bunch of "bundle" SWFs at the root of `clips/` where
 * one file exports many symbols — effectsicons.swf, statesicons.swf,
 * smileys.swf, the various UI shape files (cells, crafter, highlight, …).
 * Each exported symbol is a single static shape/sprite that needs its own
 * `.dofasset` output; this bin handles the split.
 *
 * Output layout:
 *   <outputDir>/<sanitized_symbolName>.svg
 *
 * Symbol names may contain punctuation or whitespace; we keep alphanumerics,
 * underscore and hyphen verbatim and replace anything else with `_` so the
 * filename is filesystem-safe.
 */
class ExtractBundleSymbolsCommand extends Command
{
    protected function configure(): void
    {
        $this
            ->setName('bundle:extract')
            ->setDescription('Dump every exported symbol of a single SWF as an SVG')
            ->addOption('input', 'i', InputOption::VALUE_REQUIRED, 'Path to the bundle SWF')
            ->addOption('output', 'o', InputOption::VALUE_REQUIRED, 'Output directory')
            ->addOption('clean', null, InputOption::VALUE_NONE, 'Wipe output first')
            ->addOption('symbol', null, InputOption::VALUE_OPTIONAL, 'Only extract a specific symbol name')
            ->addOption('expand-frames', null, InputOption::VALUE_NONE, 'Emit <name>_<n>.svg for each frame of multi-frame sprites (single-frame symbols stay as <name>.svg)');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $io = new SymfonyStyle($input, $output);
        $swfPath = (string) $input->getOption('input');
        $outputDir = (string) $input->getOption('output');
        $filterSymbol = $input->getOption('symbol');

        if (!$swfPath || !file_exists($swfPath)) {
            $io->error('Missing or invalid --input');
            return Command::FAILURE;
        }
        if (!$outputDir) {
            $io->error('Missing --output');
            return Command::FAILURE;
        }

        if ($input->getOption('clean') && is_dir($outputDir)) {
            foreach (glob($outputDir . '/*.svg') ?: [] as $f) @unlink($f);
        }
        @mkdir($outputDir, 0755, true);

        $swf = new SwfFile($swfPath);
        if (!$swf->valid()) {
            $io->error("Invalid SWF: $swfPath");
            return Command::FAILURE;
        }

        $extractor = new SwfExtractor($swf);
        $exported = $extractor->exported();
        $converter = new Converter(subpixelStrokeWidth: false);
        $expandFrames = (bool) $input->getOption('expand-frames');
        $written = 0;
        $skipped = 0;
        $failed = 0;

        // Symbol-keyed extraction (effectsicons, statesicons, smileys.bundle, ...)
        foreach ($exported as $symbolName => $characterId) {
            if ($filterSymbol !== null && $symbolName !== $filterSymbol) {
                continue;
            }

            $safe = $this->sanitize((string) $symbolName);

            try {
                $character = $extractor->character($characterId);
                if (!($character instanceof SpriteDefinition || $character instanceof ShapeDefinition)) {
                    $failed++;
                    continue;
                }

                // Multi-frame expansion: for gfx.tactic's themed decor
                // sprites (arene, foret, …) the AS client cycles through
                // every frame via gotoAndStop. Emit each frame as its own
                // SVG so the compile pipeline can produce one dofasset
                // per frame and the client can cycle them by id.
                $frameCount = ($expandFrames && $character instanceof SpriteDefinition)
                    ? $character->framesCount(true)
                    : 1;

                if ($frameCount > 1) {
                    $symbolWritten = 0;
                    $symbolSkipped = 0;
                    for ($frame = 0; $frame < $frameCount; $frame++) {
                        $outPath = sprintf('%s/%s_%d.svg', $outputDir, $safe, $frame);
                        if (file_exists($outPath)) {
                            $symbolSkipped++;
                            continue;
                        }
                        $svg = $converter->toSvg($character, $frame);
                        if (!$svg) {
                            continue;
                        }
                        file_put_contents($outPath, $svg);
                        $symbolWritten++;
                    }
                    $written += $symbolWritten;
                    $skipped += $symbolSkipped;
                    continue;
                }

                $outPath = sprintf('%s/%s.svg', $outputDir, $safe);
                if (file_exists($outPath)) {
                    $skipped++;
                    continue;
                }
                $svg = $converter->toSvg($character, 0);
                if (!$svg) {
                    $failed++;
                    continue;
                }
                file_put_contents($outPath, $svg);
                $written++;
            } catch (\Exception $e) {
                $failed++;
                if ($output->isVerbose()) {
                    $io->warning(sprintf("Failed %s: %s", $symbolName, $e->getMessage()));
                }
            }
        }

        // Fallback for SWFs with no named exports (demonangel, fallenDemonAngel,
        // most of the tiny ui/* bundles) — render the root timeline and name
        // the result after the SWF file stem.
        if (empty($exported) && $filterSymbol === null) {
            $stem = pathinfo($swfPath, PATHINFO_FILENAME);
            $safe = $this->sanitize($stem);
            $outPath = sprintf('%s/%s.svg', $outputDir, $safe);
            if (file_exists($outPath)) {
                $skipped++;
            } else {
                try {
                    $timeline = $extractor->timeline();
                    $svg = $converter->toSvg($timeline, 0);
                    if ($svg) {
                        file_put_contents($outPath, $svg);
                        $written++;
                    } else {
                        $failed++;
                    }
                } catch (\Exception $e) {
                    $failed++;
                    if ($output->isVerbose()) {
                        $io->warning(sprintf('Root timeline failed: %s', $e->getMessage()));
                    }
                }
            }
        }

        $extractor->release();

        $io->success(sprintf(
            'Done: %d written, %d skipped (already exist), %d failed',
            $written,
            $skipped,
            $failed
        ));

        return Command::SUCCESS;
    }

    private function sanitize(string $name): string
    {
        return preg_replace('/[^A-Za-z0-9_\-]/', '_', $name) ?: '_';
    }
}
