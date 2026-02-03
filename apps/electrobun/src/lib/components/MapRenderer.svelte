<script lang="ts">
  import { onDestroy, onMount } from "svelte";

  import { Battlefield } from "@/ank/battlefield";

  let canvasContainer: HTMLDivElement;
  let battlefield: Battlefield | null = null;
  let isLoading = true;
  let isResizing = false;
  let error: string | null = null;
  let debugEnabled = false;

  function handleResizeStart() {
    isResizing = true;
  }

  function handleResizeEnd() {
    isResizing = false;
  }

  onMount(async () => {
    try {
      battlefield = new Battlefield({
        container: canvasContainer,
        onResizeStart: handleResizeStart,
        onResizeEnd: handleResizeEnd,
        resizeDebounceMs: 300,
        preferWebGPU: true, // WebGL is more stable for resize operations in CEF
      });
      await battlefield.init();

      try {
        await battlefield.loadManifest();
        await battlefield.loadMap(7411);
      } catch (mapErr) {
        console.warn("Failed to load map, continuing without it:", mapErr);
      }

      isLoading = false;

      // Add keyboard listener for debug toggle
      window.addEventListener("keydown", handleKeyDown);
    } catch (err) {
      error =
        err instanceof Error ? err.message : "Failed to initialize renderer";
      console.error("Initialization error:", err);
      isLoading = false;
    }
  });

  onDestroy(() => {
    window.removeEventListener("keydown", handleKeyDown);
    if (battlefield) {
      battlefield.destroy();
    }
  });

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "d" || e.key === "D") {
      if (battlefield) {
        debugEnabled = battlefield.toggleDebug();
        console.log(`Debug overlay: ${debugEnabled ? "enabled" : "disabled"}`);
      }
    }
  }

  function handleWheel(e: WheelEvent) {
    if (battlefield) {
      battlefield.handleWheel(e);
    }
  }

  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    if (battlefield) {
      battlefield.handleContextMenu(e);
    }
  }
</script>

<div
  class="map-renderer"
  class:resizing={isResizing}
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

  {#if isResizing}
    <div class="resize-overlay">
      <div class="spinner"></div>
      <p>Adjusting resolution...</p>
    </div>
  {/if}

  {#if error}
    <div class="error-overlay">
      <p class="error-message">{error}</p>
    </div>
  {/if}

  {#if debugEnabled}
    <div class="debug-indicator">
      DEBUG MODE (Press D to toggle) - Hover tiles for info
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
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .map-renderer :global(canvas) {
    display: block;
    transition: filter 0.15s ease-out;
    image-rendering: pixelated;
    image-rendering: crisp-edges;
  }

  .map-renderer.resizing :global(canvas) {
    filter: blur(2px);
    image-rendering: pixelated;
  }

  .loading-overlay,
  .error-overlay,
  .resize-overlay {
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

  .resize-overlay {
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    z-index: 999;
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

  .debug-indicator {
    position: absolute;
    top: 10px;
    left: 10px;
    background: rgba(0, 100, 0, 0.9);
    color: #0f0;
    padding: 8px 12px;
    border-radius: 4px;
    font-family: monospace;
    font-size: 12px;
    z-index: 1001;
    border: 1px solid #0f0;
  }
</style>
