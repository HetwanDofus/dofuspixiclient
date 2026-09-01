---
id: QA-133
title: Les pods gagnés par les métiers ne sont jamais comptés
severity: P2
domain: progression
type: bug
status: fixed
session: 6
opened: 2026-08-31
closed: 2026-09-01
fixed_in:
related: [QA-013, QA-123, QA-129]
files:
  - apps/gameserver-ts/src/core/modules/inventory/pods.ts
  - apps/gameserver-ts/src/core/modules/stats/stats.service.ts
---

## Symptôme

`maxPods(totalStrength, podsBonus)` vaut `1000 + 5 × force + bonus`, où `bonus`
ne vient que de l'effet 158 d'un équipement. Un personnage Bûcheron 100 porte
donc exactement autant qu'un personnage sans métier.

## Attendu (1.29)

Chaque métier accorde **5 pods par niveau**, et un bonus de **1 000 pods au
niveau 100** — soit 1 500 pods pour un métier 100. Les métiers se cumulent.
Oublier un métier reprend ses pods.

## Cause

`pods.ts` a été écrit pour QA-013 quand aucun métier n'existait ; sa formule est
juste et incomplète.

## Correctif

`modules/jobs/jobs.pods.ts`, pur et testé :

```
jobPodsBonus(niveaux) = Σ 5 × niveau + (niveau >= 100 ? 1000 : 0)
```

branché dans `maxPods()`, et donc dans la trame `As` que `StatsService` assemble
déjà. Le total est recalculé au gain de niveau métier et à l'oubli.

## Vérification

Un `.spec.ts` couvre : aucun métier (1 000 + force), un métier 40 (+200), un
métier 100 (+1 500), trois métiers 100 (+4 500), et le retour à zéro après
oubli. En jeu, la jauge de pods de la bannière monte de 5 à chaque niveau de
métier.
