#!/usr/bin/env python3
"""Genere le HTML des cartes joueurs et du guide animateur.

Une fonction par carte, toutes construites sur les memes primitives
(`page`, `card`, `icon`, `svg_*`) pour garder un rendu coherent.
"""

import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# Palette, dupliquee en Python car les SVG en ligne ne voient pas le CSS.
ENCRE, BX, OR, PARCHEMIN = "#2a1a0d", "#6b1420", "#a6812c", "#efe3c4"
ASSETS = ROOT / "assets"

# --------------------------------------------------------------------------
# Contenu du jeu : "La Retenue Interdite"
# --------------------------------------------------------------------------

MAISONS = [
    # (maison, prénom du fondateur, nom du fondateur, accent, meuble heraldique)
    ("Gryffondor", "Godric", "Gryffondor", "bordeaux", "lion"),
    ("Poufsouffle", "Helga", "Poufsouffle", "or", "blaireau"),
    ("Serdaigle", "Rowena", "Serdaigle", "nuit", "aigle"),
    ("Serpentard", "Salazar", "Serpentard", "vert", "serpent"),
]

INGREDIENTS = ["Poudre de Lune", "Racine de Mandragore", "Écaille de Dragon", "Plume de Phénix"]

INDICES_CHAUDRON = [
    "La Poudre de Lune est versée en tout premier.",
    "L'Écaille de Dragon est versée juste après la Racine de Mandragore.",
    "La Plume de Phénix n'est jamais versée avant l'Écaille de Dragon.",
    "La Racine de Mandragore n'est pas le dernier ingrédient.",
]

MESSAGE_CHIFFRE = "OH PRW HVW VHSW"
MESSAGE_CLAIR = "LE MOT EST SEPT"

# Les 4 chiffres, dans l'ordre d'assemblage.
SOLUTIONS = [
    ("Les Blasons", "Poufsouffle est 2e dans l'ordre alphabétique des prénoms", 2),
    ("Le Chaudron", "La Plume de Phénix est le 4e ingrédient", 4),
    ("Le Sortilège", "VHSW se déchiffre en SEPT", 7),
    ("Les Astres", "La constellation compte 8 étoiles", 8),
]
CODE_FINAL = "".join(str(s[2]) for s in SOLUTIONS)

# Constellation : 8 étoiles + le trace qui les relie (coordonnees en % du cadre).
ETOILES = [(12, 52), (26, 26), (41, 43), (50, 14), (63, 36), (72, 62), (85, 23), (91, 51)]
TRACE = [(0, 1), (1, 2), (2, 3), (3, 4), (4, 5), (4, 6), (6, 7)]


# --------------------------------------------------------------------------
# Primitives de mise en page
# --------------------------------------------------------------------------

# --------------------------------------------------------------------------
# Visuels personnels (dossier assets/perso/, hors depot)
# --------------------------------------------------------------------------

PERSO = ASSETS / "perso"
PERSO_EXTS = (".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif")

# Synonymes acceptes pour chaque emplacement : on reconnait aussi bien les noms
# francais qu'anglais, pour ne pas avoir a renommer un fichier telecharge.
PERSO_ALIAS = {
    "blason-gryffondor": ("gryffondor", "gryffindor"),
    "blason-poufsouffle": ("poufsouffle", "hufflepuff"),
    "blason-serdaigle": ("serdaigle", "ravenclaw"),
    "blason-serpentard": ("serpentard", "slytherin"),
    "filigrane": ("filigrane", "watermark", "hogwarts", "poudlard"),
}


def _normalise(nom: str) -> str:
    """Minuscules sans accents ni separateurs, pour comparer des noms de fichiers."""
    table = str.maketrans("aaaeeeeiioouuuc", "aaaeeeeiioouuuc")
    nom = unicodedata.normalize("NFD", nom.lower())
    nom = "".join(c for c in nom if unicodedata.category(c) != "Mn").translate(table)
    return re.sub(r"[^a-z0-9]+", "", nom)


def perso(nom: str):
    """Cherche un visuel personnel pour l'emplacement `nom`.

    On accepte trois formes, de la plus stricte a la plus souple : le nom exact,
    un synonyme connu, ou n'importe quel fichier dont le nom *contient* le
    synonyme. La derniere permet de deposer un fichier telecharge sans le
    renommer (« Gryffindor-crest-vector-01.png » est reconnu tel quel).
    """
    if not PERSO.is_dir():
        return None
    fichiers = [f for f in sorted(PERSO.iterdir())
                if f.is_file() and f.suffix.lower() in PERSO_EXTS]
    for f in fichiers:                                   # nom exact
        if _normalise(f.stem) == _normalise(nom):
            return f
    cles = PERSO_ALIAS.get(nom, (nom,))
    for exact in (True, False):                          # synonyme, puis inclusion
        for f in fichiers:
            base = _normalise(f.stem)
            for cle in cles:
                k = _normalise(cle)
                if (base == k) if exact else (k in base):
                    return f
    return None


def perso_img(nom: str, *, width: str, cls: str = ""):
    """Balise <img> vers un visuel personnel, ou None s'il n'y en a pas."""
    f = perso(nom)
    if f is None:
        return None
    rel = f.relative_to(ROOT).as_posix()
    return f'<img class="{cls}" src="{rel}" style="width:{width};height:auto" alt="">'


def _icon_svg(name: str) -> str:
    path = ASSETS / "icons" / f"{name}.svg"
    return path.read_text(encoding="utf-8") if path.exists() else ""


def icon(name: str, color: str = "currentColor", size: str = "1em") -> str:
    """Insere une icone game-icons.net en ligne.

    WeasyPrint n'applique pas le CSS du document aux SVG en ligne : la couleur
    et la taille doivent donc être posées en attributs sur le <svg>.
    """
    svg = _icon_svg(name)
    if not svg:
        return ""
    svg = svg.replace('fill="currentColor"', f'fill="{color}"')
    svg = svg.replace("<svg ", f'<svg width="{size}" height="{size}" ', 1)
    return f'<span class="icon">{svg}</span>'


def icon_inner(name: str, color: str) -> str:
    """Contenu d'une icone sans sa balise <svg>, pour l'imbriquer ailleurs.

    Les icones game-icons ont toutes un viewBox 0 0 512 512 : l'appelant peut
    donc les placer avec un simple translate/scale.
    """
    svg = _icon_svg(name)
    if not svg:
        return ""
    inner = re.sub(r"^<svg[^>]*>|</svg>$", "", svg.strip())
    return inner.replace('fill="currentColor"', f'fill="{color}"')


def _vintage_svg(name: str):
    """Renvoie (viewBox, contenu) d'un ornement grave, ou None s'il manque."""
    path = ASSETS / "vintage" / f"{name}.svg"
    if not path.exists():
        return None
    raw = path.read_text(encoding="utf-8")
    m = re.search(r'viewBox="([^"]+)"', raw)
    if not m:
        return None
    inner = re.sub(r"^.*?<svg[^>]*>", "", raw, flags=re.S)
    inner = re.sub(r"</svg>\s*$", "", inner, flags=re.S)
    return m.group(1), inner


def vintage(name: str, color: str, width: str, *, height: str = "", cls: str = "") -> str:
    """Insere un ornement CC0 du depot vintageart, recolore.

    La couleur est injectee dans le SVG : WeasyPrint n'applique pas le CSS du
    document a l'interieur d'un SVG en ligne.
    """
    got = _vintage_svg(name)
    if not got:
        return ""
    vb, inner = got
    h = f' height="{height}"' if height else ""
    return (f'<svg class="{cls}" viewBox="{vb}" width="{width}"{h}'
            f' preserveAspectRatio="xMidYMid meet">'
            f'{inner.replace("fill:currentColor", f"fill:{color}")}</svg>')


def drop_cap(letter: str, color: str) -> str:
    """Lettrine gravee flottant a gauche du premier paragraphe."""
    got = _vintage_svg(f"initiale-{letter}")
    if not got:
        return ""
    vb, inner = got
    # Le flottement est pose en style inline : une regle de classe se fait
    # ignorer sur un SVG remplace dans certains contextes WeasyPrint.
    return (f'<svg viewBox="{vb}" width="17mm" height="17mm"'
            f' style="float:left;width:17mm;height:17mm;margin:1mm 3mm 0.5mm 0">'
            f'{inner.replace("fill:currentColor", f"fill:{color}")}</svg>')


def svg_corner(flip_x: bool = False, flip_y: bool = False) -> str:
    """Coin ornemental : double filet, volute fuselee et losange.

    La volute est tracee en trois segments de largeur decroissante, ce qui
    imite le fuselage d'un trait a la plume. La symetrie des quatre coins est
    obtenue en inversant les axes dans le SVG lui-meme (WeasyPrint applique mal
    un transform CSS sur un bloc absolu).
    """
    sx, tx = (-1, 124) if flip_x else (1, 0)
    sy, ty = (-1, 124) if flip_y else (1, 0)
    segs = [
        ("M35 13 C 53 13 62 27 62 42", 1.50),
        ("M62 42 C 62 53 55 60 45 60 C 37 60 32 55 32 47", 1.17),
        ("M32 47 C 32 41 36 36 42 36 C 46 36 49 39 50 42", 0.83),
    ]
    scroll = "".join(
        f'<path d="{d}" fill="none" stroke="{OR}" stroke-width="{w:.2f}"'
        f' stroke-linecap="round"/>' for d, w in segs
    )
    return f"""<svg viewBox="0 0 124 124" width="34mm" height="34mm">
  <g transform="translate({tx},{ty}) scale({sx},{sy})">
    <path d="M6 124 V32 Q6 6 32 6 H124" fill="none" stroke="{OR}" stroke-width="1.6"/>
    <path d="M13 124 V35 Q13 13 35 13 H124" fill="none" stroke="{BX}" stroke-width="0.8"/>
    {scroll}
    <path d="M20 20 l6 -6 6 6 -6 6 Z" fill="{OR}"/>
    <circle cx="50" cy="46" r="1.9" fill="{BX}"/>
  </g>
</svg>"""


def svg_fleuron(color: str = OR, width: str = "40mm") -> str:
    """Filet de separation termine par un fleuron a trois lobes."""
    return f"""<svg viewBox="0 0 200 24" width="{width}" class="fleuron">
  <line x1="4" y1="12" x2="78" y2="12" stroke="{color}" stroke-width="1"/>
  <line x1="122" y1="12" x2="196" y2="12" stroke="{color}" stroke-width="1"/>
  <path d="M100 3 C 108 9 112 12 118 12 C 112 12 108 15 100 21
           C 92 15 88 12 82 12 C 88 12 92 9 100 3 Z" fill="{color}"/>
  <circle cx="100" cy="12" r="2.6" fill="{color}"/>
  <circle cx="72" cy="12" r="1.5" fill="{color}"/>
  <circle cx="128" cy="12" r="1.5" fill="{color}"/>
</svg>"""


def svg_shield(beast, accent_hex, *, width=132):
    """Blason : ecu heraldique portant une bete du bestiaire libre.

    Le lion, le blaireau, l'aigle et le serpent sont des meubles heraldiques
    ordinaires : rien d'emprunte a une oeuvre protegee.
    """
    return f"""<svg viewBox="0 0 120 150" width="{width}" style="max-width:100%">
  <path d="M60 6 L110 23 V76 C110 108 88 130 60 142 C32 130 10 108 10 76 V23 Z"
        fill="{accent_hex}"/>
  <path d="M60 6 L110 23 V76 C110 108 88 130 60 142 C32 130 10 108 10 76 V23 Z"
        fill="none" stroke="{OR}" stroke-width="3.2"/>
  <path d="M60 15 L103 29 V76 C103 103 84 122 60 133 C36 122 17 103 17 76 V29 Z"
        fill="none" stroke="#f2e6c8" stroke-width="1" opacity="0.45"/>
  <g transform="translate(27,40) scale(0.129)">{icon_inner(beast, "#f4e9cd")}</g>
</svg>"""


# Le coin ornemental fait 34 mm pour un viewBox de 124 unites : un trait pose
# a `u` unites du bord tombe donc a u * 34/124 mm. On s'en sert pour aligner au
# millimetre les filets de raccord sur ceux des coins.
_U = 34.0 / 124.0
_GOLD_W, _BX_W = 1.6 * _U, 0.8 * _U          # epaisseurs des deux filets
_GOLD_C, _BX_C = 6 * _U, 13 * _U             # position de leur axe

FRAME_RULES = "".join(
    f'<div class="fr {orient} {side} {tone}" style="{side}:{off:.3f}mm"></div>'
    for orient, sides in (("h", ("top", "bottom")), ("v", ("left", "right")))
    for side in sides
    for tone, off in (("gold", _GOLD_C - _GOLD_W / 2), ("bx", _BX_C - _BX_W / 2))
)


def divider_for(accent: str) -> str:
    """Filet grave sous le titre, avec repli sur le fleuron trace en code."""
    return (vintage("filet", ACCENT_HEX[accent], "52mm", cls="filet")
            or svg_fleuron(ACCENT_HEX[accent]))


def card(title, subtitle, body, *, kicker="", footer="", accent="bordeaux",
         head_icon="", extra=""):
    """Cadre commun a toutes les cartes : coins ornementes relies par des filets."""
    head = (f'<div class="card-icon">{icon(head_icon, ACCENT_HEX[accent], "16mm")}</div>'
            if head_icon else "")
    kick = f'<div class="kicker">{kicker}</div>' if kicker else ""
    sub = f'<div class="subtitle">{subtitle}</div>' if subtitle else ""
    foot = f'<div class="footer">{footer}</div>' if footer else ""
    corners = (
        f'<div class="corner tl">{svg_corner()}</div>'
        f'<div class="corner tr">{svg_corner(flip_x=True)}</div>'
        f'<div class="corner bl">{svg_corner(flip_y=True)}</div>'
        f'<div class="corner br">{svg_corner(flip_x=True, flip_y=True)}</div>'
        + FRAME_RULES
    )
    return f"""<section class="page">
  <div class="card accent-{accent} {extra}">
    {corners}
    <header class="card-head">
      {head}
      {kick}
      <h1>{title}</h1>
      {sub}
      <div class="rule">{divider_for(accent)}</div>
    </header>
    <div class="card-body">{body}</div>
    {foot}
  </div>
</section>"""


def svg_room_map():
    """Plan de la salle : formes géométriques simples + 4 emplacements numérotés."""
    spots = [(95, 112), (250, 72), (310, 235), (110, 235)]
    lbl = 'font-family="MedievalSharp" font-size="12" fill="#57402a"'
    furn = 'fill="#e2d3ad" stroke="#6b1420" stroke-width="1.4"'
    dashes = "".join(
        f'<line x1="{spots[i][0]}" y1="{spots[i][1]}" x2="{spots[i + 1][0]}"'
        f' y2="{spots[i + 1][1]}" stroke="#6b1420" stroke-width="1.2"'
        f' stroke-dasharray="5 5" opacity="0.6"/>'
        for i in range(len(spots) - 1)
    )
    marks = "".join(
        f'<circle cx="{x}" cy="{y}" r="17" fill="#6b1420"/>'
        f'<text x="{x}" y="{y + 6}" text-anchor="middle" fill="#f0e3c4"'
        f' font-family="Cinzel" font-size="17">{i + 1}</text>'
        for i, (x, y) in enumerate(spots)
    )
    return f"""<svg viewBox="0 0 400 300" width="100%">
  <rect x="20" y="20" width="360" height="260" fill="none" stroke="#2a1a0d" stroke-width="3"/>
  <rect x="28" y="28" width="344" height="244" fill="none" stroke="#a6812c" stroke-width="1"/>
  <path d="M20 200 v60" stroke="#efe3c4" stroke-width="6"/>
  <path d="M20 200 a60 60 0 0 1 60 60" fill="none" stroke="#2a1a0d" stroke-width="1.4"/>
  <text x="34" y="190" {lbl}>Porte</text>
  <path d="M150 20 h100" stroke="#24354f" stroke-width="5"/>
  <text x="200" y="46" text-anchor="middle" {lbl}>Fenêtre</text>
  <rect x="330" y="70" width="42" height="110" {furn}/>
  <line x1="330" y1="107" x2="372" y2="107" stroke="#6b1420" stroke-width="0.9"/>
  <line x1="330" y1="144" x2="372" y2="144" stroke="#6b1420" stroke-width="0.9"/>
  <text x="351" y="196" text-anchor="middle" {lbl}>Étagère</text>
  <rect x="60" y="34" width="70" height="30" {furn}/>
  <text x="95" y="82" text-anchor="middle" {lbl}>Tableau</text>
  <rect x="160" y="140" width="80" height="40" {furn}/>
  <text x="200" y="198" text-anchor="middle" {lbl}>Bureau</text>
  {dashes}{marks}
</svg>"""


def svg_constellation():
    lines = "".join(
        f'<line x1="{ETOILES[a][0]}" y1="{ETOILES[a][1]}"'
        f' x2="{ETOILES[b][0]}" y2="{ETOILES[b][1]}"'
        f' stroke="#a6812c" stroke-width="0.4" opacity="0.85"/>'
        for a, b in TRACE
    )
    stars = "".join(
        f'<circle cx="{x}" cy="{y}" r="2.4" fill="#f4e9cd"/>'
        f'<path fill="#f4e9cd" d="M{x} {y - 6.5} L{x + 1.5} {y - 1.5} L{x + 6.5} {y} '
        f'L{x + 1.5} {y + 1.5} L{x} {y + 6.5} L{x - 1.5} {y + 1.5} '
        f'L{x - 6.5} {y} L{x - 1.5} {y - 1.5} Z"/>'
        for x, y in ETOILES
    )
    return f"""<svg viewBox="0 0 100 74" width="86%">
  <rect x="0" y="0" width="100" height="74" fill="#24354f"/>
  {lines}{stars}
</svg>"""


def svg_castle_watermark():
    """Silhouette de chateau en filigrane, composee de rectangles et de fleches.

    Sert de fond au certificat : elle reste tres claire pour ne pas gener
    l'ecriture par-dessus.
    """
    parts = []
    for x, w, h, roof in ((18, 30, 96, False), (56, 24, 138, True), (88, 52, 78, False),
                          (150, 30, 168, True), (192, 52, 78, False), (254, 24, 138, True),
                          (288, 30, 96, False)):
        top = 218 - h
        parts.append(f'<rect x="{x}" y="{top}" width="{w}" height="{h}"/>')
        mw = w / 5.0                                     # 3 merlons par tour
        for i in range(3):
            parts.append(f'<rect x="{x + i * 2 * mw:.1f}" y="{top - 8}"'
                         f' width="{mw:.1f}" height="8"/>')
        if roof:
            parts.append(f'<path d="M{x - 6} {top - 8} L{x + w / 2:.0f} {top - 46}'
                         f' L{x + w + 6} {top - 8} Z"/>')
    parts.append('<rect x="0" y="196" width="336" height="22"/>')
    return f"""<svg viewBox="0 0 336 230" width="128mm" class="watermark">
  <g fill="{BX}" opacity="0.07">{"".join(parts)}</g>
</svg>"""


def cut_line(text="découper suivant les pointillés"):
    return f'<div class="cut">{icon("quill-ink")}<span>{text}</span></div>'


# --------------------------------------------------------------------------
# Feuille de style
# --------------------------------------------------------------------------

CSS = """
@page { size: A4; margin: 0; }

@font-face { font-family: "Cinzel"; src: url("assets/fonts/Cinzel.ttf"); }
@font-face { font-family: "Cinzel Decorative"; src: url("assets/fonts/CinzelDecorative-Bold.ttf");
             font-weight: 700; }
@font-face { font-family: "MedievalSharp"; src: url("assets/fonts/MedievalSharp.ttf"); }
@font-face { font-family: "EB Garamond"; src: url("assets/fonts/EBGaramond.ttf"); }
@font-face { font-family: "EB Garamond"; src: url("assets/fonts/EBGaramond-Italic.ttf");
             font-style: italic; }

:root {
  --encre: #2a1a0d;
  --bordeaux: #6b1420;
  --or: #a6812c;
  --vert: #3d5240;
  --nuit: #24354f;
  --parchemin: #efe3c4;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  color: var(--encre);
  font-family: "EB Garamond", Georgia, serif;
  font-size: 12.5pt;
  line-height: 1.5;
}

.page {
  width: 210mm; height: 297mm;
  page-break-after: always;
  padding: 12mm;
  background-image: url("assets/textures/parchment.jpg");
  background-size: cover;
}
.page:last-child { page-break-after: auto; }

/* --- cadre de carte : double bordure fine + points dores aux coins --- */
.card {
  position: relative;
  height: 100%;
  padding: 15mm 16mm 10mm;
}
/* Les quatre coins ornementes dessinent le cadre a eux seuls : les filets
   des coins se prolongent jusqu'au bord et se rejoignent. */
.corner { position: absolute; width: 34mm; height: 34mm; }
.corner.tl { top: 0; left: 0; }
.corner.tr { top: 0; right: 0; }
.corner.bl { bottom: 0; left: 0; }
.corner.br { bottom: 0; right: 0; }
/* Filets reliant les coins entre eux (positions calculees en Python). */
.fr { position: absolute; }
.fr.h { left: 34mm; right: 34mm; height: 0; }
.fr.v { top: 34mm; bottom: 34mm; width: 0; }
.fr.h.gold { border-top: 0.439mm solid var(--or); }
.fr.h.bx   { border-top: 0.219mm solid var(--bordeaux); }
.fr.v.gold { border-left: 0.439mm solid var(--or); }
.fr.v.bx   { border-left: 0.219mm solid var(--bordeaux); }

.accent-bordeaux { --accent: var(--bordeaux); }
.accent-or       { --accent: var(--or); }
.accent-vert     { --accent: var(--vert); }
.accent-nuit     { --accent: var(--nuit); }

/* --- en-tete --- */
.card-head { text-align: center; }
.card-icon { color: var(--accent); margin-bottom: 2mm; line-height: 0; }
.card-icon .icon svg { width: 16mm; height: 16mm; }
.icon { display: inline-block; line-height: 0; }
.icon svg { width: 1em; height: 1em; fill: currentColor; }

.kicker {
  font-family: "MedievalSharp", serif;
  font-size: 10pt; letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--accent);
}
h1 {
  font-family: "Cinzel Decorative", serif; font-weight: 700;
  font-size: 25pt; line-height: 1.12; margin: 2mm 0 0;
  color: var(--accent);
}
.subtitle {
  font-family: "EB Garamond", serif; font-style: italic;
  font-size: 13pt; margin-top: 2mm; color: #4a3320;
}
.rule { margin: 4mm 0 0; line-height: 0; }
.fleuron { display: inline-block; }

.card-body { padding-top: 6mm; min-height: 172mm; }

/* Lettrine gravee : un ::first-letter flottant fait planter WeasyPrint, mais
   un vrai element flottant passe sans probleme. */
.dropcap {
  float: left; width: 17mm; height: 17mm;
  margin: 1mm 3mm 0.5mm 0;
}
.drop { text-indent: 0; }
.drop::after { content: ""; display: block; clear: both; }
.filet { display: inline-block; }
.card-body p { margin: 0 0 4mm; }
/* Pied dans le flux : en absolu il se faisait recouvrir par les cartes
   denses. La hauteur minimale du corps le maintient en bas des cartes aerees. */
.footer {
  margin-top: 6mm;
  font-family: "MedievalSharp", serif; font-size: 9.5pt;
  text-align: center; color: #6d5836; padding-top: 4mm;
  border-top: 0.5pt solid rgba(166, 129, 44, 0.5);
}

/* --- briques de contenu --- */
h2 {
  font-family: "Cinzel", serif; font-size: 12pt; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--accent);
  margin: 0 0 3mm; text-align: center;
}
.lead { font-size: 13.5pt; text-align: justify; }
.box {
  border: 0.7pt solid rgba(166, 129, 44, 0.75);
  background: rgba(255, 252, 242, 0.5);
  padding: 5.5mm 7mm; margin: 5mm 0;
  position: relative;
}
/* Petit losange dore centre sur le filet superieur de l'encadre. */
.box::before {
  content: ""; position: absolute; top: -1.5mm; left: 50%; margin-left: -1.5mm;
  width: 3mm; height: 3mm; background: var(--or); transform: rotate(45deg);
}
.box.plain::before { display: none; }
.box.tight { padding: 4mm 6mm; }
ol, ul { margin: 0; padding-left: 6mm; }
li { margin-bottom: 2.5mm; }
.center { text-align: center; }
.small { font-size: 11pt; }
.mono-answer {
  font-family: "Cinzel", serif; font-size: 13pt; letter-spacing: 0.06em;
  text-align: center; margin-top: 4mm;
}
.answer-box {
  display: inline-block; min-width: 16mm; padding: 2mm 4mm;
  border-bottom: 1.2pt solid var(--encre); margin-left: 3mm;
}

.grid-2 { display: flex; flex-wrap: wrap; gap: 5mm; }
.grid-2 > * { width: calc(50% - 2.5mm); }

.shields { display: flex; justify-content: space-between; gap: 4mm; margin: 6mm 0; }

.cutouts { display: flex; flex-wrap: wrap; gap: 6mm; justify-content: center; }
.cutout {
  width: calc(50% - 3mm); padding: 6mm; text-align: center;
  border: 0.9pt dashed rgba(42, 26, 13, 0.6);
}
.cutout h3 {
  font-family: "Cinzel Decorative", serif; font-size: 14pt;
  margin: 3mm 0 1mm; color: var(--accent);
}
.cutout .sub { font-style: italic; font-size: 11pt; color: #57402a; }
.cut {
  font-family: "MedievalSharp", serif; font-size: 9.5pt; color: #6d5836;
  text-align: center; margin-top: 5mm;
}
.cut .icon svg { width: 4mm; height: 4mm; vertical-align: -0.5mm; margin-right: 2mm; }

table { width: 100%; border-collapse: collapse; }
th, td { padding: 2.2mm 2mm; text-align: left; vertical-align: top; }
th {
  font-family: "Cinzel", serif; font-size: 10pt; text-transform: uppercase;
  letter-spacing: 0.08em; color: var(--accent);
  border-bottom: 0.7pt solid var(--or);
}
td { border-bottom: 0.4pt solid rgba(166, 129, 44, 0.35); }
.cipher-table td, .cipher-table th {
  text-align: center; padding: 1.6mm 0; font-family: "Cinzel", serif; font-size: 10.5pt;
}
.cipher-table tr.clair td { color: var(--bordeaux); }

.cipher {
  font-family: "Cinzel", serif; font-size: 22pt; letter-spacing: 0.3em;
  text-align: center; color: var(--bordeaux); margin: 6mm 0;
}
.slots {
  text-align: center; font-family: "Cinzel", serif; font-size: 14pt;
  letter-spacing: 0.34em; color: #7a6440; white-space: nowrap;
}

/* --- certificat --- */
.cert-wrap { position: relative; height: 100%; }
.watermark {
  position: absolute; left: 50%; top: 52%; width: 128mm;
  margin-left: -64mm; margin-top: -44mm;
}
.cert-content { position: relative; }
.signatures { display: flex; flex-wrap: wrap; gap: 7mm; margin-top: 8mm; }
.sig { width: calc(50% - 3.5mm); }
.sig .line { border-bottom: 0.7pt solid var(--encre); height: 13mm; }
.sig .cap { font-family: "MedievalSharp", serif; font-size: 10pt;
            color: #6d5836; padding-top: 1.5mm; }
/* Mise en page resserree : utilisee par la carte d'indices, dense par nature. */
.compact .card-body { padding-top: 3mm; min-height: 0; }
.compact .box { padding: 3mm 6mm; margin: 2.8mm 0; }
.compact h2 { font-size: 10.5pt; margin-bottom: 1.6mm; }
.compact li { margin-bottom: 1.1mm; }
.compact .lead { font-size: 11pt; margin-bottom: 2mm; }

/* Cases du cadenas. */
/* Visuels personnels deposes dans assets/perso/. */
.blason-perso { display: block; margin: 0 auto; }
.perso-wm { opacity: 0.10; }

.slots-boxes { text-align: center; margin: 5mm 0 4mm; }
.slots-boxes span {
  display: inline-block; width: 14mm; height: 18mm; margin: 0 3mm;
  border: 0.8pt solid var(--or);
  background: rgba(255, 253, 245, 0.5);
}

.code-final {
  font-family: "Cinzel Decorative", serif; font-weight: 700;
  font-size: 40pt; letter-spacing: 0.16em; text-align: center;
  color: var(--bordeaux); margin: 4mm 0;
}

/* --- guide animateur --- */
.guide .page { padding: 16mm 18mm; }
.guide .sheet { height: 100%; position: relative; padding-bottom: 16mm; }
.guide h1 { font-size: 21pt; text-align: center; }
.guide h2 { text-align: left; margin-top: 7mm; }
.guide .lead { font-size: 12.5pt; }
.credits { font-size: 10pt; color: #57402a; }
"""


# --------------------------------------------------------------------------
# Cartes joueurs
# --------------------------------------------------------------------------

def carte_briefing():
    body = f"""
<p class="lead drop">{drop_cap("V", ACCENT_HEX["bordeaux"])}ous êtes quatre. Vous avez été pris à fabriquer une potion
non autorisée dans les cachots. La sanction est tombée&nbsp;: <em>retenue</em>.</p>
<p class="lead">Le concierge vous a enfermés dans une salle de classe
désaffectée et a emporté la clé. Il reviendra dans <strong>quarante
minutes</strong>. Sur la porte, un cadenas a <strong>quatre chiffres</strong>.</p>
<div class="box">
  <h2>Votre mission</h2>
  <ul>
    <li>Quatre énigmes sont dissimulées dans la pièce. Chacune révèle
        <strong>un chiffre</strong>.</li>
    <li>Assemblez les quatre chiffres dans l'ordre des énigmes pour obtenir
        la combinaison du cadenas.</li>
    <li>Ouvrez la porte avant le retour du concierge.</li>
  </ul>
</div>
<div class="box tight center small">
  <strong>Règles de la retenue</strong><br>
  Rien n'est cache sous les meubles &mdash; inutile de démonter la salle.<br>
  Aucune force n'est requise&nbsp;: tout se résout par la lecture et la déduction.<br>
  Trois indices de secours peuvent être demandés au surveillant. Ils coûtent
  chacun deux minutes.
</div>
<p class="center" style="margin-top:6mm">
  {icon("padlock")} &nbsp;<strong>Durée&nbsp;: 40 minutes &mdash; 4 joueurs</strong>
</p>"""
    return card("La Retenue Interdite", "Ordre de retenue &mdash; à lire à voix haute",
                body, kicker="Briefing", head_icon="owl", accent="bordeaux",
                footer="Carte 1 &mdash; à distribuer au démarrage du chronomètre")


def carte_plan():
    body = f"""
<p class="lead drop">{drop_cap("L", ACCENT_HEX["nuit"])}e plan de la salle, relevé par un élève avant vous. Quatre
emplacements ont été marqués. Explorez-les dans l'ordre.</p>
<div class="box tight">{svg_room_map()}</div>
<table class="small">
  <tr><th style="width:22mm">Repère</th><th>Ce qui vous y attend</th></tr>
  <tr><td><strong>1</strong> &mdash; Tableau</td><td>L'Énigme des Blasons</td></tr>
  <tr><td><strong>2</strong> &mdash; Fenêtre</td><td>La Carte des Astres</td></tr>
  <tr><td><strong>3</strong> &mdash; Étagère</td><td>L'Énigme du Chaudron</td></tr>
  <tr><td><strong>4</strong> &mdash; Bureau</td><td>Le Sortilège codé et son grimoire</td></tr>
</table>"""
    return card("Plan de la Salle", "Salle 4-B, aile nord, condamnée depuis 1897",
                body, kicker="Repérage", head_icon="castle", accent="nuit",
                footer="Carte 2 &mdash; à laisser visible pendant toute la partie")


def carte_enigme_blasons():
    rows = "".join(
        f"<tr><td><strong>{m}</strong></td><td>{p} {n}</td>"
        f'<td class="center">&mdash;</td></tr>'
        for m, p, n, _, _b in MAISONS
    )
    body = f"""
<p class="lead drop">{drop_cap("Q", ACCENT_HEX["bordeaux"])}uatre maisons, quatre fondateurs. Le tableau de la salle porte
encore la trace d'une leçon effacée&nbsp;: <em>&laquo;&nbsp;on ne classe pas les
maisons par leur gloire, mais par le prénom de qui les fonda.&nbsp;&raquo;</em></p>
<div class="box">
  <h2>Les quatre fondateurs</h2>
  <table>
    <tr><th>Maison</th><th>Fondateur</th><th class="center">Rang</th></tr>
    {rows}
  </table>
</div>
<div class="box tight">
  <p class="small" style="margin:0"><strong>Marche à suivre</strong>&nbsp;:
  rangez les quatre <em>prénoms</em> des fondateurs par ordre alphabétique et
  numérotez-les de 1 à 4. Reportez chaque rang dans la colonne de droite.</p>
</div>
<p class="mono-answer">Le rang de <strong>Poufsouffle</strong> est votre
premier chiffre <span class="answer-box">&nbsp;</span></p>
<p class="center small" style="margin-top:5mm">
  Les quatre blasons découpés sont disposés dans la salle&nbsp;: vérifiez-y
  les noms des fondateurs.</p>"""
    return card("L'Énigme des Blasons", "Première épreuve &mdash; emplacement 1",
                body, kicker="Chiffre n° 1", head_icon="book-cover", accent="bordeaux",
                footer="Carte 3 &mdash; à poser au pied du tableau")


ACCENT_HEX = {"bordeaux": "#6b1420", "or": "#8a6a22", "vert": "#3d5240", "nuit": "#24354f"}


def blason(maison: str, bete: str, accent: str) -> str:
    """Ecu d'une maison : visuel personnel s'il y en a un, sinon ecu genere."""
    return (perso_img(f"blason-{maison.lower()}", width="34mm", cls="blason-perso")
            or svg_shield(bete, ACCENT_HEX[accent]))


def carte_blasons_accessoire():
    cells = "".join(
        f'<div class="cutout">{blason(maison, bete, a)}'
        f"<h3>{maison}</h3><div class=\"sub\">fondée par {prenom} {nom}</div></div>"
        for maison, prenom, nom, a, bete in MAISONS
    )
    body = f"""
<p class="lead center small">À imprimer, découper et disposer dans la pièce
avant l'arrivée des joueurs.</p>
<div class="cutouts">{cells}</div>
{cut_line()}"""
    return card("Les Quatre Blasons", "Accessoire a découper", body,
                kicker="Matériel", accent="or",
                footer="Carte 4 &mdash; accessoire de l'Énigme des Blasons")


def carte_enigme_chaudron():
    lis = "".join(f"<li>{t}</li>" for t in INDICES_CHAUDRON)
    slots = "".join(
        f'<tr><td class="center"><strong>{i}</strong></td>'
        f'<td style="border-bottom:0.7pt solid #2a1a0d">&nbsp;</td></tr>'
        for i in range(1, 5)
    )
    body = f"""
<p class="lead drop">{drop_cap("S", ACCENT_HEX["vert"])}ur l'étagère trône un chaudron froid. À côté, une recette dont
l'ordre des ingrédients a été effacé&nbsp;&mdash; il ne reste que les quatre
remarques griffonnées en marge par l'apprenti.</p>
<div class="box tight">
  <h2>Les ingrédients</h2>
  <p class="center small" style="margin:0">
    {" &nbsp;&bull;&nbsp; ".join(INGREDIENTS)}</p>
</div>
<div class="box">
  <h2>Les notes en marge</h2>
  <ol>{lis}</ol>
</div>
<div class="grid-2" style="margin-top:5mm">
  <table class="small">
    <tr><th class="center" style="width:16mm">Ordre</th><th>Ingrédient</th></tr>
    {slots}
  </table>
  <p class="small" style="align-self:center">Un seul ordre satisfait les quatre
  notes à la fois. Reconstituez-le, puis relevez la position de la
  <strong>Plume de Phénix</strong>.</p>
</div>
<p class="mono-answer">Position de la Plume de Phénix
<span class="answer-box">&nbsp;</span></p>"""
    return card("L'Énigme du Chaudron", "Deuxième épreuve &mdash; emplacement 3",
                body, kicker="Chiffre n° 2", head_icon="cauldron", accent="vert",
                footer="Carte 5 &mdash; à poser sur l'étagère, près du chaudron")


def carte_ingredients_accessoire():
    icons = ["moon", "racine", "ecaille", "plume"]
    cells = "".join(
        f'<div class="cutout"><div class="card-icon" style="color:var(--accent)">'
        f"{icon(ic)}</div><h3>{nom}</h3>"
        f'<div class="sub">flacon n° {i + 1}</div></div>'
        for i, (nom, ic) in enumerate(zip(INGREDIENTS, icons))
    )
    body = f"""
<p class="lead center small">Quatre étiquettes à coller sur des flacons, des
bocaux ou de simples verres, disposés en désordre autour du chaudron.</p>
<div class="cutouts">{cells}</div>
{cut_line()}"""
    return card("Étiquettes d'Ingrédients", "Accessoire a découper", body,
                kicker="Matériel", accent="vert",
                footer="Carte 6 &mdash; accessoire de l'Énigme du Chaudron")


def carte_grimoire():
    alpha = [chr(ord("A") + i) for i in range(26)]
    shifted = [alpha[(i - 3) % 26] for i in range(26)]

    def row(cells, cls=""):
        return f'<tr class="{cls}">' + "".join(f"<td>{c}</td>" for c in cells) + "</tr>"

    half = 13
    table = f"""<table class="cipher-table">
  {row(alpha[:half])}{row(shifted[:half], "clair")}
  <tr><td colspan="{half}" style="height:4mm;border:none"></td></tr>
  {row(alpha[half:])}{row(shifted[half:], "clair")}
</table>"""
    body = f"""
<p class="lead drop">{drop_cap("L", ACCENT_HEX["or"])}e grimoire est ouvert sur le bureau, à la page des écritures
secrètes. Une main ancienne a noté dans la marge&nbsp;:
<em>&laquo;&nbsp;reçule de trois pas dans l'alphabet, et la lettre parlera.&nbsp;&raquo;</em></p>
<div class="box">
  <h2>Table de déchiffrement &mdash; décalage de 3</h2>
  {table}
  <p class="center small" style="margin:4mm 0 0">
    Ligne du haut&nbsp;: la lettre <em>codée</em>.
    Ligne du bas, en rouge&nbsp;: la lettre <em>claire</em>.</p>
</div>
<div class="box tight small">
  <p style="margin:0"><strong>Exemple</strong>&nbsp;: la lettre codée
  <strong>D</strong> se lit <strong>A</strong>. Le mot codé
  <strong>ODIH</strong> se lit <strong>LAFE</strong>... et n'a aucun sens&nbsp;:
  c'est normal, ce n'est qu'un exercice. Le vrai message vous attend ailleurs.</p>
</div>
<p class="center small">Après l'alphabet, on repart de <strong>Z</strong>&nbsp;:
A devient X, B devient Y, C devient Z.</p>"""
    return card("Le Grimoire de Chiffrage", "Carte de référence &mdash; à garder sous la main",
                body, kicker="Outil", head_icon="scroll-unfurled", accent="or",
                footer="Carte 7 &mdash; à poser sur le bureau, avec la carte 8")


def carte_sortilege():
    body = f"""
<p class="lead drop">{drop_cap("S", ACCENT_HEX["bordeaux"])}ur le bureau, un parchemin plié en quatre. L'encre est
récente&nbsp;&mdash; quelqu'un est passé par cette retenue avant vous, et a
pris soin de ne pas écrire en clair.</p>
<div class="box center">
  <h2>Le message</h2>
  <div class="cipher">{MESSAGE_CHIFFRE}</div>
  <div class="slots">__ __ &nbsp; ___ &nbsp; ___ &nbsp; ____</div>
</div>
<p class="lead">Déchiffrez-le à l'aide du <strong>Grimoire de Chiffrage</strong>
(carte 7). Le dernier mot du message est un nombre écrit en toutes lettres.</p>
<p class="mono-answer">Ce nombre, en chiffre
<span class="answer-box">&nbsp;</span></p>
<p class="center small" style="margin-top:6mm">
  {icon("quill-ink")} &nbsp;Un mot de quatre lettres ne peut pas être un nombre
  à deux chiffres. Cherchez entre zéro et neuf.</p>"""
    return card("Le Sortilège Code", "Troisième épreuve &mdash; emplacement 4",
                body, kicker="Chiffre n° 3", head_icon="magic-swirl", accent="bordeaux",
                footer="Carte 8 &mdash; à poser sur le bureau, avec la carte 7")


def carte_astres():
    body = f"""
<p class="lead drop">{drop_cap("L", ACCENT_HEX["nuit"])}a fenêtre condamnée laisse passer un carré de ciel. Punaisée au
volet, une carte du ciel dessinée à la plume&nbsp;: une constellation que les
élèves d'astronomie appellent <em>la Retenue</em>.</p>
<div class="box tight center" style="margin:4mm 0">{svg_constellation()}</div>
<p class="lead">Le trace doré relie les étoiles entre elles, mais toutes ne sont
pas sur le trace principal. <strong>Comptez-les toutes</strong>, celles du
trace comme celles des embranchements.</p>
<p class="mono-answer">Nombre d'étoiles de la constellation
<span class="answer-box">&nbsp;</span></p>
<p class="center small" style="margin-top:3mm">
  {icon("crystal-ball", ACCENT_HEX["nuit"], "4mm")} &nbsp;Comptez les points, pas les segments.</p>"""
    return card("La Carte des Astres", "Quatrième épreuve &mdash; emplacement 2",
                body, kicker="Chiffre n° 4", head_icon="star-swirl", accent="nuit",
                footer="Carte 9 &mdash; à faire punaiser pres de la fenêtre")


def carte_assemblage():
    rows = "".join(
        f'<tr><td class="center"><strong>{i + 1}</strong></td><td>{nom}</td>'
        f'<td class="center" style="border-bottom:1pt solid #2a1a0d;width:22mm">&nbsp;</td></tr>'
        for i, (nom, _, _) in enumerate(SOLUTIONS)
    )
    body = f"""
<p class="lead drop">{drop_cap("Q", ACCENT_HEX["or"])}uatre épreuves, quatre chiffres. Le cadenas de la porte n'en
demande pas davantage &mdash; mais il les veut <strong>dans l'ordre des
épreuves</strong>.</p>
<div class="box">
  <h2>Votre combinaison</h2>
  <table>
    <tr><th class="center" style="width:18mm">Rang</th><th>Épreuve</th>
        <th class="center">Chiffre</th></tr>
    {rows}
  </table>
</div>
<div class="box center">
  <h2>Code du cadenas</h2>
  <div class="slots-boxes"><span></span><span></span><span></span><span></span></div>
  <p class="small" style="margin:0">Une seule combinaison ouvre la porte.
  Vérifiez vos quatre chiffres avant d'essayer.</p>
</div>
<p class="center" style="margin-top:5mm">{icon("key", ACCENT_HEX["or"], "13mm")}</p>"""
    return card("L'Assemblage Final", "Le cadenas de la porte", body,
                kicker="Sortie", accent="or",
                footer="Carte 10 &mdash; à remettre quand les 4 chiffres sont trouvés")


def carte_indices():
    hints = [
        ("Les Blasons", [
            "Ne regardez pas les noms de famille&nbsp;: seuls les prénoms comptent.",
            "Godric, Helga, Rowena, Salazar&nbsp;: dans quel ordre le dictionnaire les rangerait-il&nbsp;?",
            "Godric est premier, Salazar est dernier. Reste a placer Helga et Rowena.",
        ]),
        ("Le Chaudron", [
            "Commencez par la note la plus affirmative&nbsp;: elle fixe une position à coup sûr.",
            "&laquo;&nbsp;Juste après&nbsp;&raquo; veut dire deux positions collées, dans cet ordre précis.",
            "La Poudre de Lune est première, puis Mandragore et Écaille se suivent&nbsp;: il ne reste qu'une place pour la Plume.",
        ]),
        ("Le Sortilège", [
            "Le grimoire se lit de haut en bas&nbsp;: trouvez la lettre codée sur la ligne du haut.",
            "Traitez chaque lettre séparément. Commencez par le dernier mot, VHSW.",
            "V donne S, H donne E. Le mot fait quatre lettres et se termine en T.",
        ]),
        ("Les Astres", [
            "Chaque étoile dessinée compte, même celles au bout d'une branche isolée.",
            "Suivez le trace de gauche a droite, puis revenez sur l'embranchement.",
            "Il y en a plus de sept et moins de neuf.",
        ]),
    ]
    blocks = "".join(
        f'<div class="box tight"><h2>{titre}</h2><ol class="small">'
        + "".join(f"<li>{h}</li>" for h in items)
        + "</ol></div>"
        for titre, items in hints
    )
    body = f"""
<p class="lead center small"><strong>Carte réservée au surveillant.</strong>
Ne la laissez pas dans la salle. Donnez les indices dans l'ordre, un seul a la
fois, et seulement s'ils sont demandés.</p>
{blocks}"""
    return card("Indices de Secours", "À l'usage exclusif du surveillant", body,
                kicker="Animateur", head_icon="owl", accent="vert", extra="compact",
                footer="Carte 11 &mdash; à retirer de la salle avant le début de la partie")


def carte_certificat():
    sigs = "".join(
        f'<div class="sig"><div class="line"></div>'
        f'<div class="cap">Joueur {i} &mdash; nom et signature</div></div>'
        for i in range(1, 5)
    )
    inner = f"""
<p class="lead center">La porte s'est ouverte. Le concierge n'y a vu que du feu.
Cette salle vous doit le silence, et vous lui devez une histoire que personne
ne croira.</p>
<div class="box center">
  <h2>Combinaison forcée</h2>
  <div class="code-final">{CODE_FINAL}</div>
  <p class="small" style="margin:0">Temps de la retenue&nbsp;:
  <span class="answer-box">&nbsp;</span> minutes</p>
</div>
<p class="center small">Les quatre élèves ci-dessous ont purgé leur retenue avec
une insolence remarquable, et sont déclarés
<strong>Maîtres de l'Évasion</strong>.</p>
<div class="signatures">{sigs}</div>
<p class="center small" style="margin-top:8mm">
  Fait à l'école, le <span class="answer-box">&nbsp;</span>
  &nbsp;&nbsp;Contresigné&nbsp;:
  <span class="answer-box">&nbsp;</span></p>"""
    fond = (perso_img("filigrane", width="128mm", cls="watermark perso-wm")
            or svg_castle_watermark())
    body = f'<div class="cert-wrap">{fond}' \
           f'<div class="cert-content">{inner}</div></div>'
    return card("Certificat d'Évasion", "Décerné aux quatre élèves de la salle 4-B",
                body, kicker="Victoire", head_icon="top-hat", accent="bordeaux",
                footer="Carte 12 &mdash; à remettre et faire signer a la sortie")


CARTES = [
    carte_briefing, carte_plan, carte_enigme_blasons, carte_blasons_accessoire,
    carte_enigme_chaudron, carte_ingredients_accessoire, carte_grimoire,
    carte_sortilege, carte_astres, carte_assemblage, carte_indices, carte_certificat,
]


# --------------------------------------------------------------------------
# Guide animateur
# --------------------------------------------------------------------------

def guide_page(title, subtitle, body, footer):
    return f"""<section class="page">
  <div class="sheet">
    <header class="card-head">
      <h1>{title}</h1>
      <div class="subtitle">{subtitle}</div>
      <div class="rule">{svg_fleuron()}</div>
    </header>
    <div class="card-body">{body}</div>
    <div class="footer">{footer}</div>
  </div>
</section>"""


def guide_materiel():
    body = """
<h2>Le jeu en bref</h2>
<p class="lead">Quatre joueurs, 30 à 45 minutes, une seule pièce. Les joueurs
résolvent quatre énigmes indépendantes&nbsp;; chacune donne un chiffre. Les
quatre chiffres, dans l'ordre des épreuves, forment le code d'un cadenas.</p>

<h2>Matériel à prévoir</h2>
<ul>
  <li>Un <strong>cadenas à combinaison à 4 chiffres</strong> (à molettes),
      réglé sur le code final.</li>
  <li>Une <strong>boîte</strong>, un coffret ou une mallette fermée par ce
      cadenas&nbsp;&mdash; à défaut, une porte de placard.</li>
  <li>Les 12 cartes joueurs imprimées (<em>Cartes_Joueurs.pdf</em>), en A4.</li>
  <li>Une paire de <strong>ciseaux</strong> pour les cartes 4 et 6, à découper
      <em>avant</em> la partie.</li>
  <li>Quatre flacons, bocaux ou verres pour les étiquettes d'ingrédients.</li>
  <li>De la pâte adhésive ou des punaises, un chronomètre, un stylo par joueur.</li>
  <li>Facultatif&nbsp;: un chaudron ou une casserole noire, une bougie LED,
      une nappe sombre.</li>
</ul>

<h2>Préparation &mdash; 15 minutes</h2>
<ol>
  <li>Imprimez les 12 cartes. <strong>Retirez la carte 11</strong> (indices de
      secours) et gardez-la sur vous.</li>
  <li>Découpez les 4 blasons (carte 4) et les 4 étiquettes (carte 6).</li>
  <li>Réglez le cadenas sur la combinaison finale et verrouillez la boîte.</li>
  <li>Placez la carte 12 (certificat) <em>dans</em> la boîte fermée&nbsp;: c'est
      la récompense.</li>
  <li>Disposez les cartes selon le plan de la page suivante.</li>
</ol>"""
    return guide_page("Guide de l'Animateur", "La Retenue Interdite &mdash; escape game maison",
                      body, "Guide animateur &mdash; page 1 sur 4")


def guide_installation():
    body = f"""
<h2>Mise en place par emplacement</h2>
<div class="box tight">{svg_room_map()}</div>
<table class="small">
  <tr><th style="width:26mm">Emplacement</th><th>À y déposer</th></tr>
  <tr><td><strong>1</strong> &mdash; Tableau</td>
      <td>Carte 3 (Énigme des Blasons) au pied du tableau, et les 4 blasons
          découpés de la carte 4 disposés en évidence dans la pièce.</td></tr>
  <tr><td><strong>2</strong> &mdash; Fenêtre</td>
      <td>Carte 9 (Carte des Astres), punaisée ou scotchée sur le volet ou
          la vitre.</td></tr>
  <tr><td><strong>3</strong> &mdash; Étagère</td>
      <td>Carte 5 (Énigme du Chaudron), près du chaudron, avec les 4 flacons
          étiquetés disposés <em>en désordre</em>.</td></tr>
  <tr><td><strong>4</strong> &mdash; Bureau</td>
      <td>Carte 7 (Grimoire de Chiffrage) et carte 8 (Sortilège codé), la
          seconde pliée en quatre.</td></tr>
  <tr><td>Table centrale</td>
      <td>Carte 1 (Briefing) et carte 2 (Plan de la salle), face visible.</td></tr>
  <tr><td>Sur vous</td>
      <td>Carte 11 (Indices de secours). Carte 10 (Assemblage final), a donner
          quand les 4 chiffres sont trouvés.</td></tr>
  <tr><td>Dans la boîte</td>
      <td>Carte 12 (Certificat d'evasion), sous cadenas.</td></tr>
</table>

<h2>Conduite de la partie</h2>
<ul class="small">
  <li><strong>Lancement</strong>&nbsp;: lisez la carte 1 a voix haute, puis
      démarrez le chronomètre a 40 minutes.</li>
  <li><strong>Répartition</strong>&nbsp;: les 4 énigmes sont indépendantes.
      Suggerez aux joueurs de se séparer en deux binomes.</li>
  <li><strong>Rythme</strong>&nbsp;: si une énigme bloque plus de 8 minutes,
      proposez le premier indice sans attendre la demande.</li>
  <li><strong>Cout des indices</strong>&nbsp;: 2 minutes chacun, retirées du
      chronomètre. Annoncez-le a voix haute, c'est ce qui crée la tension.</li>
  <li><strong>Ambiance</strong>&nbsp;: lumiere basse, une bougie LED, et deux
      ou trois interruptions &mdash; &laquo;&nbsp;j'entends des pas dans le
      couloir&nbsp;&raquo; &mdash; aux minutes 15 et 32.</li>
  <li><strong>Fin</strong>&nbsp;: laissez-les composer le code eux-memes.
      Le déclic du cadenas vaut tous les effets sonores.</li>
</ul>"""
    return guide_page("Installation &amp; Animation", "Où poser quoi, et comment mener la partie",
                      body, "Guide animateur &mdash; page 2 sur 4")


def guide_solutions():
    """Page 3 : code final, recapitulatif et solutions des enigmes 1 et 2."""
    ordre = ["Poudre de Lune", "Racine de Mandragore", "Écaille de Dragon", "Plume de Phénix"]
    ordre_html = "".join(
        f'<tr><td class="center"><strong>{i + 1}</strong></td><td>{n}</td></tr>'
        for i, n in enumerate(ordre)
    )
    rows = "".join(
        f'<tr><td class="center"><strong>{i + 1}</strong></td><td>{nom}</td>'
        f'<td>{expl}</td><td class="center"><strong>{ch}</strong></td></tr>'
        for i, (nom, expl, ch) in enumerate(SOLUTIONS)
    )
    body = f"""
<h2>Le code final</h2>
<div class="code-final">{CODE_FINAL}</div>

<h2>Récapitulatif</h2>
<table class="small">
  <tr><th class="center" style="width:14mm">Rang</th><th style="width:32mm">Épreuve</th>
      <th>Solution</th><th class="center" style="width:16mm">Chiffre</th></tr>
  {rows}
</table>

<h2>Détail des solutions</h2>
<div class="box tight small">
  <p><strong>1. Les Blasons &mdash; réponse&nbsp;: 2.</strong>
  Les prénoms des fondateurs rangés par ordre alphabétique donnent
  Godric (1), Helga (2), Rowena (3), Salazar (4). Helga fonda Poufsouffle&nbsp;:
  la maison est donc au rang <strong>2</strong>.</p>

  <p><strong>2. Le Chaudron &mdash; réponse&nbsp;: 4.</strong>
  La note 1 fixe la Poudre de Lune en premier. La note 2 impose Mandragore puis
  Écaille collées&nbsp;; elles ne peuvent tenir qu'en positions 2 et 3, car la
  note 4 interdit Mandragore en dernière place. Il ne reste que la position 4
  pour la Plume de Phénix, ce que confirme la note 3.</p>
  <table class="small" style="width:62%;margin:2mm auto 0">{ordre_html}</table>
</div>"""
    return guide_page("Solutions", "À ne pas laisser traîner dans la salle",
                      body, "Guide animateur &mdash; page 3 sur 4")


def guide_solutions_suite():
    """Page 4 : solutions des enigmes 3 et 4, conseils de rattrapage, credits."""
    body = f"""
<h2>Détail des solutions <span class="small">(suite)</span></h2>
<div class="box tight small">
  <p><strong>3. Le Sortilège &mdash; réponse&nbsp;: 7.</strong>
  Le message <strong>{MESSAGE_CHIFFRE}</strong> se déchiffre, lettre par lettre
  avec un décalage de 3 en arrière, en <strong>{MESSAGE_CLAIR}</strong>.
  SEPT s'écrit <strong>7</strong>.</p>

  <p><strong>4. Les Astres &mdash; réponse&nbsp;: 8.</strong>
  La constellation compte <strong>8</strong> étoiles. Deux d'entre elles sont
  sur un embranchement et non sur le tracé principal&nbsp;: c'est la seule
  difficulté de l'énigme.</p>
</div>

<h2>Si la partie dérape</h2>
<p class="small">Aucune énigme ne dépend d'une autre&nbsp;: si l'une résiste
vraiment, donnez le chiffre et laissez la partie avancer. Une équipe qui sort
à 39 minutes garde un meilleur souvenir qu'une équipe qui échoue sur une
seule case.</p>

<h2>Après la partie</h2>
<p class="small">Le certificat (carte 12) attend dans la boîte cadenassée.
Faites-le signer par les quatre joueurs avant de ranger le jeu&nbsp;: les cartes
sont réutilisables telles quelles pour une autre équipe, à condition de
réimprimer les cartes 4 et 6 si elles ont été découpées.</p>

<h2>Crédits</h2>
<p class="credits">Icônes&nbsp;: <strong>Icons by game-icons.net</strong>
(Lorc), sous licence CC&nbsp;BY&nbsp;3.0. Polices&nbsp;: Cinzel, Cinzel
Decorative, EB Garamond et MedievalSharp, sous licence SIL Open Font License
1.1, via le dépôt Google&nbsp;Fonts. Texture de parchemin, blasons, plan,
constellation et filigrane&nbsp;: générés par code pour ce jeu. Aucun visuel
sous droit d'auteur n'a été utilisé. Jeu amateur, à usage strictement privé et
non commercial&nbsp;; sans lien avec les ayants droit des œuvres qui l'ont
inspiré.</p>"""
    return guide_page("Solutions (suite)", "Fin des solutions et crédits",
                      body, "Guide animateur &mdash; page 4 sur 4")


GUIDE = [guide_materiel, guide_installation, guide_solutions, guide_solutions_suite]


# --------------------------------------------------------------------------
# Assemblage
# --------------------------------------------------------------------------

def document(title, sections, body_class=""):
    return f"""<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><title>{title}</title>
<style>{CSS}</style></head>
<body class="{body_class}">
{"".join(sections)}
</body></html>"""


def build_players_html() -> str:
    return document("La Retenue Interdite &mdash; Cartes joueurs", [f() for f in CARTES])


def build_guide_html() -> str:
    return document("La Retenue Interdite &mdash; Guide animateur",
                    [f() for f in GUIDE], body_class="guide")


if __name__ == "__main__":
    (ROOT / "build").mkdir(exist_ok=True)
    (ROOT / "build" / "cartes_joueurs.html").write_text(build_players_html(), encoding="utf-8")
    (ROOT / "build" / "guide_animateur.html").write_text(build_guide_html(), encoding="utf-8")
    print("HTML ecrit dans", ROOT / "build")
