#!/usr/bin/env python3
"""Genera le icone PNG di DentalFlow usando solo la libreria standard (zlib + struct).

Disegno: sfondo a gradiente diagonale (azzurro #2F8CFF in alto a sinistra -> blu indaco #3D4FE0 in basso
a destra) con un dente bianco morbido: corona a due lobi e radici affusolate fuse con un "minimo morbido"
(niente spigoli né scalini), più un'ombra leggera sotto il dente.
Antialias: supersampling 4x (4x4 campioni) sui pixel vicini ai bordi, poi media (box filter).

Uso:  python3 tools/make_icons.py   (scrive in icons/)
"""
import math
import os
import struct
import sys
import zlib

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons')
SS = 4  # supersampling per asse

TOP_LEFT = (0x2F, 0x8C, 0xFF)
BOTTOM_RIGHT = (0x3D, 0x4F, 0xE0)
WHITE = (255, 255, 255)
SHADOW = (0x12, 0x2A, 0x8C)


# ---------- funzioni di distanza (unità del glifo: il dente sta nel cerchio di raggio ~1) ----------

def sd_round_box(x, y, cx, cy, hw, hh, r):
    qx = abs(x - cx) - hw + r
    qy = abs(y - cy) - hh + r
    ox = max(qx, 0.0)
    oy = max(qy, 0.0)
    return math.hypot(ox, oy) + min(max(qx, qy), 0.0) - r


def sd_round_cone(px, py, ax, ay, bx, by, r1, r2):
    """Segmento con raggio che va da r1 (in a) a r2 (in b): radice affusolata con estremità tonde."""
    bax, bay = bx - ax, by - ay
    l2 = bax * bax + bay * bay
    rr = r1 - r2
    a2 = l2 - rr * rr
    il2 = 1.0 / l2
    pax, pay = px - ax, py - ay
    y = pax * bax + pay * bay
    z = y - l2
    qx, qy = pax * l2 - bax * y, pay * l2 - bay * y
    x2 = qx * qx + qy * qy
    y2 = y * y * l2
    z2 = z * z * l2
    k = math.copysign(1.0, rr) * rr * rr * x2
    if math.copysign(1.0, z) * a2 * z2 > k:
        return math.sqrt(x2 + z2) * il2 - r2
    if math.copysign(1.0, y) * a2 * y2 < k:
        return math.sqrt(x2 + y2) * il2 - r1
    return (math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1


def smin(a, b, k):
    """Minimo morbido: unisce due forme con un raccordo di ampiezza k."""
    h = max(k - abs(a - b), 0.0) / k
    return min(a, b) - h * h * k * 0.25


def sd_tooth(x, y):
    lobe_l = math.hypot(x + 0.31, y + 0.33) - 0.37
    lobe_r = math.hypot(x - 0.31, y + 0.33) - 0.37
    d = smin(lobe_l, lobe_r, 0.10)  # la piccola valle tra i lobi resta, ma senza punta
    d = smin(d, sd_round_box(x, y, 0.0, -0.13, 0.64, 0.21, 0.21), 0.22)
    root_l = sd_round_cone(x, y, -0.37, 0.05, -0.23, 0.80, 0.27, 0.10)
    root_r = sd_round_cone(x, y, 0.37, 0.05, 0.23, 0.80, 0.27, 0.10)
    d = smin(d, root_l, 0.26)
    d = smin(d, root_r, 0.26)
    return d


def glyph_extent():
    """Distanza massima dal centro dei punti del dente (scansione fitta), per il controllo della safe zone."""
    ext = 0.0
    n = 600
    for j in range(n):
        y = -1.2 + 2.4 * j / (n - 1)
        for i in range(n):
            x = -1.2 + 2.4 * i / (n - 1)
            if sd_tooth(x, y) < 0:
                ext = max(ext, math.hypot(x, y))
    return ext + 0.01


# ---------- rendering ----------

def lerp(a, b, t):
    return a + (b - a) * t


def render(size, glyph_scale, rounded_bg):
    """Ritorna (pixels RGBA come bytearray, maschera glifo come lista di bool)."""
    cx = cy = size / 2.0
    radius_bg = 0.22 * size
    px = bytearray(size * size * 4)
    glyph_mask = [False] * (size * size)
    unit = 1.0 / glyph_scale  # 1 pixel in unità glifo
    edge = 1.5 * unit  # banda larga: il minimo morbido non è una distanza esatta
    sub = [(i + 0.5) / SS for i in range(SS)]

    def bg_sd(x, y):
        if not rounded_bg:
            return -1.0
        return sd_round_box(x, y, cx, cy, size / 2.0, size / 2.0, radius_bg)

    for j in range(size):
        for i in range(size):
            pxc, pyc = i + 0.5, j + 0.5
            t = min(1.0, max(0.0, (i + j) / (2.0 * (size - 1))))  # gradiente diagonale
            bg_col = tuple(lerp(TOP_LEFT[c], BOTTOM_RIGHT[c], t) for c in range(3))
            # ombra morbida sotto il dente (spostata in basso), sfumata con la distanza
            ds = sd_tooth((pxc - cx) / glyph_scale, (pyc - cy) / glyph_scale - 0.07)
            sh = 0.28 * min(1.0, max(0.0, 1.0 - (ds + 0.02) / 0.16))
            if sh > 0:
                bg_col = tuple(lerp(bg_col[c], SHADOW[c], sh) for c in range(3))
            # copertura sfondo
            dbg = bg_sd(pxc, pyc)
            if dbg < -0.75:
                cov_bg = 1.0
            elif dbg > 0.75:
                cov_bg = 0.0
            else:
                hits = 0
                for sy in sub:
                    for sx in sub:
                        if bg_sd(i + sx, j + sy) < 0:
                            hits += 1
                cov_bg = hits / (SS * SS)
            # copertura dente
            gx, gy = (pxc - cx) / glyph_scale, (pyc - cy) / glyph_scale
            dt = sd_tooth(gx, gy)
            if dt < -edge:
                cov_t = 1.0
            elif dt > edge:
                cov_t = 0.0
            else:
                hits = 0
                for sy in sub:
                    for sx in sub:
                        if sd_tooth((i + sx - cx) / glyph_scale, (j + sy - cy) / glyph_scale) < 0:
                            hits += 1
                cov_t = hits / (SS * SS)
            if cov_t > 0:
                glyph_mask[j * size + i] = True
            # composizione: dente sopra sfondo (il dente è dentro lo sfondo)
            r = lerp(bg_col[0], WHITE[0], cov_t)
            g = lerp(bg_col[1], WHITE[1], cov_t)
            b = lerp(bg_col[2], WHITE[2], cov_t)
            a = max(cov_bg, cov_t)
            k = (j * size + i) * 4
            px[k] = int(round(r))
            px[k + 1] = int(round(g))
            px[k + 2] = int(round(b))
            px[k + 3] = int(round(a * 255))
    return px, glyph_mask


def png_bytes(size, rgba):
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)  # filtro 0 (None)
        raw.extend(rgba[y * stride:(y + 1) * stride])
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b''))


def check_safe_zone(name, size, mask):
    limit = 0.36 * size
    c = size / 2.0
    for j in range(size):
        for i in range(size):
            if mask[j * size + i] and math.hypot(i + 0.5 - c, j + 0.5 - c) > limit:
                print(f'ERRORE: {name}: pixel del glifo ({i},{j}) fuori dal cerchio sicuro di raggio {limit:.1f}px',
                      file=sys.stderr)
                return False
    return True


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    ext = glyph_extent()
    # (file, lato, sfondo arrotondato, scala del glifo in px per unità, controllo safe zone)
    specs = [
        ('icon-192.png', 192, True, 0.40, False),
        ('icon-512.png', 512, True, 0.40, False),
        ('favicon-32.png', 32, True, 0.42, False),
        # full-bleed: l'intero glifo sta in un cerchio di diametro 72% (raggio 0.36*size), con margine
        ('icon-maskable-512.png', 512, False, 0.36 * 0.94 / ext, True),
        ('apple-touch-icon.png', 180, False, 0.36 * 0.94 / ext, True),
    ]
    ok = True
    for name, size, rounded, scale_frac, check in specs:
        px, mask = render(size, scale_frac * size, rounded)
        if check and not check_safe_zone(name, size, mask):
            ok = False
            continue
        with open(os.path.join(OUT_DIR, name), 'wb') as f:
            f.write(png_bytes(size, px))
        print(f'scritto icons/{name} ({size}x{size})')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
