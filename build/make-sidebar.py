"""Generate NSIS installer/uninstaller sidebar BMPs for ArkBrain-Agent.

Replaces the legacy Bailongma artwork. Layout mirrors the old sidebar
(logo → title → subtitle → accent line → caption) on the ArkBrain dark
brand background. Renders at 2x (328x628) and downsamples to the NSIS
standard 164x314 for crisp text.
"""
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

BUILD_DIR = Path(__file__).resolve().parent
LOGO = BUILD_DIR.parent / "logo.png"  # ArkBrain mark, dark bg, square

OUT_W, OUT_H = 164, 314
SS = 2  # supersample: render at 328x628

# Brand palette (matches brain-ui tokens: --add 青 + deep navy surface)
BG_TOP = (10, 15, 30)
BG_BOTTOM = (16, 24, 48)
TEXT_PRIMARY = (240, 244, 255)
TEXT_SECONDARY = (143, 163, 200)
ACCENT = (45, 212, 191)  # --add teal

CJK_BOLD = "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Bold.ttc"
CJK_MEDIUM = "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Medium.ttc"
CJK_REGULAR = "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc"


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


def tracked_text(draw: ImageDraw.ImageDraw, xy, text, fnt, fill, tracking: int):
    """Draw text with extra letter-spacing. xy = left, baseline-top anchor."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=fnt, fill=fill)
        x += draw.textlength(ch, font=fnt) + tracking
    return x - tracking


def logo_mark() -> Image.Image:
    """Graphics-only crop of logo.png. Pixel-measured layout of that file
    (1254²): mark occupies x 259..1017 / y 146..751, wordmark starts y 776.
    Crop the largest square that contains the mark without touching text."""
    src = Image.open(LOGO).convert("RGB")
    w, h = src.size
    side = int(h * 0.6188)  # 776 @1254 — stops right above the wordmark
    cx = int(w * 0.5088)    # 638 @1254 — mark is centered on it
    left = max(0, min(w - side, cx - side // 2))
    return src.crop((left, 0, left + side, side))


def logo_with_glow() -> Image.Image:
    """ArkBrain mark scaled into the sidebar, circular feathered edge."""
    size = 150 * SS
    src = logo_mark().resize((size, size), Image.LANCZOS)
    # Circular feather mask so the square source blends into the background
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    inset = 2
    d.ellipse((inset, inset, size - inset, size - inset), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(radius=6 * SS))
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(src, (0, 0), mask)
    return out


def render() -> Image.Image:
    w, h = OUT_W * SS, OUT_H * SS
    img = Image.new("RGB", (w, h))
    top, bottom = ImageDraw.Draw(img), None
    # Vertical brand gradient
    for y in range(h):
        t = y / max(1, h - 1)
        c = tuple(int(a + (b - a) * t) for a, b in zip(BG_TOP, BG_BOTTOM))
        top.line([(0, y), (w, y)], fill=c)

    d = ImageDraw.Draw(img)

    # Logo, centered upper area with a soft glow behind it
    logo = logo_with_glow()
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    glow.paste((40, 120, 255, 70), (0, 0), logo.split()[3])
    glow = glow.filter(ImageFilter.GaussianBlur(radius=14 * SS))
    img = Image.alpha_composite(img.convert("RGBA"), glow)
    lx = (w - logo.width) // 2
    ly = 14 * SS
    img.alpha_composite(logo, (lx, ly))
    d = ImageDraw.Draw(img)

    # Title / subtitle
    title_fnt = font(CJK_BOLD, 30 * SS)
    sub_fnt = font(CJK_REGULAR, 13 * SS)
    cy = 170 * SS
    title = "方舟大脑"
    tw = d.textlength(title, font=title_fnt)
    d.text(((w - tw) / 2, cy), title, font=title_fnt, fill=TEXT_PRIMARY)

    sub = "ArkBrain-Agent"
    sw = d.textlength(sub, font=sub_fnt)
    d.text(((w - sw) / 2, cy + 42 * SS), sub, font=sub_fnt, fill=TEXT_SECONDARY)

    # Accent line + tracked label
    acc_fnt = font(CJK_MEDIUM, 10 * SS)
    label = "LONGEVITY INTELLIGENCE"
    spacing = 1.6 * SS
    total = sum(d.textlength(c, font=acc_fnt) + spacing for c in label) - spacing
    ax = (w - total) / 2
    ay = cy + 66 * SS
    tracked_text(d, (ax, ay), label, acc_fnt, ACCENT, spacing)

    # Caption (two lines, centered)
    cap_fnt = font(CJK_REGULAR, 11 * SS)
    lines = ["融汇全球长寿医学智慧", "循证 AI 智能体 · 桌面端"]
    cap_y = cy + 86 * SS
    for i, line in enumerate(lines):
        lw = d.textlength(line, font=cap_fnt)
        d.text(((w - lw) / 2, cap_y + i * 17 * SS), line, font=cap_fnt, fill=TEXT_SECONDARY)

    # Bottom hairline accent
    d.rectangle([(w // 2 - 24 * SS, h - 10 * SS), (w // 2 + 24 * SS, h - 9 * SS)], fill=(*ACCENT, 255))

    return img.resize((OUT_W, OUT_H), Image.LANCZOS)


def main():
    out = render().convert("RGB")
    for name in ("installerSidebar.bmp", "uninstallerSidebar.bmp"):
        buf = BytesIO()
        out.save(buf, "BMP")
        (BUILD_DIR / name).write_bytes(buf.getvalue())
        print(f"wrote {name} {OUT_W}x{OUT_H}")


if __name__ == "__main__":
    main()
