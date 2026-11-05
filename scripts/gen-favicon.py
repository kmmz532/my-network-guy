# ファビコンとホーム画面のアイコンを生成する。使い方: python scripts/gen-favicon.py
# スイッチのポートにプラグが刺さり、ケーブルが上へ伸びる絵: スイッチのポートにプラグが刺さり、ケーブルが上へ伸びる。
# 中身は 16 px と 32 px をそれぞれ1ドットずつ描く。枠は favs5 と同じ、なめらかな角丸の紺
import sys
from PIL import Image, ImageDraw

import os
out = os.path.join(os.path.dirname(__file__), '..', 'public')
O = (36, 26, 32, 255)
Y = (255, 206, 72, 255)
B = (60, 112, 210, 255)
BH = (120, 166, 240, 255)
BD = (40, 76, 150, 255)
G = (90, 230, 110, 255)
W = (248, 246, 238, 255)
L = (214, 222, 234, 255)
FILL = (28, 38, 66, 255)
EDGE = (70, 92, 140, 255)
RIM = (16, 22, 40, 255)
SS = 8


def R(d, x, y, w, h, c):
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=c)


def frame(n):
    big = Image.new('RGBA', (n * SS, n * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    r = int(n * SS * 0.09)
    e = max(SS, int(n * SS / 32))
    # 外側の明るめの縁、暗い縁、塗りの順に重ねる（32 px でそれぞれ 1 px）
    d.rounded_rectangle([0, 0, n * SS - 1, n * SS - 1], radius=r, fill=EDGE)
    d.rounded_rectangle([e, e, n * SS - 1 - e, n * SS - 1 - e], radius=max(1, r - e), fill=RIM)
    d.rounded_rectangle([2 * e, 2 * e, n * SS - 1 - 2 * e, n * SS - 1 - 2 * e], radius=max(1, r - 2 * e), fill=FILL)
    return big.resize((n, n), Image.LANCZOS)


def content32():
    # 28×28 の中に描く
    img = Image.new('RGBA', (28, 28), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # ケーブル（上から下のプラグへ）
    R(d, 11, 0, 6, 9, O)
    R(d, 12, 0, 4, 9, B)
    R(d, 12, 0, 1, 9, BH)
    # スイッチの箱
    R(d, 0, 12, 28, 14, O)
    R(d, 1, 13, 26, 3, BH)
    R(d, 1, 16, 26, 9, B)
    R(d, 1, 24, 26, 1, BD)
    # ポート（空き）
    for x in (3, 21):
        R(d, x, 18, 4, 4, O)
    # 緑のLED（刺さったポートの上だけ点灯、ほかは消灯）
    for x, on in ((4, False), (20, True), (23, False)):
        R(d, x, 14, 2, 1, G if on else BD)
    # 刺さったプラグ（ポートの位置から上へはみ出す）
    R(d, 9, 8, 10, 14, O)
    R(d, 10, 9, 8, 12, W)
    R(d, 10, 9, 8, 3, L)
    for x in (11, 13, 15, 17):
        R(d, x, 17, 1, 3, Y)
    return img


def content16():
    # 14×14 の中に描く
    img = Image.new('RGBA', (14, 14), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    R(d, 5, 0, 4, 4, O)
    R(d, 6, 0, 2, 4, B)
    R(d, 0, 6, 14, 7, O)
    R(d, 1, 7, 12, 1, BH)
    R(d, 1, 8, 12, 4, B)
    R(d, 2, 9, 2, 2, O)
    R(d, 10, 9, 2, 2, O)
    R(d, 4, 3, 6, 8, O)
    R(d, 5, 4, 4, 6, W)
    R(d, 5, 8, 1, 1, Y)
    R(d, 7, 8, 1, 1, Y)
    d.point((10, 7), fill=G)
    d.point((11, 7), fill=G)
    return img


def compose(n, content):
    img = frame(n)
    img.alpha_composite(content, ((n - content.width) // 2, (n - content.height) // 2))
    return img


i16 = compose(16, content16())
i32 = compose(32, content32())
c192 = content32().resize((28 * 5, 28 * 5), Image.NEAREST)
i192 = compose(192, c192)
i16.save(os.path.join(out, 'favicon-16.png'))
i32.save(os.path.join(out, 'favicon.png'))
i192.save(os.path.join(out, 'icon-192.png'))
# OGP（SNS のカード）に出すサイトのロゴ。512 px の正方形
i512 = compose(512, content32().resize((28 * 16, 28 * 16), Image.NEAREST))
i512.save(os.path.join(out, 'icon-512.png'))
# マスク可能なアイコン（Android が円・角丸に切り抜く）。枠は付けず、背景を全面に塗る。
# 絵は円の安全域（直径の 80%）に収まるよう、512 px の 55% にする
m = Image.new('RGBA', (512, 512), FILL)
mc = content32().resize((28 * 10, 28 * 10), Image.NEAREST)
m.alpha_composite(mc, ((512 - mc.width) // 2, (512 - mc.height) // 2))
m.convert('RGB').save(os.path.join(out, 'icon-maskable-512.png'))
print('ok')
