<script lang="ts">
  import { onMount } from 'svelte';
  import MapRenderer from './components/MapRenderer.svelte';

  let windowHeight = 0;
  let windowWidth = 0;

  function handleResize() {
    windowWidth = window.innerWidth;
    windowHeight = window.innerHeight;
  }

  onMount(() => {
    handleResize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  });
</script>

<main>
  <header>
    <h1>Dofus WebGPU Performance Test</h1>
    <p>Rendering with PixiJS v8</p>
  </header>

  <div class="content">
    <MapRenderer />
  </div>
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

  header {
    flex-shrink: 0;
    text-align: center;
    padding: 1rem 0;
    background: rgba(0, 0, 0, 0.3);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  h1 {
    font-size: 2rem;
    margin: 0 0 0.25rem 0;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  header p {
    margin: 0;
    color: #999;
    font-size: 0.9rem;
  }

  .content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0;
    overflow: hidden;
  }
</style>
