---
id: QA-080
title: Le recadrage de l'extracteur coupe tout dessin miroir ou pivoté hors de son viewBox
severity: P1
domain: world-render
type: bug
status: fixed
session: 5
opened: 2026-08-23
closed: 2026-08-23
fixed_in:
related: [QA-078]
files:
  - tools/assets-exporter/src/Command/ExtractItemsCommand.php
  - tools/assets-exporter/src/Command/ExtractStaticCommand.php
  - tools/assets-exporter/src/Command/ExtractAccessoriesCommand.php
  - scripts/recrop-svg-viewbox.ts
  - apps/electrobun/public/assets/items
---

## Symptôme

Le Chienchien (template 1711) n'apparaissait ni dans la grille du sac ni
dans la fiche d'objet : cellule vide, aucune erreur console. Le fichier
existe pourtant (`assets/items/18/6.svg`, 14 525 octets) et le serveur de
dev le renvoie en 200.

Mesuré dans le navigateur sur le `<g>` racine du SVG :

```
viewBox = 33.9 3.0 40.0 49.3      → x visible 33.9 … 73.9
getBBox = -0.11 4.95 → 35.93 50.20 → x du dessin -0.1 … 35.9
```

Le chien est entièrement à gauche du cadre ; il n'en reste qu'un liseré de
1,9 unité sur 36. L'audit de tout `assets/items` donne **995 SVG sur
6 705 (15 %)** dont une partie du dessin tombe hors du viewBox, dont 583
amputés de plus de la moitié et 10 totalement invisibles.

## Cause

`ExtractItemsCommand::cropSvgToContent` — dupliqué à l'identique dans
`ExtractStaticCommand` et `ExtractAccessoriesCommand` — déduit l'emprise de
chaque `<use>` de la *norme* de sa matrice :

```php
$scaleX = sqrt($a * $a + $b * $b);   // toujours positif
$sw = $w * $scaleX;
$minX = min($minX, $tx, $tx + $sw);  // croît vers la droite depuis tx
```

C'est juste tant que la matrice ne fait ni miroir ni rotation. Ankama place
massivement les symboles en miroir (`a < 0`) plutôt que d'en dessiner un
second : un tel placement s'étend vers la *gauche* depuis `tx`, la boîte
était donc calculée du mauvais côté de l'origine et le recadrage jetait le
dessin. C'est exactement l'écart constaté : sur tous les fichiers touchés,
`viewBox.x` vaut `bbox.xMax - 2`, soit `tx` moins la marge de 2 unités.

Second défaut au même endroit : `$maxX = PHP_FLOAT_MIN` initialise le
maximum au plus petit flottant **positif** (~2,2e-308) et non au plus
négatif ; un dessin entièrement en coordonnées négatives n'aurait jamais
fait bouger le maximum.

## Correctif

Les trois commandes transforment maintenant les quatre coins de la boîte
propre du symbole (`(0,0,w,h)`) par la matrice complète, et partent de
`-PHP_FLOAT_MAX`. Une ré-extraction est donc correcte — mais elle demande
les SWF retail, absents du dépôt, alors que les SVG *publiés* y sont. Le
même calcul corrigé est donc appliqué directement aux sorties par
`scripts/recrop-svg-viewbox.ts` (`bunx just recrop-svg`, `--check` pour ne
que signaler) : il ne réécrit que la balise `<svg>`, laisse le corps intact,
ne touche pas un fichier dont le viewBox contient déjà son dessin, et est
idempotent.

Le script calcule la boîte analytiquement plutôt qu'en rendant le SVG :
l'extracteur normalise chaque groupe de `<defs>` pour que sa propre boîte
soit `(0,0,width,height)` — les `width`/`height` portés par le `<use>` — ce
qui rend les quatre coins suffisants. Vérifié contre le `getBBox()` du
navigateur sur 50 icônes tirées au sort : la boîte analytique n'est jamais
plus petite que la vraie, et jamais plus grande que d'environ 1,6 unité.

## Vérification

```bash
bunx just recrop-svg --check    # 0 à réécrire, sinon sortie 1
```

995 fichiers réécrits le 2026-08-23, chacun d'une seule ligne (la balise
`<svg>`). Contrôlé dans le navigateur sur les 15 pires cas (35/420, 55/728,
6/24, 19/47, 16/127, 111/2, 59/8, 4/62, 4/67, 16/252, 6/23, 90/62, 111/203,
51/9, 50/101) : tous dessinent maintenant leur objet entier. Le Chienchien
s'affiche dans le sac et dans la fiche.

## Reste à faire

Seul `assets/items` a été recadré. `ExtractStaticCommand` et
`ExtractAccessoriesCommand` partageaient le même bug, donc leurs sorties
publiées sont probablement touchées aussi — le script accepte d'autres
racines en argument (`bunx just recrop-svg <dir>`), mais l'audit et le
contrôle visuel n'ont pas été faits sur ces catégories dans cette passe.
