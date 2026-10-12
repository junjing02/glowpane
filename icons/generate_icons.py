from PIL import Image, ImageChops, ImageDraw, ImageFilter

# Glowpane icon: a graphite tile, a glowing video pane on the left and three
# stacked side panes on the right. Drawn large and scaled down, so the small
# sizes stay smooth. No relation to YouTube's red/white branding, on purpose.
SCALE = 8
BASE = 128
CANVAS = BASE * SCALE

# The video pane's light: warm amber at the top through pink to violet.
GLOW_STOPS = [(0.0, (255, 190, 110)), (0.5, (255, 96, 150)), (1.0, (124, 104, 255))]


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient_color(t):
    for (t0, c0), (t1, c1) in zip(GLOW_STOPS, GLOW_STOPS[1:]):
        if t <= t1:
            return lerp(c0, c1, (t - t0) / (t1 - t0))
    return GLOW_STOPS[-1][1]


def vertical_gradient(size, top, bottom, color_at):
    """An RGBA image filled with color_at(0..1) between rows top and bottom."""
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for y in range(size[1]):
        t = min(1.0, max(0.0, (y - top) / max(1, bottom - top)))
        d.line([(0, y), (size[0], y)], fill=color_at(t) + (255,))
    return img


def rounded_mask(size, box, radius):
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(box, radius=radius, fill=255)
    return mask


def make_icon():
    size = (CANVAS, CANVAS)
    tile_box = [0, 0, CANVAS - 1, CANVAS - 1]
    tile_radius = int(CANVAS * 0.225)
    tile_mask = rounded_mask(size, tile_box, tile_radius)

    # Tile: graphite, slightly lighter at the top.
    tile = vertical_gradient(size, 0, CANVAS, lambda t: lerp((34, 35, 42), (10, 11, 14), t))

    # Layout of the panes inside the tile.
    margin = int(CANVAS * 0.17)
    left, top, right, bottom = margin, margin, CANVAS - margin, CANVAS - margin
    inner_w = right - left
    gap = int(inner_w * 0.09)
    video_w = int(inner_w * 0.60)
    video_box = [left, top, left + video_w, bottom]
    side_x0 = left + video_w + gap
    pane_radius = int(CANVAS * 0.055)

    # Ambient light: the video pane's own colors, blurred wide behind it.
    colors = vertical_gradient(size, top, bottom, gradient_color)
    glow = Image.new("RGBA", size, (0, 0, 0, 0))
    spread = int(CANVAS * 0.03)
    glow_mask = rounded_mask(
        size, [video_box[0] - spread, video_box[1] - spread, video_box[2] + spread, video_box[3] + spread], pane_radius * 2
    )
    glow.paste(colors, (0, 0), glow_mask)
    glow = glow.filter(ImageFilter.GaussianBlur(CANVAS * 0.085))
    glow.putalpha(glow.getchannel("A").point(lambda a: int(a * 0.85)))
    tile = Image.alpha_composite(tile, glow)

    # Video pane: the gradient itself, with a soft sheen across its top half.
    video = Image.new("RGBA", size, (0, 0, 0, 0))
    video.paste(colors, (0, 0), rounded_mask(size, video_box, pane_radius))
    tile = Image.alpha_composite(tile, video)
    sheen = vertical_gradient(size, top, top + (bottom - top) // 2, lambda t: (255, 255, 255))
    sheen_alpha = Image.new("L", size, 0)
    sd = ImageDraw.Draw(sheen_alpha)
    for y in range(top, top + (bottom - top) // 2):
        t = (y - top) / ((bottom - top) / 2)
        sd.line([(0, y), (CANVAS, y)], fill=int(70 * (1 - t)))
    sheen.putalpha(ImageChops.multiply(sheen_alpha, rounded_mask(size, video_box, pane_radius)))
    tile = Image.alpha_composite(tile, sheen)

    # Side panes: three stacked blocks, fading down like a list scrolling away.
    panes = Image.new("RGBA", size, (0, 0, 0, 0))
    pd = ImageDraw.Draw(panes)
    inner_h = bottom - top
    pane_gap = int(inner_h * 0.075)
    heights = [0.26, 0.37]
    y = top
    for share, alpha in zip(heights + [None], (240, 150, 84)):
        h = int(inner_h * share) if share else bottom - y
        pd.rounded_rectangle([side_x0, y, right, y + h], radius=int(pane_radius * 0.8), fill=(255, 255, 255, alpha))
        y += h + pane_gap
    tile = Image.alpha_composite(tile, panes)

    # A fine light edge around the tile, brighter at the top.
    edge = Image.new("RGBA", size, (0, 0, 0, 0))
    stroke = max(2, int(CANVAS * 0.008))
    ImageDraw.Draw(edge).rounded_rectangle(tile_box, radius=tile_radius, outline=(255, 255, 255, 255), width=stroke)
    fade = Image.new("L", size, 0)
    fd = ImageDraw.Draw(fade)
    for yy in range(CANVAS):
        fd.line([(0, yy), (CANVAS, yy)], fill=int(64 - 44 * (yy / CANVAS)))
    edge.putalpha(ImageChops.multiply(edge.getchannel("A"), fade))
    tile = Image.alpha_composite(tile, edge)

    out = Image.new("RGBA", size, (0, 0, 0, 0))
    out.paste(tile, (0, 0), tile_mask)
    return out


icon = make_icon()

for size in (16, 48, 128):
    icon.resize((size, size), Image.LANCZOS).save(f"icon{size}.png")
    print(f"wrote icon{size}.png")
# Large copy for the landing page and link previews.
icon.resize((512, 512), Image.LANCZOS).save("icon512.png")
print("wrote icon512.png")
