# ドット絵のスプライトを生成する。色は memo/ART.md のパレットに従う。
# 使い方: python scripts/gen-sprites.py
# 出力先: src/assets/sprites/（device/・staff/・icon/）
import os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), '..', 'src', 'assets', 'sprites')

C = {
    'o': (59, 42, 51),      # 輪郭線
    'w': (223, 227, 232),   # 筐体（明）
    'g': (163, 172, 184),   # 筐体（中）
    'd': (90, 101, 115),    # 筐体（暗）
    's': (59, 95, 138),     # 画面
    'S': (98, 196, 255),    # 画面の反射
    'l': (98, 210, 111),    # LED
    'b': (79, 124, 196),    # 青
    'B': (53, 85, 143),     # 青（影）
    'bh': (122, 160, 222),  # 青（ハイライト）
    'r': (224, 100, 79),    # 赤
    'R': (168, 71, 58),     # 赤（影）
    'rh': (240, 138, 118),  # 赤（ハイライト）
    'y': (242, 196, 78),    # 黄
    'Y': (201, 150, 46),    # 黄（影）
    'e': (244, 241, 230),   # 白
    'k': (246, 207, 168),   # 肌
    'K': (220, 158, 122),   # 肌（影）
    'h': (74, 53, 48),      # 髪
    'n': (74, 69, 96),      # ズボン
    'c': (200, 148, 90),    # 木
    'G': (90, 168, 96),     # 緑
    'GG': (62, 128, 70),    # 緑（影）
    'f': (240, 160, 48),    # 橙
}


def new(w, h):
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def rect(d, x, y, w, h, fill, outline=None):
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=C[fill] + (255,), outline=(C[outline] + (255,)) if outline else None)


def px(d, x, y, color):
    d.point((x, y), fill=C[color] + (255,))


def outline(img):
    # 不透明な画素に接する透明な画素を輪郭線の色で塗る
    w, h = img.size
    src = img.load()
    out = img.copy()
    dst = out.load()
    for y in range(h):
        for x in range(w):
            if src[x, y][3]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and src[nx, ny][3] and src[nx, ny][:3] != C['o']:
                    dst[x, y] = C['o'] + (255,)
                    break
    return out


def save(img, path):
    full = os.path.join(ROOT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    img.save(full)


# ---- 機器（24×24） ----

def pc():
    img, d = new(24, 24)
    rect(d, 3, 1, 18, 13, 'w', 'o')
    d.line([(19, 2), (19, 12)], fill=C['g'])
    d.line([(4, 12), (19, 12)], fill=C['g'])
    rect(d, 5, 3, 14, 8, 's')
    for x, y in ((6, 4), (7, 4), (6, 5)):
        px(d, x, y, 'S')
    px(d, 17, 12, 'l')
    rect(d, 10, 14, 4, 2, 'g', 'o')
    rect(d, 7, 16, 10, 2, 'w', 'o')
    rect(d, 2, 19, 20, 4, 'w', 'o')
    for x in range(4, 20, 2):
        px(d, x, 20, 'd')
        px(d, x + 1, 21, 'd')
    return img


def server():
    img, d = new(24, 24)
    rect(d, 6, 0, 12, 24, 'w', 'o')
    d.line([(16, 1), (16, 22)], fill=C['g'])
    for y in (3, 8, 13):
        rect(d, 8, y, 7, 3, 'd')
        px(d, 9, y + 1, 'g')
        px(d, 13, y + 1, 'l')
    rect(d, 8, 18, 7, 3, 'g')
    return img


def l2_switch():
    img, d = new(24, 24)
    rect(d, 1, 8, 22, 9, 'b', 'o')
    d.line([(2, 9), (21, 9)], fill=C['bh'])
    d.line([(2, 15), (21, 15)], fill=C['B'])
    for i in range(8):
        x = 4 + i * 2
        rect(d, x, 12, 1, 2, 'o')
        if i % 2 == 0:
            px(d, x, 10, 'l')
    return img


def router():
    img, d = new(24, 24)
    for x in (5, 18):
        d.line([(x, 1), (x, 9)], fill=C['o'])
        px(d, x, 1, 'r')
    rect(d, 1, 9, 22, 10, 'r', 'o')
    d.line([(2, 10), (21, 10)], fill=C['rh'])
    d.line([(2, 17), (21, 17)], fill=C['R'])
    for x in (4, 6, 8):
        px(d, x, 13, 'l')
    for i in range(4):
        rect(d, 12 + i * 3, 13, 2, 2, 'o')
    return img


# ---- 社員（16×24、2コマ） ----

def staff(shirt, shade, frame):
    img, d = new(16, 24)
    # 頭
    rect(d, 4, 2, 8, 7, 'k')
    rect(d, 4, 1, 8, 3, 'h')
    px(d, 4, 4, 'h')
    px(d, 11, 4, 'h')
    d.line([(11, 5), (11, 8)], fill=C['K'])
    px(d, 6, 6, 'o')
    px(d, 9, 6, 'o')
    # 胴と腕
    rect(d, 3, 10, 10, 7, shirt)
    d.line([(12, 10), (12, 16)], fill=C[shade])
    rect(d, 2, 11, 1, 4, 'k')
    rect(d, 13, 11, 1, 4, 'k')
    # 脚。2コマ目は左右の脚を入れ替えて歩く
    rect(d, 4, 17, 8, 2, 'n')
    left, right = (3, 2) if frame == 0 else (2, 3)
    rect(d, 4, 19, 3, left, 'n')
    rect(d, 9, 19, 3, right, 'n')
    return outline(img)


# ---- アイコン（16×16） ----

def icon_mail():
    img, d = new(16, 16)
    rect(d, 1, 3, 14, 10, 'e')
    d.line([(1, 3), (8, 9), (14, 3)], fill=C['g'], width=1)
    d.line([(2, 12), (13, 12)], fill=C['g'])
    return outline(img)


def icon_money():
    img, d = new(16, 16)
    d.ellipse([1, 1, 14, 14], fill=C['y'] + (255,))
    d.ellipse([3, 3, 12, 12], outline=C['Y'] + (255,))
    rect(d, 7, 5, 2, 6, 'Y')
    px(d, 4, 3, 'e')
    px(d, 3, 4, 'e')
    return outline(img)


def icon_star():
    img, d = new(16, 16)
    pts = [(8, 1), (10, 6), (15, 6), (11, 9), (13, 14), (8, 11), (3, 14), (5, 9), (1, 6), (6, 6)]
    d.polygon(pts, fill=C['y'] + (255,))
    px(d, 7, 4, 'e')
    return outline(img)


def icon_calendar():
    img, d = new(16, 16)
    rect(d, 1, 3, 14, 12, 'e')
    rect(d, 1, 3, 14, 3, 'r')
    rect(d, 4, 1, 1, 3, 'd')
    rect(d, 11, 1, 1, 3, 'd')
    for y in (8, 11):
        for x in (3, 6, 9, 12):
            px(d, x, y, 'd')
    return outline(img)


def icon_hammer():
    img, d = new(16, 16)
    rect(d, 2, 2, 9, 4, 'g')
    d.line([(2, 2), (10, 2)], fill=C['w'])
    rect(d, 6, 6, 2, 9, 'c')
    return outline(img)


def icon_budget():
    img, d = new(16, 16)
    rect(d, 3, 1, 10, 14, 'e')
    for y in (4, 7, 10):
        d.line([(5, y), (10, y)], fill=C['g'])
    rect(d, 9, 11, 2, 2, 'r')
    return outline(img)


def icon_close():
    img, d = new(16, 16)
    d.line([(3, 3), (12, 12)], fill=C['r'], width=3)
    d.line([(12, 3), (3, 12)], fill=C['r'], width=3)
    return outline(img)


def icon_pause():
    img, d = new(16, 16)
    rect(d, 4, 3, 3, 10, 'e')
    rect(d, 9, 3, 3, 10, 'e')
    return outline(img)


def icon_play():
    img, d = new(16, 16)
    d.polygon([(4, 2), (12, 8), (4, 13)], fill=C['e'] + (255,))
    return outline(img)


def icon_menu():
    img, d = new(16, 16)
    for y in (3, 7, 11):
        rect(d, 2, y, 12, 2, 'e')
    return outline(img)


def icon_cable(color):
    img, d = new(16, 16)
    d.line([(3, 12), (12, 3)], fill=C[color], width=2)
    rect(d, 1, 11, 4, 4, 'g')
    rect(d, 11, 1, 4, 4, 'g')
    return outline(img)


def icon_pc_count():
    img, d = new(16, 16)
    rect(d, 2, 2, 12, 9, 'w')
    rect(d, 4, 4, 8, 5, 's')
    rect(d, 7, 11, 2, 2, 'g')
    rect(d, 4, 13, 8, 1, 'w')
    return outline(img)


def icon_ok():
    img, d = new(16, 16)
    d.line([(3, 8), (6, 11), (12, 4)], fill=C['G'], width=3)
    return outline(img)


if __name__ == '__main__':
    save(pc(), 'device/pc_basic.png')
    save(server(), 'device/server_basic.png')
    save(l2_switch(), 'device/l2_switch_8p.png')
    save(router(), 'device/router_basic.png')
    for name, shirt, shade in (('blue', 'b', 'B'), ('red', 'r', 'R')):
        for frame in (0, 1):
            save(staff(shirt, shade, frame), f'staff/{name}_{frame}.png')
    icons = {
        'mail': icon_mail(),
        'money': icon_money(),
        'star': icon_star(),
        'calendar': icon_calendar(),
        'hammer': icon_hammer(),
        'budget': icon_budget(),
        'close': icon_close(),
        'pause': icon_pause(),
        'play': icon_play(),
        'menu': icon_menu(),
        'cable_utp_cat5e': icon_cable('b'),
        'cable_fiber_sm': icon_cable('f'),
        'pc_count': icon_pc_count(),
        'ok': icon_ok(),
    }
    for name, img in icons.items():
        save(img, f'icon/{name}.png')
    print('ok')
