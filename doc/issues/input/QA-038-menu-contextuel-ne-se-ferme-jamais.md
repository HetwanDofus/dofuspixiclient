---
id: QA-038
title: Le menu contextuel ne se ferme jamais
severity: P2
domain: input
type: bug
status: open
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-027]
files: []
---

## Symptôme

Ouvert par clic droit sur le personnage, il reste affiché à travers `Échap`,
l'ouverture d'autres panneaux et un changement de map.

Relevé encore présent dans `document.body.innerText` (« Dev Slap Organize my
shop ») plusieurs interactions après son ouverture.
