<script lang="ts">
  import { onMount } from 'svelte';
  import MapRenderer from '@/components/MapRenderer.svelte';
  import WorldMap from '@/components/WorldMap.svelte';

  let windowHeight = 0;
  let windowWidth = 0;
  let showWorldMap = false;

  function handleResize() {
    windowWidth = window.innerWidth;
    windowHeight = window.innerHeight;
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'm' || e.key === 'M') {
      showWorldMap = !showWorldMap;
    }
  }

  onMount(() => {
    handleResize();
    window.addEventListener('resize', handleResize);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
    };
  });
</script>

<main>
  <div class="content">
    <MapRenderer />
  </div>

  <WorldMap visible={showWorldMap} />
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
  }

  main {
    width: 100%;
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: linear-gradient(135deg, #1e1e1e 0%, #2a2a2a 100%);
  }

  .content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0;
    overflow: hidden;
  }
</style>
