"""Generate a proper Agent Board logo (128x128 PNG with rounded-rect gradient + board grid icon)."""
import struct, zlib, math

W, H = 128, 128
CORNER = 20

# Gradient colors: blue (#3b82f6) → purple (#8b5cf6)
C1 = (59, 130, 246)   # --accent-blue
C2 = (139, 92, 246)   # --accent-purple

def lerp(a, b, t):
    return int(a + (b - a) * t)

def in_rounded_rect(x, y, w, h, r):
    """Check if (x,y) is inside a rounded rectangle."""
    if x < r and y < r:
        return (r - x)**2 + (r - y)**2 <= r**2
    if x >= w - r and y < r:
        return (x - (w - r - 1))**2 + (r - y)**2 <= r**2
    if x < r and y >= h - r:
        return (r - x)**2 + (y - (h - r - 1))**2 <= r**2
    if x >= w - r and y >= h - r:
        return (x - (w - r - 1))**2 + (y - (h - r - 1))**2 <= r**2
    return True

def in_circle(cx, cy, r, x, y):
    return (x - cx)**2 + (y - cy)**2 <= r**2

pixels = []
for y in range(H):
    row = [0]  # PNG filter byte
    for x in range(W):
        t = (x + y) / (W + H)  # diagonal gradient
        r = lerp(C1[0], C2[0], t)
        g = lerp(C1[1], C2[1], t)
        b = lerp(C1[2], C2[2], t)
        a = 255

        # Rounded rectangle background
        if not in_rounded_rect(x, y, W, H, CORNER):
            r, g, b, a = 0, 0, 0, 0
        else:
            # Draw a simple "board grid" icon in the center (white, semi-transparent)
            # 3x3 grid of rounded squares
            grid_x0, grid_y0 = 30, 30
            grid_size = 68
            cell = 18
            gap = 7
            icon_alpha = 0

            for row_i in range(3):
                for col_i in range(3):
                    cx0 = grid_x0 + col_i * (cell + gap)
                    cy0 = grid_y0 + row_i * (cell + gap)
                    cx1 = cx0 + cell
                    cy1 = cy0 + cell
                    cr = 4  # small corner radius for cells

                    if cx0 <= x < cx1 and cy0 <= y < cy1:
                        # Check rounded corners of cell
                        lx = x - cx0
                        ly = y - cy0
                        cw = cell
                        ch = cell
                        if in_rounded_rect(lx, ly, cw, ch, cr):
                            # Different opacity for different cells to create depth
                            if row_i == 0 and col_i == 0:
                                icon_alpha = 230
                            elif row_i == 1 and col_i == 1:
                                icon_alpha = 255
                            elif (row_i + col_i) % 2 == 0:
                                icon_alpha = 200
                            else:
                                icon_alpha = 140

            if icon_alpha > 0:
                # Blend white icon over gradient
                fa = icon_alpha / 255.0
                r = int(r * (1 - fa) + 255 * fa)
                g = int(g * (1 - fa) + 255 * fa)
                b = int(b * (1 - fa) + 255 * fa)

        row.extend([r, g, b, a])
    pixels.append(bytes(row))

raw = b"".join(pixels)

def make_chunk(ctype, data):
    c = ctype + data
    return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

png = b"\x89PNG\r\n\x1a\n"
png += make_chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0))
png += make_chunk(b"sRGB", b"\x00")
png += make_chunk(b"IDAT", zlib.compress(raw, 9))
png += make_chunk(b"IEND", b"")

# Write to all logo locations
for path in ["public/logo.png", "media/logo.png"]:
    with open(path, "wb") as f:
        f.write(png)
    print(f"Created {path} ({len(png)} bytes)")
