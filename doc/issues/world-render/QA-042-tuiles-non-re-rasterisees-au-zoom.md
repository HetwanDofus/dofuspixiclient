---
id: QA-042
title: Le rendu des tuiles n'est pas re-rastérisé net au zoom fort
severity: P3
domain: world-render
type: bug
status: open
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-039, QA-041]
files: []
---

## Symptôme

À trois crans de zoom, les bords des feuilles et des troncs sont visiblement
interpolés.

## Attendu

Avec un pipeline vectoriel, le zoom devrait rester net.
