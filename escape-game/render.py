#!/usr/bin/env python3
"""Rend les deux PDF avec WeasyPrint (HTML/CSS -> PDF, sans navigateur)."""

import sys
from pathlib import Path

from weasyprint import HTML

import build_html

ROOT = Path(__file__).resolve().parent
BUILD = ROOT / "build"

OUTPUTS = [
    ("cartes_joueurs.html", "Cartes_Joueurs.pdf", build_html.build_players_html),
    ("guide_animateur.html", "Guide_Animateur.pdf", build_html.build_guide_html),
]


def main() -> int:
    if not (ROOT / "assets" / "fonts" / "Cinzel.ttf").exists():
        print("Assets manquants : lancez d'abord `python build_assets.py`.", file=sys.stderr)
        return 1

    BUILD.mkdir(exist_ok=True)
    for html_name, pdf_name, builder in OUTPUTS:
        html = builder()
        (BUILD / html_name).write_text(html, encoding="utf-8")
        # base_url = dossier du script : les chemins d'assets sont relatifs.
        HTML(string=html, base_url=str(ROOT) + "/").write_pdf(ROOT / pdf_name)
        print(f"  + {pdf_name}")
    print("\nPDF prets dans", ROOT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
