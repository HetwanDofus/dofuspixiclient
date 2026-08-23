---
id: QA-049
title: Aucun retour visuel au survol d'une cellule
severity: P1
domain: world-render
type: gap
status: confirmed
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-025, QA-050]
files: []
---

## Symptôme

Survol d'une cellule marchable pendant 600 ms, capture de la zone avant/après :
**zéro pixel modifié**.

## Attendu (1.29)

Un losange bleu translucide sur la cellule survolée, et un changement de
curseur.

## Portée

Sans ce retour, on ne sait jamais où l'on va cliquer — c'est le manque
d'ergonomie le plus sensible en jeu, avec l'absence d'animation d'attente
(QA-025).
