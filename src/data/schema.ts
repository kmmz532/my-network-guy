// ゲームデータのzodスキーマ。ビルド時（game-data プラグイン）でのみ使用し、実行時のjsには含めない。
import { z } from 'zod';
import { parseCondition } from '../sim/guide';

const int = z.number().int();
const nonNegativeInt = z.number().int().nonnegative();
// 床の大きさ（床の内側のマス数）
const sizeSchema = z.object({ w: int.positive(), h: int.positive() });

// 社員の職種（STAFF.md「1. 社員のデータ」）
export const JOB_IDS = ['network', 'infra', 'security'] as const;
export type JobId = (typeof JOB_IDS)[number];
const jobIdSchema = z.enum(JOB_IDS);

// 社員のデータ。ゲームの状態に保存する
export interface Staff {
  uid: string; // "s" + 連番
  name: string; // 名前（言語ファイルの名前の候補のキー）
  look: string; // 見た目（STAFF_LOOKS のいずれか）
  quirk: string; // 口癖（言語ファイルの口癖の候補のID）
  job: JobId;
  level: number; // 総合能力（1〜）
  exp: number; // 次のレベルまでの経験値
  salary: number; // 月給（採用時に決まり、変わらない）
  certs: string[]; // 取得した資格のID
  training: { course: string; untilMinute: number } | null; // 受講中の研修
}

// 見た目の候補。服の色・髪の色・髪型の組み合わせ（4 × 3 × 2 = 24 通り）。
// 見た目の名前は「服_髪の色_髪型」で、スプライトは staff/<見た目>_<コマ>（scripts/gen-sprites.py と対応）
export const STAFF_SHIRTS = ['blue', 'red', 'green', 'yellow'] as const;
export const STAFF_HAIRS = ['dark', 'brown', 'blonde'] as const;
export const STAFF_HAIR_STYLES = ['short', 'long'] as const;
export const STAFF_LOOKS: readonly string[] = STAFF_SHIRTS.flatMap((shirt) =>
  STAFF_HAIRS.flatMap((hair) => STAFF_HAIR_STYLES.map((style) => `${shirt}_${hair}_${style}`)),
);
// 社員の予備の見た目（スプライトが読めないときの代わりに使う。画面の2人分）
export const STAFF_PLACEHOLDER_LOOKS = ['blue_dark_short', 'red_dark_short'] as const;
// 増やす前の見た目（blue・red）。保存済みのデータはこの名前のまま残るため、黒髪の短髪として描く
const LEGACY_STAFF_LOOKS: Readonly<Record<string, string>> = { blue: 'blue_dark_short', red: 'red_dark_short' };
// 見た目の名前からスプライトの名前（staff/ の前の部分）を決める
export const staffSpriteName = (look: string): string => LEGACY_STAFF_LOOKS[look] ?? look;

export const balanceSchema = z.object({
  time: z.object({
    realMsPerTick: int.positive(),
    gameMinutesPerTick: int.positive(),
    daysPerMonth: int.positive(),
    speeds: z.array(z.number().nonnegative()).min(1),
  }),
  startMoney: int,
  // 在庫を売るときの値段（購入時の値段に掛ける割合）
  sellRate: z.number().min(0).max(1),
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
  staff: z.object({
    initialCount: int.positive(),
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
    // 社員が出社する時刻（始業の何分前にドアから入るか）。席に着いているのは始業の時刻まで
    arriveMinutesBefore: nonNegativeInt,
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
  reputationPerStar: nonNegativeInt,
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
    // 評判の何点ごとに候補の level が1上がるか
    reputationPerLevel: int.positive(),
    baseSalary: nonNegativeInt,
    salaryPerLevel: nonNegativeInt,
  }),
  office: z.object({
    // 同時に受注できる案件の数（案件の枠）
    projectSlots: int.positive(),
    // 新しく始めたときの部屋の床の大きさ（マス）
    initialSize: sizeSchema,
    // 部屋を広げる費用と上限。費用は baseCost から、買うたびに baseCost の increase 倍ずつ増える（直線）。step マスずつ広がる
    expand: z.object({
      baseCost: nonNegativeInt,
      increase: z.number().min(0),
      step: int.positive(),
      maxSize: sizeSchema,
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
});

export const cablesFileSchema = z.object({ cables: z.array(cableSchema) });

// 機材が初期に動かすサービス（待ち受けるプロトコルとポート）。サーバーは置いたときに起動する
const serviceSchema = z.object({
  protocol: z.enum(['http']),
  port: z.number().int().min(1).max(65535),
});

export const deviceSchema = z.object({
  id: z.string().min(1),
  category: z.enum(['pc', 'server', 'l2_switch', 'router', 'l3_switch', 'router_switch', 'firewall']),
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
});

export const devicesFileSchema = z.object({ devices: z.array(deviceSchema) });

// 家具。自社オフィスに置く。seat が true の家具は社員の席になる
export const furnitureSchema = z.object({
  id: z.string().min(1),
  price: nonNegativeInt,
  sprite: z.string().min(1),
  seat: z.boolean(),
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
          unlock: z.object({ contract: z.string().min(1) }).nullable(),
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
  // 場所の名前（「受付のPC」など。画面の機器の名前になる。なければ「PC-1」などの仮の名前）
  name: z.string().min(1).max(24).optional(),
});

// 案件の達成条件。ハンドラの種類はここで列挙し、新しい種類を追加するときは本体のハンドラと合わせて追加する。
export const goalSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping'), from: z.string().min(1), to: z.string().min(1) }),
  z.object({
    type: z.literal('ping_all'),
    nodes: z.union([z.array(z.string().min(1)).min(2), z.literal('$all_pcs')]),
  }),
  z.object({
    type: z.literal('http'),
    from: z.string().min(1),
    to: z.string().min(1),
    port: z.number().int().min(1).max(65535),
  }),
  // 指定した種類の機器が一定数以上ある
  z.object({ type: z.literal('count'), category: z.string().min(1), min: z.number().int().positive() }),
  // すべてのPCから、いずれかのサーバーのWebページを閲覧できる
  z.object({ type: z.literal('http_all'), port: z.number().int().min(1).max(65535) }),
  // すべてのPCから、到達できるサーバー（外部）への経路にファイアウォールがある
  z.object({ type: z.literal('firewall') }),
]);

export const contractSchema = z.object({
  id: z.string().min(1),
  stage: int.positive(),
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
  goals: z.array(goalSchema).min(1),
  reward: z.object({
    money: nonNegativeInt,
    reputation: int.default(0),
    // 納品で倉庫に入る機材（自社案件の報酬。N34）
    devices: z.array(z.object({ device: z.string().min(1), count: int.positive() })).optional(),
  }),
  // 自社案件。自社オフィスで行い、納品後もネットワークが残る
  inhouse: z.boolean().default(false),
  // 自社案件の納品で得る効果（施工速度の上昇率など）
  effect: z.object({ buildSpeed: z.number().min(0).default(0) }).optional(),
  // true なら、IPアドレスの自動割り当て（設定がオンでも）を使わず、IPアドレスを自分で入れる
  manualIp: z.boolean().optional(),
});

export const templateSchema = z.object({
  id: z.string().min(1),
  stage: int.positive(),
  requires: z.array(z.string().min(1)).default([]),
  jobs: z.array(jobIdSchema).optional(),
  minReputation: nonNegativeInt,
  weight: nonNegativeInt,
  // 受注日からの期日（日数）
  deadlineDays: int.positive(),
  // 依頼が届いてから受注できる期限（日数の範囲。乱数で決める。N39）。省くと期限はない
  offerExpireDays: z.object({ min: int.positive(), max: int.positive() }).optional(),
  map: z.string().min(1),
  params: z.object({
    pcCount: z.object({ min: int.positive(), max: int.positive() }),
  }),
  spawnArea: z.object({
    x: nonNegativeInt,
    y: nonNegativeInt,
    width: int.positive(),
    height: int.positive(),
  }),
  budget: z.object({ base: nonNegativeInt, perPc: nonNegativeInt, perTile: nonNegativeInt }),
  reward: z.object({
    base: nonNegativeInt,
    perPc: nonNegativeInt,
    reputation: int.default(0),
  }),
  goals: z.array(goalSchema).min(1),
});

export const mapSchema = z
  .object({
    id: z.string().min(1),
    width: int.positive(),
    height: int.positive(),
    tileSize: int.positive(),
    legend: z.record(z.string().length(1), z.string().min(1)),
    tiles: z.array(z.string()),
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
        if (!(ch in map.legend)) {
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
export type GuideFile = z.infer<typeof guidesFileSchema>['guides'][number];
