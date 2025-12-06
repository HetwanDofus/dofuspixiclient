<script lang="ts">
  export let stats = {
    fps: 0,
    sprites: 0,
    drawCalls: 0,
    renderTime: 0,
    memory: 0,
  };

  export let error: string | null = null;
  export let onLoadMap: (mapId: number) => void = () => {};

  let selectedMap = 7411;
  let showStats = true;

  const testMaps = [
    { id: 37, name: 'Small Map' },
    { id: 300, name: 'Medium Map' },
    { id: 745, name: 'Large Map' },
    { id: 7411, name: 'Stress Test Map' },
  ];

  function handleMapChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    selectedMap = parseInt(target.value);
    onLoadMap(selectedMap);
  }
</script>

<div class="debug-toolbox">
  <div class="controls">
    <label for="map-select">Load Map:</label>
    <select id="map-select" value={selectedMap} on:change={handleMapChange}>
      {#each testMaps as map}
        <option value={map.id}>{map.name} (ID: {map.id})</option>
      {/each}
    </select>

    <button
      class="toggle-btn"
      on:click={() => (showStats = !showStats)}
      title={showStats ? 'Hide stats' : 'Show stats'}
    >
      {showStats ? '📊 Hide' : '📊 Show'} Stats
    </button>
  </div>

  {#if showStats}
    <div class="stats-panel">
      <div class="stat-row">
        <span class="stat-label">FPS:</span>
        <span class="stat-value">{stats.fps}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Sprites:</span>
        <span class="stat-value">{stats.sprites}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Draw Calls:</span>
        <span class="stat-value">{stats.drawCalls}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Render:</span>
        <span class="stat-value">{stats.renderTime.toFixed(2)} ms</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Memory:</span>
        <span class="stat-value">{stats.memory.toFixed(1)} MB</span>
      </div>
    </div>
  {/if}

  {#if error}
    <div class="error-bar">
      <span>⚠️ {error}</span>
    </div>
  {/if}
</div>

<style>
  .debug-toolbox {
    flex-shrink: 0;
    background: rgba(0, 0, 0, 0.5);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    padding: 1rem;
  }

  .controls {
    display: flex;
    gap: 1rem;
    align-items: center;
    flex-wrap: wrap;
  }

  label {
    font-weight: 500;
    color: #ccc;
  }

  select {
    padding: 0.5rem;
    background: #2a2a2a;
    color: #fff;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
  }

  select:hover {
    border-color: rgba(255, 255, 255, 0.4);
  }

  .toggle-btn {
    padding: 0.5rem 1rem;
    background: #3a5f7f;
    color: white;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
    transition: background 0.2s;
  }

  .toggle-btn:hover {
    background: #4a7f9f;
  }

  .stats-panel {
    margin-top: 0.75rem;
    padding: 0.75rem;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 4px;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 1rem;
    font-family: 'Courier New', monospace;
    font-size: 0.85rem;
  }

  .stat-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .stat-label {
    color: #999;
  }

  .stat-value {
    color: #0f0;
    font-weight: bold;
    margin-left: 0.5rem;
  }

  .error-bar {
    margin-top: 0.75rem;
    padding: 0.75rem;
    background: rgba(255, 100, 100, 0.2);
    border-left: 3px solid #ff6464;
    border-radius: 4px;
    color: #ff9999;
    font-size: 0.9rem;
  }
</style>
