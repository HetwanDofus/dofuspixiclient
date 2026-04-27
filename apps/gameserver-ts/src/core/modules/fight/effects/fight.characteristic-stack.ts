import type { Characteristic } from "@modules/fight/fight.types";

export class CharacteristicStack {
  private base = new Map<Characteristic, number>();
  private items = new Map<Characteristic, number>();
  private buffs = new Map<Characteristic, number>();

  setBase(id: Characteristic, v: number): void {
    this.base.set(id, v);
  }

  addItem(id: Characteristic, delta: number): void {
    this.items.set(id, (this.items.get(id) ?? 0) + delta);
  }

  addBuff(id: Characteristic, delta: number): void {
    this.buffs.set(id, (this.buffs.get(id) ?? 0) + delta);
  }

  removeBuff(id: Characteristic, delta: number): void {
    this.buffs.set(id, (this.buffs.get(id) ?? 0) - delta);
  }

  resetItems(): void {
    this.items.clear();
  }

  get(id: Characteristic): number {
    return (
      (this.base.get(id) ?? 0) +
      (this.items.get(id) ?? 0) +
      (this.buffs.get(id) ?? 0)
    );
  }

  getBase(id: Characteristic): number {
    return this.base.get(id) ?? 0;
  }
}
