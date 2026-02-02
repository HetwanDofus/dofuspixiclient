export interface MapData {
  id: number;
  width: number;
  height: number;
  backgroundNum?: number;
  cells: MapCell[];
}

export interface MapCell {
  id: number;
  ground: number;
  layer1: number;
  layer2: number;
  groundLevel: number;
  groundSlope?: number;
  layerGroundRot: number;
  layerGroundFlip: boolean;
  layerObject1Rot: number;
  layerObject1Flip: boolean;
  layerObject2Rot: number;
  layerObject2Flip: boolean;
}

export interface MapScale {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface MapBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}
