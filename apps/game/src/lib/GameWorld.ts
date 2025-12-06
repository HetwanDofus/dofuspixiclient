import { createWorld, addEntity, addComponent, removeEntity, registerComponent } from 'bitecs';
import type { IWorld } from 'bitecs';

// Game-logic-only components (no rendering, no Pixi)
export const NetworkId = { value: { type: 'ui32' } };
export const Position = { x: { type: 'f32' }, y: { type: 'f32' } };
export const Scale = { x: { type: 'f32' }, y: { type: 'f32' } };
export const Rotation = { angle: { type: 'f32' } };
export const ZIndex = { value: { type: 'ui32' } };
export const TileId = { value: { type: 'ui32' } };
export const TileType = { value: { type: 'ui8' } }; // 0=ground, 1=objects

type ComponentMap = {
  NetworkId: { value: number };
  Position: { x: number; y: number };
  Scale: { x: number; y: number };
  Rotation: { angle: number };
  ZIndex: { value: number };
  TileId: { value: number };
  TileType: { value: number };
};

type ComponentName = keyof ComponentMap;

const scalarComponents = {
  NetworkId,
  Position,
  Scale,
  Rotation,
  ZIndex,
  TileId,
  TileType,
} as const;

type ScalarComponentName = keyof typeof scalarComponents;

export class GameWorld {
  private world: IWorld;
  private entityMap: Map<number, number> = new Map(); // networkId -> eid

  constructor() {
    this.world = createWorld();

    // Register all scalar components
    registerComponent(this.world, NetworkId);
    registerComponent(this.world, Position);
    registerComponent(this.world, Scale);
    registerComponent(this.world, Rotation);
    registerComponent(this.world, ZIndex);
    registerComponent(this.world, TileId);
    registerComponent(this.world, TileType);
  }

  createEntity(networkId?: number): number {
    const eid = addEntity(this.world);
    if (networkId !== undefined) {
      this.addComponent(eid, 'NetworkId', { value: networkId });
      this.entityMap.set(networkId, eid);
    }
    return eid;
  }

  addComponent<C extends ComponentName>(eid: number, component: C, value: ComponentMap[C]): void {
    if (isScalarComponent(component)) {
      addComponent(this.world, scalarComponents[component], eid);
      this.setScalarComponent(eid, component, value as any);
    }
  }

  getComponent<C extends ComponentName>(eid: number, component: C): ComponentMap[C] | undefined {
    if (isScalarComponent(component)) {
      return this.getScalarComponent(eid, component) as ComponentMap[C];
    }
    return undefined;
  }

  setComponent<C extends ComponentName>(eid: number, component: C, value: Partial<ComponentMap[C]>): void {
    if (isScalarComponent(component)) {
      this.setScalarComponent(eid, component, value as any);
    }
  }

  private setScalarComponent(eid: number, component: ScalarComponentName, value: any): void {
    const schema = scalarComponents[component] as any;

    // bitECS stores component data in the world like: world.Position.x, world.Position.y
    const componentData = (this.world as any)[component];

    Object.entries(value).forEach(([key, val]) => {
      if (componentData && componentData[key]) {
        componentData[key][eid] = val;
      }
    });
  }

  private getScalarComponent(eid: number, component: ScalarComponentName): any {
    const schema = scalarComponents[component] as any;
    const result: any = {};

    // bitECS stores component data in the world like: world.Position.x, world.Position.y
    const componentData = (this.world as any)[component];

    Object.keys(schema).forEach((key) => {
      if (componentData && componentData[key]) {
        result[key] = componentData[key][eid];
      }
    });
    return result;
  }

  removeEntity(eid: number): void {
    const networkId = this.getComponent(eid, 'NetworkId');
    if (networkId) {
      this.entityMap.delete(networkId.value);
    }
    removeEntity(this.world, eid);
  }

  getEntityByNetworkId(networkId: number): number | undefined {
    return this.entityMap.get(networkId);
  }

  getWorld(): IWorld {
    return this.world;
  }

  destroy(): void {
    this.entityMap.clear();
  }
}

function isScalarComponent(component: ComponentName): component is ScalarComponentName {
  return component in scalarComponents;
}
