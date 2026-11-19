"""A 3D game case for EmulationStation's list, drawn from a game's Luna cover.

Black keep-case: a header with the round Luna logo and AMAZON LUNA, a purple
line under it, the cover, and a black spine with the logo and the game's
name. Turned so the spine shows; transparent background.

Only covers that fit the case are used (fits()): a tall cover loses at most
a fifth of its width or height; a wide banner keeps its flat picture.
"""
import glob, os
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

PURPLE = (145, 70, 255)
GLOW = (196, 166, 255)
VERSION = 1  # bump to redraw every box after a design change
# the cover area on the case's front (see _front): width / height
ART_RATIO = (640 - 2 * 11) / (960 - 86 - 5 - 11)
MAX_CROP = 0.20


def fits(w, h):
    """True when a w x h cover fills the case losing at most MAX_CROP of its
    width (a cover a bit wider than the case) or height (a bit taller)."""
    if not w or not h:
        return False
    r = w / h
    lost = 1 - ART_RATIO / r if r > ART_RATIO else 1 - r / ART_RATIO
    return lost <= MAX_CROP


def _font(size):
    for f in ["/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
              "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf"] + sorted(glob.glob("/usr/share/fonts/**/*Bold*.ttf", recursive=True)):
        if os.path.exists(f):
            try:
                return ImageFont.truetype(f, size)
            except Exception:
                pass
    try:
        return ImageFont.load_default(size)
    except TypeError:
        return ImageFont.load_default()


def _solve(a, b):
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(m[r][c]))
        m[c], m[p] = m[p], m[c]
        for r in range(n):
            if r != c:
                f = m[r][c] / m[c][c]
                m[r] = [x - f * y for x, y in zip(m[r], m[c])]
    return [m[i][n] / m[i][i] for i in range(n)]


def _warp(img, quad, size):
    w, h = img.size
    a, b = [], []
    for (x, y), (u, v) in zip(quad, [(0, 0), (w, 0), (w, h), (0, h)]):
        a.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.append(u)
        a.append([0, 0, 0, x, y, 1, -v * x, -v * y]); b.append(v)
    return img.transform(size, Image.Transform.PERSPECTIVE, _solve(a, b), Image.Resampling.BICUBIC)


def _spaced(d, xy, text, f, fill, spacing, anchor_mid=True):
    widths = [d.textlength(c, font=f) for c in text]
    total = sum(widths) + spacing * (len(text) - 1)
    x, y = xy
    if anchor_mid:
        x -= total / 2
    for c, w in zip(text, widths):
        d.text((x, y), c, font=f, fill=fill, anchor="lm")
        x += w + spacing
    return total


def _round(img, r):
    m = Image.new("L", img.size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, img.width - 1, img.height - 1], radius=r, fill=255)
    out = img.convert("RGBA"); out.putalpha(m)
    return out


def top_banner(img):
    """True when a cover starts with a banner across its top: a strip at most a
    sixth of its height, mostly one colour or smoothly shaded, ending in a
    straight line across the whole width (the XBOX 360 band, the original
    Xbox's, "Digital version"...)."""
    w, h = 120, 180
    im = img.convert("RGB").resize((w, h), Image.Resampling.BILINEAR)
    px = im.load()
    def diff(a, b):
        return abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])
    for y in range(int(h * 0.04), int(h * 0.17)):
        # the line under the band: nearly every column changes sharply here,
        # and stays changed a couple of rows down (not a thin rule in the art)
        # (under a pure black strip, a step to dark grey counts too: the black
        # REMASTERED band on dark artwork)
        def step(x):
            a, b, c = px[x, y - 1], px[x, y], px[x, min(h - 1, y + 2)]
            if diff(a, b) > 60 or diff(a, c) > 90:
                return True
            return sum(a) < 24 and diff(a, c) > 28 and diff(a, px[x, min(h - 1, y + 4)]) > 28
        cut = sum(1 for x in range(w) if step(x))
        if cut < w * 0.75:
            continue
        # the band above it: one colour covers most of it
        bins = {}
        for yy in range(0, y - 1):
            for x in range(w):
                c = px[x, yy]
                k = (c[0] // 32, c[1] // 32, c[2] // 32)
                bins[k] = bins.get(k, 0) + 1
        top = max(bins.values()) if bins else 0
        if top >= 0.45 * w * max(1, y - 1):
            return True
        # or it's smooth: a flat colour or a gentle shade (the original Xbox's
        # brushed-metal band), with only its logo and lettering as detail
        smooth = sum(1 for yy in range(0, y - 1) for x in range(w - 1) if diff(px[x, yy], px[x + 1, yy]) < 24)
        if smooth >= 0.55 * (w - 1) * max(1, y - 1):
            return True
    return False


def _front(cover, logo, W=640, H=960):
    face = Image.new("RGB", (W, H), (6, 6, 6))
    head, edge = 86, 11
    d = ImageDraw.Draw(face)
    for y in range(head):                                # glossy black header, a hint of green
        t = y / head
        d.line([(0, y), (W, y)], fill=(int(34 - 28 * t), int(23 - 17 * t), int(53 - 47 * t)))
    lg = logo.copy(); lg.thumbnail((62, 62), Image.Resampling.LANCZOS)
    face.paste(lg, (34, (head - lg.height) // 2), lg)
    f = _font(31)
    d.text((34 + lg.width + 14, head / 2 + 2), "AMAZON LUNA", font=f, fill="white", anchor="lm")
    for i in range(14):                                  # the glowing line
        a = max(0, 1 - i / 14) ** 2
        d.line([(0, head - i), (W, head - i)], fill=tuple(int(c1 * (1 - a * 0.5) + c2 * a * 0.5) for c1, c2 in zip(d.im.getpixel((5, head - i))[:3], PURPLE)))
    d.rectangle([0, head, W, head + 5], fill=PURPLE)
    d.line([(0, head), (W, head)], fill=GLOW, width=2)
    # a cover taller than the box is trimmed evenly top and bottom; one with a
    # banner across its top loses only its bottom instead, so the banner
    # isn't cut in half
    rgb = cover.convert("RGB")
    art = ImageOps.fit(rgb, (W - 2 * edge, H - head - 5 - edge), Image.Resampling.LANCZOS,
                       centering=(0.5, 0.0) if top_banner(rgb) else (0.5, 0.5))
    face.paste(art, (edge, head + 5))
    return _round(face, 16)


def _spine(title, logo, W=58, H=960):
    sp = Image.new("RGB", (W, H), (4, 4, 4))
    d = ImageDraw.Draw(sp)
    for x in range(W):                                   # rounded plastic: lighter in the middle
        v = int(4 + 20 * (1 - abs(x - W * 0.45) / (W / 2)) ** 2)
        d.line([(x, 0), (x, H)], fill=(v, v, v))
    lg = logo.copy(); lg.thumbnail((W - 20, W - 20), Image.Resampling.LANCZOS)
    sp.paste(lg, ((W - lg.width) // 2, 24), lg)
    # the name, top to bottom, in big spaced capitals (like "RAFT")
    side = Image.new("RGBA", (H - 120, W), (0, 0, 0, 0))
    sd = ImageDraw.Draw(side)
    t, size = title.upper(), 27
    f = _font(size)
    width = lambda: sum(sd.textlength(c, font=f) for c in t) + 10 * (len(t) - 1)
    while width() > side.width - 30 and len(t) > 3:
        size -= 2
        if size < 18:
            t, size = t[:-2].rstrip() + "…", 18
        f = _font(size)
    _spaced(sd, (6, W / 2 + 1), t, f, "white", 10, False)
    side = side.rotate(-90, expand=True)
    sp.paste(side, (0, 96), side)
    return _round(sp, 10)


def make(cover, title, logo, out_w=500):
    """The case as an RGBA picture out_w wide."""
    S = 2
    CW, CH = 620 * S, 910 * S
    canvas = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    sx0, sx1, fx1 = 16 * S, 52 * S, 604 * S
    front_q = [(sx1, 10 * S), (fx1, 34 * S), (fx1, 872 * S), (sx1, 898 * S)]
    spine_q = [(sx0, 22 * S), (sx1, 10 * S), (sx1, 898 * S), (sx0, 886 * S)]
    sh = Image.new("L", (CW, CH), 0)                     # a soft shadow on the floor
    ImageDraw.Draw(sh).polygon([(sx0 + 10 * S, 892 * S), (fx1, 866 * S), (fx1 - 6 * S, 880 * S), (sx0 + 20 * S, 906 * S)], fill=160)
    sh = sh.filter(ImageFilter.GaussianBlur(10 * S))
    canvas.paste((0, 0, 0, 255), (0, 0), sh)
    canvas.alpha_composite(_warp(_spine(title, logo), spine_q, (CW, CH)))
    canvas.alpha_composite(_warp(_front(cover, logo), front_q, (CW, CH)))
    # a soft gloss across the cover, and light catching the case edges
    gloss = Image.new("L", (CW, CH), 0)
    ImageDraw.Draw(gloss).polygon([(sx1, 10 * S), (sx1 + 260 * S, 22 * S), (sx1 + 40 * S, 896 * S), (sx1, 898 * S)], fill=30)
    gloss = gloss.filter(ImageFilter.GaussianBlur(60 * S))
    mask = Image.new("L", (CW, CH), 0)
    ImageDraw.Draw(mask).polygon(front_q, fill=255)
    gloss = Image.composite(gloss, Image.new("L", (CW, CH), 0), mask)
    canvas.alpha_composite(Image.merge("RGBA", (Image.new("L", (CW, CH), 255),) * 3 + (gloss,)))
    e = ImageDraw.Draw(canvas)
    e.line([(sx1, 16 * S), (sx1, 892 * S)], fill=(255, 255, 255, 60), width=S)
    e.line([(fx1 - 1 * S, 46 * S), (fx1 - 1 * S, 860 * S)], fill=(255, 255, 255, 50), width=S)
    canvas = canvas.crop(canvas.getbbox())
    return canvas.resize((out_w, round(canvas.height * out_w / canvas.width)), Image.Resampling.LANCZOS)
