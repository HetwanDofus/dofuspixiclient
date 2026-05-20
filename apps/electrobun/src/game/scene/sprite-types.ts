// Wire-agnostic sprite-data shapes. These used to come from `@dofus/proto`
// (`MountDisplay`, `MonsterGroupMember`); now that the proto layer is being
// retired, the scene code owns these types and the network handlers project
// dofus1-net frames into them.

/**
 * Chevauchor / mount appearance. Mirrors the AS2 `dofus.datacenter.Mount`
 * payload — only `gfxId` is actually read today (the renderer composes
 * the chevauchor sprite via `CHEVAUCHOR_ID_OFFSET + gfxId`). Add fields
 * here as the renderer needs them, never on a private/proto shape.
 */
export interface MountDisplay {
  gfxId: number;
}

/**
 * One monster of a roleplay-mode monster group (the "leader plus N
 * decorative members" stack the user sees on a single cell before
 * combat starts).
 *
 * Field set matches what `picking.ts:344` projects into the React
 * tooltip — adding more fields means adding more producers in the
 * `GM`-frame handler chain.
 */
export interface MonsterGroupMember {
  templateId: number;
  /** Localised monster name (server-side translated). May be empty for
   *  legacy servers — `picking.ts` falls back to `Monster ${templateId}`. */
  name: string;
  level: number;
  gfxId: number;
  /** AS2 colour-zone overrides — used to build the `look` string passed
   *  to the character sprite renderer. `-1` means "use the gfx default". */
  color1: number;
  color2: number;
  color3: number;
}
