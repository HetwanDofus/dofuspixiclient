<?php

namespace App\Command;

use Arakne\MapParser\WorldMap\SwfWorldMap;
use Arakne\MapParser\WorldMap\WorldMapTileRenderer;
use Arakne\MapParser\Tile\Cache\NullTileCache;
use Arakne\Swf\SwfFile;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputArgument;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Helper\ProgressBar;

/**
 * Exports Dofus world maps as individual tiles with supersampling
 *
 * World maps available:
 *   0 = Amakna
 *   2 = Astrub
 *   3 = Incarnam
 *
 * Usage:
 *   php bin/console export:worldmap-tiles 0 --tile-size 256 --supersample 2
 *   php bin/console export:worldmap-tiles amakna --output /path/to/tiles
 */
final class ExportWorldMapTilesCommand extends Command
{
    protected static $defaultName = 'export:worldmap-tiles';
    protected static $defaultDescription = 'Export Dofus world map as individual tiles';

    private const DOFUS_CLIENT_PATH = __DIR__ . '/../../../../assets/sources';
    private const OUTPUT_DIR = __DIR__ . '/../../../../assets/output/worldmap-tiles';

    private const WORLDMAP_NAMES = [
        '0' => 'amakna',
        '2' => 'astrub',
        '3' => 'incarnam',
        'dungeon' => 'dungeon',
        'hints' => 'hints',
        'amakna' => '0',
        'astrub' => '2',
        'incarnam' => '3',
    ];

    protected function configure(): void
    {
        $this
            ->setName('export:worldmap-tiles')
            ->setDescription('Export a Dofus world map as individual tiles')
            ->addArgument('world-map', InputArgument::REQUIRED, 'World map ID or name (0/amakna, 2/astrub, 3/incarnam, dungeon, hints)')
            ->addOption('format', 'f', InputOption::VALUE_OPTIONAL, 'Output format (webp, png, jpg)', 'webp')
            ->addOption('quality', null, InputOption::VALUE_OPTIONAL, 'Output quality (0-100)', '95')
            ->addOption('output', 'o', InputOption::VALUE_OPTIONAL, 'Output directory (optional)')
            ->addOption('tile-size', 't', InputOption::VALUE_OPTIONAL, 'Tile size in pixels (default: 256)', '256')
        ;
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $worldMapArg = $input->getArgument('world-map');
        $format = \strtolower($input->getOption('format'));
        $quality = (int) $input->getOption('quality');
        $outputDir = $input->getOption('output');
        $tileSize = (int) $input->getOption('tile-size');

        // Resolve world map ID
        $worldMapId = self::WORLDMAP_NAMES[\strtolower($worldMapArg)] ?? $worldMapArg;
        if (!\in_array($worldMapId, ['0', '2', '3', 'dungeon', 'hints'])) {
            $output->writeln('<error>Invalid world map. Supported: 0 (amakna), 2 (astrub), 3 (incarnam), dungeon, hints</error>');
            return Command::FAILURE;
        }

        // Validate inputs
        if (!\in_array($format, ['webp', 'png', 'jpg', 'jpeg'])) {
            $output->writeln('<error>Invalid format. Supported: webp, png, jpg, jpeg</error>');
            return Command::FAILURE;
        }

        if ($quality < 0 || $quality > 100) {
            $output->writeln('<error>Quality must be between 0 and 100</error>');
            return Command::FAILURE;
        }

        // Determine output directory
        if (!$outputDir) {
            $mapName = self::WORLDMAP_NAMES[$worldMapId] ?? $worldMapId;
            $outputDir = self::OUTPUT_DIR . '/' . $mapName;
        }

        if (!\is_dir($outputDir)) {
            \mkdir($outputDir, 0755, true);
        }

        $output->writeln('<info>[*] Loading world map...</info>');
        $output->writeln('<info>[DEBUG] World map ID: ' . $worldMapId . '</info>');

        try {
            $swfPath = self::DOFUS_CLIENT_PATH . '/clips/maps/' . $worldMapId . '.swf';
            $output->writeln('<info>[DEBUG] SWF path: ' . $swfPath . '</info>');

            if (!\file_exists($swfPath)) {
                $output->writeln(\sprintf('<error>World map file not found: %s</error>', $swfPath));
                return Command::FAILURE;
            }

            $output->writeln('<info>[DEBUG] Loading SWF file...</info>');
            $swfFile = new SwfFile($swfPath);

            $output->writeln('<info>[DEBUG] Creating WorldMap...</info>');
            $worldMap = new SwfWorldMap($swfFile);

            $output->writeln('<info>[DEBUG] Creating renderer...</info>');
            $renderer = new WorldMapTileRenderer($worldMap, tileSize: $tileSize, cache: new NullTileCache());

            $output->writeln('<info>[DEBUG] Renderer created successfully</info>');

            // Get grid size from renderer's maxZoom
            $gridSize = (int) (2 ** $renderer->maxZoom);
            $renderZoom = $renderer->maxZoom;

            $output->writeln(\sprintf('<info>[+] World map loaded: %s</info>',
                self::WORLDMAP_NAMES[$worldMapId] ?? $worldMapId
            ));
            $output->writeln(\sprintf('<info>[+] Max zoom: %d, Grid size: %d x %d</info>',
                $renderer->maxZoom, $gridSize, $gridSize
            ));

            // Render the full grid
            $tilesToRender = $gridSize * $gridSize;

            $output->writeln(\sprintf('<info>[*] Rendering %d x %d grid tiles...</info>', $gridSize, $gridSize));

            $progressBar = new ProgressBar($output, $tilesToRender);
            $progressBar->setFormat('%current%/%max% [%bar%] %percent:3s%% - %message%');
            $progressBar->start();

            $startTime = \microtime(true);

            // Extract bounds from SwfWorldMap (like php-map-parser does)
            $bounds = $worldMap->bounds();

            $manifest = [
                'worldmap' => self::WORLDMAP_NAMES[$worldMapId] ?? $worldMapId,
                'grid_size' => $gridSize,
                'tile_size' => $tileSize,
                'format' => $format === 'jpeg' ? 'jpg' : $format,
                'bounds' => [
                    'xMin' => $bounds->xMin,
                    'xMax' => $bounds->xMax,
                    'yMin' => $bounds->yMin,
                    'yMax' => $bounds->yMax,
                ],
                'tiles' => [],
            ];

            $failedTiles = [];
            for ($gridX = 0; $gridX < $gridSize; $gridX++) {
                for ($gridY = 0; $gridY < $gridSize; $gridY++) {
                    try {

                        // Render content tile at calculated zoom level
                        $tile = $renderer->render($gridX, $gridY, $renderZoom);

                        if (!$tile) {
                            // Create blank background tile if no content
                            $tile = \imagecreatetruecolor($tileSize, $tileSize);
                            if (!$tile) {
                                throw new \RuntimeException('Failed to create blank tile');
                            }
                            $bgColor = \imagecolorallocate($tile, 0xE5, 0xE5, 0xB9);
                            if ($bgColor !== false) {
                                \imagefill($tile, 0, 0, $bgColor);
                            }
                        } else {
                            // Fill with background color to remove black areas
                            $bgColor = \imagecolorallocate($tile, 0xE5, 0xE5, 0xB9);
                            if ($bgColor !== false) {
                                // Create new image with background
                                $newTile = \imagecreatetruecolor($tileSize, $tileSize);
                                if ($newTile) {
                                    \imagefill($newTile, 0, 0, $bgColor);
                                    \imagecopy($newTile, $tile, 0, 0, 0, 0, $tileSize, $tileSize);
                                    \imagedestroy($tile);
                                    $tile = $newTile;
                                }
                            }
                        }

                        // Save tile with grid coordinates in filename
                        $tileFilename = \sprintf('tile_%d_%d.%s', $gridX, $gridY, $format === 'jpeg' ? 'jpg' : $format);
                        $tileFile = $outputDir . '/' . $tileFilename;

                        try {
                            $this->saveImage($tile, $tileFile, $format, $quality);
                        } finally {
                            \imagedestroy($tile);
                        }

                        // Verify file was saved
                        if (!\file_exists($tileFile)) {
                            throw new \RuntimeException("Tile file was not created: $tileFile");
                        }

                        // Add to manifest
                        $manifest['tiles'][] = [
                            'x' => $gridX,
                            'y' => $gridY,
                            'file' => $tileFilename,
                        ];

                        $progressBar->setMessage(\sprintf('Tile (%d, %d)', $gridX, $gridY));
                        $progressBar->advance();
                    } catch (\Exception $e) {
                        $failedTiles[] = "($gridX, $gridY): " . $e->getMessage();
                        $progressBar->setMessage(\sprintf('Tile (%d, %d): ERROR', $gridX, $gridY));
                        $progressBar->advance();
                    }
                }
            }

            $savedTiles = \count($manifest['tiles']);
            $expectedTiles = $gridSize * $gridSize;

            if (!empty($failedTiles)) {
                $output->writeln('<error>[!] Failed tiles:</error>');
                foreach ($failedTiles as $failed) {
                    $output->writeln('<error>  ' . $failed . '</error>');
                }
            }

            $progressBar->finish();
            $output->writeln('');
            $output->writeln(\sprintf('<info>[+] Saved %d/%d tiles</info>', $savedTiles, $expectedTiles));
            if ($savedTiles !== $expectedTiles) {
                $output->writeln(\sprintf('<error>[!] Missing %d tiles</error>', $expectedTiles - $savedTiles));
            }

            // Save manifest
            $manifestFile = $outputDir . '/manifest.json';
            \file_put_contents($manifestFile, \json_encode($manifest, \JSON_PRETTY_PRINT | \JSON_UNESCAPED_SLASHES));

            $renderTime = \microtime(true) - $startTime;
            $output->writeln(\sprintf('<info>[+] Rendering complete (%.2fs)</info>', $renderTime));
            $output->writeln(\sprintf('<info>[+] Tiles saved to: %s</info>', $outputDir));
            $output->writeln(\sprintf('<info>[+] Manifest saved to: %s</info>', $manifestFile));

            return Command::SUCCESS;
        } catch (\Exception $e) {
            $output->writeln(\sprintf('<error>Error: %s</error>', $e->getMessage()));
            return Command::FAILURE;
        }
    }

    /**
     * Save image to file in the specified format
     */
    private function saveImage($img, string $filename, string $format, int $quality): void
    {
        if ($format === 'webp') {
            // First, save as PNG temporarily
            $tempPng = $filename . '.tmp.png';
            $pngResult = \imagepng($img, $tempPng, 9);

            if ($pngResult === false) {
                throw new \RuntimeException('Failed to create temporary PNG for WebP conversion');
            }

            try {
                // Use cwebp command-line tool for large images
                $cmd = \sprintf('cwebp -q %d %s -o %s 2>&1', $quality, \escapeshellarg($tempPng), \escapeshellarg($filename));
                $output = [];
                $returnVar = 0;
                \exec($cmd, $output, $returnVar);

                if ($returnVar !== 0) {
                    throw new \RuntimeException('cwebp conversion failed: ' . \implode("\n", $output));
                }

                // Verify WebP file was actually created
                if (!\file_exists($filename)) {
                    throw new \RuntimeException('cwebp did not produce output file');
                }
            } finally {
                // Clean up temp PNG
                if (\file_exists($tempPng)) {
                    \unlink($tempPng);
                }
            }
        } elseif ($format === 'png') {
            $result = \imagepng($img, $filename, $quality);
            if ($result === false) {
                throw new \RuntimeException('PNG encoding failed');
            }
        } elseif ($format === 'jpg' || $format === 'jpeg') {
            $result = \imagejpeg($img, $filename, $quality);
            if ($result === false) {
                throw new \RuntimeException('JPEG encoding failed');
            }
        } else {
            throw new \InvalidArgumentException("Unsupported format: $format");
        }
    }
}
