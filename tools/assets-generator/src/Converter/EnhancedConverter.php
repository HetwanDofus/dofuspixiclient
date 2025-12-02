<?php

declare(strict_types=1);

namespace DoFusWebClient\AssetsGenerator\Converter;

use Arakne\Swf\Extractor\DrawableInterface;
use Arakne\Swf\Extractor\Drawer\Converter\Converter;
use Arakne\Swf\Extractor\Drawer\Converter\ImageResizerInterface;
use Arakne\Swf\Extractor\Drawer\Converter\Renderer\ImagickSvgRendererInterface;

/**
 * Enhanced Converter that preprocesses SVG to improve thin stroke visibility.
 * Multiplies all stroke-width values by a factor to make fine details visible when rasterized.
 */
final class EnhancedConverter extends Converter
{
    private float $strokeWidthMultiplier = 4.0;

    public function __construct(
        ?ImageResizerInterface $resizer = null,
        string $backgroundColor = 'transparent',
        ?ImagickSvgRendererInterface $svgRenderer = null,
        bool $subpixelStrokeWidth = false,
        float $strokeWidthMultiplier = 4.0,
    ) {
        parent::__construct($resizer, $backgroundColor, $svgRenderer, $subpixelStrokeWidth);
        $this->strokeWidthMultiplier = $strokeWidthMultiplier;
    }

    public function toSvg(DrawableInterface $drawable, int $frame = 0): string
    {
        $svg = parent::toSvg($drawable, $frame);
        return $this->enhanceStrokes($svg);
    }

    public function toPng(DrawableInterface $drawable, int $frame = 0, array $options = []): string
    {
        $svg = $this->toSvg($drawable, $frame);
        // We need to render this enhanced SVG
        return parent::toPng($drawable, $frame, $options);
    }

    /**
     * Enhance stroke visibility by multiplying stroke-width values
     */
    private function enhanceStrokes(string $svg): string
    {
        // Replace stroke-width="X" with multiplied value
        return preg_replace_callback(
            '/stroke-width="([0-9.]+)"/',
            function ($matches) {
                $originalWidth = (float)$matches[1];
                $newWidth = max($originalWidth * $this->strokeWidthMultiplier, 0.5);
                return sprintf('stroke-width="%.4g"', $newWidth);
            },
            $svg
        );
    }
}
