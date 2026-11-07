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
    'hb': (120, 80, 50),    # 髪（茶）
    'hy': (214, 176, 96),   # 髪（金）
    'pot': (196, 112, 76),  # 植木鉢
    'POT': (150, 80, 60),   # 植木鉢（影）
    'T1': (232, 234, 228),  # 床（タイル・明）
    'T2': (198, 204, 200),  # 床（タイル・目地）
    'P1': (122, 138, 170),  # 床（カーペット）
    'P2': (104, 120, 152),  # 床（カーペット・影）
    'K1': (190, 190, 182),  # 床（コンクリート）
    'K2': (168, 168, 160),  # 床（コンクリート・暗）
    'L1': (196, 222, 208),  # 床（リノリウム）
    'L2': (172, 202, 186),  # 床（リノリウム・影）
    'cb': (206, 160, 104),  # 段ボール
    'CB': (170, 124, 76),   # 段ボール（影）
}


def new(w, h):
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def rect(d, x, y, w, h, fill, outline=None):
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=C[fill] + (255,), outline=(C[outline] + (255,)) if outline else None)


def px(d, x, y, color):
    d.point((x, y), fill=C[color] + (255,))


def from_rows(rows, keys):
    # 文字の行から絵を作る。'.' は透明、ほかの文字は keys で C の色の名前に対応させる
    img = Image.new('RGBA', (len(rows[0]), len(rows)), (0, 0, 0, 0))
    for y, row in enumerate(rows):
        assert len(row) == img.width, f'行 {y} の幅が違う'
        for x, ch in enumerate(row):
            if ch != '.':
                img.putpixel((x, y), C[keys[ch]] + (255,))
    return img


def overlay(base, rows, keys):
    # base の上に、文字の行の絵を重ねる（'.' は下の絵を残す）
    img = base.copy()
    img.alpha_composite(from_rows(rows, keys))
    return img


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


# 手で描き直したスプライト。このスクリプトでは上書きしない（描き直すときは一覧から外す）
MANUAL = {
    'device/server_basic.png',
    'device/access_point.png',
}


def save(img, path):
    if path in MANUAL:
        return
    full = os.path.join(ROOT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    img.save(full)


# ---- 機器（24×40。床の1マスより高く、足元は下から 4 px 上に揃える） ----
# 描画の基準: 足元（底面）は y=37 の行。y=38〜39 は床に重なる余白

# PC（24×40）。利用者が手で直した pc_basic.png を、画素のまま写したもの。
# 向きの名前は座った社員が向く方向（机・椅子と同じ）。画面は社員の方を向く。pc は奥向き（画面がこちらを向く）
PC_KEYS = {'A': 'o', 'B': 'e', 'C': 'w', 'D': 'S', 'E': 's', 'F': 'l', 'G': 'g'}
PC_EMPTY = '.' * 24


def pc():
    return from_rows([PC_EMPTY] * 14 + [
        '...AAAAAAAAAAAAAAAAAA...',
        '..ABBBBBBBBBBBBBBBBBBA..',
        '..AAAAAAAAAAAAAAAAAAAA..',
        '..ACCCCCCCCCCCCCCCCCCA..',
        '..ACDDDDDDDDDDDDDDDDCA..',
        '..ACDDDDDDDDDDDDDDDDCA..',
        '..ACDDDDDDDDDDDDDDDDCA..',
        '..ACEEEEEEEEEEEEEEEECA..',
        '..ACEEEEEEEEEEEEEEEECA..',
        '..ACEEDDDDDDDEEEEEEECA..',
        '..ACEEEEEEEEEEEEEEEECA..',
        '..ACEEDDDDDEEEEEEEEECA..',
        '..ACEEEEEEEEEEEEEEEECA..',
        '..ACEEEEEEEEEEEEEEEECA..',
        '..ACCCCCCCCCCCCCCCCCCA..',
        '..AAAAAAAAAAAAAAAAAFAA..',
        '..........AAAA..........',
        '..........AAAA..........',
        '..AAAAAAAAAAAAAAAAAAAA..',
        '..ABGBGBGBGBGBGBGBGBBA..',
        '..ABBBBBBBBBBBBBBBBBBA..',
        '..ABBGBGBGBGBGBGBGBGBA..',
        '..AGGGGGGGGGGGGGGGGGGA..',
        '...AAAAAAAAAAAAAAAAAA...',
        PC_EMPTY,
        PC_EMPTY,
    ], PC_KEYS)


def pc_front():
    # 手前向き（社員はこちらを向き、画面は奥を向く）: モニターの背面と台座。キーボードはモニターの奥にあり、上の縁だけが見える
    return from_rows([PC_EMPTY] * 11 + [
        '....AAAAAAAAAAAAAAAA....',
        '....ABGBGBGBGBGBGBBA....',
        '....ABBBBBBBBBBBBBBA....',
        '..AAAAAAAAAAAAAAAAAAAA..',
        '..ABBBBBBBBBBBBBBBBBBA..',
        '..AAAAAAAAAAAAAAAAAAAA..',
        '..ACCCCCCCCCCCCCCCCCCA..',
        '..ACCCCCCCCCCCCCCCCCCA..',
        '..ACCCAAAAAAAAAAAACCCA..',
        '..ACCCAGGGGGGGGGGACCCA..',
        '..ACCCAGCCCCCCCCGACCCA..',
        '..ACCCAGGGGGGGGGGACCCA..',
        '..ACCCAGCCCCCCCCGACCCA..',
        '..ACCCAGGGGGGGGGGACCCA..',
        '..ACCCAGCCCCCCCCGACCCA..',
        '..ACCCAAAAAAAAAAAACCCA..',
        '..ACCCCCCCCCCCCCCCCCCA..',
        '..ACCCCCCCCCCCCCCCCCCA..',
        '..AAAAAAAAAAAAAAAAAAAA..',
        '..........AAAA..........',
        '..........AGGA..........',
        '......AAAAAAAAAAAA......',
        '......ABBBBBBBBBBA......',
        '......ABBBBBBBBBBA......',
        '......ABBBBBBBBBBA......',
        '......AGGGGGGGGGGA......',
    ] + [PC_EMPTY] * 3, PC_KEYS)


def pc_side():
    # 右向き（社員は右を向き、画面は左の社員の方を向く）: モニターを横から見る。キーボードは画面の前（左）に縦に置く。左向きは左右反転で作る
    return from_rows([PC_EMPTY] * 14 + [
        '............AAAAAA......',
        '............ABBBBA......',
        '............AAAAAA......',
        '............ADCCGA......',
        '............ADCCGA......',
        '............ADCCGA......',
        '............ADCCGA......',
        '............ADCCGA......',
        '............ADCCGA......',
        '............ADCCGA......',
        '..AAAAAAA...ADCCGA......',
        '..ABBBBBA...ADCCGA......',
        '..ABGBBBA...ADCCGA......',
        '..ABBBGBA...ADCCGA......',
        '..ABGBBBA...ADFCGA......',
        '..ABBBGBA...AAAAAA......',
        '..ABGBBBA.....AAA.......',
        '..ABBBGBA.....AGA.......',
        '..ABGBBBA..AAAAAAAAA....',
        '..ABBBGBA..ABBBBBBBA....',
        '..ABBBBBA..ABBBBBBBA....',
        '..AGGGGGA..ABBBBBBBA....',
        '..AAAAAAA..AGGGGGGGA....',
    ] + [PC_EMPTY] * 3, PC_KEYS)


def server():
    # 縦長のタワーサーバー。天面（奥行き4）と、前面にドライブの段
    img, d = new(24, 40)
    box3q(d, 4, 0, 16, 4, 34, 'e', 'w', edge='e')
    d.line([(17, 5), (17, 36)], fill=C['g'])
    for y in (7, 13, 19, 25):
        rect(d, 6, y, 10, 4, 'd')
        px(d, 7, y + 1, 'g')
        px(d, 8, y + 1, 'g')
        px(d, 13, y + 1, 'l')
    rect(d, 6, 31, 10, 3, 'g')
    return img


# プリンター（24×40）。斜め上から見た複合機（ほかの機器と同じ視点）。
# 上にスキャナーのふた、前面の上段に用紙の出口（白い紙が出ている）と操作パネル、下段に給紙の引き出し2段
def printer():
    img, d = new(24, 40)
    box3q(d, 1, 14, 22, 3, 21, 'w', 'g', shade='d')
    box3q(d, 3, 9, 18, 3, 3, 'e', 'w', edge='e', shade='g')
    # 用紙の出口と、出てきた紙
    rect(d, 3, 19, 11, 3, 'd', 'o')
    rect(d, 5, 19, 7, 2, 'e')
    # 操作パネル（小さな画面とLED）
    rect(d, 15, 19, 6, 4, 'd', 'o')
    rect(d, 16, 20, 4, 2, 's')
    px(d, 16, 20, 'S')
    px(d, 19, 24, 'l')
    # 給紙の引き出し（2段。取っ手付き）
    for y in (26, 31):
        rect(d, 3, y, 18, 4, 'w', 'o')
        rect(d, 9, y + 2, 6, 1, 'd')
    return img


# ---- 3/4視点の箱 ----
# 斜め上から見下ろす（ART.md の視点）。箱は、上に明るい天面、下に前面を描く。
# 天面の奥行きは depth、前面の高さは h。輪郭線で囲み、天面と前面の境に明るい線を引く

def box3q(d, x, y, w, depth, h, top, front, edge=None, shade=None):
    rect(d, x, y, w, depth + h, front, 'o')
    rect(d, x + 1, y + 1, w - 2, depth - 1, top)
    d.line([(x + 1, y + depth), (x + w - 2, y + depth)], fill=C[edge or 'e'] + (255,))
    if shade:
        d.line([(x + 1, y + depth + h - 2), (x + w - 2, y + depth + h - 2)], fill=C[shade] + (255,))


# 機器の色の決まり: スイッチは青、ルーターは赤、無線は白、サーバーは灰。
# 複数の役割を持つ機器は、主の色の筐体に、副の役割の部品（アンテナ・ポートの列）を足して表す

def base(d):
    # 床に接地する低い台。天面を見せる（x 1〜22、y 33〜37）
    box3q(d, 1, 33, 22, 2, 3, 'g', 'd', edge='w')


def switch_unit(d, y, ports=8, color='b', light='bh', shade='B', top=False):
    # 横長のスイッチ1台（前面の高さ7）。top=True なら天面（奥行き3）も描く
    if top:
        rect(d, 1, y - 3, 22, 4, light, 'o')
        d.line([(2, y - 2), (21, y - 2)], fill=C['e'] + (255,))
    rect(d, 1, y, 22, 7, color, 'o')
    d.line([(2, y + 1), (21, y + 1)], fill=C[light])
    d.line([(2, y + 5), (21, y + 5)], fill=C[shade])
    for i in range(ports):
        x = 4 + i * 2
        rect(d, x, y + 2, 1, 2, 'o')
        if i % 2 == 0:
            px(d, x, y + 1, 'l')


def l2_switch():
    # 8ポートのスイッチ1台を斜め上から見る。広い天面（通気の線とロゴの帯）と、前面のポートとLED
    img, d = new(24, 40)
    box3q(d, 1, 22, 22, 7, 8, 'bh', 'b', edge='e', shade='B')
    for x in range(4, 20, 3):
        d.line([(x, 24), (x + 1, 24)], fill=C['b'] + (255,))
    rect(d, 4, 26, 6, 1, 'e')
    for i in range(8):
        x = 4 + i * 2
        px(d, x, 31, 'l' if i % 2 == 0 else 'B')
        rect(d, x, 32, 1, 2, 'o')
    px(d, 20, 31, 'y')
    rect(d, 3, 37, 3, 1, 'o')
    rect(d, 18, 37, 3, 1, 'o')
    return img


def l2_switch_4p():
    # 4ポートの小さいスイッチ。8ポートより幅が狭く低い箱（距離を延ばす中継に使う安い機器）
    img, d = new(24, 40)
    box3q(d, 5, 26, 14, 5, 6, 'bh', 'b', edge='e', shade='B')
    for x in range(7, 16, 3):
        d.line([(x, 28), (x + 1, 28)], fill=C['b'] + (255,))
    for i in range(4):
        x = 8 + i * 2
        px(d, x, 33, 'l' if i % 2 == 0 else 'B')
        rect(d, x, 34, 1, 2, 'o')
    px(d, 16, 33, 'y')
    rect(d, 6, 37, 2, 1, 'o')
    rect(d, 16, 37, 2, 1, 'o')
    return img


def l3_switch():
    # L3スイッチ: L2スイッチと同じ1台の形に、天面と前面の左端の黄色の帯（ルーティングできる印）
    img = l2_switch()
    d = ImageDraw.Draw(img)
    rect(d, 2, 23, 3, 6, 'y')
    rect(d, 2, 30, 1, 6, 'y')
    d.line([(2, 29), (4, 29)], fill=C['e'] + (255,))
    return img


def router_box(d, y=20, h=14):
    # 赤い箱のルーター。天面（奥行き4）と、前面に電源のLEDとポート
    box3q(d, 1, y, 22, 4, h - 4, 'rh', 'r', shade='R')
    fy = y + 4
    for x in (4, 6):
        px(d, x, fy + 3, 'l')
    for i in range(4):
        rect(d, 11 + i * 3, fy + 3, 2, 2, 'o')


def router():
    # アンテナのない赤い箱を、低い台に載せる
    img, d = new(24, 40)
    router_box(d, 19, 14)
    base(d)
    return img


def antennas(d, top, bottom):
    for x in (5, 18):
        d.line([(x, top), (x, bottom)], fill=C['o'])
        px(d, x, top, 'e')


def wifi_router():
    # アクセスポイント付きのルーター: 赤い箱の天面の奥から2本のアンテナ
    img, d = new(24, 40)
    antennas(d, 6, 21)
    router_box(d, 19, 14)
    base(d)
    return img


def vpn_router():
    # VPNルーター: 赤い箱の前面に、黄色の錠前の印
    img, d = new(24, 40)
    router_box(d, 19, 14)
    d.rectangle([4, 14, 8, 19], outline=C['o'] + (255,))
    d.rectangle([5, 15, 7, 19], outline=C['g'] + (255,))
    rect(d, 3, 19, 7, 6, 'y', 'o')
    px(d, 6, 21, 'o')
    px(d, 6, 22, 'o')
    base(d)
    return img


def router_switch():
    # L2スイッチ付きルーター: 上が赤いルーター、下に青いポートの列
    img, d = new(24, 40)
    router_box(d, 13, 13)
    switch_unit(d, 26)
    base(d)
    return img


def firewall():
    # ファイアウォール: 橙の箱の前面にレンガ壁の模様。天面は黄、前面の右下に2つのポートとLED
    img, d = new(24, 40)
    box3q(d, 1, 17, 22, 5, 11, 'y', 'f', edge='e', shade='Y')
    # レンガ壁: 2段の目地（段ごとに縦の目地をずらす）
    d.line([(2, 26), (21, 26)], fill=C['Y'])
    for x in (7, 15):
        d.line([(x, 24), (x, 25)], fill=C['Y'] + (255,))
    for x in (4, 11, 19):
        d.line([(x, 27), (x, 28)], fill=C['Y'] + (255,))
    # 前面の下段: LEDと2つのポート
    px(d, 4, 30, 'l')
    px(d, 6, 30, 'y')
    for x in (15, 19):
        rect(d, x, 29, 3, 2, 'o')
    base(d)
    return img


def firewall_dmz():
    # DMZ のファイアウォール: 通常のファイアウォール（橙のレンガ壁）より背の高い2段の箱。
    # 上段に赤い帯（公開用の区画の印）、下段の前面に3つのポート（右端の DMZ の口は赤で縁取る）
    img, d = new(24, 40)
    box3q(d, 1, 10, 22, 5, 18, 'y', 'f', edge='e', shade='Y')
    # 上段: 赤い帯と白い点（公開の区画）
    rect(d, 2, 16, 20, 4, 'r')
    d.line([(2, 16), (21, 16)], fill=C['rh'] + (255,))
    d.line([(2, 19), (21, 19)], fill=C['R'] + (255,))
    for x in (5, 9, 13, 17):
        px(d, x, 17, 'e')
    # 下段: レンガ壁の目地
    d.line([(2, 23), (21, 23)], fill=C['Y'] + (255,))
    for x in (7, 15):
        d.line([(x, 21), (x, 22)], fill=C['Y'] + (255,))
    for x in (4, 11, 19):
        d.line([(x, 24), (x, 25)], fill=C['Y'] + (255,))
    # LED と3つのポート
    px(d, 3, 29, 'l')
    px(d, 5, 29, 'y')
    for x in (9, 13):
        rect(d, x, 28, 3, 2, 'o')
    rect(d, 16, 27, 5, 4, 'r')
    rect(d, 17, 28, 3, 2, 'o')
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
    # GPUサーバー: 幅の広い暗い筐体。天面に通気の格子、前面に緑に光るGPUの段と冷却ファン
    img, d = new(24, 40)
    box3q(d, 1, 2, 22, 5, 31, 'g', 'd', edge='w')
    for x in range(3, 21, 2):
        d.line([(x, 3), (x, 6)], fill=C['d'] + (255,))
    for y in (10, 16, 22):
        rect(d, 3, y, 18, 5, 'o')
        d.line([(4, y + 2), (13, y + 2)], fill=C['G'])
        px(d, 18, y + 2, 'l')
    for x in (4, 13):
        d.ellipse([x, 28, x + 6, 34], fill=C['o'] + (255,))
        px(d, x + 3, 31, 'g')
    return img


# ---- 社員（16×24、2コマ） ----
# 服の色（shirt）・髪の色（hair）・髪型（style）の組み合わせで見た目を作る。名前は staff/<服>_<髪の色>_<髪型>_<コマ>.png
SHIRT_COLORS = {'blue': ('b', 'B'), 'red': ('r', 'R'), 'green': ('G', 'GG'), 'yellow': ('y', 'Y')}
HAIR_COLORS = {'dark': 'h', 'brown': 'hb', 'blonde': 'hy'}
HAIR_STYLES = ('short', 'long')


def staff(shirt, shade, hair, style, frame):
    img, d = new(16, 24)
    # 髪（頭の上。長い髪は両側に垂らす）
    rect(d, 4, 2, 8, 7, 'k')
    rect(d, 4, 1, 8, 3, hair)
    px(d, 4, 4, hair)
    px(d, 11, 4, hair)
    if style == 'long':
        rect(d, 3, 3, 1, 7, hair)
        rect(d, 12, 3, 1, 7, hair)
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


def icon_level():
    # エメラルド色のひし形の宝石（会社のレベルの印）。光は左上から。
    img, d = new(16, 16)
    em = (46, 184, 122)
    EM = (24, 120, 86)
    eh = (132, 230, 180)
    d.polygon([(8, 1), (14, 8), (8, 15), (2, 8)], fill=em + (255,))
    d.polygon([(8, 8), (14, 8), (8, 15)], fill=EM + (255,))
    d.polygon([(2, 8), (8, 8), (8, 15)], fill=(34, 150, 102, 255))
    d.line([(5, 5), (7, 3)], fill=eh + (255,))
    d.line([(5, 6), (8, 3)], fill=eh + (255,))
    px(d, 7, 2, 'e')
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
    # 旧: 両端に四角の付いた斜めの線。下の icon_utp・icon_fiber に置き換えた（呼び出しが残っていれば同じ絵を返す）
    return icon_utp() if color == 'b' else icon_fiber()


def icon_utp():
    # UTPケーブル: 青いケーブルが巻かれて、先に透明なプラグ（金色の端子と爪）
    img, d = new(16, 16)
    d.arc([1, 3, 11, 13], 90, 360, fill=C['b'] + (255,), width=2)
    d.line([(6, 12), (9, 12)], fill=C['b'] + (255,), width=2)
    rect(d, 9, 9, 6, 6, 'e', 'o')
    for x in (10, 12):
        px(d, x, 10, 'y')
    rect(d, 11, 14, 2, 1, 'o')
    return outline(img)


def icon_fiber():
    # 光ファイバー: 橙のケーブルが巻かれて、先に青い差し込み（LCの形）と光る先端
    img, d = new(16, 16)
    d.arc([1, 3, 11, 13], 90, 360, fill=C['f'] + (255,), width=2)
    d.line([(6, 12), (9, 12)], fill=C['f'] + (255,), width=2)
    rect(d, 9, 9, 5, 6, 'b', 'o')
    rect(d, 14, 11, 2, 2, 'g', 'o')
    px(d, 15, 11, 'S')
    return outline(img)


def icon_pc_count():
    img, d = new(16, 16)
    rect(d, 2, 2, 12, 9, 'w')
    rect(d, 4, 4, 8, 5, 's')
    rect(d, 7, 11, 2, 2, 'g')
    rect(d, 4, 13, 8, 1, 'w')
    return outline(img)


def icon_save():
    # フロッピーディスク。自動保存の印として使う
    img, d = new(16, 16)
    rect(d, 2, 2, 12, 12, 'b')
    rect(d, 4, 2, 8, 4, 'g')
    rect(d, 9, 3, 2, 2, 'd')
    rect(d, 4, 9, 8, 5, 'e')
    d.line([(5, 11), (10, 11)], fill=C['g'])
    return outline(img)


def icon_cart():
    img, d = new(16, 16)
    d.line([(1, 2), (3, 2), (5, 10), (13, 10)], fill=C['g'], width=2)
    rect(d, 4, 4, 10, 5, 'y')
    d.line([(5, 6), (12, 6)], fill=C['Y'])
    rect(d, 5, 12, 2, 2, 'd')
    rect(d, 11, 12, 2, 2, 'd')
    return outline(img)


def icon_inventory():
    # 段ボール箱。インベントリの印として使う
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


def icon_cursor():
    # 選択の道具（矢印のカーソル）
    img, d = new(16, 16)
    d.polygon([(3, 1), (3, 12), (6, 9), (8, 14), (10, 13), (8, 8), (12, 8)], fill=C['e'] + (255,))
    return outline(img)


def icon_wire():
    # 配線の道具（ケーブルの先のジャック）
    img, d = new(16, 16)
    d.line([(7, 9), (13, 3)], fill=C['b'], width=2)
    rect(d, 1, 6, 7, 7, 'g')
    rect(d, 3, 8, 3, 3, 'd')
    return outline(img)


def icon_trash():
    # 撤去の道具（ごみ箱）
    img, d = new(16, 16)
    rect(d, 3, 3, 10, 2, 'd')
    rect(d, 6, 1, 4, 2, 'd')
    rect(d, 4, 5, 8, 10, 'g')
    for x in (6, 8, 10):
        d.line([(x, 7), (x, 13)], fill=C['d'])
    return outline(img)


def icon_test():
    # テストの道具（虫めがねの中に、合格の印）
    img, d = new(16, 16)
    d.ellipse([2, 2, 11, 11], fill=C['e'] + (255,))
    d.ellipse([2, 2, 11, 11], outline=C['b'] + (255,), width=2)
    d.line([(4, 7), (6, 9), (9, 5)], fill=C['G'], width=2)
    d.line([(10, 10), (14, 14)], fill=C['d'], width=3)
    return outline(img)


def icon_undo():
    # 元に戻す（上を回って左に下りる矢印）
    img, d = new(16, 16)
    d.arc([3, 4, 13, 14], 180, 360, fill=C['e'] + (255,), width=2)
    d.polygon([(0, 8), (6, 8), (3, 12)], fill=C['e'] + (255,))
    return outline(img)


def icon_redo():
    # やり直す（上を回って右に下りる矢印）
    img, d = new(16, 16)
    d.arc([3, 4, 13, 14], 180, 360, fill=C['e'] + (255,), width=2)
    d.polygon([(10, 8), (15, 8), (12, 12)], fill=C['e'] + (255,))
    return outline(img)


def icon_fit():
    # 全体（四隅の印と中央の四角。画面に収めることを表す）
    img, d = new(16, 16)
    for x, y, w, h in ((1, 1, 5, 2), (1, 1, 2, 5), (10, 1, 5, 2), (13, 1, 2, 5),
                       (1, 13, 5, 2), (1, 10, 2, 5), (10, 13, 5, 2), (13, 10, 2, 5)):
        rect(d, x, y, w, h, 'e')
    rect(d, 6, 6, 4, 4, 'e')
    return outline(img)


def icon_ok():
    img, d = new(16, 16)
    d.line([(3, 8), (6, 11), (12, 4)], fill=C['G'], width=3)
    return outline(img)


def icon_device():
    # 機器の区分（ショップの「機器」のタブ）。前面にポートの列とLEDのある箱
    img, d = new(16, 16)
    rect(d, 1, 4, 14, 8, 'b')
    rect(d, 1, 4, 14, 2, 'bh')
    for x in (3, 5, 7, 9):
        rect(d, x, 8, 1, 2, 'd')
    px(d, 12, 8, 'l')
    px(d, 13, 8, 'l')
    return outline(img)


def icon_furniture():
    # 家具の区分（ショップの「家具」のタブ）。木の天板と脚の机
    img, d = new(16, 16)
    rect(d, 1, 4, 14, 3, 'F1')
    d.line([(1, 4), (14, 4)], fill=C['w'])
    rect(d, 2, 7, 2, 7, 'F3')
    rect(d, 12, 7, 2, 7, 'F3')
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


# ---- マップごとの床（32×32。map.json の floor で選ぶ。wood は floor_0〜2） ----

def floor_tile(variant):
    # 白いタイル（診療所・病棟）。16 px角の目地
    img, d = new(32, 32)
    rect(d, 0, 0, 32, 32, 'T1')
    for k in (15, 31):
        d.line([(0, k), (31, k)], fill=C['T2'])
        d.line([(k, 0), (k, 31)], fill=C['T2'])
    px(d, (4 + variant * 9) % 14, (6 + variant * 5) % 14, 'T2')
    return img


def floor_carpet(variant):
    # カーペット（ホテル・図書館・銀行）。細かい織り目
    img, d = new(32, 32)
    rect(d, 0, 0, 32, 32, 'P1')
    for y in range(0, 32, 4):
        for x in range((y // 4 % 2) * 2 + variant, 32, 4):
            px(d, x, y, 'P2')
    return img


def floor_concrete(variant):
    # コンクリート（倉庫・スタジオ）。まだらの点と、32 pxごとの継ぎ目
    img, d = new(32, 32)
    rect(d, 0, 0, 32, 32, 'K1')
    d.line([(0, 31), (31, 31)], fill=C['K2'])
    d.line([(31, 0), (31, 31)], fill=C['K2'])
    for i in range(7):
        px(d, (i * 13 + variant * 7) % 30, (i * 17 + variant * 11) % 30, 'K2')
    return img


def floor_linoleum(variant):
    # リノリウム（カフェ・コワーキング・校舎）。市松模様
    img, d = new(32, 32)
    rect(d, 0, 0, 32, 32, 'L1')
    rect(d, 0, 0, 16, 16, 'L2')
    rect(d, 16, 16, 16, 16, 'L2')
    return img


# ---- 床に置く大きな障害物（柱と同じ形の箱。天面 32×32 と、下の段の正面 32×14。左右に並べてつなぐ） ----

def counter_top():
    img, d = new(32, 32)
    rect(d, 0, 0, 32, 32, 'F1')
    d.line([(0, 30), (31, 30)], fill=C['F2'])
    return img


def counter_face():
    img, d = new(32, 14)
    rect(d, 0, 0, 32, 14, 'F2')
    d.line([(0, 1), (31, 1)], fill=C['F1'])
    d.line([(15, 2), (15, 13)], fill=C['F3'])
    return img


def shelf_top():
    # 本棚を上から見た天面。本の上端が並ぶ
    img, d = new(32, 32)
    rect(d, 0, 0, 32, 32, 'F2')
    colors = ['b', 'r', 'G', 'y', 'w', 'B', 'f']
    for row, y in enumerate((3, 18)):
        x, i = 0, row * 3
        while x < 32:
            w = 2 + (i % 3 == 0)
            rect(d, x, y, min(w, 32 - x), 11, colors[i % len(colors)])
            x += w + 1
            i += 1
    return img


def shelf_face():
    img, d = new(32, 14)
    rect(d, 0, 0, 32, 14, 'F3')
    colors = ['r', 'b', 'y', 'G', 'w', 'f', 'B']
    x, i = 1, 0
    while x < 31:
        w = 2 + (i % 3 == 1)
        h = 10 - (i % 4 == 2) * 2
        rect(d, x, 12 - h, min(w, 31 - x), h, colors[i % len(colors)])
        x += w + 1
        i += 1
    return img


def rack_top():
    # 倉庫の棚（青い支柱とオレンジの梁）を上から見た天面。棚板の上に段ボールが2つ
    img, d = new(32, 32)
    rect(d, 0, 0, 32, 32, 'g')
    rect(d, 0, 0, 32, 3, 'f')
    rect(d, 0, 29, 32, 3, 'f')
    rect(d, 0, 0, 3, 3, 'b')
    rect(d, 0, 29, 3, 3, 'b')
    rect(d, 4, 6, 11, 20, 'cb', 'CB')
    rect(d, 17, 8, 12, 17, 'cb', 'CB')
    d.line([(4, 15), (14, 15)], fill=C['y'])
    d.line([(17, 16), (28, 16)], fill=C['y'])
    return img


def rack_face():
    # 正面: 左端の青い支柱、上と下のオレンジの梁、間に段ボール
    img, d = new(32, 14)
    rect(d, 0, 0, 32, 14, 'd')
    rect(d, 0, 0, 32, 2, 'f')
    rect(d, 0, 11, 32, 3, 'f')
    rect(d, 4, 3, 11, 8, 'cb', 'CB')
    rect(d, 18, 4, 11, 7, 'cb', 'CB')
    rect(d, 0, 0, 3, 14, 'b')
    return img


def ground(variant):
    # 屋外の芝。ところどころに濃い草の束
    img, d = new(32, 32)
    rect(d, 0, 0, 32, 32, 'G')
    for x, y in (((3 + variant * 11) % 32, 5), ((17 + variant * 7) % 32, 12), ((9 + variant * 5) % 32, 22), ((25 - variant * 9) % 32, 27)):
        px(d, x, y, 'GG')
        px(d, x + 1, y - 1, 'GG')
        px(d, x + 2, y, 'GG')
    return img


def road():
    # 屋外の道路。灰色の舗装と、中央の白い破線
    img, d = new(32, 32)
    rect(d, 0, 0, 32, 32, 'd')
    d.line([(0, 0), (31, 0)], fill=C['g'] + (255,))
    d.line([(0, 31), (31, 31)], fill=C['g'] + (255,))
    for x in (2, 18):
        rect(d, x, 15, 10, 2, 'e')
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


def door():
    # 仕切りの壁の真ん中のドア。床の上に、枠と木の扉を描く
    img = floor(0)
    d = ImageDraw.Draw(img)
    rect(d, 3, 0, 26, 2, 'W3')
    rect(d, 3, 0, 3, 32, 'W3')
    rect(d, 26, 0, 3, 32, 'W3')
    rect(d, 6, 2, 20, 30, 'c', 'o')
    px(d, 21, 17, 'y')
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


def desk_chair_icon(desk_img, chair_img):
    # 「机と椅子」のアイコン（ショップ・インベントリ用）。地図と同じく、机の手前に椅子を重ねる（「机」だけの品目と見分けるため）
    img = Image.new('RGBA', (32, 32 + 28 - 4), (0, 0, 0, 0))
    img.alpha_composite(desk_img, (0, 0))
    img.alpha_composite(chair_img, (0, 32 - 4))
    return img


# 椅子（32×28）。利用者が手で直した chair.png を、画素のまま写したもの。
# 向きの名前は座った社員が向く方向。chair は奥向き（背もたれの背面が見える）
CHAIR_KEYS = {'A': 'o', 'B': 'b', 'C': 'S', 'D': 'B', 'E': 'n', 'F': 'w', 'G': 'g', 'H': 'd'}
CHAIR_EMPTY = '.' * 32
# 脚（五本脚とキャスター。y=20〜27）。どの向きでも同じ
CHAIR_BASE = [
    '......AAAAAAAAAFGGAAAAAAAA......',
    '....AAGGGGGAAAAFGGAAAAGGGGAA....',
    '....AAHHHHHGGGGFGGGGGGHHHHAA....',
    '......AAAAAHHGGHGHGGHHAAAA......',
    '.........AGGGHHAGAHHGGGA........',
    '.......AAGHHHAAAGAAAHHHAA.......',
    '.......AAHAAA..AA...AAAAA.......',
    '.........A.....AA...............',
]


def chair():
    # 奥向き: 背もたれの背面（y=1〜19）。左右に座面の端が見える
    return from_rows([
        CHAIR_EMPTY,
        '........AAAAAAAAAAAAAAAA........',
        '.......ABCCCCCCCCCCCCCCBA.......',
        '......ABBBBBBBBBBBBBBBBBBA......',
        '......ABBBBBBBBBBBBBBBBBBA......',
        '......ADBBBBBBBBBBBBBBBBDA......',
        '......ADDDDDDDDDDDDDDDDDDA......',
        '......ADDDDDDDDDDDDDDDDDDA......',
        '......ADDDDDDDDDDDDDDDDDDA......',
        '......ADDDDDDDDDDDDDDDDDDA......',
        '.....AADDDDDDDDDDDDDDDDDDAA.....',
        '....ABBDDDDDDDDDDDDDDDDDDBBA....',
        '...ABBBDDDDDDDDDDDDDDDDDDBBBA...',
        '...ABBBDDDDDDDDDDDDDDDDDDBBBA...',
        '...ABBBDDDDDDDDDDDDDDDDDDBBBA...',
        '...ADBBDDDDDDDDDDDDDDDDDDBBDA...',
        '...ADDDBDDDDDDDDDDDDDDDDBDDDA...',
        '....ADDDDEEEEEEEEEEEEEEDDDDA....',
        '.....AADDDDDDDDDDDDDDDDDDAA.....',
        '.......AAADDDDDDDDDDDDAAA.......',
    ] + CHAIR_BASE, CHAIR_KEYS)


# ---- 机と椅子の向き（N95）。名前の向きは、座った社員が向く方向（奥・手前・左・右）。今の desk・chair は奥向き ----

def desk_front():
    # 手前向き（社員は机の奥に座り、こちらを向く）。手前に幕板の正面が見える
    img, d = new(32, 32)
    rect(d, 1, 4, 30, 18, 'e')
    d.line([(1, 4), (30, 4)], fill=C['w'])
    d.line([(2, 5), (2, 20)], fill=C['w'])
    rect(d, 1, 22, 30, 3, 'w')
    d.line([(1, 24), (30, 24)], fill=C['g'])
    # 脚と、手前の幕板（正面。床近くまで下がる）
    rect(d, 2, 25, 2, 6, 'g')
    rect(d, 28, 25, 2, 6, 'g')
    rect(d, 4, 25, 24, 5, 'w')
    d.line([(4, 29), (27, 29)], fill=C['g'])
    return outline(img)


def desk_side():
    # 左向き（社員は机の右に座り、左を向く）。正面の机を90度回した形: 天板は幅が狭く奥行きが深い。
    # 社員の反対側（左）に、奥から手前まで続く板脚（幕板）の側面が見える。右向きは左右反転で作る
    img, d = new(32, 32)
    rect(d, 5, 0, 22, 22, 'e')
    d.line([(5, 0), (26, 0)], fill=C['w'])
    d.line([(6, 1), (6, 20)], fill=C['w'])
    rect(d, 5, 22, 22, 3, 'w')
    d.line([(5, 24), (26, 24)], fill=C['g'])
    # 左の板脚（天板の手前の縁から床まで。正面は細いが、外側の面が少し見える）
    rect(d, 5, 25, 4, 6, 'w')
    d.line([(8, 25), (8, 30)], fill=C['g'])
    # 右は細い脚が手前に1本、奥に1本（奥の脚は天板の陰で暗い）
    rect(d, 24, 25, 2, 6, 'g')
    rect(d, 20, 25, 2, 3, 'd')
    return outline(img)


def chair_front():
    # 手前向き（社員はこちらを向く）: 奥に背もたれの前面（クッション）、手前に座面の上面と厚み。脚は奥向きと同じ
    return from_rows([
        CHAIR_EMPTY,
        '........AAAAAAAAAAAAAAAA........',
        '.......ABCCCCCCCCCCCCCCBA.......',
        '......ABBBBBBBBBBBBBBBBBBA......',
        '......ABDDDDDDDDDDDDDDDDBA......',
        '......ABDBBBBBBBBBBBBBBDBA......',
        '......ABDBBBBBBBBBBBBBBDBA......',
        '......ABDBBBBBBBBBBBBBBDBA......',
        '......ABDDDDDDDDDDDDDDDDBA......',
        '......ADBBBBBBBBBBBBBBBBDA......',
        '.....AAAAAAAAAAAAAAAAAAAAA......',
        '....ABBBBBBBBBBBBBBBBBBBBBBA....',
        '...ABBCCCCCCCCCCCCCCCCCCCCBBA...',
        '...ABBBBBBBBBBBBBBBBBBBBBBBBA...',
        '...ABBBBBBBBBBBBBBBBBBBBBBBBA...',
        '...ABBBBBBBBBBBBBBBBBBBBBBBBA...',
        '...ADBBBBBBBBBBBBBBBBBBBBBBDA...',
        '....ADDDDDDDDDDDDDDDDDDDDDDA....',
        '.....AADDDDDDDDDDDDDDDDDDAA.....',
        '.......AAADDDDDDDDDDDDAAA.......',
    ] + CHAIR_BASE, CHAIR_KEYS)


def chair_side():
    # 右向き（社員は右を向く）: 座面を横から見て、背もたれは左の端に細く立つ。左向きは左右反転で作る
    seat = from_rows([CHAIR_EMPTY] * 11 + [
        '....AAAAAAAAAAAAAAAAAAAAAAAA....',
        '...ABCCCCCCCCCCCCCCCCCCCCCCBA...',
        '...ABBBBBBBBBBBBBBBBBBBBBBBBA...',
        '...ABBBBBBBBBBBBBBBBBBBBBBBBA...',
        '...ADBBBBBBBBBBBBBBBBBBBBBBDA...',
        '....ADDDDDDDDDDDDDDDDDDDDDDA....',
        '.....AADDDDDDDDDDDDDDDDDDAA.....',
        '.......AAADDDDDDDDDDDDAAA.......',
        CHAIR_EMPTY,
    ] + CHAIR_BASE, CHAIR_KEYS)
    back = [
        CHAIR_EMPTY,
        '......AAAAAA....................',
        '.....ABCCCCBA...................',
    ] + ['.....ADBBBBBA...................'] * 12 + [
        '.....ADDBBBBA...................',
        '.....ADDDDDDA...................',
        '......AAAAAA....................',
    ] + [CHAIR_EMPTY] * 10
    return overlay(seat, back, CHAIR_KEYS)


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
    # 本棚: 天板（奥行き4）と、3段の棚
    img, d = new(32, 52)
    box3q(d, 2, 1, 28, 4, 45, 'F1', 'F3', edge='F1')
    rect(d, 4, 7, 24, 41, 'F2')
    colors = ['b', 'r', 'G', 'y', 'w', 'B', 'f']
    for shelf in range(3):
        top = 7 + shelf * 14
        x = 5
        i = shelf * 2
        while x < 26:
            w = 2 + (i % 3 == 0)
            h = 9 + (i % 4 == 1) - (i % 5 == 2) * 2
            rect(d, x, top + 12 - h, min(w, 27 - x), h, colors[i % len(colors)])
            x += w + (i % 4 == 3)
            i += 1
        rect(d, 4, top + 12, 24, 2, 'F3')
    return outline(img)


def cabinet():
    # 書類の棚: 天面（奥行き5）と、引き出し3段の前面
    img, d = new(32, 40)
    box3q(d, 4, 1, 24, 5, 32, 'e', 'g', edge='e')
    for k in range(3):
        y = 8 + k * 10
        rect(d, 6, y, 20, 9, 'w')
        d.line([(6, y + 8), (25, y + 8)], fill=C['d'])
        rect(d, 13, y + 3, 6, 2, 'd')
    return outline(img)


def coffee():
    # 台の上のコーヒーメーカーとカップ。台とメーカーは天面を見せる
    img, d = new(32, 36)
    box3q(d, 2, 16, 28, 5, 14, 'F1', 'F2', edge='e')
    d.line([(16, 23), (16, 33)], fill=C['F3'])
    box3q(d, 6, 3, 13, 3, 13, 'g', 'd', edge='w')
    rect(d, 8, 9, 8, 6, 's')
    rect(d, 9, 10, 6, 4, 'h')
    px(d, 16, 7, 'r')
    rect(d, 22, 13, 5, 6, 'e', 'o')
    rect(d, 23, 14, 3, 1, 'h')
    return outline(img)


def water():
    # ウォーターサーバー: 上にボトル、本体は天面を見せる
    img, d = new(32, 48)
    rect(d, 10, 2, 12, 14, 'sky')
    rect(d, 10, 2, 12, 4, 'sky2')
    rect(d, 13, 0, 6, 2, 'bh')
    box3q(d, 8, 16, 16, 4, 27, 'e', 'w', edge='e')
    rect(d, 11, 25, 3, 3, 'b')
    rect(d, 18, 25, 3, 3, 'r')
    rect(d, 10, 31, 12, 8, 'g')
    return outline(img)


def trash():
    # ごみ箱: 上から口の中が見える
    img, d = new(32, 32)
    d.polygon([(9, 17), (22, 17), (21, 30), (10, 30)], fill=C['g'])
    d.ellipse([9, 13, 22, 19], fill=C['w'] + (255,))
    d.ellipse([11, 14, 20, 18], fill=C['d'] + (255,))
    d.line([(13, 21), (13, 28)], fill=C['d'])
    d.line([(18, 21), (18, 28)], fill=C['d'])
    return outline(img)


def boxes():
    # 段ボール: 天面にガムテープの線
    img, d = new(32, 36)
    box3q(d, 2, 16, 18, 5, 13, 'F1', 'c', edge='e')
    d.line([(11, 17), (11, 20)], fill=C['F3'])
    box3q(d, 16, 4, 14, 4, 10, 'F1', 'c', edge='e')
    d.line([(23, 5), (23, 7)], fill=C['F3'])
    box3q(d, 19, 21, 12, 4, 10, 'F1', 'F2', edge='e')
    rect(d, 22, 28, 7, 3, 'e')
    return outline(img)


def sofa():
    # ソファ: 背もたれの天面、座面（広く見せる）、ひじ掛けの天面
    img, d = new(32, 32)
    box3q(d, 2, 6, 28, 3, 8, 'bh', 'b', edge='e')
    rect(d, 6, 16, 20, 7, 'bh', 'o')
    d.line([(16, 17), (16, 22)], fill=C['b'])
    rect(d, 6, 23, 20, 5, 'b', 'o')
    for x in (1, 26):
        box3q(d, x, 12, 5, 3, 14, 'bh', 'B', edge='e')
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
    # PC の向き（N95）。左向きは右向きの左右反転
    save(pc_front(), 'device/pc_basic_front.png')
    pc_right = pc_side()
    save(pc_right, 'device/pc_basic_right.png')
    save(pc_right.transpose(Image.FLIP_LEFT_RIGHT), 'device/pc_basic_left.png')
    save(server(), 'device/server_basic.png')
    save(l2_switch(), 'device/l2_switch_8p.png')
    save(l2_switch_4p(), 'device/l2_switch_4p.png')
    save(router(), 'device/router_basic.png')
    # これから機材に加える候補（データはまだない）
    save(l3_switch(), 'device/l3_switch.png')
    save(wifi_router(), 'device/wifi_router.png')
    save(vpn_router(), 'device/vpn_router.png')
    save(router_switch(), 'device/router_switch.png')
    save(printer(), 'device/printer_basic.png')
    save(firewall(), 'device/firewall.png')
    save(firewall_dmz(), 'device/firewall_dmz.png')
    save(access_point(), 'device/access_point.png')
    save(laptop(), 'device/laptop.png')
    save(gpu_server(), 'device/gpu_server.png')
    for shirt_name, (shirt, shade) in SHIRT_COLORS.items():
        for hair_name, hair in HAIR_COLORS.items():
            for style in HAIR_STYLES:
                for frame in (0, 1):
                    save(staff(shirt, shade, hair, style, frame), f'staff/{shirt_name}_{hair_name}_{style}_{frame}.png')
    icons = {
        'mail': icon_mail(),
        'money': icon_money(),
        'star': icon_star(),
        'level': icon_level(),
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
        'device': icon_device(),
        'furniture': icon_furniture(),
        'cart': icon_cart(),
        'save': icon_save(),
        'inventory': icon_inventory(),
        'person': icon_person(),
        'cursor': icon_cursor(),
        'wire': icon_wire(),
        'trash': icon_trash(),
        'test': icon_test(),
        'undo': icon_undo(),
        'redo': icon_redo(),
        'fit': icon_fit(),
    }
    for name, img in icons.items():
        save(img, f'icon/{name}.png')
    for v in range(3):
        save(floor(v), f'tile/floor_{v}.png')
    for v in range(2):
        save(ground(v), f'tile/ground_{v}.png')
    save(road(), 'tile/road.png')
    for style, fn in (('tile', floor_tile), ('carpet', floor_carpet), ('concrete', floor_concrete), ('linoleum', floor_linoleum)):
        for v in range(3):
            save(fn(v), f'tile/floor_{style}_{v}.png')
    for kind, top, face in (('counter', counter_top, counter_face), ('shelf', shelf_top, shelf_face), ('rack', rack_top, rack_face)):
        save(top(), f'tile/{kind}_top.png')
        save(face(), f'tile/{kind}_face.png')
    tiles = {
        'wall_face': wall_face(),
        'window': wall_window(),
        'clock': wall_clock(),
        'poster': wall_poster(),
        'whiteboard': wall_whiteboard(),
        'door': door(),
    }
    for name, img in tiles.items():
        save(img, f'tile/{name}.png')
    furniture = {
        'desk': desk(),
        'chair': chair(),
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
    # 机と椅子の向き（N95）。右向きは左向きの左右反転
    facings = {
        'desk_front': desk_front(),
        'desk_left': desk_side(),
        'chair_front': chair_front(),
        'chair_right': chair_side(),
    }
    facings['desk_right'] = facings['desk_left'].transpose(Image.FLIP_LEFT_RIGHT)
    facings['chair_left'] = facings['chair_right'].transpose(Image.FLIP_LEFT_RIGHT)
    for name, img in facings.items():
        save(img, f'furniture/{name}.png')
    save(desk_chair_icon(furniture['desk'], furniture['chair']), 'furniture/desk_chair.png')
    print('ok')
