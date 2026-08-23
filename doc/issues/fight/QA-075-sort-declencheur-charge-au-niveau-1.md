---
id: QA-075
title: Le sort déclencheur d'un glyphe ou d'un piège est toujours chargé au niveau 1
severity: P3
domain: fight
type: bug
status: in-progress
session: 2
opened: 2026-08-23
closed:
fixed_in:
related: [QA-062]
files:
  - apps/gameserver-ts/src/core/modules/fight/cast/fight.cast.ts
---

## Symptôme

Une fois QA-062 corrigé et les dégâts pris sur le sort déclencheur, un glyphe de
rang élevé frappe comme un rang 1.

## Cause

Le préchargement des sorts déclencheurs figeait le niveau :

```ts
const lvl = await this.spells.spellLevel(triggerId, 1);
```

Tant que `triggerSpell` ne servait qu'à choisir une teinte, le niveau n'avait
aucune importance — d'où l'écriture d'origine. Il en a une dès qu'il porte les
dégâts.

## Correctif

Charger le déclencheur au niveau du sort lancé, avec repli sur 1 si ce rang
manque en base.

## Vérification

Comparer les dégâts d'un glyphe monté au rang 5 avec la fiche du sort.
