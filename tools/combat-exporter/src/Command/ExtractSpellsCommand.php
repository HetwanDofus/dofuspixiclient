<?php

namespace App\Command;

use App\ExtendedProcessor;
use Arakne\Swf\Parser\Structure\Tag\DoActionTag;
use Arakne\Swf\SwfFile;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputArgument;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Console\Input\InputInterface;

/**
 * Extracts spell data from Dofus language SWF files.
 *
 * Spells are stored in the 'S' variable in the lang SWF files.
 * Structure: S = { spellId: { n: name, d: description, l: [levels...] } }
 *
 * Each level contains:
 * - e: effects array
 * - a: AP cost
 * - minPO: minimum range
 * - maxPO: maximum range
 * - ec: critical effects
 * - cc: critical chance
 * - cf: critical failure chance
 * - po: modifiable range
 * - ldv: requires line of sight
 * - ldc: linear cast only
 * - ldt: per turn limit
 * - ldp: per target limit
 * - pa: global cooldown
 *
 * Usage:
 *   php bin/console extract:spells --input /path/to/spells_fr.swf --output ./output
 */
final class ExtractSpellsCommand extends Command
{
    protected static $defaultName = 'extract:spells';
    protected static $defaultDescription = 'Extract spell data from Dofus language SWF files';

    protected function configure(): void
    {
        $this
            ->setName('extract:spells')
            ->setDescription('Extract spell data from Dofus language SWF files to JSON')
            ->addOption('input', 'i', InputOption::VALUE_REQUIRED, 'Input SWF file path (spells_fr.swf)')
            ->addOption('output', 'o', InputOption::VALUE_OPTIONAL, 'Output directory', './output')
        ;
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $swfPath = $input->getOption('input');
        $outputDir = $input->getOption('output');

        if (!$swfPath) {
            $output->writeln('<error>Please provide an input SWF file with --input</error>');
            return Command::FAILURE;
        }

        if (!file_exists($swfPath)) {
            $output->writeln('<error>SWF file not found: ' . $swfPath . '</error>');
            return Command::FAILURE;
        }

        // Create output directory
        if (!is_dir($outputDir)) {
            mkdir($outputDir, 0755, true);
            $output->writeln('<info>Created output directory: ' . $outputDir . '</info>');
        }

        $output->writeln('<info>Dofus Spell Data Extractor</info>');
        $output->writeln(str_repeat('=', 60));
        $output->writeln('');

        $output->writeln('<info>[1/3] Loading SWF file and executing ActionScript...</info>');

        try {
            $swf = new SwfFile($swfPath, errors: 0);
            $processor = new ExtendedProcessor(allowFunctionCall: true);
            $state = new \Arakne\Swf\Avm\State();

            try {
                foreach ($swf->tags(DoActionTag::TYPE) as $tag) {
                    assert($tag instanceof DoActionTag);
                    $state = $processor->run($tag->actions, $state);
                }
                $variables = $state->variables;
            } catch (\Exception $e) {
                $output->writeln('<comment>  ⚠ ActionScript execution incomplete: ' . $e->getMessage() . '</comment>');
                $output->writeln('<comment>  Extracting ' . count($state->variables) . ' variables from partial state...</comment>');
                $variables = $state->variables;
            }
        } catch (\Exception $e) {
            $output->writeln('<error>Failed to load SWF: ' . $e->getMessage() . '</error>');
            return Command::FAILURE;
        }

        $output->writeln('<info>[2/3] Parsing spell data from ActionScript variables...</info>');

        // Extract S variable (spells)
        $spells = [];
        $spellCount = 0;

        if (isset($variables['S'])) {
            $spellsData = $variables['S'];

            if ($spellsData instanceof \Arakne\Swf\Avm\Api\ScriptObject || $spellsData instanceof \Arakne\Swf\Avm\Api\ScriptArray) {
                $spellsData = $spellsData->jsonSerialize();
            }

            if (is_array($spellsData)) {
                foreach ($spellsData as $spellId => $spellData) {
                    if ($spellData instanceof \Arakne\Swf\Avm\Api\ScriptObject) {
                        $spellData = $spellData->jsonSerialize();
                    }

                    if (!is_array($spellData)) {
                        continue;
                    }

                    $spell = [
                        'id' => (int)$spellId,
                        'name' => $spellData['n'] ?? '',
                        'description' => $spellData['d'] ?? '',
                        'breed' => $spellData['b'] ?? null,
                        'type' => $spellData['t'] ?? null,
                        'origin' => $spellData['o'] ?? null,
                        'category' => $spellData['c'] ?? null,
                        'passive' => $spellData['p'] ?? false,
                        'globalInterval' => $spellData['g'] ?? false,
                        'levels' => [],
                    ];

                    // Parse levels (l1, l2, l3, etc.)
                    for ($levelNum = 1; $levelNum <= 6; $levelNum++) {
                        $levelKey = 'l' . $levelNum;
                        if (!isset($spellData[$levelKey])) {
                            continue;
                        }

                        $levelData = $spellData[$levelKey];
                        if ($levelData instanceof \Arakne\Swf\Avm\Api\ScriptObject || $levelData instanceof \Arakne\Swf\Avm\Api\ScriptArray) {
                            $levelData = $levelData->jsonSerialize();
                        }

                        if (!is_array($levelData)) {
                            continue;
                        }

                        // Level data is an indexed array:
                        // [0] = effects, [1] = critical effects, [2] = AP cost, [3] = min range,
                        // [4] = max range, [5] = critical hit, [6] = critical failure, [7] = line only,
                        // [8] = line of sight, [9] = free cell, [10] = can boost range, [11] = class ID,
                        // [12] = per turn, [13] = per target, [14] = cooldown, [15] = zones,
                        // [16] = required states, [17] = forbidden states, [18] = min player level,
                        // [19] = crit failure ends turn, [20] = animation ID
                        $level = [
                            'level' => $levelNum,
                            'apCost' => (int)($levelData[2] ?? 0),
                            'minRange' => (int)($levelData[3] ?? 1),
                            'maxRange' => (int)($levelData[4] ?? 1),
                            'criticalChance' => (int)($levelData[5] ?? 0),
                            'criticalFailure' => (int)($levelData[6] ?? 0),
                            'lineOnly' => (bool)($levelData[7] ?? false),
                            'lineOfSight' => (bool)($levelData[8] ?? false),
                            'freeCell' => (bool)($levelData[9] ?? false),
                            'modifiableRange' => (bool)($levelData[10] ?? false),
                            'classId' => (int)($levelData[11] ?? 0),
                            'maxPerTurn' => (int)($levelData[12] ?? 0),
                            'maxPerTarget' => (int)($levelData[13] ?? 0),
                            'cooldown' => (int)($levelData[14] ?? 0),
                            'zones' => $levelData[15] ?? '',
                            'requiredStates' => $levelData[16] ?? [],
                            'forbiddenStates' => $levelData[17] ?? [],
                            'minPlayerLevel' => (int)($levelData[18] ?? 1),
                            'critFailureEndsTurn' => (bool)($levelData[19] ?? false),
                            'animationId' => (int)($levelData[20] ?? 0),
                            'effects' => [],
                            'criticalEffects' => [],
                        ];

                        // Parse effects (index 0)
                        if (isset($levelData[0]) && is_array($levelData[0])) {
                            $level['effects'] = $this->parseEffectsArray($levelData[0]);
                        }

                        // Parse critical effects (index 1)
                        if (isset($levelData[1]) && is_array($levelData[1])) {
                            $level['criticalEffects'] = $this->parseEffectsArray($levelData[1]);
                        }

                        $spell['levels'][] = $level;
                    }

                    if (!empty($spell['name'])) {
                        $spells[(int)$spellId] = $spell;
                        $spellCount++;
                    }
                }
            }
        }

        $output->writeln('<info>  ✓ Parsed ' . $spellCount . ' spells</info>');

        if ($spellCount === 0) {
            $output->writeln('<comment>  ⚠ No spells found. Available variables:</comment>');
            foreach (array_keys($variables) as $key) {
                $output->writeln('<comment>    - ' . $key . '</comment>');
            }
        }

        // Save spells.json
        $output->writeln('<info>[3/3] Saving spell data...</info>');

        $spellsOutput = [
            'version' => '1.0',
            'generated' => date('c'),
            'source' => 'extracted from ' . basename($swfPath) . ' via Arakne SWF library',
            'spells' => $spells,
            'statistics' => [
                'total_spells' => $spellCount,
            ],
        ];

        $spellsPath = $outputDir . '/spells.json';
        $jsonFlags = JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE;

        if (file_put_contents($spellsPath, json_encode($spellsOutput, $jsonFlags))) {
            $output->writeln('<info>  ✓ Saved: ' . $spellsPath . '</info>');
        } else {
            $output->writeln('<error>Error: Could not write spells.json</error>');
            return Command::FAILURE;
        }

        $output->writeln('');
        $output->writeln(str_repeat('=', 60));
        $output->writeln('<info>Extraction complete!</info>');

        return Command::SUCCESS;
    }

    /**
     * Parse effects from indexed array format.
     * Each effect is: [type, min, max, value3, duration, chance, param, rawZone]
     */
    private function parseEffectsArray(array $effectsData): array
    {
        $effects = [];

        foreach ($effectsData as $effect) {
            if ($effect instanceof \Arakne\Swf\Avm\Api\ScriptObject || $effect instanceof \Arakne\Swf\Avm\Api\ScriptArray) {
                $effect = $effect->jsonSerialize();
            }

            if (!is_array($effect)) {
                continue;
            }

            $effects[] = [
                'type' => (int)($effect[0] ?? 0),
                'min' => $effect[1] ?? null,
                'max' => $effect[2] ?? null,
                'value3' => $effect[3] ?? null,
                'duration' => (int)($effect[4] ?? 0),
                'chance' => (int)($effect[5] ?? 0),
                'param' => $effect[6] ?? null,
                'rawZone' => $effect[7] ?? null,
            ];
        }

        return $effects;
    }
}
