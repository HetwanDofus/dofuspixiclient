export interface InteractiveObjectData {
  id: number;
  name: string;
  gfxIds: number[];
  actions?: string[];
}

export interface InteractiveObjectsDatabase {
  interactiveObjects: Record<string, InteractiveObjectData>;
}
