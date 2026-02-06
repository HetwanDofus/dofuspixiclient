<?php

namespace App\Command;

use Arakne\Swf\Extractor\Drawer\Converter\Converter;
use Arakne\Swf\Extractor\Drawer\Converter\ScaleResizer;
use Arakne\Swf\Extractor\Sprite\SpriteDefinition;
use Arakne\Swf\Extractor\SwfExtractor;
use Arakne\Swf\SwfFile;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Helper\ProgressBar;

/**
 * Extracts hint graphics from hints.swf
 *
 * Uses Arakne SWF library to export all hint sprites by their export names
 * to PNG files.
 *
 * Usage:
 *   php bin/console extract:hint-graphics
 *   php bin/console extract:hint-graphics --output /path/to/output
 */
final class ExtractHintGraphicsCommand extends Command
{
    protected static $defaultName = 'extract:hint-graphics';
    protected static $defaultDescription = 'Extract hint graphics from hints.swf as PNG files';

    private const SUPERSAMPLE_FACTOR = 3;

    private const SOURCES_CLIPS_DIR = __DIR__ . '/../../../../assets/sources/clips/maps';
    private const OUTPUT_DIR = __DIR__ . '/../../../../assets/output/data/hints-graphics';

    protected function configure(): void
    {
        $this
            ->setName('extract:hint-graphics')
            ->setDescription('Extract all hint graphics from hints.swf by export name')
            ->addOption('output', 'o', InputOption::VALUE_OPTIONAL, 'Output directory (optional)')
        ;
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $outputDir = $input->getOption('output') ?: self::OUTPUT_DIR;

        // Create output directory
        if (!is_dir($outputDir)) {
            mkdir($outputDir, 0755, true);
            $output->writeln('<info>Created output directory: ' . $outputDir . '</info>');
        }

        $hintsSwfPath = self::SOURCES_CLIPS_DIR . '/hints.swf';

        $output->writeln('<info>Hint Graphics Extractor (using Arakne SWF)</info>');
        $output->writeln(str_repeat('=', 75));
        $output->writeln('<info>Source: ' . $hintsSwfPath . '</info>');
        $output->writeln('');

        if (!file_exists($hintsSwfPath)) {
            $output->writeln('<error>Hints SWF not found: ' . $hintsSwfPath . '</error>');
            return Command::FAILURE;
        }

        return $this->extractGraphics($hintsSwfPath, $outputDir, $output);
    }

    private function extractGraphics(string $hintsSwfPath, string $outputDir, OutputInterface $output): int
    {
        $output->writeln('<info>[1/3] Loading hints.swf...</info>');

        try {
            $swf = new SwfFile($hintsSwfPath);
            $extractor = new SwfExtractor($swf);
            $scaleResizer = new ScaleResizer(scale: self::SUPERSAMPLE_FACTOR);
            $converter = new Converter(resizer: $scaleResizer, subpixelStrokeWidth: false);

            $exported = $extractor->exported();
            $output->writeln('<info>  ✓ Found ' . count($exported) . ' exported assets</info>');
            $output->writeln('');

            $output->writeln('<info>[2/3] Extracting graphics...</info>');

            $progressBar = new ProgressBar($output, count($exported));
            $progressBar->setFormat('%current%/%max% [%bar%] %percent:3s%% - %message%');
            $progressBar->start();

            $extracted = 0;
            $skipped = 0;
            $failed = 0;
            $exportManifest = [];

            foreach ($exported as $name => $characterId) {
                $progressBar->setMessage("Exporting: $name");

                try {
                    $character = $extractor->character($characterId);

                    if ($character instanceof SpriteDefinition) {
                        $webpData = $converter->toWebp($character, 0, ['quality' => 95]);
                        $filename = $outputDir . '/' . $name . '.webp';

                        if (file_put_contents($filename, $webpData)) {
                            $bounds = $character->bounds();
                            $exportManifest[$name] = [
                                'character_id' => $characterId,
                                'file' => $name . '.webp',
                                'width' => $bounds->width() / 20,
                                'height' => $bounds->height() / 20,
                                'offsetX' => $bounds->xmin / 20,
                                'offsetY' => $bounds->ymin / 20,
                            ];
                            $extracted++;
                        } else {
                            $failed++;
                        }
                    } else {
                        $skipped++;
                    }
                } catch (\Exception $e) {
                    $failed++;
                }

                $progressBar->advance();
            }

            $progressBar->finish();
            $output->writeln('');
            $output->writeln('');

            $output->writeln('<info>[3/3] Saving manifest...</info>');

            // Save manifest with all export information
            $manifest = [
                'version' => '1.0',
                'generated' => date('c'),
                'source' => 'hints.swf',
                'supersample' => self::SUPERSAMPLE_FACTOR,
                'total_assets' => count($exported),
                'extracted' => $extracted,
                'skipped' => $skipped,
                'failed' => $failed,
                'graphics' => $exportManifest,
            ];

            $manifestPath = $outputDir . '/manifest.json';
            if (file_put_contents($manifestPath, json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES))) {
                $output->writeln('<info>  ✓ Saved manifest: ' . $manifestPath . '</info>');
            } else {
                $output->writeln('<error>  ✗ Failed to save manifest</error>');
            }

            $output->writeln('');
            $output->writeln(str_repeat('=', 75));
            $output->writeln('<info>Graphics extraction complete!</info>');
            $output->writeln(str_repeat('=', 75));
            $output->writeln('');
            $output->writeln('<info>  ✓ Extracted: ' . $extracted . ' graphics</info>');
            if ($skipped > 0) {
                $output->writeln('<comment>  ⚠ Skipped: ' . $skipped . ' non-sprite assets</comment>');
            }
            if ($failed > 0) {
                $output->writeln('<error>  ✗ Failed: ' . $failed . ' assets</error>');
            }
            $output->writeln('<info>  Output: ' . $outputDir . '</info>');
            $output->writeln('');

            return Command::SUCCESS;
        } catch (\Exception $e) {
            $output->writeln('');
            $output->writeln('<error>Failed to extract graphics: ' . $e->getMessage() . '</error>');
            return Command::FAILURE;
        }
    }
}
