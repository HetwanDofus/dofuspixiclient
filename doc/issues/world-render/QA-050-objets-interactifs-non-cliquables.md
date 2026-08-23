---
id: QA-050
title: 194 objets interactifs chargés sur la map, aucun n'est cliquable
severity: P1
domain: world-render
type: gap
status: confirmed
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-049]
files: []
---

## Symptôme

Relevé en session sur la map courante :

- `battlefield.interactiveObjectsData.size` → **194**
- `pickingSystem.getPickableObjects().length` → **1** (le personnage seul)

## Cause

Les portes, zaaps, ressources et éléments de décor interactifs sont décodés et
stockés, mais jamais enregistrés auprès du système de picking.

## Portée

Rien dans le monde n'est actionnable.
