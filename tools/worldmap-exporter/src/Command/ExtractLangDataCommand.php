<?php

namespace App\Command;

use App\ExtendedProcessor;
use Arakne\Swf\Extractor\Drawer\Converter\Converter;
use Arakne\Swf\Extractor\Sprite\SpriteDefinition;
use Arakne\Swf\Extractor\SwfExtractor;
use Arakne\Swf\Parser\Structure\Tag\DoActionTag;
use Arakne\Swf\SwfFile;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputArgument;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Helper\ProgressBar;

/**
 * Extracts data from Dofus language SWF files (hints, maps, etc.)
 *
 * Inspired by:
 * - tools/worldmap-exporter/build_map_superarea_mapping.php
 * - tools/worldmap-exporter/extract_hints_complete.php
 *
 * Uses Arakne SWF library to:
 * - Extract ActionScript variables (HIC, HI, HIN for hints, MA for maps)
 *
 * Extracts comprehensive JSON data from French language SWF files:
 * - hints_fr_1254.swf: Hint categories, hints by map, worldmap layering
 * - maps_fr_1251.swf: Maps, subareas, areas, superareas with coordinates
 *
 * Usage:
 *   php bin/console extract:lang-data hints
 *   php bin/console extract:lang-data maps
 *   php bin/console extract:lang-data all
 */
final class ExtractLangDataCommand extends Command
{
    protected static $defaultName = 'extract:lang-data';
    protected static $defaultDescription = 'Extract data from Dofus language SWF files to JSON';

    private const SOURCES_LANGS_DIR = __DIR__ . '/../../../../assets/sources/langs';
    private const SOURCES_CLIPS_DIR = __DIR__ . '/../../../../assets/sources/clips/maps';
    private const OUTPUT_DIR = __DIR__ . '/../../../../assets/output/data';

    private const AVAILABLE_EXTRACTS = [
        'hints' => [
            'file' => 'hints_fr_1254.swf',
            'description' => 'Hints data (categories, hints by map, worldmap layering)',
        ],
        'maps' => [
            'file' => 'maps_fr_1251.swf',
            'description' => 'Maps data (maps, subareas, areas, superareas)',
        ],
    ];

    protected function configure(): void
    {
        $this
            ->setName('extract:lang-data')
            ->setDescription('Extract comprehensive data from Dofus language SWF files')
            ->addArgument('type', InputArgument::REQUIRED, 'Data type to extract (hints, maps, all)')
            ->addOption('output', 'o', InputOption::VALUE_OPTIONAL, 'Output directory (optional)')
        ;
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $type = strtolower($input->getArgument('type'));
        $outputDir = $input->getOption('output') ?: self::OUTPUT_DIR;

        // Create output directory
        if (!is_dir($outputDir)) {
            mkdir($outputDir, 0755, true);
            $output->writeln('<info>Created output directory: ' . $outputDir . '</info>');
        }

        // Determine what to extract
        $extractTypes = [];

        if ($type === 'all') {
            $extractTypes = array_keys(self::AVAILABLE_EXTRACTS);
        } elseif (isset(self::AVAILABLE_EXTRACTS[$type])) {
            $extractTypes = [$type];
        } else {
            $output->writeln('<error>Invalid type. Available: hints, maps, all</error>');
            return Command::FAILURE;
        }

        $output->writeln('<info>Dofus Language Data Extractor (using Arakne SWF)</info>');
        $output->writeln(str_repeat('=', 75));
        $output->writeln('');

        // Process each extract type
        foreach ($extractTypes as $extractType) {
            $result = $this->extractData($extractType, $outputDir, $output);
            if ($result !== Command::SUCCESS) {
                return $result;
            }
            $output->writeln('');
        }

        $output->writeln(str_repeat('=', 75));
        $output->writeln('<info>Extraction complete!</info>');
        $output->writeln('<info>Output directory: ' . $outputDir . '</info>');

        return Command::SUCCESS;
    }

    private function extractData(string $type, string $outputDir, OutputInterface $output): int
    {
        $config = self::AVAILABLE_EXTRACTS[$type];
        $swfPath = self::SOURCES_LANGS_DIR . '/' . $config['file'];

        $output->writeln('<info>Extracting: ' . $type . '</info>');
        $output->writeln('<info>Description: ' . $config['description'] . '</info>');
        $output->writeln('<info>Source: ' . $config['file'] . '</info>');
        $output->writeln('');

        if (!file_exists($swfPath)) {
            $output->writeln('<error>SWF file not found: ' . $swfPath . '</error>');
            return Command::FAILURE;
        }

        switch ($type) {
            case 'hints':
                return $this->extractHintsData($swfPath, $outputDir, $output);
            case 'maps':
                return $this->extractMapsData($swfPath, $outputDir, $output);
            default:
                $output->writeln('<error>Unknown extract type: ' . $type . '</error>');
                return Command::FAILURE;
        }
    }

    private function extractHintsData(string $swfPath, string $outputDir, OutputInterface $output): int
    {
        $output->writeln('<info>[1/3] Loading SWF file and executing ActionScript...</info>');

        try {
            $swf = new SwfFile($swfPath, errors: 0); // Disable error reporting for fail-safe parsing
            $processor = new ExtendedProcessor(allowFunctionCall: true);
            $state = new \Arakne\Swf\Avm\State();

            try {
                // Manually execute DoAction tags using our ExtendedProcessor
                foreach ($swf->tags(DoActionTag::TYPE) as $tag) {
                    assert($tag instanceof DoActionTag);
                    $state = $processor->run($tag->actions, $state);
                }
                $variables = $state->variables;
            } catch (\Exception $e) {
                // AVM may fail on unsupported opcodes, but we can still extract partial state
                $output->writeln('<comment>  ⚠ ActionScript execution incomplete: ' . $e->getMessage() . '</comment>');
                $output->writeln('<comment>  Extracting ' . count($state->variables) . ' variables from partial state...</comment>');
                $variables = $state->variables;
            }
        } catch (\Exception $e) {
            $output->writeln('<error>Failed to load SWF: ' . $e->getMessage() . '</error>');
            return Command::FAILURE;
        }

        // Extract HIC (Hints Categories)
        $output->writeln('<info>[2/3] Parsing hints data from ActionScript variables...</info>');

        $hintsCategories = [];
        if (isset($variables['HIC'])) {
            // Convert ScriptArray to PHP array if needed
            $hic = $variables['HIC'];

            if ($hic instanceof \Arakne\Swf\Avm\Api\ScriptArray || $hic instanceof \Arakne\Swf\Avm\Api\ScriptObject) {
                $hic = $hic->jsonSerialize();
            }

            if (is_array($hic)) {
                foreach ($hic as $id => $cat) {
                    // Convert ScriptObject to array if needed
                    if ($cat instanceof \Arakne\Swf\Avm\Api\ScriptObject) {
                        $cat = $cat->jsonSerialize();
                    }

                    if (is_array($cat) && isset($cat['n'], $cat['c'])) {
                        $hintsCategories[$id] = [
                            'id' => (int)$id,
                            'name' => $cat['n'],
                            'color' => $cat['c']
                        ];
                    }
                }
            }
        }
        $output->writeln('<info>  ✓ Parsed ' . count($hintsCategories) . ' categories</info>');

        // Extract HI array (all hints by mapID)
        $hintsRaw = [];
        if (isset($variables['HI'])) {
            $hi = $variables['HI'];
            if ($hi instanceof \Arakne\Swf\Avm\Api\ScriptArray || $hi instanceof \Arakne\Swf\Avm\Api\ScriptObject) {
                $hi = $hi->jsonSerialize();
            }

            if (is_array($hi)) {
                foreach ($hi as $hint) {
                    if ($hint instanceof \Arakne\Swf\Avm\Api\ScriptObject) {
                        $hint = $hint->jsonSerialize();
                    }

                    if (is_array($hint) && isset($hint['n'], $hint['c'], $hint['g'], $hint['m'])) {
                        $hintsRaw[] = [
                            'name' => $hint['n'],
                            'categoryID' => (int)$hint['c'],
                            'gfxID' => (int)$hint['g'],
                            'mapID' => (int)$hint['m']
                        ];
                    }
                }
            }
        }
        $output->writeln('<info>  ✓ Parsed ' . count($hintsRaw) . ' hints</info>');

        // Build hints indexed by mapID
        $hintsByMap = [];
        foreach ($hintsRaw as $hint) {
            $mapID = $hint['mapID'];

            if (!isset($hintsByMap[$mapID])) {
                $hintsByMap[$mapID] = [];
            }

            $catID = $hint['categoryID'];
            $catInfo = $hintsCategories[$catID] ?? ['name' => 'Unknown', 'color' => 'Gray'];

            $hintsByMap[$mapID][] = [
                'name' => $hint['name'],
                'categoryID' => $catID,
                'category' => $catInfo['name'],
                'color' => $catInfo['color'],
                'gfxID' => $hint['gfxID']
            ];
        }

        // Extract HIN array (hint layering with world coordinates)
        $hintLayers = [];
        $hintsInLayer = [];
        if (isset($variables['HIN'])) {
            $hin = $variables['HIN'];
            if ($hin instanceof \Arakne\Swf\Avm\Api\ScriptArray || $hin instanceof \Arakne\Swf\Avm\Api\ScriptObject) {
                $hin = $hin->jsonSerialize();
            }

            if (is_array($hin)) {
                foreach ($hin as $layer) {
                    if ($layer instanceof \Arakne\Swf\Avm\Api\ScriptObject) {
                        $layer = $layer->jsonSerialize();
                    }

                    if (is_array($layer) && isset($layer['x'], $layer['y'], $layer['h'])) {
                        $layerHints = $layer['h'];
                        if ($layerHints instanceof \Arakne\Swf\Avm\Api\ScriptArray || $layerHints instanceof \Arakne\Swf\Avm\Api\ScriptObject) {
                            $layerHints = $layerHints->jsonSerialize();
                        }

                        if (is_array($layerHints)) {
                            $hintList = [];
                            foreach ($layerHints as $h) {
                                if ($h instanceof \Arakne\Swf\Avm\Api\ScriptObject) {
                                    $h = $h->jsonSerialize();
                                }

                                if (is_array($h) && isset($h['n'], $h['c'], $h['g'], $h['m'])) {
                                    $hintList[] = [
                                        'name' => $h['n'],
                                        'categoryID' => (int)$h['c'],
                                        'gfxID' => (int)$h['g'],
                                        'mapID' => (int)$h['m']
                                    ];
                                }
                            }

                            $hintLayers[] = [
                                'x' => (int)$layer['x'],
                                'y' => (int)$layer['y'],
                                'hints' => $hintList
                            ];
                            $hintsInLayer[] = count($hintList);
                        }
                    }
                }
            }
        }

        // Sort by y coordinate (painter's algorithm)
        usort($hintLayers, function($a, $b) {
            return $a['y'] <=> $b['y'];
        });

        $output->writeln('<info>  ✓ Found ' . count($hintLayers) . ' hint overlay locations</info>');

        // Save hints-data.json
        $hintsDataOutput = [
            'version' => '1.0',
            'generated' => date('c'),
            'source' => 'extracted from hints_fr_1254.swf via Arakne SWF library',
            'version_swf' => 1254,
            'language' => 'fr',
            'categories' => array_values($hintsCategories),
            'hints_by_map' => $hintsByMap,
            'statistics' => [
                'total_hints' => count($hintsRaw),
                'total_maps' => count($hintsByMap),
                'total_categories' => count($hintsCategories)
            ]
        ];

        $hintsDataPath = $outputDir . '/hints-data.json';
        if (file_put_contents($hintsDataPath, json_encode($hintsDataOutput, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE))) {
            $output->writeln('<info>  ✓ Saved: ' . $hintsDataPath . '</info>');
        } else {
            $output->writeln('<error>Error: Could not write hints-data.json</error>');
            return Command::FAILURE;
        }

        // Save hints-layering.json
        $hintsLayeringOutput = [
            'version' => '1.0',
            'generated' => date('c'),
            'source' => 'extracted from hints_fr_1254.swf via Arakne SWF library',
            'worldmap_coordinates' => 'x,y are world positions on the Dofus worldmap',
            'layering_strategy' => 'painter\'s algorithm - sort by y coordinate (low to high)',
            'total_overlay_locations' => count($hintLayers),
            'total_hint_instances' => array_sum($hintsInLayer),
            'hint_overlays' => $hintLayers,
            'statistics' => !empty($hintLayers) ? [
                'min_x' => min(array_column($hintLayers, 'x')),
                'max_x' => max(array_column($hintLayers, 'x')),
                'min_y' => min(array_column($hintLayers, 'y')),
                'max_y' => max(array_column($hintLayers, 'y')),
                'average_hints_per_location' => round(array_sum($hintsInLayer) / count($hintLayers), 1)
            ] : []
        ];

        $hintsLayeringPath = $outputDir . '/hints-layering.json';
        if (file_put_contents($hintsLayeringPath, json_encode($hintsLayeringOutput, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE))) {
            $output->writeln('<info>  ✓ Saved: ' . $hintsLayeringPath . '</info>');
        } else {
            $output->writeln('<error>Error: Could not write hints-layering.json</error>');
            return Command::FAILURE;
        }

        return Command::SUCCESS;
    }

    private function extractMapsData(string $swfPath, string $outputDir, OutputInterface $output): int
    {
        $output->writeln('<info>[1/2] Loading SWF file and executing ActionScript...</info>');

        try {
            $swf = new SwfFile($swfPath, errors: 0); // Disable error reporting for fail-safe parsing
            $processor = new ExtendedProcessor(allowFunctionCall: true);
            $state = new \Arakne\Swf\Avm\State();

            try {
                // Manually execute DoAction tags using our ExtendedProcessor
                foreach ($swf->tags(DoActionTag::TYPE) as $tag) {
                    assert($tag instanceof DoActionTag);
                    $state = $processor->run($tag->actions, $state);
                }
                $variables = $state->variables;
            } catch (\Exception $e) {
                // AVM may fail on unsupported opcodes, but we can still extract partial state
                $output->writeln('<comment>  ⚠ ActionScript execution incomplete: ' . $e->getMessage() . '</comment>');
                $output->writeln('<comment>  Extracting ' . count($state->variables) . ' variables from partial state...</comment>');
                $variables = $state->variables;
            }
        } catch (\Exception $e) {
            $output->writeln('<error>Failed to load SWF: ' . $e->getMessage() . '</error>');
            return Command::FAILURE;
        }

        $output->writeln('<info>[2/2] Parsing maps data from ActionScript variables...</info>');

        // Convert MA from ScriptObject to array if needed
        $ma = $variables['MA'] ?? null;
        if ($ma instanceof \Arakne\Swf\Avm\Api\ScriptObject) {
            $ma = $ma->jsonSerialize();
        }

        // Extract MA.m (Maps structure with coordinates and subareas)
        $maps = [];
        $mapCoordinates = [];
        if (isset($ma['m'])) {
            $mapsData = $ma['m'];
            if ($mapsData instanceof \Arakne\Swf\Avm\Api\ScriptObject || $mapsData instanceof \Arakne\Swf\Avm\Api\ScriptArray) {
                $mapsData = $mapsData->jsonSerialize();
            }

            if (is_array($mapsData)) {
                foreach ($mapsData as $mapID => $mapData) {
                    if ($mapData instanceof \Arakne\Swf\Avm\Api\ScriptObject) {
                        $mapData = $mapData->jsonSerialize();
                    }

                    if (is_array($mapData) && isset($mapData['x'], $mapData['y'], $mapData['sa'])) {
                        $maps[$mapID] = (int)$mapData['sa'];
                        $mapCoordinates[$mapID] = [
                            'x' => (int)$mapData['x'],
                            'y' => (int)$mapData['y']
                        ];
                    }
                }
            }
        }
        $output->writeln('<info>  ✓ Found ' . count($maps) . ' maps with coordinates</info>');

        // Extract MA.sa (Subareas)
        $subareas = [];
        if (isset($ma['sa'])) {
            $subareasData = $ma['sa'];
            if ($subareasData instanceof \Arakne\Swf\Avm\Api\ScriptObject || $subareasData instanceof \Arakne\Swf\Avm\Api\ScriptArray) {
                $subareasData = $subareasData->jsonSerialize();
            }

            if (is_array($subareasData)) {
                foreach ($subareasData as $subareaID => $subareaData) {
                    if ($subareaData instanceof \Arakne\Swf\Avm\Api\ScriptObject) {
                        $subareaData = $subareaData->jsonSerialize();
                    }

                    if (is_array($subareaData) && isset($subareaData['a'])) {
                        $subareas[$subareaID] = (int)$subareaData['a'];
                    }
                }
            }
        }
        $output->writeln('<info>  ✓ Found ' . count($subareas) . ' subareas</info>');

        // Extract MA.a (Areas)
        $areas = [];
        if (isset($ma['a'])) {
            $areasData = $ma['a'];
            if ($areasData instanceof \Arakne\Swf\Avm\Api\ScriptObject || $areasData instanceof \Arakne\Swf\Avm\Api\ScriptArray) {
                $areasData = $areasData->jsonSerialize();
            }

            if (is_array($areasData)) {
                foreach ($areasData as $areaID => $areaData) {
                    if ($areaData instanceof \Arakne\Swf\Avm\Api\ScriptObject) {
                        $areaData = $areaData->jsonSerialize();
                    }

                    if (is_array($areaData) && isset($areaData['sua'])) {
                        $areas[$areaID] = (int)$areaData['sua'];
                    }
                }
            }
        }
        $output->writeln('<info>  ✓ Found ' . count($areas) . ' areas</info>');

        // Build map → superarea chain
        $mapToSuperarea = [];
        $unmapped = [];

        foreach ($maps as $mapID => $subareaID) {
            if (!isset($subareas[$subareaID])) {
                $unmapped[] = "Map $mapID → subarea $subareaID (subarea not found)";
                continue;
            }

            $areaID = $subareas[$subareaID];

            if (!isset($areas[$areaID])) {
                $unmapped[] = "Map $mapID → subarea $subareaID → area $areaID (area not found)";
                continue;
            }

            $superareaID = $areas[$areaID];
            $mapToSuperarea[$mapID] = $superareaID;
        }

        $output->writeln('<info>  ✓ Mapped ' . count($mapToSuperarea) . ' maps to superareas</info>');
        if (!empty($unmapped)) {
            $output->writeln('<comment>  ⚠ ' . count($unmapped) . ' maps could not be fully mapped</comment>');
        }

        // Build map data with both superarea and coordinates
        $mapData = [];
        foreach ($mapToSuperarea as $mapID => $superareaID) {
            $mapData[$mapID] = [
                'sua' => $superareaID,
                'x' => $mapCoordinates[$mapID]['x'] ?? null,
                'y' => $mapCoordinates[$mapID]['y'] ?? null
            ];
        }

        // Save map-data.json
        $mapDataOutput = [
            'version' => '1.0',
            'generated' => date('c'),
            'source' => 'extracted from maps_fr_1251.swf via Arakne SWF library',
            'description' => 'Map data including superarea and world coordinates',
            'superareas' => [
                0 => 'Continent Amaknien (Amakna)',
                3 => 'Zone de départ (Incarnam)'
            ],
            'maps' => $mapData,
            'statistics' => [
                'total_maps' => count($mapData),
                'total_subareas' => count($subareas),
                'total_areas' => count($areas)
            ]
        ];

        $mapDataPath = $outputDir . '/map-data.json';
        if (file_put_contents($mapDataPath, json_encode($mapDataOutput, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES))) {
            $output->writeln('<info>  ✓ Saved: ' . $mapDataPath . '</info>');
        } else {
            $output->writeln('<error>Error: Could not write map-data.json</error>');
            return Command::FAILURE;
        }

        return Command::SUCCESS;
    }
}
