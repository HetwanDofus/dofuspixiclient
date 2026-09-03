---
id: QA-148
title: L'outil équipé n'apparaît jamais dans la main du personnage
severity: P2
domain: world-render
type: bug
status: fixed
session: 7
opened: 2026-09-03
closed:
fixed_in:
related: [QA-143, QA-147, QA-149]
files:
  - tools/assets-exporter/src/Command/ExtractSpriteMetadataCommand.php
  - apps/electrobun/public/assets/spritesheets/sprites/80.dofasset
---

## Symptôme

Avec `dev2` (Iop paysan, Faux du Paysan équipée), l'animation de fauchage se
joue mais les mains restent vides : la faux n'apparaît à aucune frame.

Le défaut n'est pas propre à la faux ni au métier. Aucune des 24 planches de
classe publiées ne portait d'ancrage d'accessoire `slot 0` — l'emplacement
arme — dans aucune de ses 124 animations, alors que le SWF en déclare 32 :
`anim10R`..`anim17R`, `anim111R`..`anim117R`, `emote6R` et leurs miroirs `L`,
c'est-à-dire exactement les poses d'outil. Aucun personnage n'a donc jamais
montré d'arme ni d'outil, pour aucune classe.

## Attendu (1.29)

`GAC.applyAccessory(this, 0, "R")` place l'arme sur la main, à la profondeur
de la pose. Les cinq emplacements de la chaîne d'apparence sont, dans l'ordre,
`arme, chapeau, cape, familier, bouclier` — soit les slots `0..4`, et le
client se sert du numéro pour choisir quoi accrocher où.

## Cause

`ExtractSpriteMetadataCommand::parseGacCalls` cherchait le slot avec
`is_int($v) && $v >= 0 && $v <= 10` sur la pile d'`ActionPush`.

`ActionPush` est typé, et Flash publie la même constante en Integer (type 7)
ou en Double (type 6) selon la façon dont il a compilé la frame. Le `0` de
l'arme est un **Double** dans les 24 SWF de classe, donc `is_int` le
rejetait ; la boucle continuait et retenait l'entier suivant de la pile —
`argCount`, le nombre d'arguments de l'appel. Chaque ancrage d'arme était
donc publié en `slot 3` (le familier), et le `slot 0` n'existait nulle part.

Relevé sur `80.swf`, `anim17R`, profondeur 89 :

```
pile   ["R", 0, "this", 3, "GAC", "applyAccessory"]
types  ["string", "double", "string", "integer", "string", "string"]
lu     slot 3   ← argCount
```

## Correctif

Accepter tout nombre entier de valeur (`is_int` ou `is_float` sans partie
décimale) dans la plage 0-10. Les slots déjà corrects ne bougent pas : dans
chaque pile observée le slot précède `argCount`, donc « premier entier » et
« premier nombre » désignent la même valeur partout ailleurs.

Les 24 planches de classe ont été ré-extraites et recompilées.

## Vérification

```bash
just pipeline-run sprites 80 && bun tools/asset-pipeline/src/cli.ts compile sprites --id 80
```

`80.dofasset` porte le `slot 0` dans 32 animations, dont `anim17R` :

```
slot 0: 32 anims  e.g. ['anim10L', 'anim10R', 'anim111L', ...]
anim17R frame 0 [(2, 1, 'R'), (4, 8, 'L'), (1, 15, 'R'), (0, 16, 'R'), (3, 20, 'R')]
```

À rejouer en jeu : `dev2/dev2`, faux équipée, faucher un champ — la faux doit
être en main pendant toute l'animation.
