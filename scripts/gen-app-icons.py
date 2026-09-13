#!/usr/bin/env python3
"""Generează asset-urile de brand: wordmark „lei" alb pe verde închis.

Rulare:  python3 scripts/gen-app-icons.py

Scrie assets/icon.png, assets/adaptive-icon.png, assets/splash-icon.png,
assets/favicon.png și landing/favicon.png. După rulare e nevoie de
`npm run prebuild` ca icoanele să ajungă în proiectul nativ iOS/Android.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent

FONT_PATH = "/System/Library/Fonts/SFNS.ttf"
FONT_WEIGHT = b"Black"
TEXT = "lei"

# Verde închis din aceeași familie de nuanță ca theme/colors.ts primary (#A3B86C).
GREEN_TOP = (87, 105, 47)  # #57692F
GREEN_BOTTOM = (63, 77, 34)  # #3F4D22
GREEN_FLAT = (78, 95, 46)  # #4E5F2E — folosit ca backgroundColor în app.json
WHITE = (255, 255, 255)

SUPERSAMPLE = 4
TRACKING_RATIO = -0.02  # tracking negativ: literele stau strâns, ca un wordmark


def _font(size: int) -> ImageFont.FreeTypeFont:
    font = ImageFont.truetype(FONT_PATH, size)
    font.set_variation_by_name(FONT_WEIGHT)
    return font


def _glyph_offsets(font: ImageFont.FreeTypeFont, tracking: float) -> tuple[float, list[float]]:
    draw = ImageDraw.Draw(Image.new("L", (1, 1)))
    offsets: list[float] = []
    x = 0.0
    for index, char in enumerate(TEXT):
        offsets.append(x)
        x += draw.textlength(char, font=font)
        if index != len(TEXT) - 1:
            x += tracking
    return x, offsets


def _mark(font_size: int) -> Image.Image:
    """Wordmark-ul alb pe fundal transparent, decupat exact pe cerneală."""
    font = _font(font_size)
    total, offsets = _glyph_offsets(font, TRACKING_RATIO * font_size)
    pad = font_size
    canvas = Image.new("RGBA", (int(total + 2 * pad), int(font_size * 2.5)), (255, 255, 255, 0))
    draw = ImageDraw.Draw(canvas)
    baseline = int(font_size * 1.8)
    for char, x in zip(TEXT, offsets):
        draw.text((pad + x, baseline), char, font=font, fill=(*WHITE, 255), anchor="ls")
    return canvas.crop(canvas.getbbox())


def _gradient(size: int) -> Image.Image:
    strip = Image.new("RGB", (1, size))
    draw = ImageDraw.Draw(strip)
    for y in range(size):
        t = y / max(size - 1, 1)
        draw.point(
            (0, y),
            fill=tuple(int(GREEN_TOP[i] + (GREEN_BOTTOM[i] - GREEN_TOP[i]) * t) for i in range(3)),
        )
    return strip.resize((size, size), Image.NEAREST)


def compose(size: int, *, background: bool, mark_ratio: float) -> Image.Image:
    inner = size * SUPERSAMPLE
    if background:
        image = _gradient(inner).convert("RGBA")
    else:
        image = Image.new("RGBA", (inner, inner), (0, 0, 0, 0))

    mark = _mark(int(inner * 0.5))
    target_width = int(inner * mark_ratio)
    scale = target_width / mark.width
    mark = mark.resize((target_width, max(1, round(mark.height * scale))), Image.LANCZOS)

    image.alpha_composite(mark, ((inner - mark.width) // 2, (inner - mark.height) // 2))
    return image.resize((size, size), Image.LANCZOS)


def main() -> None:
    # Icoana de app: fără canal alfa (App Store respinge icoanele cu transparență).
    compose(1024, background=True, mark_ratio=0.55).convert("RGB").save(ROOT / "assets/icon.png")

    # Android adaptive: doar foreground-ul, încadrat în safe zone-ul de 66%.
    compose(1024, background=False, mark_ratio=0.44).save(ROOT / "assets/adaptive-icon.png")

    # Splash: marca pe transparent, peste backgroundColor-ul din app.json.
    compose(1024, background=False, mark_ratio=0.42).save(ROOT / "assets/splash-icon.png")

    # Favicon: marca mai mare, altfel dispare la 48px.
    favicon = compose(48, background=True, mark_ratio=0.68).convert("RGB")
    favicon.save(ROOT / "assets/favicon.png")
    favicon.save(ROOT / "landing/favicon.png")

    print("✓ assets regenerate. Rulează `npm run prebuild` pentru proiectul nativ.")


if __name__ == "__main__":
    main()
