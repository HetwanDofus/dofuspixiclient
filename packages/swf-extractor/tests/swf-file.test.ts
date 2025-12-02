import { describe, test, expect } from 'bun:test';
import { SwfFile } from '../src/swf-file.ts';

const FIXTURES_DIR = import.meta.dir + '/fixtures';

async function loadSwf(name: string): Promise<SwfFile> {
  const data = await Bun.file(`${FIXTURES_DIR}/${name}`).arrayBuffer();
  return SwfFile.fromBuffer(Buffer.from(data));
}

describe('SwfFile', () => {
  describe('fromBuffer', () => {
    test('parses simple swf file', async () => {
      const swf = await loadSwf('simple.swf');

      expect(swf.valid).toBe(true);
      expect(swf.header.version).toBe(6);
      expect(swf.header.signature).toBe('CWS');
      expect(swf.header.frameCount).toBe(1);
    });

    test('parses big values swf file', async () => {
      const swf = await loadSwf('big.swf');
      expect(swf.valid).toBe(true);
    });

    test('returns invalid for corrupted files', () => {
      const invalidData = Buffer.from('invalid signature data');
      expect(() => SwfFile.fromBuffer(invalidData)).toThrow();
    });
  });

  describe('variables', () => {
    test('extracts simple variables', async () => {
      const swf = await loadSwf('simple.swf');
      const vars = swf.variables;

      expect(vars.simple_int).toBe(123);
      expect(vars.simple_string).toBe('abc');
      expect(vars.simple_float).toBeCloseTo(1.23);
      expect(vars.simple_bool).toBe(true);
      expect(vars.simple_null).toBeNull();
    });

    test('extracts big values', async () => {
      const swf = await loadSwf('big.swf');
      const vars = swf.variables;

      expect(vars.big_int).toBe(1234567890);
      expect(vars.negative_int).toBe(-1234567890);
      expect(vars.big_float).toBeCloseTo(1234567890123.1235);
      expect(vars.negative_float).toBeCloseTo(-1234567890123.1235);
    });

    test('extracts cast values', async () => {
      const swf = await loadSwf('cast.swf');
      const vars = swf.variables;

      expect(vars.str_to_number).toBe(1234);
      expect(vars.float_to_str).toBe('1234.5678');
      expect(vars.int_to_bool).toBe(true);
    });

    test('extracts object variables', async () => {
      const swf = await loadSwf('objects.swf');
      const vars = swf.variables;

      expect(vars.bag).toBeDefined();
      expect((vars.bag as Record<string, unknown>).a).toBe(1);
      expect((vars.bag as Record<string, unknown>).b).toBe(false);
      expect(vars.get_member).toBe(1);
      expect(vars.array_access).toBe(2);
    });

    test('extracts array variables', async () => {
      const swf = await loadSwf('array.swf');
      const vars = swf.variables;

      expect(vars.arr1_length).toBe(0);
      expect(vars.arr2_length).toBe(5);
      expect(vars.arr3_length).toBe(3);
    });
  });

  describe('exportedAssets', () => {
    test('returns exported assets from 1317.swf', async () => {
      const swf = await loadSwf('1317.swf');
      const assets = swf.exportedAssets;

      expect(assets.length).toBeGreaterThan(0);

      for (const asset of assets) {
        expect(asset.name).toBeDefined();
        expect(typeof asset.name).toBe('string');
        expect(asset.id).toBeDefined();
        expect(typeof asset.id).toBe('number');
      }
    });
  });

  describe('header', () => {
    test('returns correct frame rate', async () => {
      const swf = await loadSwf('simple.swf');
      expect(swf.frameRate).toBe(50);
    });

    test('returns display bounds', async () => {
      const swf = await loadSwf('simple.swf');
      const bounds = swf.displayBounds;

      expect(bounds.width).toBeGreaterThanOrEqual(0);
      expect(bounds.height).toBeGreaterThanOrEqual(0);
    });
  });
});
