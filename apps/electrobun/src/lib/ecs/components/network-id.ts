import { component, field } from '@lastolivegames/becsy';

@component export class NetworkId {
  @field.uint32 declare value: number;
}
