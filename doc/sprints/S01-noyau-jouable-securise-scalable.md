# Sprint 01 — Le noyau : jouable, sécurisé, scalable

**Objectif** — fermer la boucle de jeu autour du combat, puis rendre le serveur
défendable et redémarrable, avant d'engager le chantier des interfaces.

**Pourquoi maintenant** — le combat fonctionne mais ne rapporte rien et ne se
soigne pas : la partie s'arrête au bout de deux ou trois combats. Tant que la
boucle ne tourne pas, on ne peut ni jouer longtemps, ni tester à plusieurs, ni
juger de l'équilibrage. Et tout ce qu'on empilera par-dessus reposera sur un
serveur sans limitation de débit dont un redémarrage détruit les combats.

**Fini quand** — le runbook en fin de document passe intégralement.

---

## Hors périmètre — explicitement

Ces sujets sont réels et suivis ailleurs. Les faire entrer ici ferait échouer le
sprint.

- **Tout le câblage d'interface** — QA-037 et sa famille (Inventaire, Quêtes,
  Amis, Guilde, Monture, Conquête), QA-005, QA-025, QA-049. C'est le chantier
  d'après, celui que ce sprint doit rendre possible.
- **Le bouton du mode tactique** (QA-043) : c'est de l'interface.
- **La reprise d'un combat après reconnexion.** QA-069 s'arrête au combattant
  fantôme. Reprendre un combat suppose QA-066 livré *et* un client capable de
  rejoindre un combat en cours — un sprint à lui seul.
- **PNJ, échange entre joueurs, banque, maisons.** Tous dépendent de la création
  d'objets, qui n'apparaît ici que par le butin (QA-060).
- **Le PvP en duel.** Le gestionnaire existe, il n'a jamais été joué. À couvrir
  dans un sprint dédié, avec sa propre recette.

---

## Lot A — Fermer la boucle (jouable)

En premier parce que c'est le plus rentable et le moins risqué : trois des
quatre tâches sont du câblage de données déjà présentes en base.

| # | Issue | Ce qui change | Ordre de grandeur |
|---|---|---|---|
| A1 | [QA-059](../issues/fight/QA-059-aucun-xp-ni-kamas-en-fin-de-combat.md) | Trois champs de récompense traversent enfin `LiveMonsterMember` | ½ jour |
| A2 | [QA-063](../issues/progression/QA-063-aucune-regeneration-de-vie-hors-combat.md) + [QA-070](../issues/progression/QA-070-vie-jamais-persistee-apres-un-combat.md) | Les PV survivent au combat, puis se régénèrent depuis un horodatage | 1–2 jours |
| A3 | [QA-060](../issues/fight/QA-060-aucun-butin-d-objets-en-fin-de-combat.md) | Butin, et la **première insertion d'objet** du projet | 2–3 jours |
| A4 | [QA-061](../issues/fight/QA-061-glyphes-ne-touchent-que-la-case-centrale.md) + [QA-062](../issues/fight/QA-062-glyphes-et-pieges-degats-neutres.md) + [QA-071](../issues/fight/QA-071-glyphe-declenche-a-chaque-tour.md) → [QA-075](../issues/fight/QA-075-sort-declencheur-charge-au-niveau-1.md) | Zone, élément, fréquence et durée des glyphes et pièges | 2 jours |

**A1 avant A3** : la distribution d'XP et celle du butin doivent finir dans la
même transaction. Écrire A3 sur une distribution d'XP déjà correcte évite de
refaire la transaction deux fois.

**A2 avant A3** : sans régénération, on ne peut pas enchaîner assez de combats
pour observer un taux de drop. QA-070 y est entré en cours de route — instrumenter
QA-063 a montré que **rien n'écrivait `players.life`** : une régénération
branchée sur une colonne qui ne descend jamais n'a rien à régénérer, et les deux
défauts se recettent d'un même geste.

**A4 en dernier du lot** : c'est le seul point qui touche le moteur d'effets, et
il n'est prérequis de rien. Cinq défauts s'y sont ajoutés (QA-071 à QA-075),
tous découverts en instrumentant les deux premiers et tous logés dans le même
mécanisme d'effet enveloppe — les traiter ensemble coûte moins cher que de les
rouvrir un par un.

> **Le point d'attention du lot** — A3 ouvre le robinet des objets. C'est la
> première fois que le serveur écrit dans `player_items`. La méthode
> d'insertion créée ici resservira au marchand, à l'échange et à la banque : ce
> qu'on décide de sa signature et de sa transaction se paiera longtemps.

## Lot B — Rendre le serveur défendable (sécurisé)

En second parce que ces trois trous ne sont exploitables que par un client
modifié — donc sans conséquence tant que le jeu est privé, et bloquants dès
qu'il ne l'est plus.

| # | Issue | Ce qui change | Ordre de grandeur |
|---|---|---|---|
| B1 | [QA-064](../issues/server-runtime/QA-064-aucune-limitation-de-debit.md) | Compteur à jetons par session, au gateway | 2 jours |
| B2 | [QA-067](../issues/server-runtime/QA-067-cache-de-maps-sans-eviction.md) | Plafond et éviction sur le cache de maps | ½ jour |
| B3 | [QA-065](../issues/network/QA-065-vitesse-de-deplacement-non-verifiee.md) | Durée théorique du trajet vérifiée à l'accusé | 1–2 jours |
| B4 | [QA-069](../issues/fight/QA-069-combattant-fantome-a-la-deconnexion.md) | Le combat écoute la fermeture de session | 2 jours |

**B2 juste après B1** : le flood de données de map est précisément ce qui fait
enfler le cache. Les deux se recettent d'un même geste.

**Ne pas élargir B3.** Vérifier la durée, renvoyer la position réelle en cas de
rejet, et s'arrêter là. Fermer la session sur un écart serait un générateur de
faux positifs sous latence.

## Lot C — Tenir la charge et les redémarrages (scalable)

En dernier, et dans cet ordre précis.

| # | Issue | Ce qui change | Ordre de grandeur |
|---|---|---|---|
| C1 | [QA-068](../issues/network/QA-068-aucune-resynchronisation-d-etat-de-map.md) | Un message d'état complet de map, et ses trois déclencheurs | 2 jours |
| C2 | [QA-066](../issues/server-runtime/QA-066-combats-perdus-au-redemarrage-du-core.md) | Combats et groupes de monstres dans le transfert d'état | 4–5 jours |

**C1 avant C2** : la resynchronisation est l'outil de diagnostic de tout le
reste. Sans elle, on ne sait jamais si l'on regarde un bug ou une divergence
accumulée depuis dix minutes — ce qui rend C2 très difficile à recetter.

**C2 en dernier, et c'est délibéré.** C'est la seule tâche du sprint qui peut
déraper : un combat porte des fonctions de rappel qui ne se sérialisent pas, il
faut sérialiser l'état et reconstruire les rappels. Si elle glisse, elle ne doit
bloquer personne.

> **Le gain caché de C2** — `just gamed` tourne en mode watch : aujourd'hui,
> modifier un fichier pendant un test de combat annule le combat. C2 supprime ce
> frein quotidien. C'est un argument pour ne pas la reporter indéfiniment sous
> prétexte qu'elle est difficile.

---

# Runbook de recette — sprint 01

À exécuter à la main, dans l'ordre, sur une machine de développement. Chaque
étape dit ce qu'il faut faire, ce qu'on doit voir, et ce qui signe l'échec.

Compter environ **une heure et demie** pour la passe complète.

## 0 · Préparation

```bash
just db                          # postgres + migrations + compte dev/dev
just import-world game.sql       # une seule fois, si jamais fait
SPAWN_MAP_ID=7365 just db-seed   # Pious niveaux 1-5 — les combats les plus doux
just dev                         # tout dans un terminal, Ctrl-C tue tout
```

Ouvrir <http://localhost:5173> dans Chrome (WebGPU requis), se connecter avec
`dev` / `dev`, choisir Server #1 puis le personnage.

Garder sous la main un second terminal pour les requêtes :

```bash
just psql "select id, name, level, experience, kamas, life from players"
```

**Point de contrôle** — le personnage est sur la map 7365, des groupes de
monstres sont visibles, et la console du navigateur ne montre pas d'erreur.
Si les groupes manquent, relire QA-034 avant d'aller plus loin.

---

## 1 · Boucle de récompense — A1, A3

> Couvre QA-059 (XP et kamas) et QA-060 (butin).

**Avant** — noter l'état de départ :

```bash
just psql "select experience, kamas, life from players where name='Dev'"
just psql "select count(*) from player_items"
```

**Gestes** — cliquer un groupe de monstres, jouer le combat jusqu'à la victoire.

**Attendu**

- L'écran de fin de combat affiche une **XP et des kamas non nuls**, et le butin
  éventuel.
- Les logs serveur montrent `xp:` et `kamas:` supérieurs à zéro.
- En base, `experience` et `kamas` ont augmenté des mêmes montants que ceux
  affichés à l'écran.
- Sur plusieurs combats, `count(*) from player_items` finit par augmenter.

**Échec si** — l'écran de fin affiche `0` (le symptôme d'origine de QA-059), ou
si l'écran affiche un montant que la base ne reflète pas (transaction non
commitée).

**Le piège à vérifier** — enchaîner **cinq** combats. Le butin est tiré au sort :
un seul combat sans objet ne prouve rien, cinq combats sans aucun objet sur des
monstres à taux de drop élevé signent un bug.

**La vérification qui compte vraiment** — perdre volontairement un combat
(laisser le timer passer les tours jusqu'à la mort). Ni XP, ni kamas, ni butin ne
doivent être accordés, et la base ne doit pas bouger.

---

## 2 · Régénération — A2

> Couvre QA-063 (régénération) et QA-070 (les PV en base).

**Le relevé qui compte d'abord** — avant toute question de régénération,
vérifier que les dégâts arrivent seulement jusqu'à la base :

```bash
just psql "select name, life, life_updated_at from players"
```

Sortir d'un combat en ayant pris des coups, relire. Si `life` n'a pas bougé,
QA-070 n'est pas corrigé et rien de ce qui suit n'a de sens à tester.

**Avant** — sortir d'un combat avec des PV manquants, et relever :

```bash
just psql "select life from players where name='Dev'"
```

Le maximum de PV n'est **pas** une colonne : il est dérivé du niveau et de la
vitalité par `maxLifePoints()` (`stats.service.ts`). Pour le lire, ouvrir le
panneau Caractéristiques en jeu.

**Gestes**

1. Attendre trois à cinq minutes en jeu, en se déplaçant normalement.
2. Ouvrir le panneau Caractéristiques (`C`) et lire les PV.
3. **Puis** se déconnecter, attendre trois minutes, se reconnecter.

**Attendu** — les PV remontent régulièrement dans les deux cas. Le second cas
est le plus important : la régénération hors ligne prouve que le calcul dérive
bien d'un horodatage et non d'une minuterie en mémoire.

**Échec si** — les PV ne bougent qu'avec le client ouvert. C'est le signe d'une
implémentation par minuterie, explicitement écartée dans QA-063 : elle ne passe
pas l'échelle et se perd au redémarrage du core.

**À vérifier aussi** — les PV ne dépassent **jamais** le maximum, y compris après
une très longue absence. Laisser le personnage déconnecté une nuit est le test
le plus simple.

---

## 3 · Glyphes — A4

> Couvre QA-061 (zone) et QA-062 (élément et effet).

**Préparation** — il faut un Féca avec un sort de glyphe. Le compte de
développement démarre avec trois sorts de classe ; si le personnage n'est pas
Féca ou n'a pas de glyphe, créer un personnage adapté en base
(voir [data-seeding.md](../data-seeding.md)).

**Gestes**

1. Engager un combat contre un groupe d'au moins trois monstres.
2. Poser un glyphe de façon que des ennemis se trouvent **sur la couronne** de
   la zone, et non sur la case centrale.
3. Passer le tour et observer le début du tour suivant.

**Attendu**

- Tout ennemi **dans la zone dessinée** subit les dégâts — pas seulement celui
  qui est au centre. C'est le cœur de QA-061.
- Le disque dessiné à l'écran et la zone qui blesse **coïncident exactement**.
- Les dégâts sont de l'**élément du sort déclencheur** : un Glyphe Enflammé fait
  des dégâts Feu, visibles dans le flottant de dégâts et sensibles aux
  résistances Feu de la cible.
- Les montants sont cohérents avec la fiche du sort.

**Échec si** — seul l'ennemi de la case centrale est touché (QA-061 non corrigé),
ou si les dégâts sont neutres ou absurdement hors de la plage annoncée
(QA-062 non corrigé : le calcul lit l'identifiant du sort déclencheur au lieu
d'une plage de dégâts).

**Ne pas oublier les pièges.** Ils ont le même défaut d'élément **et** le même
défaut de zone (QA-074), corrigés au même endroit. Poser un piège, faire passer
un monstre **sur le bord** de la zone sans toucher le centre, vérifier qu'il se
déclenche et dans quel élément.

**Deux relevés de plus, ajoutés avec QA-073 et QA-075.**

- Poser un glyphe de durée 3 dans un combat à au moins trois combattants et
  **compter les rounds** jusqu'à sa disparition : trois rounds, pas trois tours.
  Vérifier au passage que le disque **disparaît de l'écran** au moment où il
  cesse d'agir (QA-072) — une zone qu'on voit et qui ne fait plus rien est pire
  que pas de zone du tout.
- Monter le sort de glyphe à un rang élevé et comparer les dégâts à la fiche du
  sort : ils suivaient auparavant le rang 1 quel que soit le rang lancé.

---

## 4 · Vitesse de déplacement — B3

> Couvre QA-065.

**Gestes** — depuis la console du navigateur, envoyer l'accusé de réception de
déplacement immédiatement après avoir cliqué une case lointaine, sans attendre
la fin de l'animation. Autre méthode, plus simple : cliquer une case à l'autre
bout de la map, puis cliquer aussitôt une autre case lointaine, en boucle rapide.

**Attendu** — le serveur refuse l'accusé arrivé trop tôt, journalise le rejet, et
le personnage se retrouve **repositionné là où le serveur le croit**.

**Échec si** — le personnage traverse la map instantanément, ou si la session est
fermée. Fermer sur un écart de vitesse est un faux positif garanti sous latence,
et QA-065 l'écarte explicitement.

**La vérification de non-régression, obligatoire** — jouer normalement pendant
deux minutes : marche, course, longs trajets, changements de map. **Aucun rejet
ne doit apparaître dans les logs.** Un seul faux positif ici est plus grave que
le speedhack qu'on corrige.

---

## 5 · Limitation de débit — B1, B2

> Couvre QA-064 (débit) et QA-067 (cache de maps).

**Gestes** — depuis la console du navigateur, envoyer en boucle serrée des
demandes de données de map (quelques milliers).

**Attendu**

- La session dépassant le plafond est fermée avec un **code applicatif dédié**,
  distinct de 4001 (`core_gone`) et 4002 (`account_taken_over`).
- Les **autres sessions ne sont pas affectées** : un second client connecté en
  parallèle continue de jouer sans à-coup.
- La mémoire du core **se stabilise** au lieu de croître indéfiniment : c'est
  QA-067 qui se recette ici, le flood de maps étant justement ce qui remplit le
  cache.

**Échec si** — le flood ralentit ou fige les autres joueurs. Le core est
mono-processus et partagé : c'est exactement le scénario que QA-064 doit rendre
impossible.

**Le cas à ne pas oublier** — refaire le même flood **avant de s'authentifier**.
Le plafond doit s'appliquer aussi là ; sinon il suffit d'ouvrir des sockets sans
compte pour saturer le serveur.

**La non-régression** — jouer normalement cinq minutes, dont un combat entier
avec beaucoup de sorts. Aucune fermeture ne doit survenir. Un plafond trop serré
se voit d'abord en combat, où les trames partent en rafale.

---

## 6 · Déconnexion en combat — B4

> Couvre QA-069.

**Préparation** — le gestionnaire de bots est l'outil adapté :

```bash
cd dofus-bot-manager
bun run server
bun run cli spawn -u dev -p dev -c Dev --json
bun run cli list --json
```

**Gestes**

1. Engager un combat avec un client (le navigateur ou un bot).
2. Pendant le combat, couper brutalement ce client :
   `bun run cli kill --id <bot_id> --json`, ou fermer l'onglet.

**Attendu**

- Après un court délai de grâce, le combattant passe en **mode automatique** et
  le combat **continue et se termine normalement**.
- Le combat disparaît du registre à la fin.

**Échec si** — le combat reste bloqué, ou si le combattant coupé continue
d'occuper un tour sans jamais jouer. C'est le symptôme exact de QA-069 : le
timer fait bien passer le tour, mais rien ne sort le combattant du combat.

**Ce qu'on ne teste pas ici** — se reconnecter et reprendre le combat. C'est hors
périmètre du sprint, et c'est normal que ça ne marche pas.

---

## 7 · Deux clients — C1

> Couvre QA-068 et vérifie la cohérence multijoueur générale.

**Préparation** — deux personnages distincts sur la même map. Le navigateur pour
l'un, un bot pour l'autre.

**Gestes**

1. Vérifier que chacun voit l'autre, au bon endroit.
2. Déplacer l'un : l'autre doit voir le mouvement en temps réel.
3. **Provoquer une divergence** : mettre l'onglet du navigateur en arrière-plan,
   déplacer le bot plusieurs fois, puis revenir sur l'onglet.

**Attendu** — au retour de visibilité de l'onglet, la position du bot se
**réaligne toute seule**. C'est le déclencheur central de QA-068.

**Échec si** — le bot reste affiché à son ancienne position, ou apparaît en
double. Sans resynchronisation, cette divergence est **définitive** : rien dans
le protocole ne la corrigera jamais.

**Le second cas, tout aussi important** — faire quitter la map au bot pendant que
l'onglet est en arrière-plan. Au retour, il ne doit plus être affiché du tout.
Un joueur fantôme qui reste à l'écran est le symptôme le plus courant du
problème.

---

## 8 · Survie au redémarrage — C2

> Couvre QA-066. La dernière étape, et la plus exigeante.

**Gestes**

1. Engager un combat et le mener jusqu'au deuxième ou troisième tour, avec des
   PV entamés, des buffs actifs et **un glyphe posé** — c'est le cas difficile,
   celui des fonctions de rappel.
2. Redémarrer le core : `docker restart dofuspixiclient-gamed-1`.

**Attendu**

- Le combat **survit**. Les combattants, leurs PV, leurs PA et PM, les buffs en
  cours, le glyphe posé et le tour courant sont tous restaurés.
- Le joueur peut reprendre son tour et terminer le combat.
- Les groupes de monstres de la map sont toujours aux mêmes cases.

**Échec si** — le combat disparaît, ou s'il revient amputé : buffs perdus, glyphe
disparu, tour remis à zéro. Le glyphe est le meilleur détecteur, parce que c'est
le morceau d'état qui ne se sérialise pas naïvement.

**La vérification qui sert tous les jours** — refaire l'essai en mode watch :
lancer `just gamed`, engager un combat, modifier un fichier serveur pour
provoquer un rechargement. Le combat doit survivre. C'est le bénéfice quotidien
de C2, et le signe le plus fiable qu'il est vraiment fini.

---

## 9 · Non-régression avant clôture

Une dernière passe complète, sans instrumentation ni console :

1. Connexion, sélection de serveur, sélection de personnage.
2. Cinq changements de map enchaînés — aucune erreur console, aucune requête en
   échec.
3. Un zaap emprunté.
4. Un combat complet, gagné, avec récompense.
5. Régénération constatée après le combat.
6. Déconnexion propre, reconnexion, le personnage est là où on l'a laissé.

Puis, en ligne de commande :

```bash
cd apps/gameserver-ts && bun test src/ && bun run test:integration && bun run typecheck && bun run lint
cd ../electrobun     && bun test && bun run check-types && bun run lint
cd ../..             && just issues-check
```

**Le sprint est clos** quand cette liste passe et que les neuf étapes précédentes
sont vertes.

## À faire à la clôture

Passer les issues du sprint en `fixed`, renseigner leur `fixed_in`, puis
`just issues`. Une issue ne passe `closed` qu'après avoir été rejouée manette en
main — c'est la distinction que porte le suivi, et ce runbook est précisément
l'instrument qui permet de la franchir.
