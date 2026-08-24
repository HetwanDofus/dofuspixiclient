---
id: QA-078
title: L'inventaire n'utilisait aucun des assets du skin 1.29 déjà en dépôt
severity: P2
domain: hud-panels
type: bug
status: fixed
session: 4
opened: 2026-08-23
closed: 2026-08-23
fixed_in:
related: [QA-013, QA-015, QA-016]
files:
  - apps/electrobun/src/hud/inventory/inventory-theme.ts
  - apps/electrobun/src/hud/inventory/EquipmentPanel.tsx
  - apps/electrobun/src/hud/inventory/BagPanel.tsx
  - apps/electrobun/public/themes/classic/assets/panels/inventory/kamas.svg
---

## Symptôme

Comparaison de `screenshot-ui/inventory-screenshot.png` (client tourné en
local) contre `screenshot-ui/inventaire.png` (capture retail) : il manquait
les cases gris clair de fond sur chaque emplacement d'équipement (vides
comme remplis), la silhouette de personnage en filigrane derrière le
paperdoll, le logo du kama (remplacé par un « K » dessiné à la main, en
bleu), et la grille de cellules du sac — qui ne dessinait une case que là
où il y avait un objet, un sac filtré à vide affichait un rectangle beige
nu.

## Attendu (1.29)

`apps/electrobun/public/themes/classic/assets/panels/inventory/` contient
déjà `character-silhouette.svg`, `equip-slot-fill.svg`,
`equip-slot-highlight.svg`, `grid-cell-bg.svg` et `grid-cell-highlight.svg`
— sortis du pipeline d'assets lors d'une session précédente et jamais
utilisés par aucun composant. Le pipeline lui-même ne tourne pas sur un
clone frais (retail SWFs non commités), mais ces *sorties* le sont.

## Cause

La passe qui a câblé l'inventaire (session 3) a choisi « CSS pur » pour
éviter une dépendance au pipeline d'extraction SWF, et a construit les
slots et la grille avec des aplats de couleur unis plutôt que de vérifier
si le skin existait déjà sous forme de fichiers statiques.

## Correctif

`EquipmentPanel.tsx` : chaque slot (vide ou plein) porte
`equip-slot-fill.svg` en fond, `equip-slot-highlight.svg` en survol/
sélection ; la silhouette est un `<img>` absolu sous les slots. Le libellé
texte des slots vides est retiré (voir QA-015). Le logo kama est un
nouveau `kamas.svg` tracé sur la capture, en remplacement du « K » inline ;
son texte passe de bleu à crème (`#edeadf`, échantillonné). `BagPanel.tsx` :
la grille rend désormais `max(objets, lignes visibles) × 4` cellules,
chacune `grid-cell-bg.svg`, avec `grid-cell-highlight.svg` en sélection —
un sac vide ou filtré affiche donc la grille comme en 1.29. L'ascenseur
`Scrollbar` (déplacé de `hud/spells/` vers `hud/components/`, générique
par `trackColor`/`thumbColor`) remplace le `overflow-y: auto` natif.

## Vérification

Testé à la main dans le client web le 2026-08-23, côte à côte avec
`screenshot-ui/inventaire.png` : slots et silhouette visibles, logo et
texte kama conformes, grille remplie jusqu'en bas même filtrée à vide.
`bun test` (299 serveur, 125 client) et `bunx biome check` sur les fichiers
touchés restent verts.
