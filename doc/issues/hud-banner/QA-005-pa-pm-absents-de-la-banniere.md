---
id: QA-005
title: PA / PM absents de la bannière
severity: P1
domain: hud-banner
type: gap
status: open
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-006, QA-018]
files: []
---

## Symptôme

La bannière n'affiche que le cœur de vie (`55`). C'est l'une des quatre
absences qui se remarquent dans les dix premières secondes de jeu.

## Attendu (1.29)

Les points d'action et de mouvement encadrent le cœur, visibles en permanence
y compris hors combat.

## Cause

Les valeurs existent pourtant côté client — le panneau Caractéristiques
affiche bien `PA 6 / PM 3`. C'est du câblage, pas de la donnée manquante.
