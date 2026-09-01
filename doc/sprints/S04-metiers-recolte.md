# Sprint 04 — Les métiers : le référentiel, prouvé par la récolte

**Objectif** — poser le référentiel des métiers que l'artisanat et la
forgemagie réutiliseront, et le faire porter par le flux le plus court :
apprendre un métier, équiper un outil, couper un arbre.

**Pourquoi maintenant** — le monde est posé depuis S01 et S02 : 9 358 cartes,
**16 523 cellules interactives dont 12 226 ressources**, et pas une seule n'est
récoltable. Le joueur n'a aujourd'hui qu'une source de revenus, le combat. Tant
que la récolte ne tourne pas, l'économie n'a qu'un robinet, l'hôtel de vente
livré en S03 n'a rien à vendre, et l'artisanat n'a pas d'ingrédients.

**Pourquoi la récolte d'abord** — c'est le seul flux métier à **un joueur, une
transaction, aucune fenêtre**. Il exerce tout le référentiel — import, XP,
niveau, pods, outil, état d'une occurrence, diffusion à la carte — sans le cas
dur de l'artisanat, qui est une session d'échange. Si le référentiel est bon,
la récolte est petite. Si la récolte est grosse, le référentiel est mauvais :
c'est le signal que ce sprint est fait pour donner.

**Fini quand** — le runbook en fin de document passe intégralement.

---

## Hors périmètre — explicitement

- **Tout l'artisanat** : QA-135 (l'atelier), QA-136 (cases, taux, expérience),
  QA-137 (la fenêtre). Ils ont chacun leur fiche et attendent ce sprint ; en
  faire entrer un seul ferait échouer les deux. Le référentiel importé ici
  contient déjà leurs 2 298 recettes et leurs 34 compétences de craft — c'est
  précisément ce qui rendra S05 petit.
- **La coopération et le livre des artisans** : QA-138, QA-139.
- **L'oubli d'un métier** (QA-140). La règle des trois slots est écrite et
  testée ici ; ce qui la relâche est le sprint d'après.
- **Le Chasseur** (QA-141). Sa donnée n'existe nulle part et il n'a pas d'objet
  interactif : ce n'est pas la même boucle.
- **La forgemagie et les métiers mage.** Les 15 compétences `f` sont importées,
  rien de plus. La règle des slots les compte déjà pour que le lot mage n'ait
  pas à revenir sur `jobs.service.ts`.
- **Les icônes de métier.** `clips/jobs/<g>.swf` n'a jamais été extrait ; le
  panneau utilise l'icône de la ressource-phare du métier.
- **La courbe d'XP du personnage.** `xpForLevel(n) = n² × 10` reste le bouchon
  qu'il est. `Experience.lua` porte aussi la vraie table `PlayerLevelExp` — une
  fiche à part, pas celle-ci.
- **La limitation de débit** (QA-064) et **le contrôle de distance** (QA-114).
  La récolte revalide sa propre proximité ; le reste du jeu en a toujours
  besoin, pas ce sprint.

---

## Lot A — Le référentiel (prérequis de tout)

En premier parce que rien au-dessus ne peut être écrit correctement tant que
les niveaux minimum et les gains d'expérience sont des constantes devinées.

| # | Issue | Ce qui change | Ordre de grandeur |
|---|---|---|---|
| A1 | [QA-129](../issues/progression/QA-129-referentiel-des-metiers-jamais-importe.md) | La migration 0057, `import-starloco-jobs.ts`, `just import-jobs` chaînée dans `import-world` | 2–3 jours |

**Le point d'attention du lot.** Trois valeurs n'existaient nulle part dans le
dépôt — la courbe d'XP métier, l'XP par ressource, le niveau minimum par
compétence — et ont été retrouvées dans les scripts Lua de StarLoco, que rien
ne consommait encore. Elles sont transcrites dans un fichier committé,
`apps/gameserver-ts/data/starloco-job-skills.json`, avec leur provenance. C'est
la seule façon de tenir l'exigence de QA-123 : *aucune constante silencieuse
dans le service d'exécution*.

**Leurs délais de réapparition ne sont pas repris.** Les scripts Lua portent
`{6000, 10000}` sous un `-- TODO: Fix respawn timers`. Les vraies valeurs
rétail sont déjà en base depuis QA-084, dans
`interactive_objects_templates.respawn_ms` : Frêne 300 s, Chêne 1 020 s, Orme
7 200 s. Prendre le Lua ici, ce serait remplacer une donnée juste par un
bouchon.

## Lot B — Le module métier

| # | Issue | Ce qui change | Ordre de grandeur |
|---|---|---|---|
| B1 | [QA-131](../issues/network/QA-131-protocole-des-metiers-sans-producteur.md) | `JobSkillEntry` réaligné sur le client décompilé, puis `JS`/`JX`/`JN`/`JR`/`OT` émis | 1 jour |
| B2 | [QA-133](../issues/progression/QA-133-pods-de-metier-non-comptes.md) | `jobPodsBonus` branché dans `maxPods` | ½ jour |
| B3 | [QA-130](../issues/world-content/QA-130-aucun-pnj-n-enseigne-de-metier.md) | La branche 6 du dialogue PNJ, et la règle des trois slots | 1 jour |

**B1 avant tout le reste du lot.** `JobSkillEntry` porte
`{level, min_slots, max_slots}` là où le fil porte `param1..param4`, et
**`param1` est le nombre de cases**, pas un niveau. Écrire l'émetteur contre la
mauvaise forme, c'est le réécrire — et c'est un bump majeur du contrat publié,
donc autant le faire une fois.

**B3 en dernier du lot** : c'est le seul point qui touche une tranche
existante, et il n'est prérequis que de la recette.

## Lot C — La boucle de récolte

| # | Issue | Ce qui change | Ordre de grandeur |
|---|---|---|---|
| C1 | [QA-132](../issues/network/QA-132-gdf-jamais-emis.md) | `GDF` émis et traité — l'état d'un objet interactif | 1 jour |
| C2 | [QA-123](../issues/progression/QA-123-boucle-de-recolte-inexistante.md) | `ACTION_HARVEST = 501`, `gatherable_cell_states`, `HarvestService`, la machine client | 3–4 jours |
| C3 | [QA-134](../issues/hud-panels/QA-134-pas-de-panneau-metiers.md) | Le panneau Métiers et le bouton de bannière | 1 jour |

**C1 avant C2, et C1 est le vrai livrable du sprint.** C2 est ce qu'on regarde
à l'écran ; C1 est ce qui rend une ressource *exclusive*. Sans état diffusé,
deux joueurs voient la même occurrence disponible et la boucle n'est pas une
boucle, c'est une animation.

**Ce que C2 ne doit pas faire** — inventer un contrôle de distance générique
(QA-114), une limitation de débit (QA-064), ou une consommation d'énergie. Le
1.29 n'en dépense pas à la récolte : l'énergie est une **condition**, pas un
coût, et le reste est une fiche à part.

**La réservation est un seul `UPDATE … RETURNING`.** C'est le même
raisonnement qu'en S02 : `GatewayFrameService.onFrame` appelle
`WsRouter.dispatch` sans `await`, deux trames du même client s'entrelacent
réellement, et rien au gateway ne les dédoublonne. Le double-clic est un cas de
test, pas une hypothèse.

---

## Runbook

À exécuter à la main, dans l'ordre, par quelqu'un qui n'a pas écrit le code.

### Préparation

```bash
git lfs pull && bun install
just wasm
just db
just import-world game.sql          # inclut désormais import-jobs
SPAWN_MAP_ID=7365 just db-seed
just dev
```

Se connecter (`dev` / `dev`), choisir le personnage.

---

### 1 · Le référentiel tient — A1

> Couvre QA-129.

```bash
just import-jobs game.sql
just import-jobs game.sql          # une seconde fois, exprès
docker exec dofuspixiclient-postgres-1 psql -U dofus -d dofus -tAc \
  "select (select count(*) from jobs),
          (select count(*) from job_skills),
          (select count(*) from job_skills where kind = 1),
          (select count(*) from job_tools),
          (select count(*) from recipes),
          (select count(*) from job_gatherable_cells);"
```

**Attendu** — les deux exécutions impriment le même décompte, ligne à ligne, et
la requête donne ~39 métiers, 147 compétences dont **57 de récolte**,
~2 298 recettes et ~12 226 cellules récoltables. Le script imprime ses comptes
par source, importé, rejeté et raison.

**Échec si** — le second passage change une seule ligne, ou si un rejet est
imprimé sans sa raison. Un import qui n'explique pas ce qu'il jette est un
import qu'on ne saura pas déboguer dans six mois.

**Le relevé qui compte autant** — le niveau minimum et l'XP d'une compétence
connue :

```bash
docker exec dofuspixiclient-postgres-1 psql -U dofus -d dofus -tAc \
  "select id, name, min_level, harvest_item_id, harvest_xp
     from job_skills where id in (6, 39, 10, 174, 158) order by min_level;"
```

Attendu : Frêne (6) niveau 1 XP 10, Châtaignier (39) niveau 10 XP 15, Chêne (10)
niveau 30 XP 25, Kaliptus (174) niveau **75** XP 55, Bambou sacré (158)
niveau 100 XP 75. Le Kaliptus est le cas qui distingue la bonne source de la
mauvaise : `item_template.level` le donne à 50.

---

### 2 · La courbe d'expérience — A1, B1

```bash
cd apps/gameserver-ts && bun test src/core/modules/jobs/
```

**Attendu** — le `.spec.ts` de `jobs.progression.constants.ts` assère les six
points de contrôle : niveau 10 → 1 911, 30 → 19 242, 60 → 100 421,
65 → 125 671, 80 → 240 964, 100 → **581 687**.

**Échec si** — un seul écart. La table est copiée, pas calculée ; un écart
signifie une transcription fautive et rien d'autre.

---

### 3 · Apprendre un métier — B3

> Couvre QA-130.

**Gestes** — aller voir un maître de métier, lancer le dialogue, choisir
« Apprendre le métier de … ». Les deux qui servent cette recette :
**Oli Venders [2,-21]** (Bûcheron) et **Chipo Atufe [9,-23]** (Mineur).

**Aucun des deux PNJ de l'atelier paysan ne convient**, et c'est le piège de
cette étape : Louse Degraine [5,-23] lance une quête (grisée à juste titre) et
Emia Elliesol [7,-25] mène à une bulle vide (QA-142). Le maître Paysan
joignable est **Farle Ingalsse [5,6]**. La liste complète est dans QA-130 ;
Alchimiste et Pêcheur n'en ont aucun.

**Attendu** — le panneau Métiers (bouton de bannière, QA-134) affiche le métier
au niveau 1, jauge à 0.

**Échec si** — le bouton de bannière ne fait rien. C'est son état actuel : il
est rendu, son icône existe, et il n'a pas d'`onClick`.

**Le cas à ne pas oublier** — apprendre trois métiers, puis en tenter un
quatrième. Il doit être refusé tant que les trois précédents ne sont pas au
niveau 30.

---

### 4 · Sans outil, rien — B1, C2

**Gestes** — sac vide de tout outil, cliquer un frêne.

Au passage, **un puits** : « Puiser » doit être actif sans aucun métier et sans
outil, et rendre de l'Eau en une seconde et demie. C'est la compétence de
`-Base-`, et elle ne suit aucune des règles de cette étape.

**Attendu** — le menu « Frêne » s'ouvre et « Couper » est **grisé**.

**Gestes** — équiper une Hache de Bûcheron (item 454), rouvrir le menu.

**Attendu** — « Couper » est actif. Déséquiper la hache : l'entrée redevient
grise, sans changer de carte ni rouvrir quoi que ce soit.

**Échec si** — l'entrée reste grise avec la hache équipée. La trame `OT` doit
partir à l'équipement, et le prédicat du client doit lire l'état métier reçu et
non une liste blanche de compétences en dur.

---

### 5 · Couper — C2

**Gestes** — cliquer « Couper » depuis l'autre bout de la carte.

**Attendu**, dans cet ordre : le personnage marche jusqu'à la cellule, une
action d'environ 12 secondes se joue, l'arbre change de frame, du Bois de Frêne
entre dans l'inventaire, la jauge du métier monte de 10.

**Échec si** — l'objet arrive avant la fin de l'action. Le client ne simule
jamais la réussite ; tout ce qui s'affiche vient d'une trame serveur.

**Le cas qui mesure la formule** — monter Bûcheron à un niveau nettement au-delà
de 1 (`bun run scripts/set-level.ts`, ou en récoltant) et recommencer : la
durée doit descendre de 100 ms par niveau d'écart, et la quantité monter d'un
palier tous les 5 niveaux d'écart.

---

### 6 · La ressource est exclusive — C1

> C'est la décision de conception du sprint, elle se recette explicitement.

**Préparation** — un second personnage sur la même carte :

```bash
cd dofus-bot-manager && bun run server
bun run cli spawn -u dev -p dev -c <second personnage> --json
```

**Gestes** — le premier coupe l'arbre, le second regarde.

**Attendu** — le second voit l'arbre changer de frame, ne peut plus le cliquer,
et le voit revenir à l'échéance.

**Échec si** — le second peut couper le même arbre. C'est ce que fait le dépôt
aujourd'hui : l'état d'un objet interactif n'existe pas, il est dérivé à la
volée d'une carte immuable.

---

### 7 · Le double-clic — C2

**Gestes** — double-cliquer aussi vite que possible sur le même arbre.
Recommencer cinq fois sur des arbres différents.

**Attendu** — une seule récolte par arbre. La quantité de bois obtenue ne
dépasse jamais celle d'une récolte.

**Échec si** — deux crédits, ou une réservation qui reste prise. Rien au
gateway ne dédoublonne les trames (QA-045, QA-064) et le routeur ne les
sérialise pas : les deux requêtes arrivent vraiment.

**La vérification en base**, après la manipulation :

```bash
docker exec dofuspixiclient-postgres-1 psql -U dofus -d dofus -tAc \
  "select map_id, cell_id, available_at, reserved_by, reserved_until
     from gatherable_cell_states where reserved_until > now();"
```

Aucune réservation ne doit survivre à la fin de son action.

---

### 8 · Les interruptions — C2

Quatre gestes, un par branche, tous pendant l'action :

1. cliquer ailleurs pour se déplacer ;
2. changer de carte ;
3. se faire agresser (ou lancer un combat) ;
4. fermer brutalement l'onglet (`bun run cli kill --id <bot_id> --json`).

**Attendu** — dans les quatre cas : aucune récompense, aucune expérience, et la
ressource redevient disponible immédiatement. Après le quatrième, se
reconnecter et récolter le même arbre doit marcher du premier coup.

**Échec si** — une récompense partielle tombe, ou la ressource reste
indisponible. Le verrou doit écouter la fermeture de session, comme le fait
déjà l'échange.

---

### 9 · Les pods — B2

> Couvre QA-133.

**Gestes** — relever les pods maximum dans la bannière, monter d'un niveau de
métier, les relever.

**Attendu** — exactement 5 pods de plus par niveau. Un métier 100 vaut 1 500.

**Échec si** — le total ne bouge qu'au prochain changement de carte. La trame de
statistiques doit être renvoyée après le passage de niveau.

---

### 10 · Survie au redémarrage — C1, C2

**Gestes** — récolter un arbre, puis, **pendant** son délai de réapparition :

```bash
docker restart dofuspixiclient-gamed-1
```

**Attendu** — l'arbre revient à l'instant qui était persisté, ni plus tôt, ni
jamais.

**Échec si** — il revient immédiatement (l'état n'était qu'en mémoire) ou plus
du tout (le réveil n'a pas été ré-armé au démarrage).

**La variante qui sert tous les jours** — refaire l'essai sous `just gamed` en
mode watch, en modifiant un fichier serveur.

---

### 11 · Non-régression avant clôture

1. Connexion, sélection de serveur, sélection de personnage.
2. Cinq changements de map enchaînés, aucune erreur console.
3. Un combat complet, gagné, avec butin **et** XP.
4. Équiper, déséquiper, utiliser une potion, poser un raccourci.
5. Banque : déposer, retirer. Échange entre joueurs. Hôtel de vente.
6. Une porte de maison, un zaap.
7. Déconnexion propre, reconnexion : inventaire, banque et métiers intacts.

Puis :

```bash
cd apps/gameserver-ts && bun test src/ && bun run test:integration && bun run typecheck && bun run lint
cd ../electrobun     && bun test && bun run check-types && bun run lint
cd ../..             && just issues-check
bun run --cwd packages/proto gen && git diff --exit-code packages/proto/gen
```

**Le sprint est clos** quand cette liste passe et que les dix étapes
précédentes sont vertes.

## À faire à la clôture

Passer QA-123, QA-129, QA-130, QA-131, QA-132, QA-133 et QA-134 en `fixed`,
renseigner leur `fixed_in`, puis `just issues`. Elles ne passent `closed`
qu'après avoir été rejouées manette en main — c'est ce que ce runbook permet de
franchir.

`@dofus/proto` prend un **bump majeur** : `JobSkillEntry` change de sémantique
(QA-131), et `doc/contracts.md` le classe comme tel.

Le sprint suivant est S05 — l'artisanat : QA-135 (l'atelier), QA-136 (cases,
taux, expérience) et QA-137 (la fenêtre). Ses 2 298 recettes et ses
34 compétences de craft sont déjà en base à la fin de celui-ci.
