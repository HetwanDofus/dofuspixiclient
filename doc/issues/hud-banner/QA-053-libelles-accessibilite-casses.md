---
id: QA-053
title: Libellés d'accessibilité cassés sur les boutons de menu
severity: P3
domain: hud-banner
type: bug
status: open
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-052]
files: []
---

## Symptôme

Les neuf boutons ronds exposent comme nom accessible la concaténation des
textes alternatifs de leurs deux images d'état : `"ButtonButton pressedStat"`,
`"ButtonButton pressedSpel"`, `"ButtonButton pressedInve"`…

Les trois boutons du coin chat sont eux nommés, mais en anglais
(`Expand chat`, `Open emotes`, `Sit down`).

## Attendu (1.29)

« Caractéristiques », « Sorts », « Inventaire »…
