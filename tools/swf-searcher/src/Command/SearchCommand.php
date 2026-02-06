<?php

namespace App\Command;

use App\Renderer\Supersampled6xRsvgRenderer;
use Arakne\Swf\Extractor\Drawer\Converter\Converter;
use Arakne\Swf\Extractor\Image\ImageCharacterInterface;
use Arakne\Swf\Extractor\Shape\ShapeDefinition;
use Arakne\Swf\Extractor\Sprite\SpriteDefinition;
use Arakne\Swf\Extractor\SwfExtractor;
use Arakne\Swf\SwfFile;
use Arakne\Swf\Error\Errors;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Helper\QuestionHelper;
use Symfony\Component\Console\Helper\Table;
use Symfony\Component\Console\Input\InputArgument;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Console\Question\ChoiceQuestion;
use Symfony\Component\Console\Question\Question;
use Symfony\Component\Console\Style\SymfonyStyle;

final class SearchCommand extends Command
{
    protected static $defaultName = 'search';
    protected static $defaultDescription = 'Search and export characters from SWF files';

    private const FORMAT_WEBP = 'webp';
    private const FORMAT_PNG = 'png';
    private const FORMAT_SVG = 'svg';

    private const SCALE_OPTIONS = [
        '1x' => 1,
        '2x' => 2,
        '3x' => 3,
        '4x' => 4,
        '6x' => 6,
    ];

    protected function configure(): void
    {
        $this
            ->setName('search')
            ->setDescription('Search for characters in an SWF file by ID or export name')
            ->addArgument('swf', InputArgument::REQUIRED, 'Path to the SWF file')
            ->addOption('query', null, InputOption::VALUE_OPTIONAL, 'Search query (character ID or export name pattern)')
            ->addOption('output', 'o', InputOption::VALUE_OPTIONAL, 'Output directory', './output')
            ->addOption('format', 'f', InputOption::VALUE_OPTIONAL, 'Export format (webp, png, svg)')
            ->addOption('scale', 's', InputOption::VALUE_OPTIONAL, 'Scale factor (1x, 2x, 3x, 4x, 6x)')
            ->addOption('list', 'l', InputOption::VALUE_NONE, 'List all characters without interactive selection')
            ->addOption('export-all', null, InputOption::VALUE_NONE, 'Export all matching characters without selection')
        ;
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $io = new SymfonyStyle($input, $output);
        $swfPath = $input->getArgument('swf');

        if (!file_exists($swfPath)) {
            $io->error("SWF file not found: $swfPath");
            return Command::FAILURE;
        }

        $io->title('SWF Character Search & Export');
        $io->text("Loading: $swfPath");

        try {
            $swf = new SwfFile($swfPath, errors: Errors::IGNORE_INVALID_TAG & ~Errors::EXTRA_DATA & ~Errors::UNPROCESSABLE_DATA);

            if (!$swf->valid()) {
                $io->error('Invalid SWF file');
                return Command::FAILURE;
            }

            $extractor = new SwfExtractor($swf);
            $characters = $this->collectCharacters($extractor);

            $io->success(sprintf('Found %d characters', count($characters)));

            // Apply search filter if query provided
            $query = $input->getOption('query');
            if ($query !== null) {
                $characters = $this->filterCharacters($characters, $query);
                $io->text(sprintf('Filtered to %d characters matching "%s"', count($characters), $query));
            }

            if (empty($characters)) {
                $io->warning('No characters found matching the criteria');
                return Command::SUCCESS;
            }

            // List mode - just display and exit
            if ($input->getOption('list')) {
                $this->displayCharacterTable($characters, $io);
                return Command::SUCCESS;
            }

            // Interactive selection or export-all
            $selectedCharacters = $input->getOption('export-all')
                ? $characters
                : $this->selectCharacters($characters, $input, $output, $io);

            if (empty($selectedCharacters)) {
                $io->text('No characters selected for export');
                return Command::SUCCESS;
            }

            // Get export options
            $format = $this->getFormat($input, $output, $io);
            $scale = $this->getScale($input, $output, $io);
            $outputDir = $input->getOption('output');

            // Export selected characters
            return $this->exportCharacters(
                $selectedCharacters,
                $extractor,
                $swf->frameRate(),
                $outputDir,
                $format,
                $scale,
                $io
            );

        } catch (\Exception $e) {
            $io->error('Failed to process SWF: ' . $e->getMessage());
            return Command::FAILURE;
        }
    }

    private function collectCharacters(SwfExtractor $extractor): array
    {
        $characters = [];

        // Get exported characters with names
        $exported = $extractor->exported();
        $exportedByCharId = array_flip($exported);

        // Iterate through all character IDs (typically 1 to a few thousand)
        for ($id = 1; $id < 65535; $id++) {
            try {
                $character = $extractor->character($id);
                $type = $this->getCharacterType($character);

                if ($type === 'unknown') {
                    continue;
                }

                $bounds = $character->bounds();
                $exportName = $exportedByCharId[$id] ?? null;

                $characters[$id] = [
                    'id' => $id,
                    'exportName' => $exportName,
                    'type' => $type,
                    'width' => $bounds->width() / 20,
                    'height' => $bounds->height() / 20,
                    'offsetX' => $bounds->xmin / 20,
                    'offsetY' => $bounds->ymin / 20,
                    'frameCount' => $character instanceof SpriteDefinition
                        ? count($character->timeline()->frames)
                        : 1,
                ];
            } catch (\Exception $e) {
                // Character doesn't exist at this ID, continue
                continue;
            }
        }

        return $characters;
    }

    private function getCharacterType($character): string
    {
        return match (true) {
            $character instanceof SpriteDefinition => 'sprite',
            $character instanceof ShapeDefinition => 'shape',
            $character instanceof ImageCharacterInterface => 'image',
            default => 'unknown',
        };
    }

    private function filterCharacters(array $characters, string $query): array
    {
        // Check if query is numeric (character ID)
        if (is_numeric($query)) {
            $id = (int) $query;
            return isset($characters[$id]) ? [$id => $characters[$id]] : [];
        }

        // Filter by export name pattern (case-insensitive)
        $pattern = strtolower($query);
        return array_filter($characters, function ($char) use ($pattern) {
            if ($char['exportName'] === null) {
                return false;
            }
            return str_contains(strtolower($char['exportName']), $pattern);
        });
    }

    private function displayCharacterTable(array $characters, SymfonyStyle $io): void
    {
        $table = new Table($io);
        $table->setHeaders(['ID', 'Export Name', 'Type', 'Size (WxH)', 'Offset (X,Y)', 'Frames']);

        foreach ($characters as $char) {
            $table->addRow([
                $char['id'],
                $char['exportName'] ?? '-',
                $char['type'],
                sprintf('%.1f x %.1f', $char['width'], $char['height']),
                sprintf('%.1f, %.1f', $char['offsetX'], $char['offsetY']),
                $char['frameCount'],
            ]);
        }

        $table->render();
    }

    private function selectCharacters(array $characters, InputInterface $input, OutputInterface $output, SymfonyStyle $io): array
    {
        $this->displayCharacterTable($characters, $io);
        $io->newLine();

        /** @var QuestionHelper $helper */
        $helper = $this->getHelper('question');

        // Build choices
        $choices = [];
        foreach ($characters as $id => $char) {
            $label = $char['exportName']
                ? sprintf('[%d] %s (%s)', $id, $char['exportName'], $char['type'])
                : sprintf('[%d] (%s)', $id, $char['type']);
            $choices[$id] = $label;
        }

        $question = new ChoiceQuestion(
            'Select characters to export (comma-separated numbers, or "all"):',
            array_merge(['all' => 'Export all'], $choices),
            'all'
        );
        $question->setMultiselect(true);

        $selected = $helper->ask($input, $output, $question);

        if (in_array('Export all', $selected, true)) {
            return $characters;
        }

        // Map selected labels back to character IDs
        $selectedIds = [];
        foreach ($selected as $label) {
            foreach ($choices as $id => $choiceLabel) {
                if ($label === $choiceLabel) {
                    $selectedIds[$id] = $characters[$id];
                    break;
                }
            }
        }

        return $selectedIds;
    }

    private function getFormat(InputInterface $input, OutputInterface $output, SymfonyStyle $io): string
    {
        $format = $input->getOption('format');

        if ($format !== null) {
            return strtolower($format);
        }

        /** @var QuestionHelper $helper */
        $helper = $this->getHelper('question');

        $question = new ChoiceQuestion(
            'Select export format:',
            [
                self::FORMAT_WEBP => 'WebP (recommended, smallest size)',
                self::FORMAT_PNG => 'PNG (lossless, widely compatible)',
                self::FORMAT_SVG => 'SVG (vector, scalable)',
            ],
            self::FORMAT_WEBP
        );

        $selected = $helper->ask($input, $output, $question);

        // Extract format key from the selection
        foreach ([self::FORMAT_WEBP, self::FORMAT_PNG, self::FORMAT_SVG] as $fmt) {
            if (str_starts_with($selected, $fmt) || str_contains($selected, $fmt)) {
                return $fmt;
            }
        }

        return self::FORMAT_WEBP;
    }

    private function getScale(InputInterface $input, OutputInterface $output, SymfonyStyle $io): int
    {
        $scale = $input->getOption('scale');

        if ($scale !== null) {
            return self::SCALE_OPTIONS[$scale] ?? 1;
        }

        /** @var QuestionHelper $helper */
        $helper = $this->getHelper('question');

        $question = new ChoiceQuestion(
            'Select scale/supersample factor:',
            [
                '1x' => '1x (original size)',
                '2x' => '2x (double size)',
                '3x' => '3x (triple size)',
                '4x' => '4x (quadruple size)',
                '6x' => '6x (highest quality for vectors)',
            ],
            '1x'
        );

        $selected = $helper->ask($input, $output, $question);

        // Extract scale from selection
        if (preg_match('/^(\d+)x/', $selected, $matches)) {
            return (int) $matches[1];
        }

        return 1;
    }

    private function exportCharacters(
        array $characters,
        SwfExtractor $extractor,
        float $frameRate,
        string $outputDir,
        string $format,
        int $scale,
        SymfonyStyle $io
    ): int {
        if (!is_dir($outputDir)) {
            mkdir($outputDir, 0755, true);
        }

        $io->section('Exporting Characters');
        $io->text(sprintf('Format: %s, Scale: %dx, Output: %s', strtoupper($format), $scale, $outputDir));
        $io->newLine();

        $manifest = [
            'version' => '1.0',
            'generated' => date('c'),
            'format' => $format,
            'scale' => $scale,
            'characters' => [],
        ];

        $progressBar = $io->createProgressBar(count($characters));
        $progressBar->setFormat('%current%/%max% [%bar%] %percent:3s%% - %message%');
        $progressBar->start();

        $exported = 0;
        $failed = 0;

        foreach ($characters as $id => $charInfo) {
            $progressBar->setMessage(sprintf('Exporting character %d', $id));

            try {
                $character = $extractor->character($id);
                $characterManifest = $this->exportCharacter(
                    $character,
                    $charInfo,
                    $outputDir,
                    $format,
                    $scale,
                    $frameRate
                );

                $manifest['characters'][(string) $id] = $characterManifest;
                $exported++;
            } catch (\Exception $e) {
                $failed++;
            }

            $progressBar->advance();
        }

        $progressBar->finish();
        $io->newLine(2);

        // Save manifest
        $manifestPath = $outputDir . '/manifest.json';
        file_put_contents($manifestPath, json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

        $io->success(sprintf(
            'Export complete! %d characters exported, %d failed. Manifest: %s',
            $exported,
            $failed,
            $manifestPath
        ));

        return Command::SUCCESS;
    }

    private function exportCharacter(
        $character,
        array $charInfo,
        string $outputDir,
        string $format,
        int $scale,
        float $frameRate
    ): array {
        $id = $charInfo['id'];
        $isRasterImage = $character instanceof ImageCharacterInterface;

        // For raster images, don't apply scale (or limit it)
        $effectiveScale = $isRasterImage ? 1 : $scale;

        $converter = new Converter(svgRenderer: new Supersampled6xRsvgRenderer(), subpixelStrokeWidth: false);

        $bounds = $character->bounds();
        $characterManifest = [
            'id' => $id,
            'exportName' => $charInfo['exportName'],
            'type' => $charInfo['type'],
            'width' => ($bounds->width() / 20) * $effectiveScale,
            'height' => ($bounds->height() / 20) * $effectiveScale,
            'offsetX' => ($bounds->xmin / 20) * $effectiveScale,
            'offsetY' => ($bounds->ymin / 20) * $effectiveScale,
            'scale' => $effectiveScale,
            'frames' => [],
        ];

        // Determine frame count
        $frameCount = 1;
        if ($character instanceof SpriteDefinition) {
            $frameCount = count($character->timeline()->frames);
            $characterManifest['fps'] = $frameRate;
        }

        $characterManifest['frameCount'] = $frameCount;

        // Export each frame
        for ($frameIndex = 0; $frameIndex < $frameCount; $frameIndex++) {
            $filename = $frameCount > 1
                ? sprintf('%d_%d.%s', $id, $frameIndex, $format)
                : sprintf('%d.%s', $id, $format);

            $filepath = $outputDir . '/' . $filename;

            $this->exportFrame($converter, $character, $frameIndex, $format, $filepath);

            $characterManifest['frames'][] = [
                'index' => $frameIndex,
                'file' => $filename,
            ];
        }

        return $characterManifest;
    }

    private function exportFrame(
        Converter $converter,
        $character,
        int $frameIndex,
        string $format,
        string $filepath
    ): void {
        switch ($format) {
            case self::FORMAT_SVG:
                $svg = $converter->toSvg($character, $frameIndex);
                file_put_contents($filepath, $svg);
                break;

            case self::FORMAT_PNG:
                $png = $converter->toPng($character, $frameIndex);
                file_put_contents($filepath, $png);
                break;

            case self::FORMAT_WEBP:
            default:
                $webp = $converter->toWebp($character, $frameIndex, ['lossless' => true]);
                file_put_contents($filepath, $webp);
                break;
        }
    }
}
