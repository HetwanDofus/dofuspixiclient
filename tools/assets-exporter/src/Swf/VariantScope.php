<?php

namespace App\Swf;

/**
 * The `_parent` chain a 1.29 tile clip walks to read its variant number.
 *
 * Self-referential: `_parent._parent.n` and `_parent.n` both land here, which
 * is what the clips assume — they are placed at a fixed depth under the
 * exported wrapper that declared the variable.
 */
final class VariantScope
{
    /** True once a clip actually read one of the wrapper's variables. */
    public bool $used = false;

    /** @param array<string, int> $variables */
    public function __construct(private readonly array $variables)
    {
    }

    public function __isset(string $name): bool
    {
        return $name === '_parent' || isset($this->variables[$name]);
    }

    public function __get(string $name): mixed
    {
        if ($name === '_parent') {
            return $this;
        }

        if (!isset($this->variables[$name])) {
            return null;
        }

        $this->used = true;

        return $this->variables[$name];
    }
}
