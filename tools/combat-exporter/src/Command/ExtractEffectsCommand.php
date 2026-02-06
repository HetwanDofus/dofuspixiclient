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
 * Extracts effect definitions from Dofus language SWF files.
 *
 * Effects are stored in the 'E' variable in the lang SWF files.
 * Structure: E = { effectId: { d: description, o: operator, c: characteristic } }
 *
 * Usage:
 *   php bin/console extract:effects --input /path/to/effects_fr.swf --output ./output
 */
final class ExtractEffectsCommand extends Command
{
    protected static $defaultName = 'extract:effects';
    protected static $defaultDescription = 'Extract effect definitions from Dofus language SWF files';

    protected function configure(): void
    {
        $this
            ->setName('extract:effects')
            ->setDescription('Extract effect definitions from Dofus language SWF files to JSON')
            ->addOption('input', 'i', InputOption::VALUE_REQUIRED, 'Input SWF file path (effects_fr.swf)')
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

        $output->writeln('<info>Dofus Effect Data Extractor</info>');
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

        $output->writeln('<info>[2/3] Parsing effect data from ActionScript variables...</info>');

        // Extract E variable (effects)
        $effects = [];
        $effectCount = 0;

        if (isset($variables['E'])) {
            $effectsData = $variables['E'];

            if ($effectsData instanceof \Arakne\Swf\Avm\Api\ScriptObject || $effectsData instanceof \Arakne\Swf\Avm\Api\ScriptArray) {
                $effectsData = $effectsData->jsonSerialize();
            }

            if (is_array($effectsData)) {
                foreach ($effectsData as $effectId => $effectData) {
                    if ($effectData instanceof \Arakne\Swf\Avm\Api\ScriptObject) {
                        $effectData = $effectData->jsonSerialize();
                    }

                    if (!is_array($effectData)) {
                        // Effect might be just a string description
                        if (is_string($effectData)) {
                            $effects[(int)$effectId] = [
                                'id' => (int)$effectId,
                                'description' => $effectData,
                            ];
                            $effectCount++;
                        }
                        continue;
                    }

                    $effect = [
                        'id' => (int)$effectId,
                        'description' => $effectData['d'] ?? '',
                    ];

                    // Optional fields
                    if (isset($effectData['o'])) {
                        $effect['operator'] = $effectData['o'];
                    }
                    if (isset($effectData['c'])) {
                        $effect['characteristic'] = (int)$effectData['c'];
                    }
                    if (isset($effectData['j'])) {
                        $effect['jet'] = $effectData['j'];
                    }

                    if (!empty($effect['description'])) {
                        $effects[(int)$effectId] = $effect;
                        $effectCount++;
                    }
                }
            }
        }

        $output->writeln('<info>  ✓ Parsed ' . $effectCount . ' effects</info>');

        if ($effectCount === 0) {
            $output->writeln('<comment>  ⚠ No effects found. Available variables:</comment>');
            foreach (array_keys($variables) as $key) {
                $output->writeln('<comment>    - ' . $key . '</comment>');
            }
        }

        // Build effect type mapping for convenience
        $effectTypes = $this->buildEffectTypeMapping($effects);

        // Save effects.json
        $output->writeln('<info>[3/3] Saving effect data...</info>');

        $effectsOutput = [
            'version' => '1.0',
            'generated' => date('c'),
            'source' => 'extracted from ' . basename($swfPath) . ' via Arakne SWF library',
            'effects' => $effects,
            'type_mapping' => $effectTypes,
            'statistics' => [
                'total_effects' => $effectCount,
            ],
        ];

        $effectsPath = $outputDir . '/effects.json';
        $jsonFlags = JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE;

        if (file_put_contents($effectsPath, json_encode($effectsOutput, $jsonFlags))) {
            $output->writeln('<info>  ✓ Saved: ' . $effectsPath . '</info>');
        } else {
            $output->writeln('<error>Error: Could not write effects.json</error>');
            return Command::FAILURE;
        }

        $output->writeln('');
        $output->writeln(str_repeat('=', 60));
        $output->writeln('<info>Extraction complete!</info>');

        return Command::SUCCESS;
    }

    /**
     * Build a mapping of common effect types for convenience.
     */
    private function buildEffectTypeMapping(array $effects): array
    {
        // Known effect type IDs from Dofus 1.29 protocol
        $mapping = [
            'damage' => [
                'neutral' => 100,
                'earth' => 97,
                'fire' => 98,
                'water' => 96,
                'air' => 99,
            ],
            'steal_hp' => [
                'neutral' => 95,
                'earth' => 92,
                'fire' => 93,
                'water' => 91,
                'air' => 94,
            ],
            'heal' => 108,
            'ap' => [
                'remove' => 168,
                'give' => 111,
            ],
            'mp' => [
                'remove' => 169,
                'give' => 128,
            ],
            'movement' => [
                'push' => 5,
                'pull' => 6,
                'teleport' => 4,
                'switch' => 8,
            ],
            'state' => [
                'invisibility' => 150,
                'carry' => 50,
                'throw' => 51,
            ],
            'summon' => [
                'creature' => 180,
                'static' => 181,
            ],
            'glyph_trap' => [
                'glyph' => 401,
                'trap' => 400,
            ],
        ];

        return $mapping;
    }
}
