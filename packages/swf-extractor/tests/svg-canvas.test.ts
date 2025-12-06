import { describe, test, expect } from 'bun:test';
import { SwfFile } from '../src/swf-file.ts';
import { SwfExtractor } from '../src/extractor/swf-extractor.ts';
import { SvgCanvas } from '../src/extractor/drawer/svg/svg-canvas.ts';

const FIXTURES_DIR = import.meta.dir + '/fixtures';

async function loadSwf(name: string): Promise<{ swf: SwfFile; extractor: SwfExtractor }> {
  const data = await Bun.file(`${FIXTURES_DIR}/${name}`).arrayBuffer();
  const swf = SwfFile.fromBuffer(Buffer.from(data));
  return { swf, extractor: new SwfExtractor(swf.parser) };
}

describe('SvgCanvas', () => {
  describe('render', () => {
    test('renders a sprite to SVG', async () => {
      const { swf, extractor } = await loadSwf('1317.swf');
      const assets = swf.exportedAssets;
      const firstAsset = assets[0];

      if (firstAsset) {
        const drawable = extractor.getDrawable(firstAsset.id);
        if (drawable) {
          const canvas = new SvgCanvas();
          drawable.draw(canvas);
          const svg = canvas.render();

          expect(svg).toContain('<svg');
          expect(svg).toContain('</svg>');
          // Check for width/height attributes instead of viewBox
          expect(svg).toMatch(/width="[^"]+px"/);
        }
      }
    });

    test('includes defs section for gradients', async () => {
      const { swf, extractor } = await loadSwf('1317.swf');
      const assets = swf.exportedAssets;

      for (const asset of assets.slice(0, 5)) {
        const drawable = extractor.getDrawable(asset.id);
        if (drawable) {
          const canvas = new SvgCanvas();
          drawable.draw(canvas);
          const svg = canvas.render();

          if (svg.includes('linearGradient') || svg.includes('radialGradient') || svg.includes('filter')) {
            expect(svg).toContain('<defs>');
            expect(svg).toContain('</defs>');
          }
          break;
        }
      }
    });

    test('renders multiple frames', async () => {
      const { swf, extractor } = await loadSwf('1317.swf');
      const assets = swf.exportedAssets;

      const animAsset = assets.find(a => a.name.startsWith('anim'));
      if (animAsset) {
        const drawable = extractor.getDrawable(animAsset.id);
        if (drawable && drawable.framesCount() > 1) {
          const canvas0 = new SvgCanvas();
          drawable.draw(canvas0, 0);
          const svg0 = canvas0.render();

          const canvas1 = new SvgCanvas();
          drawable.draw(canvas1, 1);
          const svg1 = canvas1.render();

          expect(svg0).toContain('<svg');
          expect(svg1).toContain('<svg');
        }
      }
    });
  });

  describe('transforms', () => {
    test('applies transformations correctly', async () => {
      const { swf, extractor } = await loadSwf('1317.swf');
      const assets = swf.exportedAssets;
      const firstAsset = assets[0];

      if (firstAsset) {
        const drawable = extractor.getDrawable(firstAsset.id);
        if (drawable) {
          const canvas = new SvgCanvas();
          drawable.draw(canvas);
          const svg = canvas.render();

          expect(svg).toMatch(/<(g|use|symbol)/);
        }
      }
    });
  });

  describe('paths', () => {
    test('renders paths with stroke and fill', async () => {
      const { extractor } = await loadSwf('1317.swf');
      const shapeIds = [...extractor.shapes()];
      const firstShapeId = shapeIds[0];

      if (firstShapeId !== undefined) {
        const shape = extractor.getShape(firstShapeId);
        if (shape) {
          const canvas = new SvgCanvas();
          shape.draw(canvas);
          const svg = canvas.render();

          if (svg.includes('<path')) {
            expect(svg).toMatch(/d="[^"]+"/);
          }
        }
      }
    });
  });
});
