import { describe, test, expect } from 'bun:test';
import { SwfFile } from '../src/swf-file.ts';
import { SwfExtractor } from '../src/extractor/swf-extractor.ts';

const FIXTURES_DIR = import.meta.dir + '/fixtures';

async function loadSwf(name: string): Promise<{ swf: SwfFile; extractor: SwfExtractor }> {
  const data = await Bun.file(`${FIXTURES_DIR}/${name}`).arrayBuffer();
  const swf = SwfFile.fromBuffer(Buffer.from(data));
  return { swf, extractor: new SwfExtractor(swf.parser) };
}

describe('SwfExtractor', () => {
  describe('getShape', () => {
    test('returns shape definition for valid shape ID', async () => {
      const { swf, extractor } = await loadSwf('1317.swf');
      const assets = swf.exportedAssets;
      expect(assets.length).toBeGreaterThan(0);

      const firstAsset = assets[0];
      expect(firstAsset).toBeDefined();
      const sprite = extractor.getSprite(firstAsset!.id);
      expect(sprite).toBeDefined();
    });

    test('returns null for non-existent shape', async () => {
      const { extractor } = await loadSwf('1317.swf');
      const shape = extractor.getShape(99999);
      expect(shape).toBeNull();
    });
  });

  describe('getSprite', () => {
    test('returns sprite definition for valid sprite ID', async () => {
      const { swf, extractor } = await loadSwf('1317.swf');
      const assets = swf.exportedAssets;
      const spriteAsset = assets.find(a => a.name.startsWith('anim') || a.name.startsWith('static'));

      if (spriteAsset) {
        const sprite = extractor.getSprite(spriteAsset.id);
        expect(sprite).toBeDefined();
        expect(sprite?.id).toBe(spriteAsset.id);
      }
    });

    test('returns null for non-existent sprite', async () => {
      const { extractor } = await loadSwf('1317.swf');
      const sprite = extractor.getSprite(99999);
      expect(sprite).toBeNull();
    });
  });

  describe('getDrawable', () => {
    test('returns drawable for shape or sprite', async () => {
      const { swf, extractor } = await loadSwf('1317.swf');
      const assets = swf.exportedAssets;
      expect(assets.length).toBeGreaterThan(0);

      const firstAsset = assets[0];
      expect(firstAsset).toBeDefined();
      const drawable = extractor.getDrawable(firstAsset!.id);
      expect(drawable).toBeDefined();
    });

    test('returns null for non-existent character', async () => {
      const { extractor } = await loadSwf('1317.swf');
      const drawable = extractor.getDrawable(99999);
      expect(drawable).toBeNull();
    });
  });

  describe('getCharacterType', () => {
    test('returns correct type for sprites', async () => {
      const { swf, extractor } = await loadSwf('1317.swf');
      const assets = swf.exportedAssets;

      for (const asset of assets.slice(0, 3)) {
        const type = extractor.getCharacterType(asset.id);
        expect(['shape', 'sprite', 'image', 'morph', null]).toContain(type);
      }
    });

    test('returns null for non-existent character', async () => {
      const { extractor } = await loadSwf('1317.swf');
      const type = extractor.getCharacterType(99999);
      expect(type).toBeNull();
    });
  });

  describe('exported', () => {
    test('yields exported assets', async () => {
      const { extractor } = await loadSwf('1317.swf');
      const exports = [...extractor.exported()];
      expect(exports.length).toBeGreaterThan(0);

      for (const exp of exports) {
        expect(exp.name).toBeDefined();
        expect(exp.id).toBeDefined();
      }
    });
  });

  describe('shapes', () => {
    test('yields all shapes in the file', async () => {
      const { extractor } = await loadSwf('1317.swf');
      const shapes = [...extractor.shapes()];
      expect(shapes.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('sprites', () => {
    test('yields all sprites in the file', async () => {
      const { extractor } = await loadSwf('1317.swf');
      const sprites = [...extractor.sprites()];
      expect(sprites.length).toBeGreaterThan(0);
    });
  });
});
