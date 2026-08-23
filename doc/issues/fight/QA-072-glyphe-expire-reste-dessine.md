---
id: QA-072
title: Un glyphe expiré reste dessiné chez le client
severity: P2
domain: fight
type: bug
status: in-progress
session: 2
opened: 2026-08-23
closed:
fixed_in:
related: [QA-073]
files:
  - apps/gameserver-ts/src/core/modules/fight/engine/fight.runner.ts:167
---

## Symptôme

Le disque d'un glyphe reste affiché sur le terrain après sa disparition, jusqu'à
la fin du combat.

## Cause

`ObjectRegistry.tickDown()` rend la liste des objets expirés. Son résultat était
jeté :

```ts
this.fight.fightMap.objects.tickDown();
```

Aucun `emitGlyphRemove` n'était donc émis. L'émetteur possède pourtant la
méthode, et le client sait traiter l'opération `REMOVE` d'un `gameZoneData`.

C'est une zone que le joueur voit, sur laquelle il raisonne pour se placer, et
qui ne fait plus rien : le pire cas d'un affichage qui ment.

## Correctif

Diffuser un retrait de zone pour chaque objet expiré.

## Vérification

Poser un glyphe, laisser passer sa durée, vérifier que le disque disparaît de
l'écran au round où il cesse d'agir — et pas plus tard.
