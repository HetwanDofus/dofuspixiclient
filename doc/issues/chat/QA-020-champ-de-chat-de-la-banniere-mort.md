---
id: QA-020
title: Le champ de chat de la bannière n'est branché à rien
severity: P1
domain: chat
type: gap
status: confirmed
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-021, QA-022]
files: [apps/electrobun/src/hud/banner/BannerReact.tsx:387]
---

## Symptôme

`BannerReact.tsx:387` passe uniquement un `placeholder` à
`MainBannerChatInput`. Inspection des props React de l'élément en session :
`type, className, placeholder` — pas de `value`, `onChange`, `onKeyDown` ni
`onSubmit`.

On peut taper « bonjour le monde » et appuyer sur Entrée : le texte reste dans
le champ, rien n'est envoyé, rien n'apparaît dans le log, aucune trame ne part.
La zone de log de la bannière au-dessus reste vide en toutes circonstances.

## Dépendance

À traiter avec QA-021 : il faut d'abord décider lequel des deux chats est le
chat du jeu.
