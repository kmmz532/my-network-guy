# OGP の画像（1200×630）を生成する。使い方: python scripts/gen-ogp.py
# タイトル画面と同じ見た目: オフィスの床と奥の壁、題名、ケーブルでつないだ機器の並び、社員
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(__file__)
SPRITES = os.path.join(HERE, '..', 'src', 'assets', 'sprites')
OUT = os.path.join(HERE, '..', 'public', 'ogp.png')
W, H = 1200, 630
S = 4  # スプライトの拡大率


def sprite(name):
    return Image.open(os.path.join(SPRITES, name + '.png')).convert('RGBA')


def big(im, s=S):
    return im.resize((im.width * s, im.height * s), Image.NEAREST)


def font(size):
    # ドット風の書体があれば使い、なければ Windows の既定のゴシック体
    for path in (os.path.join(HERE, 'fonts', 'DotGothic16-Regular.ttf'), 'C:/Windows/Fonts/meiryob.ttc', 'C:/Windows/Fonts/msgothic.ttc'):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


img = Image.new('RGBA', (W, H))
# 床
tile = 32 * 3
for y in range(0, H, tile):
    for x in range(0, W, tile):
        img.alpha_composite(big(sprite(f'tile/floor_{(x // tile + y // tile) % 3}'), 3), (x, y))
# 奥の壁と窓
for x in range(0, W, tile):
    img.alpha_composite(big(sprite('tile/wall_face'), 3), (x, 0))
for x in range(tile, W, tile * 4):
    img.alpha_composite(big(sprite('tile/window'), 3), (x, 0))
# 文字が読めるよう暗い層
shade = Image.new('RGBA', (W, H), (27, 20, 32, 90))
img.alpha_composite(shade)

d = ImageDraw.Draw(img)
title = '私のネットワーク屋'
f = font(96)
tw = d.textlength(title, font=f)
tx, ty = (W - tw) / 2, 120
for dx, dy in ((-4, 0), (4, 0), (0, -4), (0, 4), (4, 4)):
    d.text((tx + dx, ty + dy), title, font=f, fill=(59, 42, 51, 255))
d.text((tx, ty), title, font=f, fill=(255, 255, 255, 255))
sub = 'My Network Guy'
fs = font(32)
d.text(((W - d.textlength(sub, font=fs)) / 2, 236), sub, font=fs, fill=(255, 230, 150, 255))

# 機器の並びとケーブル
names = ['device/pc_basic', 'device/l2_switch_8p', 'device/router_basic', 'device/server_basic']
devs = [big(sprite(n)) for n in names]
gap = 70
total = sum(im.width for im in devs) + gap * (len(devs) - 1)
x = (W - total) // 2
base_y = 300
centers = []
for im in devs:
    centers.append((x + im.width // 2, base_y + im.height - 40))
    x += im.width + gap
d.line(centers, fill=(98, 210, 111, 255), width=6)
x = (W - total) // 2
for im in devs:
    img.alpha_composite(im, (x, base_y))
    x += im.width + gap
for i, cx in ((0, 40), (2, 60)):
    pass
# 社員2人
for name, cx in (('staff/blue_0', centers[0][0]), ('staff/red_0', centers[3][0])):
    st = big(sprite(name))
    img.alpha_composite(st, (cx - st.width // 2, base_y + 170))

img.convert('RGB').save(OUT)
print('ok')
