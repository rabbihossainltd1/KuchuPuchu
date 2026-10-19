#!/usr/bin/env python3
"""Rebuild every KuchuPuchu brand asset from the owner's logo photo.

The owner supplied ONE picture (a black rounded plate with a white speech
bubble and a blue arrow) and asked for it to be used everywhere: the launcher
icon, the in-app brand mark, the notification icon, the web logo, the favicon
and the PWA icons.

This script derives every one of those files from that single picture, so the
brand can be re-cut later from a new picture without hand-editing a dozen
binaries:

    python3 scripts/make-brand-assets.py path/to/logo-photo.jpg

What it writes
--------------
    web/public/logo.png                     192x192  the mark (web + PWA)
    web/public/icon.svg                     the same PNG inside an <image>
    native-android/.../mipmap-*/ic_launcher.png        the mark (legacy)
    native-android/.../mipmap-*/ic_launcher_foreground.png  the art, safe zone
    native-android/.../mipmap-*/ic_launcher_round.png  the art on a black disc
    native-android/.../mipmap-*/ic_stat_kp.png         the white silhouette
    native-android/.../drawable/icon_gold.png   512x512  the mark (in-app)

How the picture is read
-----------------------
The photo is a JPEG on white, so the plate is found by its own darkness and
the speech bubble + arrow are the pixels inside the plate that are NOT dark.
The white background is dropped with a flood fill from the border, which also
fills the bubble (it is enclosed by the plate) - that is what makes the
result a clean silhouette instead of a white blob.
"""

from __future__ import annotations

import base64
import io
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, "native-android", "app", "src", "main", "res")

# The plate's own black, sampled from the picture (JPEG noise varies).
PLATE_BLACK = (17, 17, 19)
# A pixel this dark is plate, not bubble.
DARK_MAX = 95
# A pixel this bright is the white paper behind the logo.
PAPER_MIN = 240

# density -> (legacy icon px, adaptive foreground px, status icon px)
DENSITIES = {
    "mdpi": (48, 108, 24),
    "hdpi": (72, 162, 36),
    "xhdpi": (96, 216, 48),
    "xxhdpi": (144, 324, 72),
    "xxxhdpi": (192, 432, 96),
}
# The adaptive icon's safe zone: the middle 66 of the 108dp canvas.
SAFE_ZONE = 66 / 108


def read_picture(path: str) -> Image.Image:
    return Image.open(path).convert("RGB")


def crop_to_plate(pic: Image.Image) -> Image.Image:
    """The square region that holds the plate (the picture is a photo, so the
    plate is not perfectly square - it is squared off here, not stretched)."""
    a = np.asarray(pic).astype(np.int16)
    paper = a.max(axis=2) >= PAPER_MIN
    ys, xs = np.nonzero(~paper)
    if len(xs) == 0:
        raise SystemExit("no logo found in the picture")
    minx, maxx, miny, maxy = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    side = max(maxx - minx + 1, maxy - miny + 1)
    cx, cy = (minx + maxx) // 2, (miny + maxy) // 2
    left = max(0, cx - side // 2)
    top = max(0, cy - side // 2)
    return pic.crop((left, top, left + side, top + side))


def flood_outside(non_plate: np.ndarray) -> np.ndarray:
    """True where the white paper is reachable from the border.

    The bubble and the arrow are enclosed by the plate, so they are NOT
    reached: the result is the plate's silhouette plus the art inside it.
    """
    outside = np.zeros_like(non_plate)
    outside[0, :] = non_plate[0, :]
    outside[-1, :] = non_plate[-1, :]
    outside[:, 0] = non_plate[:, 0]
    outside[:, -1] = non_plate[:, -1]
    while True:
        grown = outside.copy()
        grown[1:, :] |= outside[:-1, :]
        grown[:-1, :] |= outside[1:, :]
        grown[:, 1:] |= outside[:, :-1]
        grown[:, :-1] |= outside[:, 1:]
        grown &= non_plate
        if int(grown.sum()) == int(outside.sum()):
            return outside
        outside = grown


def split_master(crop: Image.Image) -> tuple[np.ndarray, np.ndarray]:
    """Return (silhouette, art) as boolean masks over the cropped picture."""
    a = np.asarray(crop).astype(np.int16)
    plate = a.max(axis=2) < DARK_MAX
    outside = flood_outside(~plate)
    silhouette = ~outside
    art = silhouette & ~plate
    return silhouette, art


def build_mark(crop: Image.Image, silhouette: np.ndarray, art: np.ndarray) -> Image.Image:
    """RGBA: the plate as one flat black, the art in the picture's own colours,
    the paper transparent."""
    a = np.asarray(crop).astype(np.uint8).copy()
    flat = np.array(PLATE_BLACK, dtype=np.uint8)
    plate_only = silhouette & ~art
    a[plate_only] = flat
    out = np.dstack([a, (silhouette * 255).astype(np.uint8)])
    return Image.fromarray(out, "RGBA")


def build_art(crop: Image.Image, art: np.ndarray) -> Image.Image:
    """RGBA: the speech bubble + arrow only (for the adaptive foreground)."""
    a = np.asarray(crop).astype(np.uint8).copy()
    out = np.dstack([a, (art * 255).astype(np.uint8)])
    return Image.fromarray(out, "RGBA")


def build_silhouette(art: np.ndarray) -> Image.Image:
    """RGBA: the art as a flat white shape (the status-bar icon)."""
    h, w = art.shape
    out = np.zeros((h, w, 4), dtype=np.uint8)
    out[..., 0] = 255
    out[..., 1] = 255
    out[..., 2] = 255
    out[..., 3] = (art * 255).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def fit(img: Image.Image, size: int, fraction: float = 1.0) -> Image.Image:
    """Scale the art to `fraction` of a `size` canvas, centred."""
    target = max(1, int(round(size * fraction)))
    scaled = img.resize((target, target), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(scaled, ((size - target) // 2, (size - target) // 2), scaled)
    return canvas


def on_disc(img: Image.Image, size: int) -> Image.Image:
    """The art on a filled black disc (the round launcher icon)."""
    disc = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mask = Image.new("L", (size, size), 0)
    from PIL import ImageDraw

    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    disc.paste(Image.new("RGBA", (size, size), PLATE_BLACK + (255,)), (0, 0), mask)
    art = fit(img, int(size * 0.78))
    disc.alpha_composite(art)
    return disc


def write_png(img: Image.Image, path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, "PNG", optimize=True)
    print(f"  {os.path.relpath(path, ROOT)}  {img.size[0]}x{img.size[1]}")


def write_web(mark: Image.Image) -> None:
    logo = mark.resize((192, 192), Image.LANCZOS)
    path = os.path.join(ROOT, "web", "public", "logo.png")
    logo.save(path, "PNG", optimize=True)
    print(f"  web/public/logo.png  192x192")
    buf = io.BytesIO()
    logo.save(buf, "PNG", optimize=True)
    data = base64.b64encode(buf.getvalue()).decode()
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192">\n'
        '  <image width="192" height="192" href="data:image/png;base64,'
        + data
        + '" />\n</svg>\n'
    )
    with open(os.path.join(ROOT, "web", "public", "icon.svg"), "w") as fh:
        fh.write(svg)
    print("  web/public/icon.svg")


def main() -> int:
    source = sys.argv[1] if len(sys.argv) > 1 else "/home/user/uploads/photo.jpg"
    if not os.path.exists(source):
        raise SystemExit(f"picture not found: {source}")
    print(f"reading {source}")
    crop = crop_to_plate(read_picture(source))
    silhouette, art = split_master(crop)
    mark = build_mark(crop, silhouette, art)
    art_img = build_art(crop, art)
    silhouette_img = build_silhouette(art)

    print("web:")
    write_web(mark)

    print("android:")
    write_png(mark.resize((512, 512), Image.LANCZOS), os.path.join(RES, "drawable", "icon_gold.png"))
    for density, (legacy, foreground, status) in DENSITIES.items():
        folder = os.path.join(RES, f"mipmap-{density}")
        write_png(mark.resize((legacy, legacy), Image.LANCZOS), os.path.join(folder, "ic_launcher.png"))
        write_png(
            fit(art_img, foreground, SAFE_ZONE),
            os.path.join(folder, "ic_launcher_foreground.png"),
        )
        write_png(on_disc(art_img, legacy), os.path.join(folder, "ic_launcher_round.png"))
        write_png(
            fit(silhouette_img, status, 1.0),
            os.path.join(folder, "ic_stat_kp.png"),
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
