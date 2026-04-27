<?php

namespace App\Command;

use Arakne\Swf\Extractor\Drawer\Converter\Converter;
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
 * Extract color-zone metadata from static-shape SWFs (artworks, emblems,
 * auras, alignments). Walks the timeline recursively, parses GAC.applyColor
 * calls on each body-part sprite, and emits a per-id metadata.json with the
 * same shape character-sprite metadata uses:
 *
 *   { gfxId, colorZones: { "1": [#hex, ...], ... }, colorMapping: { "1": N } }
 *
 * Static shapes differ from character sprites in two ways we accommodate
 * here: (a) they have no accessory slots, (b) the depth of the body-part
 * timeline varies by export — some wrap in an outer sprite, some don't. We
 * handle both by recursing until we hit SpriteDefinitions whose actions
 * contain applyColor, rather than hard-coding the 2-level nesting the main
 * character extractor relies on.
 */
class ExtractStaticMetadataCommand extends Command
{
    private Converter $converter;

    protected function configure(): void
    {
        $this
            ->setName('static:metadata')
            ->setDescription('Extract color-zone metadata from static SWFs (artworks, emblems, auras, alignments)')
            ->addOption('input', 'i', InputOption::VALUE_REQUIRED, 'Input dir containing *.swf')
            ->addOption('output', 'o', InputOption::VALUE_REQUIRED, 'Output dir (one subdir per id)')
            ->addOption('id', null, InputOption::VALUE_OPTIONAL, 'Only extract this id')
            ->addOption('identity-mapping', null, InputOption::VALUE_NONE,
                'Emit identity colorMapping {1:1,2:2,3:3} instead of requiring a sprite-side table');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $io = new SymfonyStyle($input, $output);
        $inputDir = (string) $input->getOption('input');
        $outputDir = (string) $input->getOption('output');
        $filterId = $input->getOption('id');
        $identityMapping = (bool) $input->getOption('identity-mapping');

        if (!$inputDir || !is_dir($inputDir)) {
            $io->error('Missing or invalid --input');
            return Command::FAILURE;
        }
        if (!$outputDir) {
            $io->error('Missing --output');
            return Command::FAILURE;
        }

        @mkdir($outputDir, 0755, true);
        $this->converter = new Converter(subpixelStrokeWidth: false);

        $extracted = 0;
        $skipped = 0;
        $noZones = 0;

        foreach (glob($inputDir . '/*.swf') ?: [] as $swfPath) {
            $id = pathinfo($swfPath, PATHINFO_FILENAME);
            if ($filterId !== null && $id !== (string) $filterId) continue;

            $metadata = $this->extractMetadata($swfPath, $id, $identityMapping);
            if ($metadata === null) {
                $skipped++;
                continue;
            }
            if (empty($metadata['colorZones'])) {
                $noZones++;
                continue;
            }

            $outFile = sprintf('%s/%s/metadata.json', $outputDir, $id);
            @mkdir(dirname($outFile), 0755, true);
            file_put_contents(
                $outFile,
                json_encode($metadata, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)
            );
            $extracted++;
        }

        $io->success(sprintf(
            'Done: %d metadata files written, %d skipped, %d had no zones',
            $extracted,
            $skipped,
            $noZones
        ));
        return Command::SUCCESS;
    }

    private function extractMetadata(string $swfPath, string $id, bool $identityMapping): ?array
    {
        try {
            $swf = new SwfFile($swfPath);
            if (!$swf->valid()) return null;
            $ext = new SwfExtractor($swf);
        } catch (\Exception $e) {
            return null;
        }

        $colorZones = [];
        // Walk the full character graph recursively looking for body-part
        // sprites whose frame actions call GAC.applyColor. We rely on the
        // SWF's exported symbols — artworks / emblems / auras always export
        // their root sprite.
        try {
            foreach ($ext->exported() as $name => $characterId) {
                $char = $ext->character($characterId);
                if (!($char instanceof SpriteDefinition)) continue;
                $this->walkForZones($char, $colorZones, 0);
            }
            $ext->release();
        } catch (\Exception $e) {
            return null;
        }

        foreach ($colorZones as $z => $colors) {
            $colorZones[$z] = array_values(array_unique($colors));
        }

        $colorMapping = $identityMapping || !empty($colorZones)
            ? $this->deriveColorMapping($colorZones)
            : [];

        return [
            'gfxId' => ctype_digit((string) $id) ? (int) $id : $id,
            'colorZones' => $colorZones,
            'colorMapping' => $colorMapping,
        ];
    }

    private function walkForZones(SpriteDefinition $sprite, array &$zones, int $depth): void
    {
        if ($depth > 6) return; // guard against cycles
        $this->scanTimelineActions($sprite, $zones);

        try {
            $frames = $this->getFrames($sprite->timeline());
            foreach ($frames as $frame) {
                $objects = $this->getObjects($frame) ?? [];
                foreach ($objects as $obj) {
                    $child = $this->getChildObject($obj);
                    if ($child instanceof SpriteDefinition) {
                        $this->walkForZones($child, $zones, $depth + 1);
                    }
                }
            }
        } catch (\Exception $e) {
            // ignore traversal errors — we already scanned this sprite's own actions
        }
    }

    /**
     * For every frame in this sprite's timeline, parse DoAction records for
     * `GAC.applyColor(clip, zone)` calls. When found, scrape unique fill hex
     * colors from the sprite's rendered SVG and bucket them under the zone id.
     */
    private function scanTimelineActions(SpriteDefinition $sprite, array &$zones): void
    {
        try {
            $frames = $this->getFrames($sprite->timeline());
        } catch (\Exception $e) {
            return;
        }

        foreach ($frames as $frame) {
            try {
                $actions = $this->getActions($frame);
            } catch (\Exception $e) {
                continue;
            }
            foreach ($actions as $tag) {
                try {
                    $records = $this->getActionRecords($tag);
                } catch (\Exception $e) {
                    continue;
                }
                $pushStack = [];
                foreach ($records as $rec) {
                    $opcode = $this->getOpcode($rec);
                    $data = $this->getData($rec);

                    if ($opcode === 'ActionPush' && is_array($data)) {
                        foreach ($data as $v) {
                            if (is_object($v)) $pushStack[] = $this->valueFromPush($v);
                        }
                    } elseif ($opcode === 'ActionCallMethod') {
                        if (in_array('applyColor', $pushStack, true)) {
                            $zone = null;
                            foreach ($pushStack as $v) {
                                if (is_int($v) && $v >= 1 && $v <= 3) { $zone = $v; break; }
                            }
                            if ($zone !== null) {
                                $colors = $this->extractFillColors($sprite);
                                if (!isset($zones[$zone])) $zones[$zone] = [];
                                $zones[$zone] = array_merge($zones[$zone], $colors);
                            }
                        }
                        $pushStack = [];
                    }
                }
            }
        }
    }

    private function extractFillColors(SpriteDefinition $sprite): array
    {
        try {
            $svg = $this->converter->toSvg($sprite, 0);
            if (!$svg) return [];
            preg_match_all('/fill="(#[0-9a-fA-F]{6})"/', $svg, $matches);
            return array_values(array_unique($matches[1] ?? []));
        } catch (\Exception $e) {
            return [];
        }
    }

    /**
     * Static shapes don't carry a remap table (that's sprite-specific). The
     * safe default: identity mapping — zone N tints to player_colors[N-1].
     * Callers with a specific remap (e.g. guild emblems) can post-process.
     */
    private function deriveColorMapping(array $zones): array
    {
        $mapping = [];
        foreach (array_keys($zones) as $zone) {
            $mapping[(string) $zone] = (int) $zone;
        }
        return $mapping;
    }

    // ── Reflection helpers (mirror the ones in ExtractSpriteMetadataCommand) ──

    private function getFrames($timeline): array
    {
        $rc = new \ReflectionClass($timeline);
        $fp = $rc->getProperty('frames');
        $fp->setAccessible(true);
        return $fp->getValue($timeline) ?? [];
    }

    private function getObjects($frame): array
    {
        $rc = new \ReflectionClass($frame);
        if (!$rc->hasProperty('objects')) return [];
        $op = $rc->getProperty('objects');
        $op->setAccessible(true);
        return $op->getValue($frame) ?? [];
    }

    private function getActions($frame): array
    {
        $rc = new \ReflectionClass($frame);
        if (!$rc->hasProperty('actions')) return [];
        $ap = $rc->getProperty('actions');
        $ap->setAccessible(true);
        return $ap->getValue($frame) ?? [];
    }

    private function getChildObject($frameObject)
    {
        $rc = new \ReflectionClass($frameObject);
        if (!$rc->hasProperty('object')) return null;
        $op = $rc->getProperty('object');
        $op->setAccessible(true);
        return $op->getValue($frameObject);
    }

    private function getActionRecords($tag): array
    {
        $rc = new \ReflectionClass($tag);
        if (!$rc->hasProperty('actions')) return [];
        $ap = $rc->getProperty('actions');
        $ap->setAccessible(true);
        return $ap->getValue($tag) ?? [];
    }

    private function getOpcode($record): string
    {
        $rc = new \ReflectionClass($record);
        $op = $rc->getProperty('opcode');
        $op->setAccessible(true);
        $v = $op->getValue($record);
        return is_object($v) ? $v->name : (string) $v;
    }

    private function getData($record)
    {
        $rc = new \ReflectionClass($record);
        $dp = $rc->getProperty('data');
        $dp->setAccessible(true);
        return $dp->getValue($record);
    }

    private function valueFromPush(object $v)
    {
        $rc = new \ReflectionClass($v);
        foreach (['value', 'constant'] as $prop) {
            if ($rc->hasProperty($prop)) {
                $p = $rc->getProperty($prop);
                $p->setAccessible(true);
                $raw = $p->getValue($v);
                if ($raw !== null) return $raw;
            }
        }
        return null;
    }
}
