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
TEXTURES = ASSETS / "textures"

CACHE = Path(tempfile.gettempdir()) / "escape-game-sources"

FONTS_REPO = "https://github.com/google/fonts"
ICONS_REPO = "https://github.com/game-icons/icons"

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

ICON_NAMES = [
    "owl", "cauldron", "quill-ink", "round-bottom-flask", "key", "padlock",
    "crystal-ball", "wizard-staff", "castle", "star-swirl", "magic-swirl",
    "book-cover", "scroll-unfurled", "fairy-wand", "gothic-cross", "top-hat",
]


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
    todo = [n for n in ICON_NAMES if not (ICONS / f"{n}.svg").exists()]
    for name in ICON_NAMES:
        if name not in todo:
            print(f"  = {name}.svg (deja present)")
    if not todo:
        return
    src = None
    try:
        src = sparse_clone(ICONS_REPO, CACHE / "game-icons", ["lorc"])
    except (OSError, subprocess.CalledProcessError) as exc:
        print(f"  ! clone git indisponible ({exc}), repli HTTP")
    for name in todo:
        local = (src / "lorc" / f"{name}.svg") if src is not None else None
        raw = local.read_text(encoding="utf-8") if local and local.exists() \
            else fetch(ICON_RAW_BASE.format(name)).decode("utf-8")
        (ICONS / f"{name}.svg").write_text(clean_icon(raw), encoding="utf-8")
        print(f"  + {name}.svg")


def noise_layer(w: int, h: int, scale: int, blur: float, rng) -> np.ndarray:
    """Bruit basse frequence : petit tableau aleatoire agrandi puis floute."""
    small = rng.random((max(2, h // scale), max(2, w // scale)))
    img = Image.fromarray((small * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    img = img.filter(ImageFilter.GaussianBlur(blur))
    a = np.asarray(img, dtype=np.float32) / 255.0
    return (a - a.mean()) / (a.std() + 1e-6)


def build_parchment(width: int = 1500, height: int = 2121, seed: int = 20240) -> None:
    TEXTURES.mkdir(parents=True, exist_ok=True)
    dest = TEXTURES / "parchment.jpg"
    rng = np.random.default_rng(seed)

    base = np.array([240.0, 227.0, 196.0])  # ~#f0e3c4
    canvas = np.repeat(np.repeat(base[None, None, :], height, 0), width, 1)

    # Mottling : plusieurs echelles de bruit melangees.
    mottle = (
        1.00 * noise_layer(width, height, 90, 12, rng)
        + 0.60 * noise_layer(width, height, 30, 5, rng)
        + 0.30 * noise_layer(width, height, 10, 2, rng)
    )
    mottle /= 1.9
    canvas += mottle[:, :, None] * np.array([9.0, 10.0, 12.0])

    # Grain fin.
    grain = rng.normal(0.0, 2.2, (height, width, 1))
    canvas += grain

    # Quelques taches brunes semi-transparentes et floutees.
    stain = np.zeros((height, width), dtype=np.float32)
    yy, xx = np.mgrid[0:height, 0:width]
    for _ in range(14):
        cx, cy = rng.integers(0, width), rng.integers(0, height)
        r = rng.integers(70, 260)
        d = ((xx - cx) ** 2 + (yy - cy) ** 2) / float(r * r)
        stain += np.clip(1.0 - d, 0.0, 1.0) * float(rng.uniform(0.10, 0.32))
    stain = np.asarray(
        Image.fromarray((np.clip(stain, 0, 1) * 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(28)
        ),
        dtype=np.float32,
    ) / 255.0
    canvas -= stain[:, :, None] * np.array([26.0, 32.0, 40.0])

    # Vignettage brun sur les bords.
    nx = (xx / (width - 1) - 0.5) * 2.0
    ny = (yy / (height - 1) - 0.5) * 2.0
    vign = np.clip((nx ** 2 + ny ** 2) / 1.45 - 0.18, 0.0, 1.0) ** 1.4
    canvas -= vign[:, :, None] * np.array([34.0, 42.0, 54.0])

    Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8)).save(dest, "JPEG", quality=90)
    print(f"  + textures/parchment.jpg ({width}x{height})")


def main() -> None:
    print("Polices (OFL, google/fonts) :")
    download_fonts()
    print("Icones (CC-BY, game-icons.net) :")
    download_icons()
    print("Texture parchemin (generee par code) :")
    build_parchment()
    print("\nAssets prets dans", ASSETS)


if __name__ == "__main__":
    main()
