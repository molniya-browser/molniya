from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import subprocess

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "molniya-master.png"
MASTER = ROOT / "molniya-1024.png"
ICONSET = ROOT / "Molniya.iconset"
ICNS = ROOT / "Molniya.icns"
PREVIEW = ROOT / "molniya-themes-preview.png"


def rounded_mask(size: int, scale: int = 4) -> Image.Image:
    s = size * scale
    mask = Image.new("L", (s, s), 0)
    draw = ImageDraw.Draw(mask)
    # Matches the generated squircle while removing its baked checkerboard.
    draw.rounded_rectangle(
        (31 * scale, 30 * scale, 993 * scale, 993 * scale),
        radius=232 * scale,
        fill=255,
    )
    return mask.resize((size, size), Image.Resampling.LANCZOS)


def load_font(size: int):
    candidates = [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def add_icon(canvas: Image.Image, icon: Image.Image, center_x: int, center_y: int, icon_size: int):
    resized = icon.resize((icon_size, icon_size), Image.Resampling.LANCZOS)
    x = center_x - icon_size // 2
    y = center_y - icon_size // 2

    alpha = resized.getchannel("A")
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    shadow_shape = Image.new("RGBA", resized.size, (0, 0, 0, 115))
    shadow_shape.putalpha(alpha.point(lambda p: round(p * 0.42)))
    shadow.alpha_composite(shadow_shape, (x, y + 24))
    shadow = shadow.filter(ImageFilter.GaussianBlur(24))
    canvas.alpha_composite(shadow)
    canvas.alpha_composite(resized, (x, y))


def main():
    source = Image.open(SOURCE).convert("RGBA")
    if source.size != (1024, 1024):
        raise ValueError(f"Expected 1024x1024 source, got {source.size}")

    source.putalpha(rounded_mask(1024))
    source.save(MASTER, optimize=True)

    ICONSET.mkdir(exist_ok=True)
    exports = {
        "icon_16x16.png": 16,
        "icon_16x16@2x.png": 32,
        "icon_32x32.png": 32,
        "icon_32x32@2x.png": 64,
        "icon_128x128.png": 128,
        "icon_128x128@2x.png": 256,
        "icon_256x256.png": 256,
        "icon_256x256@2x.png": 512,
        "icon_512x512.png": 512,
        "icon_512x512@2x.png": 1024,
    }
    for name, size in exports.items():
        resized = source if size == 1024 else source.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(ICONSET / name, optimize=True)

    subprocess.run(["iconutil", "-c", "icns", str(ICONSET), "-o", str(ICNS)], check=True)

    preview = Image.new("RGBA", (1600, 1000), (255, 255, 255, 255))
    draw = ImageDraw.Draw(preview)
    draw.rectangle((0, 0, 799, 999), fill=(245, 245, 247, 255))
    draw.rectangle((800, 0, 1599, 999), fill=(18, 18, 22, 255))

    add_icon(preview, source, 400, 455, 620)
    add_icon(preview, source, 1200, 455, 620)

    font = load_font(30)
    small = load_font(20)
    draw.text((400, 840), "Светлая тема", font=font, fill=(35, 35, 40, 255), anchor="mm")
    draw.text((1200, 840), "Тёмная тема", font=font, fill=(238, 238, 242, 255), anchor="mm")
    draw.text((400, 890), "МОЛНИЯ  ·  БРАУЗЕР", font=small, fill=(125, 125, 135, 255), anchor="mm")
    draw.text((1200, 890), "МОЛНИЯ  ·  БРАУЗЕР", font=small, fill=(125, 125, 140, 255), anchor="mm")
    preview.convert("RGB").save(PREVIEW, optimize=True)

    print(MASTER)
    print(ICNS)
    print(PREVIEW)


if __name__ == "__main__":
    main()
