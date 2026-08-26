---
id: QA-085
title: Aucun protocole d'utilisation d'objet interactif — portes, zaaps et coffres inertes
severity: P1
domain: network
type: gap
status: fixed
session: 2
opened: 2026-08-25
closed:
fixed_in:
related: [QA-050, QA-084, QA-086]
files:
  - proto/game.proto
  - apps/gameserver-ts/src/core/modules/maps/maps.cells-codec.ts
  - apps/gameserver-ts/src/core/modules/interactive-objects/interactive-objects.service.ts
  - apps/gameserver-ts/src/core/features/game/interactive-use/interactive-use.handler.ts
  - apps/electrobun/src/game/scene/battlefield/picking.ts
  - apps/electrobun/src/game/lang/interactive-objects-lang.ts
---

## Symptôme

Cliquer sur la porte d'une maison ne fait rien. Le zaap ouvrait un menu dont
l'unique entrée « Use » était un `log.debug`. Aucun autre élément — coffre,
établi, ressource — ne réagissait.

Comptage du monde entier, en décodant les 9 358 payloads `maps.cells` :
**16 523 cellules interactives**, dont 12 226 ressources, 1 743 coffres,
1 093 portes de maison, 75 zaapis et 33 zaaps. Rien n'en exploitait aucune.

## Attendu (1.29)

`DofusBattlefield.onObjectRelease` ouvre un menu titré du nom de l'élément avec
une entrée par compétence de sa liste `IO.d[id].sk`, grisée quand l'action est
indisponible. `GameManager.useRessource` marche d'abord jusqu'à la cellule puis
émet `GA;500;<cellId>;<skillId>`.

## Cause

La chaîne était coupée en cinq endroits :

1. **Le serveur jetait le bit `interactive`.** `maps.cells-codec.ts` le décodait
   et le rangeait en bit 59 du mot 60 bits, mais `decodeOne` ne le relisait
   jamais et `MapCell` n'avait pas le champ.
2. **Le client devinait par liste blanche de gfx**, enregistrant au picking tout
   sprite de layer > 0 dont le gfx figurait dans un JSON anglais — un arbre
   décoratif compris. Le `cellId` reçu dans `onSpriteCreated` était jeté.
3. **`registerTile` n'installait aucun callback**, donc la branche `onClick` de
   `onObjectClick` était morte pour les tuiles (c'est QA-050).
4. **Seul le Zaap avait un menu**, et son action ne faisait rien.
5. **Aucun message ne traversait le réseau** : pas de message d'utilisation
   d'élément, et `GameActionType` sautait de 303 à 617.

## Correctif

- `MapCell.layer_object2_interactive` (champ 17) et `ACTION_INTERACTIVE_USE = 500`
  dans `proto/game.proto` ; `decodeOne` relit le bit 59.
- Le client n'enregistre au picking qu'un sprite de **layer 2** dont la cellule
  a le bit armé, et `registerTile` retient le `cellId`.
- Le menu est reconstruit depuis les bundles lang français
  (`interactiveobjects.json` + `skills.json`, les deux tables que lit
  `DofusTranslator`), avec les compétences non implémentées grisées plutôt que
  masquées. Le JSON anglais `public/assets/data/interactive-objects.json` n'est
  plus utilisé pour le menu.
- Marche-puis-agit : `GameClient.useInteractive` mémorise `{mapId, cellId,
  skillId}`, lance le déplacement et n'émet qu'à l'arrivée, en abandonnant si le
  trajet s'est terminé ailleurs.
- Nouveau module `modules/interactive-objects/` + slice
  `features/game/interactive-use/`. Le client n'est jamais cru sur parole : le
  serveur relit la cellule, exige le bit `interactive`, résout le template par
  gfx et refuse une compétence que le template ne liste pas — même niveau de
  contrôle que l'adjacence dans `validatePath`.

Trois compétences sont câblées : **84 « Entrer »** (téléport vers la carte
intérieure, cf. QA-084 pour la dérivation de la géométrie), **114 « Utiliser »**
(`WaypointsService.openZaapMenu`, désormais alimenté en zaaps) et
**104 « Ouvrir »** (le serveur distingue coffre de maison et banque de compte
par l'appartenance de la carte à une maison). Le reste de chaque liste apparaît
grisé.

## Vérification

```bash
cd apps/gameserver-ts && bun test src/core/modules/interactive-objects/
# 8 tests : bit non armé refusé, compétence non offerte refusée,
# maison sans sortie gardée close, coffre → maison vs banque
```

En jeu : cliquer la porte en 7414:236 → menu « Porte », « Entrer » actif, les
autres grisées ; « Entrer » amène sur la carte 7779. Cliquer le zaap en
7411:297 → la liste des destinations s'ouvre.
