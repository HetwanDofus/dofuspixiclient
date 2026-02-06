<?php

namespace App;

use Arakne\Swf\Avm\State;
use Arakne\Swf\Parser\Structure\Action\ActionRecord;
use Arakne\Swf\Parser\Structure\Action\Opcode;

/**
 * Extended ActionScript processor with additional opcode support
 *
 * Adds support for opcodes not implemented in the base Arakne Processor:
 * - ActionAdd2 (0x47): Addition/concatenation operator
 * - ActionSubtract (0x0b): Subtraction operator
 * - ActionMultiply (0x0c): Multiplication operator
 * - ActionDivide (0x0d): Division operator
 * - ActionModulo (0x3f): Modulo operator
 * - ActionIncrement (0x50): Increment operator
 * - ActionDecrement (0x51): Decrement operator
 * - ActionLess2 (0x48): Less than comparison
 * - ActionEquals2 (0x49): Equality comparison
 * - ActionNot (0x12): Logical NOT
 * - ActionAnd (0x10): Logical AND
 * - ActionOr (0x11): Logical OR
 */
final class ExtendedProcessor
{
    public function __construct(
        private bool $allowFunctionCall = true,
    ) {}

    /**
     * Run the given actions and return the final state.
     */
    public function run(array $actions, ?State $state = null): State
    {
        $state ??= new State();

        foreach ($actions as $action) {
            $this->execute($state, $action);
        }

        return $state;
    }

    /**
     * Execute a single instruction with extended opcode support.
     */
    public function execute(State $state, ActionRecord $action): void
    {
        // First try the base processor for supported opcodes
        $baseProcessor = new \Arakne\Swf\Avm\Processor($this->allowFunctionCall);

        try {
            $baseProcessor->execute($state, $action);
            return;
        } catch (\Exception $e) {
            // If base processor doesn't support it, try our extended opcodes
            if (!str_contains($e->getMessage(), 'Unknown action:')) {
                throw $e;
            }
        }

        // Handle extended opcodes
        match ($action->opcode) {
            Opcode::ActionAdd2 => $this->add2($state),
            Opcode::ActionSubtract => $this->subtract($state),
            Opcode::ActionMultiply => $this->multiply($state),
            Opcode::ActionDivide => $this->divide($state),
            Opcode::ActionModule => $this->modulo($state),
            Opcode::ActionIncrement => $this->increment($state),
            Opcode::ActionDecrement => $this->decrement($state),
            Opcode::ActionLess2 => $this->less2($state),
            Opcode::ActionEquals2 => $this->equals2($state),
            Opcode::ActionNot => $this->not($state),
            Opcode::ActionAnd => $this->and($state),
            Opcode::ActionOr => $this->or($state),
            Opcode::ActionJump => null, // Ignore jumps for now
            Opcode::ActionIf => null, // Ignore conditional jumps for now
            default => throw new \Exception('Unknown action: '.$action->opcode->name.' '.json_encode($action).' Stack: '.json_encode($state->stack)),
        };
    }

    /**
     * ActionAdd2: Addition/concatenation operator
     * Pops two values, adds them (numeric) or concatenates them (string), and pushes result
     */
    private function add2(State $state): void
    {
        $b = array_pop($state->stack);
        $a = array_pop($state->stack);

        // If either operand is a string, concatenate
        if (is_string($a) || is_string($b)) {
            $state->stack[] = (string)$a . (string)$b;
            return;
        }

        // Otherwise, add as numbers
        $state->stack[] = (float)$a + (float)$b;
    }

    /**
     * ActionSubtract: Subtraction operator
     */
    private function subtract(State $state): void
    {
        $b = array_pop($state->stack);
        $a = array_pop($state->stack);
        $state->stack[] = (float)$a - (float)$b;
    }

    /**
     * ActionMultiply: Multiplication operator
     */
    private function multiply(State $state): void
    {
        $b = array_pop($state->stack);
        $a = array_pop($state->stack);
        $state->stack[] = (float)$a * (float)$b;
    }

    /**
     * ActionDivide: Division operator
     */
    private function divide(State $state): void
    {
        $b = array_pop($state->stack);
        $a = array_pop($state->stack);
        $state->stack[] = $b != 0 ? (float)$a / (float)$b : 0;
    }

    /**
     * ActionModulo: Modulo operator
     */
    private function modulo(State $state): void
    {
        $b = array_pop($state->stack);
        $a = array_pop($state->stack);
        $state->stack[] = $b != 0 ? (float)$a % (float)$b : 0;
    }

    /**
     * ActionIncrement: Increment operator (++value)
     */
    private function increment(State $state): void
    {
        $index = count($state->stack) - 1;
        $state->stack[$index] = (float)$state->stack[$index] + 1;
    }

    /**
     * ActionDecrement: Decrement operator (--value)
     */
    private function decrement(State $state): void
    {
        $index = count($state->stack) - 1;
        $state->stack[$index] = (float)$state->stack[$index] - 1;
    }

    /**
     * ActionLess2: Less than comparison
     */
    private function less2(State $state): void
    {
        $b = array_pop($state->stack);
        $a = array_pop($state->stack);
        $state->stack[] = $a < $b;
    }

    /**
     * ActionEquals2: Equality comparison
     */
    private function equals2(State $state): void
    {
        $b = array_pop($state->stack);
        $a = array_pop($state->stack);
        $state->stack[] = $a == $b;
    }

    /**
     * ActionNot: Logical NOT operator
     */
    private function not(State $state): void
    {
        $index = count($state->stack) - 1;
        $state->stack[$index] = !$state->stack[$index];
    }

    /**
     * ActionAnd: Logical AND operator
     */
    private function and(State $state): void
    {
        $b = array_pop($state->stack);
        $a = array_pop($state->stack);
        $state->stack[] = $a && $b;
    }

    /**
     * ActionOr: Logical OR operator
     */
    private function or(State $state): void
    {
        $b = array_pop($state->stack);
        $a = array_pop($state->stack);
        $state->stack[] = $a || $b;
    }
}
