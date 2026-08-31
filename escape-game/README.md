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

Aucun visuel, logo ou blason sous droit d'auteur n'est utilisé. Blasons, plan
de la salle, constellation, filigrane de château et texture sont générés par
du code, dans ce dépôt.

- **Icônes** : *Icons by game-icons.net* (Lorc), licence CC BY 3.0.
- **Polices** : Cinzel, Cinzel Decorative, EB Garamond, MedievalSharp —
  licence SIL Open Font License 1.1, via le dépôt Google Fonts.

Jeu amateur, sans lien avec les ayants droit des œuvres qui l'ont inspiré.
