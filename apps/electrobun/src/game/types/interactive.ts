export interface InteractiveObjectData {
  id: number;
  name: string;
  type?: number;
  gfxIds: number[];
  actions?: string[];
}

export interface InteractiveObjectsDatabase {
  interactiveObjects: Record<string, InteractiveObjectData>;
}
