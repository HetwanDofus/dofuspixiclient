---
id: QA-001
title: Écran de login générique, hors charte 1.29 et non traduit
severity: P2
domain: auth
type: bug
status: open
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-002]
files: [apps/electrobun/src/window/mainview/auth/]
---

## Symptôme

Le login est un formulaire Tailwind sombre « Sign in / Username / Password »
sur fond dégradé gris. Ces trois libellés sont les seuls en anglais de tout le
parcours d'entrée — le reste du client est intégralement en français
(lingui + bundles `langs/fr`).

## Attendu (1.29)

Un écran de connexion illustré, avec le logo.
