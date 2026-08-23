---
id: QA-004
title: Badge « Connected » de debug en haut à droite
severity: P3
domain: hud-banner
type: bug
status: open
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-003, QA-046]
files: [apps/electrobun/src/window/mainview/MapRenderer.tsx:285]
---

## Symptôme

Pastille verte permanente hors de la zone de jeu.

## Attendu (1.29)

Le 1.29 n'affiche l'état réseau que sur perte de connexion.

## Correctif

Le correctif de [QA-046](../session/QA-046-session-zombie-apres-redemarrage-core.md)
a déjà rendu ce badge honnête — il lit désormais `connectionStore` en direct au
lieu d'un `useState` renseigné une seule fois au montage. Reste à décider s'il
doit s'afficher hors incident.
