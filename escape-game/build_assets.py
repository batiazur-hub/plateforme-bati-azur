#!/usr/bin/env python3
"""Telecharge les polices/icones libres et genere la texture parchemin.

Sources :
  - Polices : Google Fonts (OFL) depuis le depot officiel github.com/google/fonts
  - Icones  : game-icons.net (CC-BY 3.0) depuis github.com/game-icons/icons
  - Texture : generee par code (numpy + PIL), rien n'est telecharge.
"""

import re
import shutil
import subprocess
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
FONTS = ASSETS / "fonts"
ICONS = ASSETS / "icons"
VINTAGE = ASSETS / "vintage"
TEXTURES = ASSETS / "textures"

CACHE = Path(tempfile.gettempdir()) / "escape-game-sources"

FONTS_REPO = "https://github.com/google/fonts"
ICONS_REPO = "https://github.com/game-icons/icons"
# Ornements graves du XIXe siecle, tracés en vectoriel et places en CC0
# (domaine public) : lettrines, filets, rosaces.
VINTAGE_REPO = "https://github.com/WelshPixie/vintageart"

# nom local -> chemin dans le depot vintageart
VINTAGE_FILES = {
    "initiale-V": "letters/ornatev2.svg",
    "initiale-L": "letters/ornatel.svg",
    "initiale-Q": "letters/ornateq.svg",
    "initiale-S": "letters/ornates.svg",
    "filet": "dividers/divider11.svg",
    "rosace": "ornaments/ornament22.svg",
}
VINTAGE_SPARSE_DIRS = ["letters", "dividers", "ornaments"]

# nom local -> chemin dans le depot google/fonts (licence OFL)
FONT_FILES = {
    "Cinzel.ttf": "ofl/cinzel/Cinzel[wght].ttf",
    "CinzelDecorative-Bold.ttf": "ofl/cinzeldecorative/CinzelDecorative-Bold.ttf",
    "MedievalSharp.ttf": "ofl/medievalsharp/MedievalSharp.ttf",
    "EBGaramond.ttf": "ofl/ebgaramond/EBGaramond[wght].ttf",
    "EBGaramond-Italic.ttf": "ofl/ebgaramond/EBGaramond-Italic[wght].ttf",
}
FONT_SPARSE_DIRS = ["ofl/cinzel", "ofl/cinzeldecorative", "ofl/medievalsharp", "ofl/ebgaramond"]

# Repli HTTP direct si git n'est pas disponible.
FONT_RAW_BASE = "https://github.com/google/fonts/raw/refs/heads/main/"
ICON_RAW_BASE = "https://raw.githubusercontent.com/game-icons/icons/master/lorc/{}.svg"

# Icones game-icons.net (CC BY 3.0). Les auteurs sont ranges par dossier dans
# le depot : on garde le chemin complet pour pouvoir puiser chez plusieurs.
ICON_PATHS = {
    # bestiaire heraldique des quatre maisons
    "lion": "lorc/lion.svg",
    "blaireau": "delapouite/raccoon-head.svg",
    "aigle": "delapouite/eagle-head.svg",
    "serpent": "lorc/snake.svg",
    # ambiance
    "owl": "lorc/owl.svg",
    "cauldron": "lorc/cauldron.svg",
    "quill-ink": "lorc/quill-ink.svg",
    "round-bottom-flask": "lorc/round-bottom-flask.svg",
    "key": "lorc/key.svg",
    "padlock": "lorc/padlock.svg",
    "crystal-ball": "lorc/crystal-ball.svg",
    "wizard-staff": "lorc/wizard-staff.svg",
    "castle": "lorc/castle.svg",
    "star-swirl": "lorc/star-swirl.svg",
    "magic-swirl": "lorc/magic-swirl.svg",
    "book-cover": "lorc/book-cover.svg",
    "scroll-unfurled": "lorc/scroll-unfurled.svg",
    "fairy-wand": "lorc/fairy-wand.svg",
    "top-hat": "lorc/top-hat.svg",
    "moon": "lorc/moon.svg",
    # etiquettes d'ingredients
    "racine": "delapouite/plant-roots.svg",
    "ecaille": "lorc/dorsal-scales.svg",
    "plume": "lorc/feather.svg",
    "candle": "lorc/candle-flame.svg",
    "spell-book": "delapouite/secret-book.svg",
    "tied-scroll": "lorc/tied-scroll.svg",
}
ICON_SPARSE_DIRS = ["lorc", "delapouite"]
ICON_RAW_BASE = "https://raw.githubusercontent.com/game-icons/icons/master/{}"


def sparse_clone(url: str, dest: Path, dirs: list) -> Path:
    """Clone superficiel et partiel : on ne recupere que les dossiers utiles."""
    if (dest / ".git").is_dir():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        shutil.rmtree(dest)
    subprocess.run(
        ["git", "clone", "--depth", "1", "--filter=blob:none", "--sparse", url, str(dest)],
        check=True, env={**__import__("os").environ, "GIT_LFS_SKIP_SMUDGE": "1"},
        stdout=subprocess.DEVNULL,
    )
    subprocess.run(["git", "-C", str(dest), "sparse-checkout", "set", *dirs],
                   check=True, stdout=subprocess.DEVNULL)
    return dest


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "escape-game-builder"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def download_fonts() -> None:
    FONTS.mkdir(parents=True, exist_ok=True)
    todo = {n: rel for n, rel in FONT_FILES.items() if not (FONTS / n).exists()}
    for name in FONT_FILES:
        if name not in todo:
            print(f"  = {name} (deja present)")
    if not todo:
        return
    src = None
    try:
        src = sparse_clone(FONTS_REPO, CACHE / "google-fonts", FONT_SPARSE_DIRS)
    except (OSError, subprocess.CalledProcessError) as exc:
        print(f"  ! clone git indisponible ({exc}), repli HTTP")
    for name, rel in todo.items():
        if src is not None and (src / rel).exists():
            (FONTS / name).write_bytes((src / rel).read_bytes())
        else:
            (FONTS / name).write_bytes(fetch(FONT_RAW_BASE + urllib.parse.quote(rel)))
        print(f"  + {name}")


def clean_icon(svg: str) -> str:
    """Retire le fond noir plein et rend la forme recolorable en CSS."""
    # Le fond est un path plein couvrant tout le viewBox (M0 0h512v512H0z).
    svg = re.sub(r'<path[^>]*d="M0 0h512v512H0[zZ]?"[^>]*/>\s*', "", svg)
    svg = re.sub(r'fill="#fff(fff)?"', 'fill="currentColor"', svg, flags=re.I)
    svg = re.sub(r'fill="#000(000)?"', 'fill="none"', svg, flags=re.I)
    return svg.strip()


def download_icons() -> None:
    ICONS.mkdir(parents=True, exist_ok=True)
    todo = {n: rel for n, rel in ICON_PATHS.items() if not (ICONS / f"{n}.svg").exists()}
    for name in ICON_PATHS:
        if name not in todo:
            print(f"  = {name}.svg (deja present)")
    if not todo:
        return
    src = None
    try:
        src = sparse_clone(ICONS_REPO, CACHE / "game-icons", ICON_SPARSE_DIRS)
    except (OSError, subprocess.CalledProcessError) as exc:
        print(f"  ! clone git indisponible ({exc}), repli HTTP")
    for name, rel in todo.items():
        local = (src / rel) if src is not None else None
        raw = local.read_text(encoding="utf-8") if local and local.exists() \
            else fetch(ICON_RAW_BASE.format(rel)).decode("utf-8")
        (ICONS / f"{name}.svg").write_text(clean_icon(raw), encoding="utf-8")
        print(f"  + {name}.svg")


def clean_vintage(svg: str) -> str:
    """Allege un SVG produit par Inkscape et rend son encre recolorable.

    Ces fichiers embarquent metadonnees, calques et attributs sodipodi/inkscape
    qui triplent leur poids sans rien apporter au rendu.
    """
    svg = re.sub(r"<metadata\b.*?</metadata>", "", svg, flags=re.S)
    svg = re.sub(r"<sodipodi:namedview\b.*?(?:/>|</sodipodi:namedview>)", "", svg, flags=re.S)
    svg = re.sub(r"<\?xml[^>]*\?>|<!--.*?-->", "", svg, flags=re.S)
    svg = re.sub(r'\s(?:inkscape|sodipodi):[\w-]+="[^"]*"', "", svg)
    svg = svg.replace("fill:#000000", "fill:currentColor")
    return re.sub(r"\n\s*\n", "\n", svg).strip()


def download_vintage() -> None:
    VINTAGE.mkdir(parents=True, exist_ok=True)
    todo = {n: rel for n, rel in VINTAGE_FILES.items() if not (VINTAGE / f"{n}.svg").exists()}
    for name in VINTAGE_FILES:
        if name not in todo:
            print(f"  = {name}.svg (deja present)")
    if not todo:
        return
    src = sparse_clone(VINTAGE_REPO, CACHE / "vintageart", VINTAGE_SPARSE_DIRS)
    for name, rel in todo.items():
        raw = (src / rel).read_text(encoding="utf-8", errors="ignore")
        out = clean_vintage(raw)
        (VINTAGE / f"{name}.svg").write_text(out, encoding="utf-8")
        print(f"  + {name}.svg ({len(raw) // 1024} Ko -> {len(out) // 1024} Ko)")


def noise_layer(w: int, h: int, scale: int, blur: float, rng) -> np.ndarray:
    """Bruit basse frequence : petit tableau aleatoire agrandi puis floute."""
    small = rng.random((max(2, h // scale), max(2, w // scale)))
    img = Image.fromarray((small * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    img = img.filter(ImageFilter.GaussianBlur(blur))
    a = np.asarray(img, dtype=np.float32) / 255.0
    return (a - a.mean()) / (a.std() + 1e-6)


def build_parchment(width: int = 1500, height: int = 2121, seed: int = 20240) -> None:
    """Parchemin discret : le fond doit rester lisible sous du texte fin.

    On vise un papier legerement irregulier, pas un vieux grimoire tache : le
    contraste du mottling est volontairement faible et le vignettage doux.
    """
    TEXTURES.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(seed)

    base = np.array([243.0, 232.0, 206.0])
    canvas = np.repeat(np.repeat(base[None, None, :], height, 0), width, 1)

    # Mottling large, tres attenue.
    mottle = (
        1.00 * noise_layer(width, height, 140, 18, rng)
        + 0.45 * noise_layer(width, height, 45, 7, rng)
    ) / 1.45
    canvas += mottle[:, :, None] * np.array([4.5, 5.0, 6.0])

    # Fibres du papier : grain fin, presque imperceptible.
    canvas += rng.normal(0.0, 1.4, (height, width, 1))

    # Vignettage chaud et doux sur les bords.
    yy, xx = np.mgrid[0:height, 0:width]
    nx = (xx / (width - 1) - 0.5) * 2.0
    ny = (yy / (height - 1) - 0.5) * 2.0
    vign = np.clip((nx ** 2 + ny ** 2) / 2.6 - 0.30, 0.0, 1.0) ** 1.6
    canvas -= vign[:, :, None] * np.array([16.0, 21.0, 30.0])

    Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8)).save(
        TEXTURES / "parchment.jpg", "JPEG", quality=92)
    print(f"  + textures/parchment.jpg ({width}x{height})")


def main() -> None:
    print("Polices (OFL, google/fonts) :")
    download_fonts()
    print("Icones (CC-BY, game-icons.net) :")
    download_icons()
    print("Ornements graves (CC0, vintageart) :")
    download_vintage()
    print("Texture parchemin (generee par code) :")
    build_parchment()
    print("\nAssets prets dans", ASSETS)


if __name__ == "__main__":
    main()
