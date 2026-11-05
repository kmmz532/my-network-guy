// ゲームデータのzodスキーマ。ビルド時（game-data プラグイン）でのみ使用し、実行時のjsには含めない。
import { z } from 'zod';

const int = z.number().int();
const nonNegativeInt = z.number().int().nonnegative();

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

// 見た目の候補（src/assets/sprites/staff/ のスプライト名）
export const STAFF_LOOKS = ['blue', 'red'] as const;

export const balanceSchema = z.object({
  time: z.object({
    realMsPerTick: int.positive(),
    gameMinutesPerTick: int.positive(),
    daysPerMonth: int.positive(),
    speeds: z.array(z.number().nonnegative()).min(1),
  }),
  startMoney: int,
  offerIntervalDays: int.positive(),
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

export const deviceSchema = z.object({
  id: z.string().min(1),
  category: z.enum(['pc', 'server', 'l2_switch', 'router']),
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

const serviceSchema = z.object({
  protocol: z.enum(['http']),
  port: z.number().int().min(1).max(65535),
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
]);

export const contractSchema = z.object({
  id: z.string().min(1),
  stage: int.positive(),
  order: int,
  requires: z.array(z.string().min(1)).default([]),
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
  }),
  // 自社案件。自社オフィスで行い、納品後もネットワークが残る
  inhouse: z.boolean().default(false),
  // 自社案件の納品で得る効果（施工速度の上昇率など）
  effect: z.object({ buildSpeed: z.number().min(0).default(0) }).optional(),
});

export const templateSchema = z.object({
  id: z.string().min(1),
  stage: int.positive(),
  requires: z.array(z.string().min(1)).default([]),
  minReputation: nonNegativeInt,
  weight: nonNegativeInt,
  // 受注日からの期日（日数）
  deadlineDays: int.positive(),
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
  budget: z.object({ base: nonNegativeInt, perPc: nonNegativeInt }),
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
