---
id: QA-016
title: « All types » en anglais dans le panneau Inventaire
severity: P3
domain: hud-panels
type: bug
status: fixed
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-023, QA-028]
files: [apps/electrobun/src/hud/inventory/BagPanel.tsx]
---

## Symptôme

Seule chaîne non traduite du panneau ; tout le reste (« Équipement »,
« Aucun objet sélectionné », « Kamas », « Pods ») est en français.

## Correctif

Le panneau ressources a été réécrit (`BagPanel.tsx`) ; le sélecteur de type
affiche « Tous types » et liste les types réellement présents dans le sac,
via `TypeSelect.tsx`.

## Vérification

Testé à la main dans le client web le 2026-08-23.
