---
id: QA-043
title: Le mode tactique n'a aucun déclencheur dans l'interface
severity: P1
domain: fight
type: gap
status: confirmed
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-044, QA-058]
files: []
---

## Symptôme

`Battlefield.setTacticalMode()` est **entièrement implémenté** (tuiles `tactic_`
/ `cell_`, décor thématique, restauration à la sortie) et `tacticalModeStore`
existe. Appelé à la main depuis la console, le rendu obtenu est propre et fidèle
au 1.29 : cellules grises, obstacles en relief, décors conservés.

Mais **aucun `.tsx` n'appelle `setTacticalMode`** — grep sur tout `hud/` : zéro
occurrence.

## Attendu (1.29)

Un bouton de la barre de combat expose ce mode.

## Portée

C'est l'exemple type de la fonctionnalité **écrite et livrée morte**. Même
schéma que le chat latéral (QA-022) et les boutons utilitaires de la bannière
(QA-052). Le travail restant est un bouton, pas un moteur.
