# PC（pc_basic）の向き違いの絵を生成する（N95）。名前の向きは、座った社員が向く方向（机・椅子と同じ）。画面は社員の方を向く。
# 奥向きの device/pc_basic.png は手で描いたもので、ここでは作らない。
# 色と大きさ（24×40、足元は y=37）は pc_basic.png に合わせる。
# 使い方: python scripts/gen-pc-facings.py
# 出力先: src/assets/sprites/device/pc_basic_front.png・pc_basic_left.png・pc_basic_right.png
import os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), '..', 'src', 'assets', 'sprites', 'device')

# pc_basic.png の色
O = (59, 42, 51)      # 輪郭
W = (244, 241, 230)   # 天面・キーボード
F = (223, 227, 232)   # 筐体
S = (98, 196, 255)    # 画面
SD = (59, 95, 138)    # 画面（暗い部分）
L = (98, 210, 111)    # 電源のランプ
G = (163, 172, 184)   # キーの影・筐体の影


def new():
    img = Image.new('RGBA', (24, 40), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def rect(d, x, y, w, h, fill, outline=None):
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=fill + (255,), outline=(outline + (255,)) if outline else None)


def px(d, x, y, c):
    d.point((x, y), fill=c + (255,))


def keyboard_far(d):
    # 奥のキーボード（モニターの向こう側）。上の縁だけが見える
    rect(d, 4, 11, 16, 4, W, O)
    for x in range(6, 18, 2):
        px(d, x, 12, G)


def back():
    # 手前向き（社員はこちらを向き、画面は奥を向く）: モニターの背面と台座。キーボードはモニターの奥にあり、上に少し見える
    img, d = new()
    keyboard_far(d)
    # モニターの上の縁（天面）と背面
    rect(d, 2, 14, 20, 3, W, O)
    rect(d, 2, 16, 20, 14, F, O)
    # 背面の膨らみ（中央の箱）と通気口
    rect(d, 6, 19, 12, 8, G, O)
    for y in (21, 23, 25):
        d.line([(8, y), (15, y)], fill=F + (255,))
    # 首と台座
    rect(d, 10, 30, 4, 3, G, O)
    rect(d, 6, 32, 12, 5, W, O)
    d.line([(7, 36), (16, 36)], fill=G + (255,))
    return img


def side():
    # 右向き（社員は右を向き、画面は左の社員の方を向く）: モニターを横から見る。キーボードは画面の前（左）に縦に置く
    img, d = new()
    # キーボード: 縦長の天面と手前の縁
    rect(d, 2, 24, 7, 13, W, O)
    for y in range(26, 34, 2):
        px(d, 4, y, G)
        px(d, 6, y + 1, G)
    d.line([(3, 35), (7, 35)], fill=G + (255,))
    # モニター: 上の縁（天面）と側面。左の縁に画面の光を細く見せる
    rect(d, 12, 14, 6, 3, W, O)
    rect(d, 12, 16, 6, 14, F, O)
    d.line([(13, 17), (13, 28)], fill=S + (255,))
    d.line([(16, 17), (16, 28)], fill=G + (255,))
    px(d, 14, 28, L)
    # 首と台座（奥行きのある台）
    rect(d, 14, 30, 3, 3, G, O)
    rect(d, 11, 32, 9, 5, W, O)
    d.line([(12, 36), (18, 36)], fill=G + (255,))
    return img


def main():
    os.makedirs(ROOT, exist_ok=True)
    back().save(os.path.join(ROOT, 'pc_basic_front.png'))
    right = side()
    right.save(os.path.join(ROOT, 'pc_basic_right.png'))
    right.transpose(Image.FLIP_LEFT_RIGHT).save(os.path.join(ROOT, 'pc_basic_left.png'))


if __name__ == '__main__':
    main()
