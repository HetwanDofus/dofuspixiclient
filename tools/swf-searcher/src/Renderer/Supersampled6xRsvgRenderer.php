<?php

namespace App\Renderer;

use Arakne\Swf\Extractor\Drawer\Converter\Renderer\AbstractCommandImagickSvgRenderer;

use function escapeshellarg;
use function sprintf;

/**
 * Parse the SVG string using `rsvg-convert` with 6x zoom to render as PNG, before passing it to Imagick.
 */
final readonly class Supersampled6xRsvgRenderer extends AbstractCommandImagickSvgRenderer
{
    public function __construct()
    {
        parent::__construct('rsvg-convert');
    }

    protected function buildCommand(string $command, string $backgroundColor): string
    {
        return sprintf(
            '%s -f png -b %s -z 6',
            $command,
            escapeshellarg($backgroundColor)
        );
    }
}
