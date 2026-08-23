---
id: QA-010
title: Le personnage n'a aucun sort
severity: P1
domain: hud-panels
type: gap
status: open
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-036, QA-037, QA-007]
files: [apps/electrobun/src/hud/panels/SpellsPanel.tsx]
---

## Symptôme

Panneau Sorts (`S`) : liste vide, `Points de boost : 0`.

## Attendu (1.29)

Tout personnage démarre avec les sorts de base de sa classe dès le niveau 1.

## Cause

Le panneau ne s'abonne à aucun store (QA-037) — les sorts arrivent pourtant
bien dans `spellsStore`. Depuis QA-036 le carnet côté serveur contient les
trois sorts de départ corrects.

## Portée

Sans sort affiché ni lançable, le combat se limite au corps à corps : cela
bloque le test de tout le runtime de sorts.
