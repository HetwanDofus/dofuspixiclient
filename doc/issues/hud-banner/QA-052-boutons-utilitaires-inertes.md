---
id: QA-052
title: Les quatre boutons utilitaires de la bannière sont inertes
severity: P2
domain: hud-banner
type: gap
status: confirmed
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-022, QA-051, QA-053]
files: []
---

## Symptôme

`Expand chat`, `Open emotes`, `Sit down` (coin haut-gauche) et le bouton `More`
(« + » orange à droite) : clic → `document.body.innerText` inchangé, aucun log,
aucune erreur.

## Attendu (1.29)

« S'asseoir » et le panneau d'émotes sont des fonctions 1.29 courantes.
