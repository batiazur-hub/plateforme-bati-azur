#!/usr/bin/env python3
"""Genere le HTML des cartes joueurs et du guide animateur.

Une fonction par carte, toutes construites sur les memes primitives
(`page`, `card`, `icon`, `svg_*`) pour garder un rendu coherent.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"

# --------------------------------------------------------------------------
# Contenu du jeu : "La Retenue Interdite"
# --------------------------------------------------------------------------

MAISONS = [
    # (maison, prénom du fondateur, nom du fondateur, accent)
    ("Gryffondor", "Godric", "Gryffondor", "bordeaux"),
    ("Poufsouffle", "Helga", "Poufsouffle", "or"),
    ("Serdaigle", "Rowena", "Serdaigle", "nuit"),
    ("Serpentard", "Salazar", "Serpentard", "vert"),
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
ETOILES = [(14, 62), (27, 34), (42, 52), (50, 20), (63, 44), (72, 74), (84, 30), (90, 61)]
TRACE = [(0, 1), (1, 2), (2, 3), (3, 4), (4, 5), (4, 6), (6, 7)]


# --------------------------------------------------------------------------
# Primitives de mise en page
# --------------------------------------------------------------------------

def icon(name: str, color: str = "currentColor", size: str = "1em") -> str:
    """Insere une icone game-icons.net en ligne.

    WeasyPrint n'applique pas le CSS du document aux SVG en ligne : la couleur
    et la taille doivent donc être posées en attributs sur le <svg>.
    """
    path = ASSETS / "icons" / f"{name}.svg"
    if not path.exists():
        return ""
    svg = path.read_text(encoding="utf-8")
    svg = svg.replace('fill="currentColor"', f'fill="{color}"')
    svg = svg.replace("<svg ", f'<svg width="{size}" height="{size}" ', 1)
    return f'<span class="icon">{svg}</span>'


def card(title, subtitle, body, *, kicker="", footer="", accent="bordeaux", head_icon=""):
    """Cadre commun a toutes les cartes : double bordure, points dores aux coins."""
    head = (f'<div class="card-icon">{icon(head_icon, ACCENT_HEX[accent], "17mm")}</div>'
            if head_icon else "")
    kick = f'<div class="kicker">{kicker}</div>' if kicker else ""
    sub = f'<div class="subtitle">{subtitle}</div>' if subtitle else ""
    foot = f'<div class="footer">{footer}</div>' if footer else ""
    return f"""<section class="page">
  <div class="card accent-{accent}">
    <span class="dot tl"></span><span class="dot tr"></span>
    <span class="dot bl"></span><span class="dot br"></span>
    <header class="card-head">
      {head}
      {kick}
      <h1>{title}</h1>
      {sub}
      <div class="rule"></div>
    </header>
    <div class="card-body">{body}</div>
    {foot}
  </div>
</section>"""


def svg_shield(initial, accent_hex, *, width=150):
    """Blason dessine geometriquement (aucun visuel copie).

    Tout le style est pose en attributs : WeasyPrint ignore le CSS du document
    a l'interieur d'un SVG en ligne.
    """
    return f"""<svg viewBox="0 0 120 152" width="{width}" style="max-width:100%">
  <path d="M60 4 L112 22 V78 C112 112 88 134 60 146 C32 134 8 112 8 78 V22 Z"
        fill="{accent_hex}" stroke="#a6812c" stroke-width="3"/>
  <path d="M60 14 L104 29 V78 C104 106 84 126 60 137 C36 126 16 106 16 78 V29 Z"
        fill="none" stroke="#f0e3c4" stroke-width="1.5" opacity="0.55"/>
  <text x="60" y="92" text-anchor="middle" fill="#f6ecd4"
        font-family="Cinzel Decorative" font-weight="700" font-size="44">{initial}</text>
</svg>"""


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
    return f"""<svg viewBox="0 0 100 90" width="100%">
  <rect x="0" y="0" width="100" height="90" fill="#24354f"/>
  {lines}{stars}
</svg>"""


def svg_castle_watermark():
    """Silhouette de château composee de rectangles et de triangles."""
    towers = ""
    for x, w, h in ((30, 34, 130), (86, 26, 172), (128, 44, 108), (186, 26, 160), (236, 34, 138)):
        top = 230 - h
        merlons = "".join(
            f'<rect x="{x + i * (w / 5.0):.1f}" y="{top - 9}"'
            f' width="{w / 10.0:.1f}" height="9"/>'
            for i in range(5)
        )
        roof = (f'<path d="M{x - 4} {top - 9} L{x + w / 2:.1f} {top - 40} '
                f'L{x + w + 4} {top - 9} Z"/>') if h > 150 else ""
        towers += f'<rect x="{x}" y="{top}" width="{w}" height="{h}"/>{merlons}{roof}'
    return f"""<svg viewBox="0 0 300 240" width="118mm" class="watermark">
  <g fill="#6b1420" opacity="0.10">
    <rect x="0" y="200" width="300" height="30"/>
    {towers}
    <path d="M138 230 v-46 a12 12 0 0 1 24 0 v46 Z" fill="#efe3c4" opacity="1"/>
  </g>
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
  padding: 13mm 14mm;
  border: 1.6pt solid var(--bordeaux);
  outline: 0.7pt solid var(--or);
  outline-offset: 2.6mm;
  display: flex; flex-direction: column;
}
.dot { position: absolute; width: 2.6mm; height: 2.6mm; border-radius: 50%;
       background: var(--or); }
.dot.tl { top: -1.3mm; left: -1.3mm; }
.dot.tr { top: -1.3mm; right: -1.3mm; }
.dot.bl { bottom: -1.3mm; left: -1.3mm; }
.dot.br { bottom: -1.3mm; right: -1.3mm; }

.accent-bordeaux { --accent: var(--bordeaux); }
.accent-or       { --accent: var(--or); }
.accent-vert     { --accent: var(--vert); }
.accent-nuit     { --accent: var(--nuit); }

/* --- en-tete --- */
.card-head { text-align: center; }
.card-icon { color: var(--accent); margin-bottom: 3mm; }
.card-icon .icon svg { width: 17mm; height: 17mm; }
.icon { display: inline-block; line-height: 0; }
.icon svg { width: 1em; height: 1em; fill: currentColor; }

.kicker {
  font-family: "MedievalSharp", serif;
  font-size: 10pt; letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--accent);
}
h1 {
  font-family: "Cinzel Decorative", serif; font-weight: 700;
  font-size: 24pt; line-height: 1.15; margin: 2mm 0 0;
  color: var(--accent);
}
.subtitle {
  font-family: "EB Garamond", serif; font-style: italic;
  font-size: 13pt; margin-top: 2mm; color: #4a3320;
}
.rule {
  width: 46mm; height: 0; margin: 5mm auto 0;
  border-top: 0.7pt solid var(--or); position: relative;
}
.rule::after {
  content: ""; position: absolute; left: 50%; top: -1.3mm;
  width: 2.6mm; height: 2.6mm; margin-left: -1.3mm;
  background: var(--or); transform: rotate(45deg);
}

.card-body { flex: 1; padding-top: 7mm; }
.card-body p { margin: 0 0 4mm; }
.footer {
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
  border: 0.7pt solid rgba(107, 20, 32, 0.55);
  background: rgba(255, 253, 244, 0.42);
  padding: 6mm 7mm; margin: 5mm 0;
}
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
  margin: 4mm 0 1mm; color: var(--accent);
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
.slots { text-align: center; font-family: "Cinzel", serif; font-size: 18pt;
         letter-spacing: 0.55em; color: #7a6440; }

/* --- certificat --- */
.cert-wrap { position: relative; height: 100%; }
.watermark {
  position: absolute; left: 50%; top: 46%; width: 118mm;
  margin-left: -59mm; margin-top: -47mm;
  color: rgba(107, 20, 32, 0.10);
}
.cert-content { position: relative; }
.signatures { display: flex; flex-wrap: wrap; gap: 7mm; margin-top: 8mm; }
.sig { width: calc(50% - 3.5mm); }
.sig .line { border-bottom: 0.7pt solid var(--encre); height: 13mm; }
.sig .cap { font-family: "MedievalSharp", serif; font-size: 10pt;
            color: #6d5836; padding-top: 1.5mm; }
.code-final {
  font-family: "Cinzel Decorative", serif; font-weight: 700;
  font-size: 40pt; letter-spacing: 0.16em; text-align: center;
  color: var(--bordeaux); margin: 4mm 0;
}

/* --- guide animateur --- */
.guide .page { padding: 16mm 18mm; }
.guide .sheet { height: 100%; display: flex; flex-direction: column; }
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
<p class="lead">Vous êtes quatre. Vous avez été pris à fabriquer une potion
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
<p class="lead">Le plan de la salle, relevé par un élève avant vous. Quatre
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
        for m, p, n, _ in MAISONS
    )
    body = f"""
<p class="lead">Quatre maisons, quatre fondateurs. Le tableau de la salle porte
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


def carte_blasons_accessoire():
    cells = "".join(
        f'<div class="cutout">{svg_shield(maison[0], ACCENT_HEX[a])}'
        f"<h3>{maison}</h3><div class=\"sub\">fondée par {prénom} {nom}</div></div>"
        for maison, prénom, nom, a in MAISONS
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
<p class="lead">Un chaudron froid trône sur l'étagère. À côté, une recette dont
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
    <tr><th class="center" style="width:16mm">Ordre</th><th>Ingredient</th></tr>
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
    icons = ["round-bottom-flask", "wizard-staff", "gothic-cross", "fairy-wand"]
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
<p class="lead">Un grimoire ouvert sur le bureau, à la page des écritures
secrètes. Une main ancienne a note dans la marge&nbsp;:
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
<p class="lead">Sur le bureau, un parchemin plié en quatre. L'encre est
récente&nbsp;&mdash; quelqu'un est passé par cette retenue avant vous, et a
pris soin de ne pas ecrire en clair.</p>
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
  à deux chiffres. Cherchez entre zero et neuf.</p>"""
    return card("Le Sortilège Code", "Troisième épreuve &mdash; emplacement 4",
                body, kicker="Chiffre n° 3", head_icon="magic-swirl", accent="bordeaux",
                footer="Carte 8 &mdash; à poser sur le bureau, avec la carte 7")


def carte_astres():
    body = f"""
<p class="lead">La fenêtre condamnée laisse passer un carré de ciel. Punaisée au
volet, une carte du ciel dessinée à la plume&nbsp;: une constellation que les
élèves d'astronomie appellent <em>la Retenue</em>.</p>
<div class="box tight">{svg_constellation()}</div>
<p class="lead">Le trace doré relie les étoiles entre elles, mais toutes ne sont
pas sur le trace principal. <strong>Comptez-les toutes</strong>, celles du
trace comme celles des embranchements.</p>
<p class="mono-answer">Nombre d'étoiles de la constellation
<span class="answer-box">&nbsp;</span></p>
<p class="center small" style="margin-top:5mm">
  {icon("crystal-ball")} &nbsp;Comptez les points, pas les segments.</p>"""
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
<p class="lead">Quatre épreuves, quatre chiffres. Le cadenas de la porte n'en
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
  <div class="code-final">_ &nbsp; _ &nbsp; _ &nbsp; _</div>
  <p class="small" style="margin:0">Une seule combinaison ouvre la porte.
  Vérifiez vos quatre chiffres avant d'essayer.</p>
</div>
<p class="center" style="margin-top:6mm">{icon("key")}</p>"""
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
            "Traitez chaque lettre separement. Commencez par le dernier mot, VHSW.",
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
                kicker="Animateur", head_icon="owl", accent="vert",
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
    body = f'<div class="cert-wrap">{svg_castle_watermark()}' \
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
      <div class="rule"></div>
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
