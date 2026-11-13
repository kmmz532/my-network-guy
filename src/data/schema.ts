// ゲームデータのzodスキーマ。ビルド時（game-data プラグイン）でのみ使用し、実行時のjsには含めない。
import { z } from 'zod';
import { parseCondition } from '../sim/guide';
import { CATEGORY_IDS } from './categories';
import { VOID_CHAR } from './tileKind';

const int = z.number().int();
// 解放のレベル（会社のレベル。N45）。品目ごとに必ず書く
const unlockLevelSchema = int.min(1).max(999);
const nonNegativeInt = z.number().int().nonnegative();
// 床の大きさ（床の内側のマス数）
const sizeSchema = z.object({ w: int.positive(), h: int.positive() });

// 社員の職種（STAFF.md「1. 社員のデータ」）
// エンジニア枠の職種（案件の担当に選べ、施工の力になる）
export const ENGINEER_JOB_IDS = ['network', 'infra', 'security', 'dev'] as const;
export type EngineerJobId = (typeof ENGINEER_JOB_IDS)[number];
// 内勤の職種（案件の担当に選べず、社内の仕事で会社に効果を与える）。まだ追加していない
export const BACK_OFFICE_JOB_IDS = ['sales', 'hr', 'accounting'] as const;
export type BackOfficeJobId = (typeof BACK_OFFICE_JOB_IDS)[number];
export const JOB_IDS = [...ENGINEER_JOB_IDS, ...BACK_OFFICE_JOB_IDS] as const;
export type JobId = EngineerJobId | BackOfficeJobId;
const jobIdSchema = z.enum(JOB_IDS);

// 社員のデータ。ゲームの状態に保存する
export interface Staff {
  uid: string; // "s" + 連番
  // 勤務の区分（日勤か夜勤。N48）
  shift: 'day' | 'night';
  name: string; // 名前（言語ファイルの名前の候補のキー）
  look: string; // 見た目（STAFF_LOOKS のいずれか）
  quirk: string; // 口癖（言語ファイルの口癖の候補のID）
  job: JobId;
  level: number; // 総合能力（1〜）
  exp: number; // 次のレベルまでの経験値
  salary: number; // 月給（採用時に決まり、変わらない）
  certs: string[]; // 取得した資格のID
  training: { course: string; untilMinute: number } | null; // 受講中の研修
  levelCap: number; // 今の level の上限（10 の倍数の段階の上端。昇給で上がる・N101）
  desk: string | null; // 座っている机（自社オフィスの家具の uid）。辞めた社員の机は空いたままになる（A）
  hiredMonth: number; // 採用した月（ゲーム内の月の番号。退職の条件に使う・N90）
  leaving: boolean; // 退職を伝え済み（その月の末日に退職する・N90）
}

// 見た目の候補。服の色・髪の色・髪型の組み合わせ（4 × 3 × 2 = 24 通り）。
// 見た目の名前は「服_髪の色_髪型」で、スプライトは staff/<見た目>_<コマ>（scripts/gen-sprites.py と対応）
export const STAFF_SHIRTS = ['blue', 'red', 'green', 'yellow'] as const;
export const STAFF_HAIRS = ['dark', 'brown', 'blonde'] as const;
export const STAFF_HAIR_STYLES = ['short', 'long'] as const;
// 服の色と髪の色に分けられない見た目（紫の長髪）。ほかの見た目と同じ確率（1/25）で選ばれる
export const STAFF_SPECIAL_LOOKS: readonly string[] = ['purple_long'];
export const STAFF_LOOKS: readonly string[] = [
  ...STAFF_SHIRTS.flatMap((shirt) => STAFF_HAIRS.flatMap((hair) => STAFF_HAIR_STYLES.map((style) => `${shirt}_${hair}_${style}`))),
  ...STAFF_SPECIAL_LOOKS,
];
// 社員の予備の見た目（スプライトが読めないときの代わりに使う。画面の2人分）
export const STAFF_PLACEHOLDER_LOOKS = ['blue_dark_short', 'red_dark_short'] as const;
// 増やす前の見た目（blue・red）。保存済みのデータはこの名前のまま残るため、黒髪の短髪として描く
const LEGACY_STAFF_LOOKS: Readonly<Record<string, string>> = { blue: 'blue_dark_short', red: 'red_dark_short' };
// 見た目の名前からスプライトの名前（staff/ の前の部分）を決める
export const staffSpriteName = (look: string): string => LEGACY_STAFF_LOOKS[look] ?? look;

// 床の絵の種類（木・タイル・カーペット・コンクリート・リノリウム）
export const FLOOR_IDS = ['wood', 'tile', 'carpet', 'concrete', 'linoleum'] as const;
export type FloorId = (typeof FLOOR_IDS)[number];
const floorIdSchema = z.enum(FLOOR_IDS);

export const balanceSchema = z.object({
  time: z.object({
    realMsPerTick: int.positive(),
    gameMinutesPerTick: int.positive(),
    daysPerMonth: int.positive(),
    speeds: z.array(z.number().nonnegative()).min(1),
    // 早送りの速さが解放されるレベル（N99）。ここにない速さは最初から使える（停止・1倍・2倍）
    speedUnlockLevels: z.record(z.string(), unlockLevelSchema),
  }),
  startMoney: int,
  // 在庫を売るときの値段（購入時の値段に掛ける割合）
  sellRate: z.number().min(0).max(1),
  // 地図の1マスの長さ（メートル）。ケーブルの上限と表示に使う（N49）
  metersPerTile: int.positive(),
  // 夜勤の給与の倍率（日勤の給与に掛ける。N48）
  nightPayRate: z.number().positive(),
  // 納品以外の経験値の量と、1日の上限（N55）
  // 経験値の量の割合（現在のレベルの必要経験値に掛ける）。納品は解放レベルの必要経験値に掛ける（LEVEL.md）
  // 自社のサーバーを外部に貸す収入（N72）。公開しているサーバー1台ごとに、月末に受け取る額
  // 型紙なしで任せる（N94）。能力と職種の一致から、費用の割合と手直しを乱数で決める
  delegate: z.object({
    powerForFull: z.number().positive(),
    matchWeight: z.number().min(0).max(1),
    bestCostRatio: z.number().nonnegative(),
    worstCostRatio: z.number().nonnegative(),
    noiseWidth: z.number().nonnegative(),
    worstRework: z.number().nonnegative(),
    reworkNoise: z.number().nonnegative(),
    // 型紙なしで任せた依頼の施工にかける時間（配置する機器1台あたり・分）。施工の進みは担当の社員の施工力で決まる
    blindMinutesPerDevice: z.number().positive(),
  }),
  // 内勤（社内の仕事で会社に効果を与える。担当には出さない）。効果の強さは、その職種の内勤の実効 level の合計
  backOffice: z.object({
    dailyExp: nonNegativeInt,
    // printerArrivalBonus: つないでいるプリンターが1台あると、営業の依頼が届く確率に足す（N98）
    sales: z.object({ chancePerLevel: z.number().nonnegative(), maxChance: z.number().min(0).max(1), printerArrivalBonus: z.number().min(0).max(1), rewardWeightPerLevel: z.number().nonnegative() }),
    accounting: z.object({ ratePerLevel: z.number().nonnegative(), maxRate: z.number().nonnegative() }),
    // システムエンジニア（エンジニア枠）。担当でない日の開発の収入の率（月給に掛ける）。level が上がるほど率が上がる
    dev: z.object({ baseRate: z.number().nonnegative(), ratePerLevel: z.number().nonnegative() }),
    hr: z.object({
      maxExtraCandidates: nonNegativeInt,
      candidatesPerLevel: z.number().nonnegative(),
      candidateLevelPerLevel: z.number().nonnegative(),
      trainingRatePerLevel: z.number().nonnegative(),
      maxTrainingRate: z.number().nonnegative(),
      juniorMaxLevel: nonNegativeInt,
      juniorExpRatePerLevel: z.number().nonnegative(),
    }),
  }),
  // 退職（N90）。退職金は月給の payMonths か月分。採用から minMonths か月たつまで伝えられない
  retire: z.object({ payMonths: nonNegativeInt, minMonths: nonNegativeInt }),
  rental: z.object({ monthlyPerCustomer: z.number().int().nonnegative(), levelsPerCustomer: z.number().int().positive() }),
  exp: z.object({ delivery: z.number().nonnegative(), deliveryGapStep: z.number().nonnegative(), deliveryGapMin: z.number().nonnegative(), guide: z.number().nonnegative(), hire: z.number().nonnegative(), expansion: z.number().nonnegative(), furniture: z.number().nonnegative(), dailyCap: z.number().nonnegative() }),
  // 機材の価格の式（N35）: 基本の価格（分類）＋ポート1つあたり（分類）＋機能ごとの加算。機材の定価は、この式の値とそろえる
  pricing: z.object({
    base: z.record(z.string(), nonNegativeInt),
    perPort: z.record(z.string(), nonNegativeInt),
    features: z.record(z.string(), nonNegativeInt),
  }),
  // ゲーム開始時の在庫（機器・家具の id と台数）
  initialStock: z.record(z.string(), nonNegativeInt),
  offerIntervalDays: int.positive(),
  // 依頼がまとめて届く確率（間隔ごと）と、まとめて届くときの件数の上限（2件以上）。省略すると、毎回1件ずつ届く
  offerBurst: z.object({ chance: z.number().min(0).max(1), count: int.min(2) }).optional(),
  // 新しく解放した種類（announce）を、解放から arrivals 件届くまで weightFactor 倍の重みで出す（N51b）
  freshOffer: z.object({ arrivals: int.positive(), weightFactor: int.positive() }),
  staff: z.object({
    initialCount: int.positive(),
    // 社員の level の上限の段階（10 の倍数。昇給で1段階ずつ上がる・N101）
    levelCapStep: int.positive(),
    // ゲーム開始時に置く机の位置（自社オフィスのマス）
    initialDesks: z.array(z.object({ x: nonNegativeInt, y: nonNegativeInt })),
    // ゲーム開始時の社員の職種・level・月給（先頭から順に作る）
    initial: z.array(
      z.object({
        job: jobIdSchema,
        level: int.positive(),
        salary: nonNegativeInt,
      }),
    ),
    // ヒントの段階が上がる level の境目（段階1・2・3の順）
    hintLevels: z.array(int.positive()).length(3),
    // level n から n+1 に上がるのに必要な経験値は expPerLevel × n
    expPerLevel: int.positive(),
    power: z.object({
      // 案件の求める職種と一致したときの係数
      jobMatch: z.number().positive(),
      // 席のない社員の係数（ソファがないとき）
      seatless: z.number().min(0).max(1),
    }),
  }),
  build: z.object({
    workStartHour: z.number().min(0).max(24),
    workEndHour: z.number().min(0).max(24),
    minutesPerDevice: nonNegativeInt,
    minutesPerCableTile: nonNegativeInt,
    // 夜勤の勤務時間（開始の時刻から、翌日の終了の時刻まで。N48）
    nightStartHour: z.number().min(0).max(24),
    nightEndHour: z.number().min(0).max(24),
    // 社員が出社する時刻（始業の何分前にドアから入るか）。席に着いているのは始業の時刻まで
    arriveMinutesBefore: nonNegativeInt,
  }),
  // 社員の休憩（N42）。1回は minMinutes 以上、1日に maxPerDay 回・合計 maxMinutesPerDay まで（見た目だけ。施工・経験値・給与には影響しない）
  breaks: z.object({
    maxPerDay: nonNegativeInt,
    maxMinutesPerDay: nonNegativeInt,
    minMinutes: int.positive(),
    maxMinutes: int.positive(),
  }),
  rating: z
    .array(
      z.object({
        stars: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        maxCostRatio: z.number().nonnegative().nullable(),
        maxRework: nonNegativeInt.nullable(),
        // 報酬に掛ける倍率
        rewardRate: z.number().positive(),
      }),
    )
    .min(1),
  // ツールチップの出し方（ミリ秒）
  tooltip: z.object({
    hoverMs: nonNegativeInt,
    longPressMs: nonNegativeInt,
    touchHideMs: nonNegativeInt,
  }),
  // 試験の合格率: min(maxRate, baseRate + perLevel × (level − 資格の minLevel))
  exam: z.object({
    baseRate: z.number().min(0).max(1),
    perLevel: z.number().min(0),
    maxRate: z.number().min(0).max(1),
  }),
  // 採用の候補（毎月1日に作り直す）
  hiring: z.object({
    maxCandidates: nonNegativeInt,
    baseSalary: nonNegativeInt,
    salaryPerLevel: nonNegativeInt,
    // 内勤（営業・人事・経理）の給与は、エンジニアの式に掛ける係数。下限は minSalary（N100）
    backOfficeSalaryRate: z.number().positive(),
    minSalary: nonNegativeInt,
    // 社員の人数の上限（会社のレベル以上での上限。[レベル, 上限] の組）
    staffCapByLevel: z.array(z.tuple([unlockLevelSchema, int.positive()])),
    // 候補の能力は、会社のレベルの何段階ごとに1上がるか
    candidateLevelStep: int.positive(),
  }),
  // 会社のレベル（N45）。必要な経験値と、毎回の報酬の式の係数
  level: z.object({
    max: unlockLevelSchema,
    base: z.number().positive(),
    power: z.number().positive(),
    moneyBase: nonNegativeInt,
    moneyPower: z.number().positive(),
  }),
  // 機能の解放のレベル（品目ではないもの）
  featureUnlocks: z.object({ nightShift: unlockLevelSchema, floorChange: unlockLevelSchema, uplink: unlockLevelSchema }),
  // 自社の床の種類（N92）。見た目だけで、費用は1マスあたり。木は最初から使える
  floors: z.array(z.object({ id: floorIdSchema, unlockLevel: unlockLevelSchema, costPerTile: nonNegativeInt })),
  office: z.object({
    // 同時に受注できる案件の数（案件の枠）
    projectSlots: int.positive(),
    // 新しく始めたときの部屋の床の大きさ（マス）
    initialSize: sizeSchema,
    // 回線終端の位置を変更する費用
    uplinkMoveCost: nonNegativeInt,
    // 部屋を広げる費用と上限。費用は baseCost から、買うたびに baseCost の increase 倍ずつ増える（直線）。step マスずつ広がる
    expand: z.object({
      baseCost: nonNegativeInt,
      increase: z.number().min(0),
      step: int.positive(),
      maxSize: sizeSchema,
      // 拡張の回数ごとの解放のレベル（1回目から順に）
      unlockLevels: z.array(unlockLevelSchema),
    }),
  }),
  // 納品が遅れたときの報酬の割合。1日ごとに lateRatePerDay ぶん減り、lateFloor より下がらない
  deadline: z.object({
    lateRatePerDay: z.number().min(0),
    lateFloor: z.number().min(0).max(1),
  }),
});

export const cableSchema = z.object({
  id: z.string().min(1),
  port: z.string().min(1),
  bandwidthMbps: nonNegativeInt,
  maxLengthTiles: nonNegativeInt,
  pricePerLink: nonNegativeInt,
  pricePerTile: nonNegativeInt,
  unlockLevel: unlockLevelSchema,
});

export const cablesFileSchema = z.object({ cables: z.array(cableSchema) });

// 機材が初期に動かすサービス（待ち受けるプロトコルとポート）。サーバーは置いたときに起動する
const serviceSchema = z.object({
  protocol: z.enum(['http']),
  port: z.number().int().min(1).max(65535),
});

// 機器の能力（NET.md §4）。コードは機器の種類ではなく、この能力だけを見る（N134）
export const CAPABILITY_IDS = ['switchport', 'vlan', 'stp', 'svi', 'routedPort', 'subif', 'routing', 'rip', 'ospf', 'bgp', 'nat', 'services', 'dhcpRelay', 'firewall', 'wireless', 'wan', 'vrrp', 'lag'] as const;
export type Capability = (typeof CAPABILITY_IDS)[number];

export const deviceSchema = z
  .object({
  id: z.string().min(1),
  category: z.enum(CATEGORY_IDS),
  // 機器ができること（N134）。定義にない能力は、読み込みで止める
  capabilities: z.array(z.enum(CAPABILITY_IDS)).default([]),
  // SVI（VLAN のインターフェース）の数の上限。svi を持つ機器だけ
  sviMax: nonNegativeInt.optional(),
  // 机の上にも床にも置ける小さな機器（N91）。省略時は false（PC は机の上だけ・サーバーなどは床だけ）
  deskable: z.boolean().default(false),
  price: nonNegativeInt,
  ports: z
    .array(
      z.object({
        type: z.string().min(1),
        count: int.positive(),
        speedMbps: nonNegativeInt,
      }),
    )
    .min(1),
  features: z.array(z.string()).default([]),
  defaultServices: z.array(serviceSchema).default([]),
  sprite: z.string().min(1),
  unlockLevel: unlockLevelSchema,
})
  // 能力の組み合わせの矛盾は、読み込みで止める（N134）
  .superRefine((d, ctx) => {
    const has = (c: Capability) => d.capabilities.includes(c);
    const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${d.id}: ${message}` });
    if (has('svi') && !has('switchport')) fail('svi には switchport が必要');
    if (has('svi') && d.sviMax === undefined) fail('svi には sviMax が必要');
    if (!has('svi') && d.sviMax !== undefined) fail('sviMax は svi を持つ機器だけ');
    if (has('subif') && !has('routedPort')) fail('subif には routedPort が必要');
    if ((has('ospf') || has('bgp') || has('nat')) && !has('routing')) fail('ospf・bgp・nat には routing が必要');
    if (has('vlan') && !has('switchport')) fail('vlan には switchport が必要');
  });

export const devicesFileSchema = z.object({ devices: z.array(deviceSchema) });

// 家具。自社オフィスに置く。seat が true の家具は社員の席になる
export const furnitureSchema = z.object({
  id: z.string().min(1),
  price: nonNegativeInt,
  sprite: z.string().min(1),
  // ショップ・インベントリのアイコン（地図の絵と分けたいときだけ書く。省くと sprite を使う）
  icon: z.string().min(1).optional(),
  seat: z.boolean(),
  unlockLevel: unlockLevelSchema,
  // 家具の効果（OFFICE.md「家具の効果」）。range を省略するとオフィス全体に効く
  effect: z.object({
    stat: z.enum(['power', 'exp', 'seatless']),
    value: z.number(),
    range: nonNegativeInt.optional(),
  }).optional(),
});

export const furnitureFileSchema = z.object({ furniture: z.array(furnitureSchema) });

export const shopFileSchema = z.object({
  items: z
    .array(
      z
        .object({
          device: z.string().min(1).optional(),
          cable: z.string().min(1).optional(),
          furniture: z.string().min(1).optional(),
          // サンドボックスだけに並べる（経営モードでは、解放のレベルに関係なく並べない）
          sandboxOnly: z.boolean().optional(),
        })
        .refine((item) => [item.device, item.cable, item.furniture].filter((v) => v !== undefined).length === 1, {
          message: 'device・cable・furniture のどれか1つだけを指定する',
        }),
    ),
});

const interfaceSchema = z.object({
  port: nonNegativeInt,
  ip: z.string().regex(/^\d{1,3}(\.\d{1,3}){3}$/),
  prefix: z.number().int().min(0).max(32),
});

const placedConfigSchema = z.object({
  interfaces: z.array(interfaceSchema),
  gateway: z.string().regex(/^\d{1,3}(\.\d{1,3}){3}$/).nullable(),
  services: z.array(serviceSchema),
  locked: z.boolean(),
});

export const placedSchema = z.object({
  ref: z.string().min(1),
  device: z.string().min(1),
  x: nonNegativeInt,
  y: nonNegativeInt,
  locked: z.boolean(),
  config: placedConfigSchema.optional(),
  // 回線終端の回線の情報（ISP の名前・回線のネットワーク・ISP 側のアドレス・ISP の AS 番号）
  isp: z.object({ name: z.string(), network: z.string(), prefix: z.number().int().min(8).max(30), ispIp: z.string(), asn: z.number().int().positive().optional() }).optional(),
  // 場所の名前（「受付のPC」など。画面の機器の名前になる。なければ「PC-1」などの仮の名前）
  name: z.string().min(1).max(24).optional(),
});

// 案件の達成条件。ハンドラの種類はここで列挙し、新しい種類を追加するときは本体のハンドラと合わせて追加する。
export const goalSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping'), from: z.string().min(1), to: z.string().min(1) }),
  z.object({
    type: z.literal('ping_all'),
    // ひな形では、要素に $role:<役割> を書くと、その役割の PC すべてに置き換わる
    nodes: z.union([z.array(z.string().min(1)).min(1), z.literal('$all_pcs')]),
  }),
  z.object({
    type: z.literal('http'),
    from: z.string().min(1),
    to: z.string().min(1),
    port: z.number().int().min(1).max(65535),
  }),
  // 指定した種類の機器が一定数以上ある
  z.object({ type: z.literal('count'), category: z.string().min(1), min: z.number().int().positive() }),
  // 指定した型の機器が一定数以上ある（例: GPUサーバー。カテゴリでは区別できない機器に使う）
  z.object({ type: z.literal('count_device'), device: z.string().min(1), min: z.number().int().positive() }),
  // すべてのPCから、いずれかのサーバーのWebページを閲覧できる
  z.object({ type: z.literal('http_all'), port: z.number().int().min(1).max(65535) }),
  // すべての PC から、そのカテゴリの機器のどれか1台へ Ping が通る（N51b。プリンターの共有）
  z.object({ type: z.literal('reach_category'), category: z.string().min(1) }),
  // 無線の端末（無線の能力を持つ機器）が、アクセスポイントに min 台以上つながる（N152）
  z.object({ type: z.literal('wireless_clients'), min: z.number().int().positive() }),
  // すべての PC どうしが届き、設定した経路（static）を1つも使わない（経路は RIP・OSPF で覚える。N143）
  z.object({ type: z.literal('no_static_route') }),
  // 指定したルーターの BGP の隣接が、min 本以上確立している
  z.object({ type: z.literal('bgp_established'), node: z.string().min(1), min: z.number().int().positive() }),
  // 指定した機器のどれか1台の電源を切っても、残りの PC・サーバーがすべて互いに届く
  z.object({ type: z.literal('survive_device_failure'), nodes: z.array(z.string().min(1)).min(1) }),
  // 指定したスイッチが、スパニングツリーのルートブリッジになっている
  z.object({ type: z.literal('stp_root'), node: z.string().min(1) }),
  // 回線終端（uplink）が2つ以上あり、どれか1つを失っても、すべての PC が外部へ届く
  z.object({ type: z.literal('survive_uplink_failure') }),
  // 指定した機器が、同じネットワークの OSPF の指定ルーター（DR）に選ばれている
  z.object({ type: z.literal('ospf_dr'), node: z.string().min(1) }),
  // すべての PC が、名前（ホスト名）で指定の機器へ届く。名前は各 PC が対応表・ネームサーバーで引く（N68）
  z.object({ type: z.literal('reach_by_name'), name: z.string().min(1) }),
  // すべてのPCから、到達できるサーバー（外部）への経路にファイアウォールがある
  z.object({ type: z.literal('firewall') }),
  // from から to への Ping が、ファイアウォールの規則で止められている（通ってはいけない通信。N38）
  z.object({ type: z.literal('blocked'), from: z.string().min(1), to: z.string().min(1) }),
  // from のどの機器から to のどの機器へも Ping が届かない（理由は問わない。ネットワークを分ける）
  z.object({ type: z.literal('isolated'), from: z.array(z.string().min(1)).min(1), to: z.array(z.string().min(1)).min(1) }),
  // nodes のすべての機器から、いずれかのサーバーのWebページを閲覧できる
  z.object({ type: z.literal('http_from'), nodes: z.array(z.string().min(1)).min(1), port: z.number().int().min(1).max(65535) }),
  // from のどの機器から to のどの機器への Ping も、ファイアウォールの規則で止められている
  z.object({ type: z.literal('blocked_all'), from: z.array(z.string().min(1)).min(1), to: z.array(z.string().min(1)).min(1) }),
]);

// 地図・依頼に置く家具（N76）。歩けない床になり、機器は置けない
const placedFurnitureSchema = z.object({ id: z.string().min(1), x: nonNegativeInt, y: nonNegativeInt, facing: z.enum(['up', 'down', 'left', 'right']).optional() });

export const contractSchema = z.object({
  id: z.string().min(1),
  stage: int.positive(),
  // この案件が届く会社のレベル（その案件で使う機器の解放のレベル以上）
  unlockLevel: unlockLevelSchema,
  order: int,
  requires: z.array(z.string().min(1)).default([]),
  // 向いている職種（施工力の1.5倍・依頼カードの表示）。省くと、どの職種にも向かない
  jobs: z.array(jobIdSchema).optional(),
  map: z.string().min(1),
  budget: nonNegativeInt,
  // 受注日からの期日（日数）。自社案件のように期日のない案件は省く
  deadlineDays: int.positive().optional(),
  // 扱う論点（sim-3 の段階の ID）と、割り当てに使えるアドレスブロック（任意）
  topics: z.array(z.string().min(1)).optional(),
  addressBlock: z.object({ network: z.string().regex(/^\d{1,3}(\.\d{1,3}){3}$/), prefix: int.min(8).max(30) }).optional(),
  placed: z.array(placedSchema),
  // 依頼で作った家具（机・棚・飾り。N76）
  furniture: z.array(placedFurnitureSchema).optional(),
  goals: z.array(goalSchema).min(1),
  reward: z.object({
    money: nonNegativeInt,
    // 納品でインベントリに入る機材（自社案件の報酬。N34）
    devices: z.array(z.object({ device: z.string().min(1), count: int.positive() })).optional(),
  }),
  // 自社案件。自社オフィスで行い、納品後もネットワークが残る
  inhouse: z.boolean().default(false),
  // 自社案件の納品で得る効果（施工速度の上昇率など）
  effect: z.object({ buildSpeed: z.number().min(0).default(0) }).optional(),
  // true なら、IPアドレスの自動割り当て（設定がオンでも）を使わず、IPアドレスを自分で入れる
  manualIp: z.boolean().optional(),
});

// 置く範囲の1つ。台数の範囲（min〜max）の床に PC を置く（N51a）
const spawnGroupSchema = z.object({
  x: nonNegativeInt,
  y: nonNegativeInt,
  width: int.positive(),
  height: int.positive(),
  min: int.positive(),
  max: int.positive(),
  // 役割（目標の $role:<役割> で指す）と、PC の表示名（末尾に番号が付く）。どちらも書くか、どちらも書かない
  role: z.string().regex(/^[a-z]+$/).optional(),
  name: z.string().min(1).optional(),
}).refine((g) => (g.role === undefined) === (g.name === undefined), { message: 'role と name は、どちらも書くか、どちらも書かない' });

// 定型案件（ひな形）。変化形（variantOf）は読み込み時に元のひな形と合わせて完全な形にする（N51a）
export const templateSchema = z
  .object({
    id: z.string().min(1),
    stage: int.positive(),
    unlockLevel: unlockLevelSchema,
    requires: z.array(z.string().min(1)).default([]),
    jobs: z.array(jobIdSchema).optional(),
    weight: nonNegativeInt,
    // 受注日からの期日（日数）
    deadlineDays: int.positive(),
    // 依頼が届いてから受注できる期限（日数の範囲。乱数で決める。N39）。省くと期限はない
    offerExpireDays: z.object({ min: int.positive(), max: int.positive() }).optional(),
    map: z.string().min(1),
    // 台数の範囲（spawnArea のとき）。spawnGroups のときは書かない（台数は各グループの合計）
    params: z
      .object({
        pcCount: z.object({ min: int.positive(), max: int.positive() }),
      })
      .optional(),
    // 置く範囲（1つ）。spawnGroups と どちらか一方だけを書く
    spawnArea: z
      .object({
        x: nonNegativeInt,
        y: nonNegativeInt,
        width: int.positive(),
        height: int.positive(),
      })
      .optional(),
    // 置く範囲（複数）。複数の部屋に PC を分けて置くときに使う（N51a）
    spawnGroups: z.array(spawnGroupSchema).min(1).optional(),
    budget: z.object({ base: nonNegativeInt, perPc: nonNegativeInt, perTile: nonNegativeInt }),
    reward: z.object({
      base: nonNegativeInt,
      perPc: nonNegativeInt,
    }),
    goals: z.array(goalSchema).min(1),
    // レベルアップの画面に出すか（新しい種類は true。変化形は false。N51a）
    announce: z.boolean(),
    // 文言のキーに使う ID（変化形は元のひな形の ID。読み込み時に入る）
    textId: z.string().min(1).optional(),
    // 机の並べ方の候補（N76）。省くと島型と壁沿い型
    layout: z.array(z.enum(['island', 'wall', 'reception'])).min(1).optional(),
    // 飾りの家具の候補（N76）。省くと事務所の既定
    decor: z.array(z.string().min(1)).min(1).optional(),
  })
  .superRefine((t, ctx) => {
    if ((t.spawnArea === undefined) === (t.spawnGroups === undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'spawnArea と spawnGroups は、どちらか一方だけを書く' });
    }
    if (t.spawnGroups !== undefined && t.params !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'spawnGroups のとき params.pcCount は書かない（台数は各グループの合計）' });
    }
    if (t.spawnArea !== undefined && t.params === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'spawnArea のとき params.pcCount が必要' });
    }
  });

// 変化形（N51a）。元のひな形から引き継ぐため、書けるのは台数・予算・報酬・期限・重み・解放のレベルなどに限る
export const variantSchema = z
  .object({
    id: z.string().min(1),
    variantOf: z.string().min(1),
    unlockLevel: unlockLevelSchema.optional(),
    weight: nonNegativeInt.optional(),
    params: z.object({ pcCount: z.object({ min: int.positive(), max: int.positive() }) }).optional(),
    spawnGroups: z.array(spawnGroupSchema).min(1).optional(),
    deadlineDays: int.positive().optional(),
    offerExpireDays: z.object({ min: int.positive(), max: int.positive() }).optional(),
    budget: z.object({ base: nonNegativeInt, perPc: nonNegativeInt, perTile: nonNegativeInt }).optional(),
    reward: z.object({ base: nonNegativeInt, perPc: nonNegativeInt }).optional(),
  })
  .strict();

export const mapSchema = z
  .object({
    id: z.string().min(1),
    width: int.positive(),
    height: int.positive(),
    tileSize: int.positive(),
    // 床の絵の種類（wood は木の板。ほかは tile/floor_<種類>_0〜2）
    floor: floorIdSchema,
    // 部屋ごとの床の種類（自社オフィスの床の張り替え・N92）。マスに書いていないものは floor と同じ
    floorTiles: z.record(z.string(), floorIdSchema).optional(),
    legend: z.record(z.string().length(1), z.string().min(1)),
    tiles: z.array(z.string()),
    // 地図に置く固定の家具（N76）
    furniture: z.array(placedFurnitureSchema).optional(),
  })
  .superRefine((map, ctx) => {
    if (map.tiles.length !== map.height) {
      ctx.addIssue({ code: 'custom', message: `tiles の行数が height（${map.height}）と一致しない` });
    }
    map.tiles.forEach((row, y) => {
      if (row.length !== map.width) {
        ctx.addIssue({ code: 'custom', message: `tiles[${y}] の長さが width（${map.width}）と一致しない` });
      }
      for (const ch of row) {
        if (ch !== VOID_CHAR && !(ch in map.legend)) {
          ctx.addIssue({ code: 'custom', message: `tiles[${y}] の文字 "${ch}" が legend にない` });
        }
      }
    });
  });

export const langSchema = z.record(z.string(), z.string());

// 初めての概念の案内（P7）。手順の光らせる対象と、完了の条件（書式は sim/guide.ts の parseCondition）。文言は言語ファイルの guide.<案件>.<n>
export const guidesFileSchema = z.object({
  guides: z.array(
    z.object({
      contract: z.string().min(1),
      steps: z
        .array(
          z.object({
            target: z.string().min(1),
            done: z.string().refine((v) => parseCondition(v) !== null, '完了の条件の書式が正しくない'),
          }),
        )
        .min(1),
    }),
  ),
});

// 教材（学習モード。サンドボックスで開く、報酬・期限・費用のない小さな案件）。機器は ref で指す。
// 題名・依頼文・案内の文言は言語ファイルの lesson.<id>.title・lesson.<id>.brief・lesson.<id>.step.<n>（n は1から）
export const LESSON_TOPICS = ['l2', 'routing', 'redundancy', 'service', 'nat', 'wireless', 'security'] as const;
const lessonEndSchema = z.object({ ref: z.string().min(1), port: nonNegativeInt });
export const lessonSchema = z.object({
  id: z.string().min(1),
  topic: z.enum(LESSON_TOPICS),
  order: int,
  size: z.object({ w: int.positive(), h: int.positive() }),
  placed: z.array(placedSchema).min(1),
  links: z.array(z.object({ cable: z.string().min(1), a: lessonEndSchema, b: lessonEndSchema })),
  goals: z.array(goalSchema).min(1),
  guide: z
    .array(
      z.object({
        target: z.string().min(1),
        done: z.string().refine((v) => parseCondition(v) !== null, '完了の条件の書式が正しくない'),
      }),
    )
    .min(1),
});

// 研修の課程（STAFF.md「4. 育成」）。受講中は担当に選べず、期日に経験値を得る
export const trainingFileSchema = z.object({
  courses: z.array(
    z.object({
      id: z.string().min(1),
      cost: nonNegativeInt,
      days: int.positive(),
      exp: nonNegativeInt,
    }),
  ),
});

// 資格（架空の名前。言語ファイルの cert.<id>.name）。受験には職種と level が必要
export const certFileSchema = z.object({
  certs: z.array(
    z.object({
      id: z.string().min(1),
      job: jobIdSchema,
      minLevel: int.positive(),
      fee: nonNegativeInt,
    }),
  ),
});

export type Balance = z.infer<typeof balanceSchema>;
export type TrainingCourse = z.infer<typeof trainingFileSchema>['courses'][number];
export type CertDef = z.infer<typeof certFileSchema>['certs'][number];
export type Cable = z.infer<typeof cableSchema>;
export type Device = z.infer<typeof deviceSchema>;
export type Furniture = z.infer<typeof furnitureSchema>;
export type ShopItem = z.infer<typeof shopFileSchema>['items'][number];
export type Placed = z.infer<typeof placedSchema>;
export type Goal = z.infer<typeof goalSchema>;
export type Contract = z.infer<typeof contractSchema>;
export type ContractTemplate = z.infer<typeof templateSchema>;
export type GameMap = z.infer<typeof mapSchema>;
export type Lang = z.infer<typeof langSchema>;
export type Lesson = z.infer<typeof lessonSchema>;
export type GuideFile = z.infer<typeof guidesFileSchema>['guides'][number];

// 会社のレベルの節目の報酬（N45）。解放は書かない（解放は品目の unlockLevel）
export const levelsFileSchema = z.object({
  milestones: z.array(
    z.object({
      level: unlockLevelSchema,
      reward: z.object({
        devices: z.array(z.object({ device: z.string().min(1), count: int.positive() })).default([]),
      }),
    }),
  ),
});

// 職種の定義（jobs.json・N104）。性質はここで決め、コードは分岐の代わりにこれを読む
export const jobDefSchema = z.object({
  id: z.enum(JOB_IDS),
  group: z.enum(['field', 'dev', 'backOffice']),
  unlockLevel: unlockLevelSchema,
  pc: z.enum(['required', 'bonus', 'none']),
  pcBonus: z
    .object({ buildRate: z.number().nonnegative().optional(), idleExpRate: z.number().nonnegative().optional(), effectRate: z.number().positive().optional() })
    .optional(),
  salaryRate: z.number().positive(),
  effect: z.enum(['sales', 'hr', 'accounting', 'devIncome', 'none']),
  dailyExp: z.enum(['full', 'idle', 'none']),
  buildsOnSite: z.boolean(),
});
export const jobsFileSchema = z.object({ jobs: z.array(jobDefSchema) });
export type JobDef = z.infer<typeof jobDefSchema>;
