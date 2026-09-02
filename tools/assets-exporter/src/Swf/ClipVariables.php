<?php

namespace App\Swf;

use Arakne\Swf\Avm\Processor;
use Arakne\Swf\Avm\State;
use Arakne\Swf\Extractor\Sprite\SpriteDefinition;
use Throwable;

use function is_int;

/**
 * Reads the integer variables a clip assigns to itself on its first frame.
 *
 * Dofus 1.29 declines a single piece of art into several resources this way:
 * the exported symbol is a thin wrapper whose frame 0 does `n_arbre = 3`, and
 * the nested clips holding the nine variants read that variable back to pick
 * their own frame. See {@see VariantFrameModifier} for the other half.
 */
final class ClipVariables
{
    /**
     * @return array<string, int> variable name => value, empty when the clip
     *                            assigns nothing (the overwhelming majority).
     */
    public static function of(SpriteDefinition $sprite): array
    {
        try {
            $frame = $sprite->timeline()->frames[0] ?? null;
        } catch (Throwable) {
            return [];
        }

        if ($frame === null) {
            return [];
        }

        $state = new State();
        $processor = new Processor(allowFunctionCall: false);

        foreach ($frame->actions as $tag) {
            foreach ($tag->actions as $action) {
                try {
                    $processor->execute($state, $action);
                } catch (Throwable) {
                    // Opcodes the AVM subset does not implement (ActionStop and
                    // friends) are irrelevant here — keep reading.
                }
            }
        }

        $variables = [];
        foreach ($state->variables as $name => $value) {
            if (is_int($value)) {
                $variables[$name] = $value;
            }
        }

        return $variables;
    }
}
