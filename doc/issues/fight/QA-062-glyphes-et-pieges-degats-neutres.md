---
id: QA-062
title: "Glyphes et pièges : dégâts neutres, calculés sur l'effet enveloppe"
severity: P1
domain: fight
type: bug
status: in-progress
session: 2
opened: 2026-08-23
closed:
fixed_in:
related: [QA-061]
files:
  - apps/gameserver-ts/src/core/modules/fight/effects/handlers/trap-glyph.handler.ts
---

## Symptôme

Même une fois la zone corrigée (QA-061), les dégâts d'un glyphe sont faux.

## Cause — deux défauts distincts

**L'élément est figé sur Neutre.** Les deux appels sont
`calculateDamage(scope, Element.Neutral)` puis
`applyDamageToTarget(…, Element.Neutral)`. Un Glyphe Enflammé inflige donc des
dégâts neutres : les résistances Feu de la cible ne s'appliquent pas, ni les
bonus Feu du lanceur.

Le handler sait pourtant déterminer l'élément — `pickGlyphColor()` remonte
`scope.triggerSpell` pour en **teinter le visuel**. L'information est chargée,
utilisée pour la couleur, et ignorée pour les dégâts.

**Le calcul lit le mauvais effet.** `calculateDamage(scope, …)` travaille sur
`scope.effect`, qui est ici l'effet enveloppe 401. Cet effet ne porte pas de
plage de dégâts : par convention 1.29 son `min` contient l'**identifiant du sort
déclencheur**. Les dégâts sont donc dérivés d'un identifiant de sort.

Le commentaire en tête du fichier documente d'ailleurs le mécanisme correct —
il n'a été branché que sur la couleur.

## Correctif

Faire porter au glyphe l'effet de dégâts du **sort déclencheur**
(`scope.triggerSpell`) et son élément, et non l'effet enveloppe. Le piège (400)
a le même défaut et se corrige au même endroit.

## Vérification

Voir le runbook du sprint 01, étape « Glyphes ».
