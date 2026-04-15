/**
 * Mount model data extracted from rides lang SWF.
 * Maps mount modelID (color in DB) → mount creature gfxId + default colors.
 *
 * The chevauchorGfxId (rider sprite) is sent separately per-actor and comes
 * from the character's gfxId field in the DB when mounted.
 */
export interface MountModelData {
  /** Mount creature sprite ID (e.g., 7002 for dragodindes) */
  gfxId: number;
  /** Default color 1 */
  color1: number;
  /** Default color 2 (-1 = use default) */
  color2: number;
  /** Default color 3 */
  color3: number;
  /** Display name */
  name: string;
}

export const MOUNT_MODELS: Record<number, MountModelData> = {
  1:  { gfxId: 7002, color1: 16772045, color2: -1,       color3: 16772045, name: "Dragodinde Amande Sauvage" },
  3:  { gfxId: 7002, color1: 1245184,  color2: 393216,   color3: 1245184,  name: "Dragodinde Ebène" },
  6:  { gfxId: 7002, color1: 16747520, color2: -1,       color3: 16747520, name: "Dragodinde Rousse Sauvage" },
  9:  { gfxId: 7002, color1: 1182992,  color2: 16777200, color3: 16777200, name: "Dragodinde Ebène et Ivoire" },
  10: { gfxId: 7002, color1: 16747520, color2: -1,       color3: 16747520, name: "Dragodinde Rousse" },
  11: { gfxId: 7002, color1: 16747520, color2: 16777200, color3: 16777200, name: "Dragodinde Ivoire et Rousse" },
  12: { gfxId: 7002, color1: 16747520, color2: 1703936,  color3: 1774084,  name: "Dragodinde Ebène et Rousse" },
  15: { gfxId: 7002, color1: 4251856,  color2: -1,       color3: 4251856,  name: "Dragodinde Turquoise" },
  16: { gfxId: 7002, color1: 16777200, color2: 16777200, color3: 16777200, name: "Dragodinde Ivoire" },
  17: { gfxId: 7002, color1: 4915330,  color2: -1,       color3: 4915330,  name: "Dragodinde Indigo" },
  18: { gfxId: 7002, color1: 16766720, color2: 16766720, color3: 16766720, name: "Dragodinde Dorée" },
  19: { gfxId: 7002, color1: 14423100, color2: -1,       color3: 14423100, name: "Dragodinde Pourpre" },
  20: { gfxId: 7002, color1: 16772045, color2: -1,       color3: 16772045, name: "Dragodinde Amande" },
  21: { gfxId: 7002, color1: 3329330,  color2: -1,       color3: 3329330,  name: "Dragodinde Emeraude" },
  22: { gfxId: 7002, color1: 15859954, color2: 16777200, color3: 15859954, name: "Dragodinde Orchidée" },
  23: { gfxId: 7002, color1: 14524637, color2: -1,       color3: 14524637, name: "Dragodinde Prune" },
  33: { gfxId: 7002, color1: 16772045, color2: 16766720, color3: 16766720, name: "Dragodinde Amande et Dorée" },
  34: { gfxId: 7002, color1: 16772045, color2: 1245184,  color3: 1245184,  name: "Dragodinde Amande et Ebène" },
  35: { gfxId: 7002, color1: 16772045, color2: 3329330,  color3: 3329330,  name: "Dragodinde Amande et Emeraude" },
  36: { gfxId: 7002, color1: 16772045, color2: 4915330,  color3: 4915330,  name: "Dragodinde Amande et Indigo" },
  37: { gfxId: 7002, color1: 16772045, color2: 16777200, color3: 16777200, name: "Dragodinde Amande et Ivoire" },
  38: { gfxId: 7002, color1: 16772045, color2: 16747520, color3: 16747520, name: "Dragodinde Amande et Rousse" },
  39: { gfxId: 7002, color1: 16772045, color2: 4251856,  color3: 4251856,  name: "Dragodinde Amande et Turquoise" },
  40: { gfxId: 7002, color1: 16772045, color2: 15859954, color3: 15859954, name: "Dragodinde Amande et Orchidée" },
  41: { gfxId: 7002, color1: 16772045, color2: 14423100, color3: 14423100, name: "Dragodinde Amande et Pourpre" },
  42: { gfxId: 7002, color1: 1245184,  color2: 16766720, color3: 16766720, name: "Dragodinde Dorée et Ebène" },
  43: { gfxId: 7002, color1: 16766720, color2: 3329330,  color3: 3329330,  name: "Dragodinde Dorée et Emeraude" },
  44: { gfxId: 7002, color1: 16766720, color2: 4915330,  color3: 4915330,  name: "Dragodinde Dorée et Indigo" },
  45: { gfxId: 7002, color1: 16766720, color2: 16777200, color3: 16777200, name: "Dragodinde Dorée et Ivoire" },
  46: { gfxId: 7002, color1: 16766720, color2: 16747520, color3: 16747520, name: "Dragodinde Dorée et Rousse" },
  47: { gfxId: 7002, color1: 16766720, color2: 4251856,  color3: 4251856,  name: "Dragodinde Dorée et Turquoise" },
  48: { gfxId: 7002, color1: 16766720, color2: 15859954, color3: 15859954, name: "Dragodinde Dorée et Orchidée" },
  49: { gfxId: 7002, color1: 16766720, color2: 14423100, color3: 14423100, name: "Dragodinde Dorée et Pourpre" },
  50: { gfxId: 7002, color1: 1245184,  color2: 3329330,  color3: 3329330,  name: "Dragodinde Ebène et Emeraude" },
  51: { gfxId: 7002, color1: 4915330,  color2: 4915330,  color3: 1245184,  name: "Dragodinde Ebène et Indigo" },
  52: { gfxId: 7002, color1: 1245184,  color2: 4251856,  color3: 4251856,  name: "Dragodinde Ebène et Turquoise" },
  53: { gfxId: 7002, color1: 15859954, color2: 0,        color3: 0,        name: "Dragodinde Ebène et Orchidée" },
  54: { gfxId: 7002, color1: 14423100, color2: 14423100, color3: 1245184,  name: "Dragodinde Ebène et Pourpre" },
  55: { gfxId: 7002, color1: 3329330,  color2: 4915330,  color3: 4915330,  name: "Dragodinde Emeraude et Indigo" },
  56: { gfxId: 7002, color1: 3329330,  color2: 16777200, color3: 16777200, name: "Dragodinde Emeraude et Ivoire" },
  57: { gfxId: 7002, color1: 3329330,  color2: 16747520, color3: 16747520, name: "Dragodinde Emeraude et Rousse" },
  58: { gfxId: 7002, color1: 3329330,  color2: 4251856,  color3: 4251856,  name: "Dragodinde Emeraude et Turquoise" },
  59: { gfxId: 7002, color1: 3329330,  color2: 15859954, color3: 15859954, name: "Dragodinde Emeraude et Orchidée" },
  60: { gfxId: 7002, color1: 3329330,  color2: 14423100, color3: 14423100, name: "Dragodinde Emeraude et Pourpre" },
  61: { gfxId: 7002, color1: 4915330,  color2: 16777200, color3: 16777200, name: "Dragodinde Indigo et Ivoire" },
  62: { gfxId: 7002, color1: 4915330,  color2: 16747520, color3: 16747520, name: "Dragodinde Indigo et Rousse" },
  63: { gfxId: 7002, color1: 4915330,  color2: 4251856,  color3: 4251856,  name: "Dragodinde Indigo et Turquoise" },
  64: { gfxId: 7002, color1: 4915330,  color2: 15859954, color3: 15859954, name: "Dragodinde Indigo et Orchidée" },
  65: { gfxId: 7002, color1: 14423100, color2: 4915330,  color3: 4915330,  name: "Dragodinde Indigo et Pourpre" },
  66: { gfxId: 7002, color1: 16777200, color2: 4251856,  color3: 4251856,  name: "Dragodinde Ivoire et Turquoise" },
  67: { gfxId: 7002, color1: 16777200, color2: 16731355, color3: 16711910, name: "Dragodinde Ivoire et Orchidée" },
  68: { gfxId: 7002, color1: 14423100, color2: 16777200, color3: 16777200, name: "Dragodinde Ivoire et Pourpre" },
  69: { gfxId: 7002, color1: 4251856,  color2: 16747520, color3: 16747520, name: "Dragodinde Turquoise et Rousse" },
  70: { gfxId: 7002, color1: 14315734, color2: 16747520, color3: 16747520, name: "Dragodinde Orchidée et Rousse" },
  71: { gfxId: 7002, color1: 14423100, color2: 16747520, color3: 16747520, name: "Dragodinde Pourpre et Rousse" },
  72: { gfxId: 7002, color1: 15859954, color2: 4251856,  color3: 4251856,  name: "Dragodinde Turquoise et Orchidée" },
  73: { gfxId: 7002, color1: 14423100, color2: 4251856,  color3: 4251856,  name: "Dragodinde Turquoise et Pourpre" },
  74: { gfxId: 7002, color1: 16766720, color2: 16766720, color3: 16766720, name: "Dragodinde Dorée Sauvage" },
  75: { gfxId: 7003, color1: 16772045, color2: -1,       color3: 16772045, name: "Dragodinde Squelette" },
  76: { gfxId: 7002, color1: 14315734, color2: 14423100, color3: 14423100, name: "Dragodinde Orchidée et Pourpre" },
  77: { gfxId: 7002, color1: 14524637, color2: 16772045, color3: 16772045, name: "Dragodinde Prune et Amande" },
  78: { gfxId: 7002, color1: 14524637, color2: 16766720, color3: 16766720, name: "Dragodinde Prune et Dorée" },
  79: { gfxId: 7002, color1: 14524637, color2: 1245184,  color3: 1245184,  name: "Dragodinde Prune et Ebène" },
  80: { gfxId: 7002, color1: 14524637, color2: 3329330,  color3: 3329330,  name: "Dragodinde Prune et Emeraude" },
  82: { gfxId: 7002, color1: 14524637, color2: 4915330,  color3: 4915330,  name: "Dragodinde Prune et Indigo" },
  83: { gfxId: 7002, color1: 14524637, color2: 16777200, color3: 16777200, name: "Dragodinde Prune et Ivoire" },
  84: { gfxId: 7002, color1: 14524637, color2: 16747520, color3: 16747520, name: "Dragodinde Prune et Rousse" },
  85: { gfxId: 7002, color1: 14524637, color2: 4251856,  color3: 4251856,  name: "Dragodinde Prune et Turquoise" },
  86: { gfxId: 7002, color1: 14524637, color2: 15859954, color3: 15859954, name: "Dragodinde Prune et Orchidée" },
  87: { gfxId: 7002, color1: 14524637, color2: 14423100, color3: 14423100, name: "Dragodinde Prune et Pourpre" },
  88: { gfxId: 7005, color1: 16753715, color2: 7482137,  color3: 8079413,  name: "Dragodinde en armure" },
  89: { gfxId: 7006, color1: -1,       color2: -1,       color3: -1,       name: "Dragodinde du Paladin" },
  90: { gfxId: 7007, color1: -1,       color2: -1,       color3: -1,       name: "Tabi" },
  91: { gfxId: 7008, color1: -1,       color2: -1,       color3: -1,       name: "Karnage" },
  92: { gfxId: 7009, color1: -1,       color2: -1,       color3: -1,       name: "Bouftea Maur" },
};

/**
 * Get mount model data by modelID (color field in DB).
 */
export function getMountModel(modelId: number): MountModelData | undefined {
  return MOUNT_MODELS[modelId];
}
