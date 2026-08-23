---
id: QA-027
title: Menu contextuel en anglais et non conforme
severity: P2
domain: input
type: bug
status: open
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-038, QA-035]
files: []
---

## Symptôme

Clic droit sur son propre personnage → menu à trois lignes : `Dev` (titre),
`Slap`, `Organize my shop`.

Les deux actions sont en anglais et ne correspondent à rien du 1.29 : « Slap »
(gifler) n'est pas une action du jeu, et l'organisation de boutique n'apparaît
que sur un personnage en mode marchand.

## Attendu (1.29)

Sur un autre joueur : message privé, ajouter en ami / ennemi, inviter dans le
groupe, duel, échange, profil. Toutes absentes.
