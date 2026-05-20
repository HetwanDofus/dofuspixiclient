import { Application, Container } from "pixi.js";
import { type DependencyList, type RefObject, useEffect, useRef } from "react";

import { getVelloGpu, whenVelloReady } from "@/game/render/vello-loader";

export interface UsePixiSlotOptions {
  /**
   * When true, the slot's Pixi `Application` adopts Vello's shared
   * `GPUDevice` (waits for `initVello()` to land first). REQUIRED for
   * any slot that mounts sprites wrapping Vello-produced GPUTextures
   * via `ExternalSource` — without device sharing the `ExternalSource`
   * resource lives on a different `GPUDevice` than the Pixi renderer
   * and Pixi silently draws nothing.
   *
   * Default false to preserve back-compat for slots that don't touch
   * runtime-SWF textures.
   */
  shareVelloGpu?: boolean;
}

/**
 * Hook that creates a standalone PIXI Application inside a DOM element.
 *
 * Use this when the embedded PIXI content does NOT need access to the
 * main game renderer's texture cache (e.g., a self-contained mini-app).
 *
 * Pass `{ shareVelloGpu: true }` when the slot's sprites wrap Vello
 * GPUTextures (minimap chunks, worldmap chunks, hint icons, etc.).
 *
 * @param factory - Called once after the PIXI app initializes.
 *   Receives the Application and root Container. May return a cleanup function.
 * @param deps - React dependency list to re-initialize the slot.
 * @returns A ref to attach to the container div.
 */
export function usePixiSlot(
  factory: (app: Application, container: Container) => (() => void) | undefined,
  deps: DependencyList = [],
  options: UsePixiSlotOptions = {}
): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);
  const { shareVelloGpu = false } = options;

  useEffect(() => {
    const el = ref.current;

    if (!el) {
      return;
    }

    const app = new Application();
    let cleanup: (() => void) | undefined;
    let destroyed = false;

    (async () => {
      let gpu: { adapter: GPUAdapter; device: GPUDevice } | null = null;
      if (shareVelloGpu) {
        // Wait for Vello to install its renderer + device. The slot
        // mounts before the Battlefield's `initVello()` lands; without
        // the gate we'd race and get `getVelloGpu() === null`.
        await whenVelloReady();
        if (destroyed) return;
        gpu = getVelloGpu();
      }

      await app.init({
        resizeTo: el,
        backgroundAlpha: 0,
        antialias: true,
        ...(gpu ? { gpu, preference: "webgpu" as const } : {}),
      });

      if (destroyed) {
        app.destroy(true);
        return;
      }

      el.appendChild(app.canvas);
      const container = new Container();
      app.stage.addChild(container);
      cleanup = factory(app, container);
    })();

    return () => {
      destroyed = true;
      cleanup?.();

      try {
        app.destroy(true);
      } catch {
        // May already be destroyed
      }
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: caller-managed deps array
  }, deps);

  return ref;
}

/**
 * Hook that creates a PIXI Container rendered via the main game Application.
 *
 * Use this when the embedded content needs access to the main renderer's
 * texture cache (e.g., minimap rendering shared assets).
 *
 * The factory receives the main Application and a Container that's added
 * to the stage. The container is removed on cleanup.
 *
 * @param mainApp - The main PIXI Application instance (from PixiAppContext).
 * @param factory - Populates the container. May return a cleanup function.
 * @param deps - React dependency list.
 * @returns A ref to attach to a canvas element for rendering.
 */
export function usePixiSlotShared(
  mainApp: Application | null,
  factory: (container: Container) => (() => void) | undefined,
  deps: DependencyList = []
): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!mainApp || !ref.current) {
      return;
    }

    const container = new Container();
    mainApp.stage.addChild(container);
    const cleanup = factory(container);

    return () => {
      cleanup?.();
      mainApp.stage.removeChild(container);
      container.destroy({ children: true });
    };
  }, [mainApp, ...deps, factory]); // eslint-disable-line react-hooks/exhaustive-deps

  return ref;
}
