<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { WorldMapRenderer } from '@/ank/gapi/worldmap';

  export let visible: boolean = false;

  let canvasContainer: HTMLDivElement;
  let renderer: WorldMapRenderer | null = null;
  let isLoading = true;
  let error: string | null = null;

  $: if (visible && canvasContainer) {
    if (!renderer) {
      initRenderer();
    } else {
      // Map already loaded, just show it with animation
      renderer.show();
    }
  } else if (!visible && renderer) {
    // Hide renderer when map is closed (keep it cached)
    renderer.hide();
  }

  async function initRenderer() {
    try {
      isLoading = true;
      error = null;
      renderer = new WorldMapRenderer(canvasContainer);
      await renderer.init();
      await renderer.loadWorldMap(0); // 0 = Amakna, 3 = Incarnam (loads only once)
      isLoading = false;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load world map';
      console.error('World map error:', err);
      isLoading = false;
    }
  }

  onDestroy(() => {
    if (renderer) {
      renderer.destroy();
      renderer = null;
    }
  });
</script>

<div class="world-map-overlay" class:hidden={!visible}>
  <div class="world-map-container" bind:this={canvasContainer}>
    {#if isLoading}
      <div class="loading-overlay">
        <div class="spinner"></div>
        <p>Loading world map...</p>
      </div>
    {/if}

    {#if error}
      <div class="error-overlay">
        <p class="error-message">{error}</p>
      </div>
    {/if}
  </div>

  <div class="help-text">
    <kbd>M</kbd> Close map | <kbd>Drag</kbd> Pan | <kbd>Scroll</kbd> Zoom
  </div>
</div>

<style>
  .world-map-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.95);
    z-index: 9999;
    display: flex;
    flex-direction: column;
  }

  .world-map-overlay.hidden {
    display: none;
  }

  .world-map-container {
    flex: 1;
    position: relative;
    width: 100%;
    height: 100%;
  }

  .world-map-container :global(canvas) {
    display: block;
    image-rendering: pixelated;
    image-rendering: crisp-edges;
  }

  .help-text {
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    color: white;
    font-size: 14px;
    background: rgba(0, 0, 0, 0.7);
    padding: 10px 20px;
    border-radius: 5px;
    border: 1px solid rgba(255, 255, 255, 0.3);
  }

  kbd {
    background: #333;
    padding: 2px 8px;
    border-radius: 3px;
    border: 1px solid #555;
    font-weight: bold;
    font-family: monospace;
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
    z-index: 10000;
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
