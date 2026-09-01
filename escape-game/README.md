# La Retenue Interdite — escape game imprimable

Jeu de cartes PDF pour un escape game maison, thème « école de sorcellerie
britannique ». 4 joueurs, 30–45 minutes, une seule pièce. Usage strictement
privé et non commercial.

## Génération

```bash
pip install weasyprint numpy pillow
python build_assets.py   # polices + icônes + texture parchemin
python render.py         # -> Cartes_Joueurs.pdf et Guide_Animateur.pdf
```

`build_assets.py` récupère les polices et les icônes par **clone git partiel**
des dépôts officiels (`google/fonts`, `game-icons/icons`), avec repli sur un
téléchargement HTTP direct. Les fichiers déjà présents dans `assets/` ne sont
pas re-téléchargés. La texture de parchemin est **générée par code**
(numpy + PIL), jamais téléchargée.

## Fichiers

| Fichier | Rôle |
|---|---|
| `build_assets.py` | Récupère les polices/icônes, génère la texture |
| `build_html.py` | Construit le HTML — une fonction par carte |
| `render.py` | WeasyPrint : HTML → PDF |
| `Cartes_Joueurs.pdf` | 12 cartes A4, une par page |
| `Guide_Animateur.pdf` | 4 pages : matériel, installation, solutions |

## Le jeu

Quatre énigmes indépendantes donnent chacune un chiffre ; les quatre chiffres,
dans l'ordre des épreuves, forment le code d'un cadenas.
**Les solutions sont dans le guide animateur** — à ne pas laisser traîner.

## Contenu graphique

Aucun visuel, logo ou blason sous droit d'auteur n'est utilisé.

Les quatre écus portent des **meubles héraldiques ordinaires** — lion,
blaireau, aigle, serpent — qui relèvent du vocabulaire héraldique commun et
non d'une œuvre protégée. Le cadre, le plan de la salle, la constellation, le
filigrane de château et la texture de parchemin sont **générés par le code de
ce dépôt**.

### Sources externes

| Source | Licence | Usage |
|---|---|---|
| [google/fonts](https://github.com/google/fonts) | OFL 1.1 | Cinzel, Cinzel Decorative, EB Garamond, MedievalSharp |
| [game-icons/icons](https://github.com/game-icons/icons) | CC BY 3.0 | Meubles héraldiques et icônes (Lorc, Delapouite) |
| [WelshPixie/vintageart](https://github.com/WelshPixie/vintageart) | CC0 1.0 | Lettrines gravées, filets, rosaces (gravures XIXᵉ, domaine public) |

Attribution requise par CC BY, portée dans le guide animateur :
*Icons by game-icons.net*.

## Mettre vos propres visuels Harry Potter

Le jeu accepte vos images sans toucher au code. Déposez-les dans
`assets/perso/` puis relancez `python render.py` :

| Fichier | Remplace |
|---|---|
| `blason-gryffondor.*` … `blason-serpentard.*` | les écus de la carte 4 |
| `filigrane.*` | le fond du certificat (carte 12) |

Extensions acceptées : `.svg .png .jpg .jpeg .webp .gif`. Les maisons sans
fichier gardent l'écu héraldique généré — vous pouvez donc n'en remplacer
qu'une partie.

**Inutile de renommer vos téléchargements** : il suffit que le nom du fichier
contienne celui de la maison, en français ou en anglais, casse et ponctuation
indifférentes. `Gryffindor-crest-vector-01.png` ou `Ravenclaw_Crest_HQ.png`
sont reconnus tels quels. `render.py` affiche au démarrage ce qu'il a trouvé.
Détail dans `assets/perso/LISEZ-MOI.txt`.

**Ce dossier est exclu du dépôt Git**, volontairement. Un visuel sous droit
d'auteur utilisé chez soi pour une partie entre amis relève de l'usage privé ;
le même fichier poussé sur un dépôt public devient une publication, ce qui est
une autre affaire. Le mécanisme est versionné, vos images restent chez vous.

### Où les trouver

La licence qu'il vous faut n'est pas « libre de droits » mais **usage
personnel** — et celle-là est courante. Les banques de SVG Harry Potter
(Vecteezy, Free SVG Download, The Navage Patch, Happiness is Homemade)
distribuent leurs fichiers en *personal use only* : redistribution et usage
commercial interdits, usage privé et scolaire autorisés. C'est exactement le
cadre d'une partie entre amis.

Le téléchargement se fait depuis votre navigateur : le proxy réseau de
l'environnement de build bloque tous les hôtes sauf GitHub — y compris les
sites officiels (`wizardingworld.com`, `harrypotter.com`, `warnerbros.com`),
vérifié. Ces derniers ne distribuent de toute façon pas leurs blasons comme
ressources téléchargeables, et leurs conditions d'utilisation en interdisent
l'extraction.

### Pourquoi le dépôt lui-même n'en contient aucune

Une recherche a été menée spécifiquement sur les ressources HP dites libres,
créations de fans comprises. Conclusion : **il n'en existe pas de réellement
libres**.

- Les banques de « SVG Harry Potter gratuits » (blasons de Poudlard, Reliques
  de la Mort, silhouettes) sont en *personal use only* — pas une licence libre.
- Les projets de fans sur GitHub affichant une licence MIT ne libèrent que le
  **code de leur auteur**. Vérification faite sur
  [Hogwarts-OS](https://github.com/nishantharkut/Hogwarts-OS) : son dossier
  d'assets contient un Vif d'or dérivé du design Warner et une texture de
  papier de 22 Mo sans provenance. Un fichier `LICENSE` ne peut pas concéder
  des droits que son auteur n'a jamais détenus.
- Une œuvre de fan reste une œuvre dérivée : son auteur ne peut pas la placer
  valablement sous CC0 ou CC BY.

D'où le parti pris retenu : le **registre visuel** (héraldique, gravure
victorienne, grimoire) plutôt que les **actifs de la franchise**.
