---
id: QA-025
title: Les personnages n'ont aucune animation d'attente
severity: P1
domain: world-render
type: gap
status: confirmed
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-041, QA-049]
files: []
---

## Symptôme

Trois captures du canvas autour du sprite à 700 ms d'intervalle donnent des
pixels **strictement identiques** ; le compteur de l'overlay reste à `r:0`
(aucune frame rasterisée). Le personnage est figé sur une pose unique.

## Attendu (1.29)

`static<Direction>` joue en boucle en permanence — respiration, clignement.
C'est ce qui donne au monde son impression de vie.

## Portée

Avec QA-049, c'est l'absence la plus immédiatement visible manette en main :
elle se remarque dans les dix premières secondes.
