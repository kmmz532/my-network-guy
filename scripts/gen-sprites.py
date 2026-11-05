# ドット絵のスプライトを生成する。色は memo/ART.md のパレットに従う。
# 使い方: python scripts/gen-sprites.py
# 出力先: src/assets/sprites/（device/・staff/・icon/・tile/・furniture/）
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
    'F1': (224, 183, 124),  # 床（木・明）
    'F2': (200, 148, 90),   # 床（木・中）
    'F3': (160, 106, 69),   # 床（木・暗）
    'W1': (239, 231, 214),  # 壁（明）
    'W2': (207, 195, 170),  # 壁（暗）
    'W3': (176, 160, 136),  # 壁（巾木）
    'sky': (159, 224, 255),  # 窓の空
    'sky2': (198, 238, 255),  # 窓の空（明）
    'bg': (120, 140, 165),  # 青灰色（スイッチの筐体）
    'pot': (196, 112, 76),  # 植木鉢
    'POT': (150, 80, 60),   # 植木鉢（影）
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


# ---- 機器（24×40。床の1マスより高く、足元は下から 4 px 上に揃える） ----
# 描画の基準: 足元（底面）は y=37 の行。y=38〜39 は床に重なる余白

def pc():
    # モニターとキーボード。本体は机の下にある想定で描かない。下端（y=37）を置き場所に揃える
    img, d = new(24, 40)
    rect(d, 2, 16, 20, 15, 'w', 'o')
    rect(d, 4, 18, 16, 10, 's')
    rect(d, 4, 18, 16, 3, 'S')
    d.line([(6, 23), (12, 23)], fill=C['S'])
    d.line([(6, 25), (10, 25)], fill=C['S'])
    px(d, 19, 29, 'l')
    rect(d, 10, 31, 4, 3, 'g', 'o')
    rect(d, 3, 34, 18, 4, 'g', 'o')
    d.line([(5, 35), (18, 35)], fill=C['w'])
    return img


def server():
    # 縦長のラックサーバー
    img, d = new(24, 40)
    rect(d, 4, 0, 16, 38, 'w', 'o')
    d.line([(17, 1), (17, 36)], fill=C['g'])
    for y in (3, 10, 17, 24):
        rect(d, 6, y, 10, 4, 'd')
        px(d, 7, y + 1, 'g')
        px(d, 8, y + 1, 'g')
        px(d, 13, y + 1, 'l')
    rect(d, 6, 31, 10, 3, 'g')
    return img


# 機器の色の決まり: スイッチは青、ルーターは赤、無線は白、サーバーは灰。
# 複数の役割を持つ機器は、主の色の筐体に、副の役割の部品（アンテナ・ポートの列）を足して表す

def base(d):
    # 床に接地する低い台（x 1〜22、y 35〜37）
    rect(d, 1, 35, 22, 3, 'd', 'o')


def switch_unit(d, y, ports=8, color='b', light='bh', shade='B'):
    # 横長のスイッチ1台（高さ7）。上の縁を明るく、下の縁を暗く、ポートとLEDを並べる
    rect(d, 1, y, 22, 7, color, 'o')
    d.line([(2, y + 1), (21, y + 1)], fill=C[light])
    d.line([(2, y + 5), (21, y + 5)], fill=C[shade])
    for i in range(ports):
        x = 4 + i * 2
        rect(d, x, y + 2, 1, 2, 'o')
        if i % 2 == 0:
            px(d, x, y + 1, 'l')


def l2_switch():
    # 青いスイッチを2段に重ね、低い台に載せる
    img, d = new(24, 40)
    switch_unit(d, 19)
    switch_unit(d, 27)
    base(d)
    return img


def l3_switch():
    # L2スイッチと同じ2段の筐体に、左端の黄色の帯（ルーティングできる印）を付ける
    img, d = new(24, 40)
    switch_unit(d, 19)
    switch_unit(d, 27)
    for y in (19, 27):
        rect(d, 1, y, 3, 7, 'y', 'o')
        d.line([(2, y + 1), (2, y + 5)], fill=C['Y'])
    base(d)
    return img


def router_box(d, y=20, h=14):
    # 赤い箱のルーター。前面に電源のLEDとポートを並べる
    rect(d, 1, y, 22, h, 'r', 'o')
    d.line([(2, y + 1), (21, y + 1)], fill=C['rh'])
    d.line([(2, y + h - 2), (21, y + h - 2)], fill=C['R'])
    for x in (4, 6):
        px(d, x, y + 5, 'l')
    for i in range(4):
        rect(d, 11 + i * 3, y + 5, 2, 2, 'o')


def router():
    # アンテナのない赤い箱を、低い台に載せる
    img, d = new(24, 40)
    router_box(d, 21, 14)
    base(d)
    return img


def antennas(d, top, bottom):
    for x in (5, 18):
        d.line([(x, top), (x, bottom)], fill=C['o'])
        px(d, x, top, 'e')


def wifi_router():
    # アクセスポイント付きのルーター: 赤い箱に2本のアンテナ
    img, d = new(24, 40)
    antennas(d, 7, 21)
    router_box(d, 21, 14)
    base(d)
    return img


def vpn_router():
    # VPNルーター: 赤い箱の前面に、黄色の錠前の印
    img, d = new(24, 40)
    router_box(d, 21, 14)
    # 錠前: 上のつる（輪郭だけの四角）と、黄色の胴
    d.rectangle([4, 15, 8, 20], outline=C['o'] + (255,))
    d.rectangle([5, 16, 7, 20], outline=C['g'] + (255,))
    rect(d, 3, 20, 7, 6, 'y', 'o')
    px(d, 6, 22, 'o')
    px(d, 6, 23, 'o')
    base(d)
    return img


def router_switch():
    # L2スイッチ付きルーター: 上が赤いルーター、下に青いポートの列
    img, d = new(24, 40)
    router_box(d, 15, 12)
    switch_unit(d, 27)
    base(d)
    return img


def access_point():
    # 置き型のアクセスポイント: 角の丸い白い平たい箱を斜め上から見た形。天面の中央に青い光の輪、
    # 前面に状態のLED。上に小さな電波の印を2本
    img, d = new(24, 40)
    for i, w in enumerate((3, 6)):
        y = 22 - i * 3
        d.line([(12 - w, y), (11, y - 2), (12, y - 2), (12 + w - 1, y)], fill=C['S'] + (255,))
    # 天面（明るい白）と前面（少し暗い白）
    d.rounded_rectangle([2, 24, 21, 31], radius=3, fill=C['e'] + (255,), outline=C['o'] + (255,))
    rect(d, 3, 31, 18, 4, 'w')
    d.line([(3, 35), (20, 35)], fill=C['o'] + (255,))
    d.line([(2, 31), (2, 34)], fill=C['o'] + (255,))
    d.line([(21, 31), (21, 34)], fill=C['o'] + (255,))
    # 天面の青い光の輪
    d.ellipse([8, 26, 15, 29], outline=C['S'] + (255,))
    # 前面のLED
    px(d, 11, 33, 'l')
    px(d, 12, 33, 'l')
    # 床に置く低いゴム足
    rect(d, 4, 36, 3, 1, 'o')
    rect(d, 17, 36, 3, 1, 'o')
    return img


def laptop():
    # 開いたノートPC。画面を後ろに傾け、手前にキーボードの面
    img, d = new(24, 40)
    rect(d, 4, 19, 16, 12, 'g', 'o')
    rect(d, 6, 21, 12, 8, 's')
    rect(d, 6, 21, 12, 2, 'S')
    d.line([(8, 25), (13, 25)], fill=C['S'])
    d.polygon([(3, 31), (20, 31), (22, 36), (1, 36)], fill=C['w'] + (255,), outline=C['o'] + (255,))
    for x in range(4, 20, 2):
        px(d, x, 33, 'g')
    rect(d, 9, 35, 6, 1, 'g')
    px(d, 18, 34, 'l')
    return img


def gpu_server():
    # GPUサーバー: 幅の広い暗い筐体に、緑に光るGPUの段と冷却ファン
    img, d = new(24, 40)
    rect(d, 1, 4, 22, 34, 'd', 'o')
    d.line([(2, 5), (21, 5)], fill=C['g'])
    for y in (8, 15, 22):
        rect(d, 3, y, 18, 5, 'o')
        d.line([(4, y + 2), (13, y + 2)], fill=C['G'])
        px(d, 18, y + 2, 'l')
    for x in (4, 13):
        d.ellipse([x, 29, x + 6, 35], fill=C['o'] + (255,))
        px(d, x + 3, 32, 'g')
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


def icon_cart():
    img, d = new(16, 16)
    d.line([(1, 2), (3, 2), (5, 10), (13, 10)], fill=C['g'], width=2)
    rect(d, 4, 4, 10, 5, 'y')
    d.line([(5, 6), (12, 6)], fill=C['Y'])
    rect(d, 5, 12, 2, 2, 'd')
    rect(d, 11, 12, 2, 2, 'd')
    return outline(img)


def icon_warehouse():
    # 段ボール箱。倉庫の印として使う
    img, d = new(16, 16)
    rect(d, 2, 6, 12, 9, 'c')
    rect(d, 1, 3, 14, 4, 'F1')
    rect(d, 7, 3, 2, 12, 'F3')
    return outline(img)


def icon_person():
    # 採用の画面を開く人物のアイコン
    img, d = new(16, 16)
    rect(d, 5, 2, 6, 5, 'k')
    rect(d, 5, 1, 6, 2, 'h')
    rect(d, 3, 8, 10, 7, 'b')
    return outline(img)


def icon_ok():
    img, d = new(16, 16)
    d.line([(3, 8), (6, 11), (12, 4)], fill=C['G'], width=3)
    return outline(img)


# ---- 床・壁（32×32） ----
# 床は木の板。継ぎ目の位置を変えた3種類を、マップ上でばらして敷く

def floor(variant):
    img, d = new(32, 32)
    rect(d, 0, 0, 32, 32, 'F1')
    for row in range(4):
        y = row * 8
        d.line([(0, y + 7), (31, y + 7)], fill=C['F2'])
        seam = (row * 11 + variant * 7) % 32
        d.line([(seam, y), (seam, y + 6)], fill=C['F2'])
    for x, y in (((5 + variant * 9) % 32, 3), ((19 + variant * 5) % 32, 19), ((27 - variant * 6) % 32, 27)):
        px(d, x, y, 'F2')
    return img


def wall_face():
    # 奥の壁の正面。下端に巾木を引いて床との境界を示す
    img, d = new(32, 32)
    rect(d, 0, 0, 32, 32, 'W1')
    rect(d, 0, 0, 32, 3, 'W2')
    rect(d, 0, 26, 32, 6, 'W3')
    d.line([(0, 26), (31, 26)], fill=C['o'])
    d.line([(0, 31), (31, 31)], fill=C['F3'])
    return img


def wall_window():
    img = wall_face()
    d = ImageDraw.Draw(img)
    rect(d, 5, 5, 22, 18, 'w', 'o')
    rect(d, 7, 7, 18, 14, 'sky')
    rect(d, 7, 7, 18, 5, 'sky2')
    d.line([(16, 7), (16, 20)], fill=C['w'])
    d.line([(7, 14), (24, 14)], fill=C['w'])
    for x, y in ((10, 17), (11, 17), (19, 10)):
        px(d, x, y, 'e')
    return img


def wall_clock():
    img = wall_face()
    d = ImageDraw.Draw(img)
    d.ellipse([10, 6, 21, 17], fill=C['e'], outline=C['o'])
    d.line([(15, 8), (15, 12)], fill=C['o'])
    d.line([(15, 12), (18, 12)], fill=C['o'])
    return img


def wall_poster():
    img = wall_face()
    d = ImageDraw.Draw(img)
    rect(d, 9, 4, 14, 18, 'e', 'o')
    rect(d, 11, 6, 10, 7, 'b')
    d.polygon([(11, 12), (15, 8), (20, 12)], fill=C['G'])
    d.line([(11, 16), (20, 16)], fill=C['g'])
    d.line([(11, 18), (17, 18)], fill=C['g'])
    return img


def wall_whiteboard():
    img = wall_face()
    d = ImageDraw.Draw(img)
    rect(d, 2, 4, 28, 19, 'e', 'g')
    # ネットワーク図の落書き
    rect(d, 6, 8, 4, 3, 'b')
    rect(d, 21, 8, 4, 3, 'b')
    rect(d, 13, 15, 5, 3, 'r')
    d.line([(8, 11), (15, 15)], fill=C['b'])
    d.line([(23, 11), (16, 15)], fill=C['b'])
    d.line([(4, 23), (27, 23)], fill=C['d'])
    px(d, 24, 22, 'r')
    return img


# ---- 家具（幅32。下端をマスの下端に揃え、1マスを超える分は上へはみ出す） ----

def desk():
    # 白いオフィスデスク。斜め上から見下ろし、天板を広く見せる（PCは天板の中ほどに載る）
    img, d = new(32, 32)
    rect(d, 1, 4, 30, 18, 'e')
    d.line([(1, 4), (30, 4)], fill=C['w'])
    d.line([(2, 5), (2, 20)], fill=C['w'])
    rect(d, 1, 22, 30, 3, 'w')
    d.line([(1, 24), (30, 24)], fill=C['g'])
    # 脚（金属）と、奥に見える幕板
    rect(d, 2, 25, 2, 6, 'g')
    rect(d, 28, 25, 2, 6, 'g')
    rect(d, 4, 25, 24, 2, 'd')
    return outline(img)


def plant():
    img, d = new(32, 44)
    d.ellipse([7, 2, 24, 18], fill=C['G'])
    d.ellipse([3, 10, 17, 26], fill=C['G'])
    d.ellipse([15, 10, 29, 26], fill=C['GG'])
    d.ellipse([9, 14, 22, 28], fill=C['G'])
    for x, y in ((11, 6), (6, 15), (13, 18), (20, 9)):
        px(d, x, y, 'GG')
    d.line([(16, 26), (16, 31)], fill=C['GG'])
    d.polygon([(9, 31), (23, 31), (21, 42), (11, 42)], fill=C['pot'])
    d.line([(9, 31), (23, 31)], fill=C['POT'])
    d.line([(20, 33), (19, 41)], fill=C['POT'])
    return outline(img)


def bookshelf():
    img, d = new(32, 52)
    rect(d, 2, 2, 28, 48, 'F3')
    rect(d, 4, 4, 24, 44, 'F2')
    colors = ['b', 'r', 'G', 'y', 'w', 'B', 'f']
    for shelf in range(3):
        top = 4 + shelf * 15
        x = 5
        i = shelf * 2
        while x < 26:
            w = 2 + (i % 3 == 0)
            h = 10 + (i % 4 == 1) - (i % 5 == 2) * 2
            rect(d, x, top + 13 - h, min(w, 27 - x), h, colors[i % len(colors)])
            x += w + (i % 4 == 3)
            i += 1
        rect(d, 4, top + 13, 24, 2, 'F3')
    return outline(img)


def cabinet():
    img, d = new(32, 40)
    rect(d, 4, 2, 24, 37, 'g')
    rect(d, 4, 2, 24, 2, 'w')
    for k in range(3):
        y = 5 + k * 11
        rect(d, 6, y, 20, 10, 'w')
        d.line([(6, y + 9), (25, y + 9)], fill=C['d'])
        rect(d, 13, y + 3, 6, 2, 'd')
    return outline(img)


def coffee():
    # 台の上のコーヒーメーカーとカップ
    img, d = new(32, 36)
    rect(d, 2, 18, 28, 17, 'F2')
    rect(d, 2, 18, 28, 2, 'F1')
    d.line([(16, 21), (16, 34)], fill=C['F3'])
    rect(d, 6, 3, 13, 15, 'd')
    rect(d, 6, 3, 13, 4, 'o')
    rect(d, 8, 10, 8, 6, 's')
    rect(d, 9, 11, 6, 4, 'h')
    px(d, 16, 5, 'r')
    rect(d, 22, 12, 5, 6, 'e')
    px(d, 27, 14, 'e')
    return outline(img)


def water():
    img, d = new(32, 48)
    rect(d, 10, 2, 12, 15, 'sky')
    rect(d, 10, 2, 12, 4, 'sky2')
    rect(d, 13, 0, 6, 2, 'bh')
    rect(d, 8, 17, 16, 30, 'w')
    rect(d, 8, 17, 16, 2, 'e')
    rect(d, 11, 24, 3, 3, 'b')
    rect(d, 18, 24, 3, 3, 'r')
    rect(d, 10, 30, 12, 8, 'g')
    return outline(img)


def trash():
    img, d = new(32, 32)
    d.polygon([(10, 16), (22, 16), (21, 30), (11, 30)], fill=C['g'])
    rect(d, 9, 15, 14, 2, 'w')
    d.line([(14, 19), (14, 28)], fill=C['d'])
    d.line([(18, 19), (18, 28)], fill=C['d'])
    rect(d, 13, 12, 4, 3, 'e')
    return outline(img)


def boxes():
    img, d = new(32, 36)
    rect(d, 2, 18, 18, 16, 'c')
    rect(d, 2, 18, 18, 3, 'F1')
    d.line([(11, 18), (11, 26)], fill=C['F3'])
    rect(d, 16, 6, 14, 12, 'c')
    rect(d, 16, 6, 14, 2, 'F1')
    rect(d, 20, 22, 11, 12, 'F2')
    rect(d, 22, 26, 7, 3, 'e')
    return outline(img)


def sofa():
    img, d = new(32, 32)
    rect(d, 2, 8, 28, 12, 'b')
    rect(d, 2, 8, 28, 3, 'bh')
    rect(d, 1, 14, 5, 14, 'B')
    rect(d, 26, 14, 5, 14, 'B')
    rect(d, 6, 18, 20, 8, 'b')
    d.line([(16, 18), (16, 25)], fill=C['B'])
    rect(d, 6, 26, 20, 3, 'B')
    return outline(img)


# ---- 機器の背面（機器の画面の「背面」タブで、拡大して並べる部品） ----
# ポートの差し込み口は 12×10。上に爪の切り欠き、下に金色の端子を描く

def rear_port_empty():
    img, d = new(12, 10)
    rect(d, 0, 0, 12, 10, 'g', 'o')
    rect(d, 2, 2, 8, 7, 'o')
    rect(d, 4, 8, 4, 1, 'g')  # 爪の切り欠き（下側）
    for x in range(3, 9, 2):
        px(d, x, 3, 'Y')      # 端子
    return img


def rear_port_plugged(body, shade):
    # 差し込み口にプラグが刺さった状態。プラグの胴とケーブルの根元を手前に描く
    img = rear_port_empty()
    d = ImageDraw.Draw(img)
    rect(d, 2, 2, 8, 7, body)
    d.line([(2, 2), (9, 2)], fill=C['e'] + (255,))  # 透明なプラグの上縁
    rect(d, 3, 4, 6, 2, shade)
    rect(d, 4, 8, 4, 2, shade)                     # 爪
    return img


def rear_fan():
    # 冷却ファンの格子（16×16）
    img, d = new(16, 16)
    rect(d, 0, 0, 16, 16, 'd', 'o')
    d.ellipse([2, 2, 13, 13], fill=C['o'] + (255,))
    for i in range(3, 13, 3):
        d.line([(i, 3), (i, 12)], fill=C['g'] + (255,))
    rect(d, 7, 7, 2, 2, 'g')
    return img


def rear_power():
    # 電源の差し込み口（12×10）
    img, d = new(12, 10)
    rect(d, 0, 0, 12, 10, 'g', 'o')
    rect(d, 2, 2, 8, 6, 'o')
    for x in (4, 7):
        rect(d, x, 4, 1, 2, 'g')
    return img


if __name__ == '__main__':
    rear = {
        'port_empty': rear_port_empty(),
        'port_utp': rear_port_plugged('b', 'B'),
        'port_fiber': rear_port_plugged('f', 'Y'),
        'fan': rear_fan(),
        'power': rear_power(),
    }
    for name, img in rear.items():
        save(img, f'rear/{name}.png')
    save(pc(), 'device/pc_basic.png')
    save(server(), 'device/server_basic.png')
    save(l2_switch(), 'device/l2_switch_8p.png')
    save(router(), 'device/router_basic.png')
    # これから機材に加える候補（データはまだない）
    save(l3_switch(), 'device/l3_switch.png')
    save(wifi_router(), 'device/wifi_router.png')
    save(vpn_router(), 'device/vpn_router.png')
    save(router_switch(), 'device/router_switch.png')
    save(access_point(), 'device/access_point.png')
    save(laptop(), 'device/laptop.png')
    save(gpu_server(), 'device/gpu_server.png')
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
        'cart': icon_cart(),
        'warehouse': icon_warehouse(),
        'person': icon_person(),
    }
    for name, img in icons.items():
        save(img, f'icon/{name}.png')
    for v in range(3):
        save(floor(v), f'tile/floor_{v}.png')
    tiles = {
        'wall_face': wall_face(),
        'window': wall_window(),
        'clock': wall_clock(),
        'poster': wall_poster(),
        'whiteboard': wall_whiteboard(),
    }
    for name, img in tiles.items():
        save(img, f'tile/{name}.png')
    furniture = {
        'desk': desk(),
        'plant': plant(),
        'bookshelf': bookshelf(),
        'cabinet': cabinet(),
        'coffee': coffee(),
        'water': water(),
        'trash': trash(),
        'boxes': boxes(),
        'sofa': sofa(),
    }
    for name, img in furniture.items():
        save(img, f'furniture/{name}.png')
    print('ok')
