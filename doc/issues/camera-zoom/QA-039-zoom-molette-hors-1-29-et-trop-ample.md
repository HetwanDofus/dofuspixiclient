---
id: QA-039
title: Le zoom molette n'existe pas dans le 1.29 et va beaucoup trop loin
severity: P2
domain: camera-zoom
type: bug
status: open
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-040, QA-041, QA-042]
files: [apps/electrobun/src/game/constants/battlefield.ts:41]
---

## Symptôme

`ZOOM_LEVELS = [1,2,3,4,5]`. Trois crans de molette suffisent à remplir l'écran
avec deux buissons.

## Attendu (1.29)

Aucun zoom : la vue est fixe.

## Décision à prendre

Si le zoom est un ajout assumé, l'amplitude doit être réduite (1 → 2 au
maximum) ; sinon il faut le retirer. QA-040, QA-041 et QA-042 dépendent tous
les trois de cet arbitrage.
