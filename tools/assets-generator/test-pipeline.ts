import { processTilesCompletelyPipeline } from './src/sub-types/tiles/index';

(async () => {
  try {
    console.log('Starting pipeline...\n');
    const result = await processTilesCompletelyPipeline(
      '/Users/grandnainconnu/Work/personal/dofus/dofus1.29/dofuswebclient2/assets/sources/clips/gfx',
      '/Users/grandnainconnu/Work/personal/dofus/dofus1.29/dofuswebclient2/assets/rasters/tiles',
      '/Users/grandnainconnu/Work/personal/dofus/dofus1.29/dofuswebclient2/assets/output'
    );

    console.log('\n✅ Pipeline completed!');
    console.log(`\nResults:`);
    console.log(`- Ground tiles: ${result.extraction.ground.stats.processed}`);
    console.log(`- Object tiles: ${result.extraction.objects.stats.processed}`);
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
})();
