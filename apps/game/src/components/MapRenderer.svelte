<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { MapRendererEngine } from '../lib/MapRendererEngine';
  import DebugToolbox from './DebugToolbox.svelte';

  let canvasContainer: HTMLDivElement;
  let engine: MapRendererEngine | null = null;
  let isLoading = true;
  let error: string | null = null;
  let stats = {
    fps: 0,
    sprites: 0,
    drawCalls: 0,
    renderTime: 0,
    memory: 0,
  };

  async function handleLoadMap(mapId: number) {
    if (!engine) return;
    try {
      isLoading = true;
      error = null;
      await engine.loadMap(mapId);
      isLoading = false;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load map';
      isLoading = false;
    }
  }

  onMount(async () => {
    try {
      engine = new MapRendererEngine(canvasContainer);
      await engine.init();

      try {
        await engine.loadManifest();
        // Load default Dofus map
        await engine.loadMap(7411);
      } catch (mapErr) {
        console.warn('Failed to load map, continuing without it:', mapErr);
        // Continue anyway - we can still show ECS sprites
      }

      // Spawn stress test sprites with ECS
      await engine.spawnStressTestSprites(100);
      isLoading = false;

      // Start stats update loop
      const statsInterval = setInterval(() => {
        if (engine) {
          stats = engine.getStats();
        }
      }, 100);

      return () => {
        clearInterval(statsInterval);
      };
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to initialize renderer';
      console.error('Initialization error:', err);
      isLoading = false;
    }
  });

  onDestroy(() => {
    if (engine) {
      engine.destroy();
    }
  });

  function handleWheel(e: WheelEvent) {
    if (engine) {
      engine.handleWheel(e);
    }
  }

  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    if (engine) {
      engine.handleContextMenu(e);
    }
  }
</script>

<DebugToolbox {stats} {error} onLoadMap={handleLoadMap} />

<div
  class="map-renderer"
  bind:this={canvasContainer}
  on:wheel={handleWheel}
  on:contextmenu={handleContextMenu}
  role="application"
>
  {#if isLoading}
    <div class="loading-overlay">
      <div class="spinner"></div>
      <p>Loading map...</p>
    </div>
  {/if}

  {#if error}
    <div class="error-overlay">
      <p class="error-message">{error}</p>
    </div>
  {/if}
</div>

<style>
  .map-renderer {
    flex: 1;
    position: relative;
    background: #1a1a1a;
    overflow: hidden;
    width: 100%;
    height: 100%;
  }

  .map-renderer :global(canvas) {
    position: absolute;
    top: 0;
    left: 0;
    width: 100% !important;
    height: 100% !important;
  }

  .loading-overlay,
  .error-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.8);
    color: white;
    z-index: 1000;
  }

  .spinner {
    border: 4px solid rgba(255, 255, 255, 0.1);
    border-left-color: #fff;
    border-radius: 50%;
    width: 40px;
    height: 40px;
    animation: spin 1s linear infinite;
    margin-bottom: 1rem;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .error-message {
    color: #ff6b6b;
    font-weight: bold;
  }
</style>
