import { component, field } from '@lastolivegames/becsy';

@component export class Position {
  @field.float64 declare x: number;
  @field.float64 declare y: number;
}

@component export class Scale {
  @field.float64 declare x: number;
  @field.float64 declare y: number;
}

@component export class Rotation {
  @field.float64 declare angle: number;
}

@component export class ZIndex {
  @field.uint32 declare value: number;
}
