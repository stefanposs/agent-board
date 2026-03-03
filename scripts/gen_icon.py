import struct
import zlib

w, h = 128, 128
pixels = []
for y in range(h):
    row = [0]  # filter byte
    for x in range(w):
        dx = min(x, w - 1 - x)
        dy = min(y, h - 1 - y)
        corner = 16
        r = int(59 + (139 - 59) * x / w)
        g = int(130 + (92 - 130) * x / w)
        b = 246
        a = 255
        if dx < corner and dy < corner:
            dist_sq = (corner - dx) ** 2 + (corner - dy) ** 2
            if dist_sq > corner ** 2:
                a = 0
        row.extend([r, g, b, a])
    pixels.append(bytes(row))

raw = b"".join(pixels)

def make_chunk(ctype, data):
    c = ctype + data
    return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

png = b"\x89PNG\r\n\x1a\n"
png += make_chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
png += make_chunk(b"IDAT", zlib.compress(raw))
png += make_chunk(b"IEND", b"")

with open("media/icon.png", "wb") as f:
    f.write(png)
print("Created media/icon.png")
