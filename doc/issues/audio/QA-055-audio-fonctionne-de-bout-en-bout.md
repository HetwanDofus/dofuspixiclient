---
id: QA-055
title: L'audio fonctionne de bout en bout
severity: none
domain: audio
type: check
status: closed
session: 1
opened: 2026-08-20
closed: 2026-08-20
fixed_in:
related: [QA-056]
files: []
---

## Vérification

C'est une des parties les mieux finies du client. Vérifié en instrumentant le
constructeur `Audio` et l'`AudioManager` :

- `playMusic(115)` crée `/assets/sound/musics/loc_amakna.mp3`, `play()` réussit,
  volume `0.225` en cours de fondu vers `0.3`, position `2,9 s` — la piste joue
  réellement ;
- l'ambiance tourne aussi : les bruits aléatoires de l'ambiance 7 (`fx_512`,
  `fx_511`, `fx_510`) sont créés et joués, conformément à son entrée
  `n:[487,488,510,511,512,513]` ;
- le bundle `langs/fr/audio.json` résout correctement (`115 → loc_amakna.mp3`,
  `118 → loc_cania.mp3`) et la base porte bien les ids (7 061 maps avec musique,
  7 505 avec ambiance) ;
- aucun échec de lecture, aucun fichier manquant.

**RAS.** Voir [audio.md](../../audio.md). Le seul manque est l'absence de
réglage dans l'interface, QA-056.

## Piège de méthode

J'ai d'abord conclu à tort que rien ne jouait, sur la foi d'un
`document.querySelectorAll("audio")` vide — or `new Audio(url)` ne crée aucun
élément dans le DOM. Il faut **instrumenter le constructeur `Audio`, et
l'installer avant le premier chargement de map.**
