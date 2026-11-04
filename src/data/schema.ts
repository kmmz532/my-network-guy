// ゲームデータのzodスキーマ。ビルド時（game-data プラグイン）でのみ使用し、実行時のjsには含めない。
import { z } from 'zod';

const int = z.number().int();
const nonNegativeInt = z.number().int().nonnegative();

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
    monthlySalary: nonNegativeInt,
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
      }),
    )
    .min(1),
  reputationPerStar: nonNegativeInt,
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

export const shopFileSchema = z.object({
  items: z
    .array(
      z
        .object({
          device: z.string().min(1).optional(),
          cable: z.string().min(1).optional(),
          unlock: z.object({ contract: z.string().min(1) }).nullable(),
        })
        .refine((item) => (item.device !== undefined) !== (item.cable !== undefined), {
          message: 'device と cable のどちらか一方だけを指定する',
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
]);

export const contractSchema = z.object({
  id: z.string().min(1),
  stage: int.positive(),
  order: int,
  requires: z.array(z.string().min(1)).default([]),
  map: z.string().min(1),
  budget: nonNegativeInt,
  placed: z.array(placedSchema).min(1),
  goals: z.array(goalSchema).min(1),
  reward: z.object({
    money: nonNegativeInt,
    reputation: int.default(0),
  }),
});

export const templateSchema = z.object({
  id: z.string().min(1),
  stage: int.positive(),
  requires: z.array(z.string().min(1)).default([]),
  minReputation: nonNegativeInt,
  weight: nonNegativeInt,
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

export type Balance = z.infer<typeof balanceSchema>;
export type Cable = z.infer<typeof cableSchema>;
export type Device = z.infer<typeof deviceSchema>;
export type ShopItem = z.infer<typeof shopFileSchema>['items'][number];
export type Placed = z.infer<typeof placedSchema>;
export type Goal = z.infer<typeof goalSchema>;
export type Contract = z.infer<typeof contractSchema>;
export type ContractTemplate = z.infer<typeof templateSchema>;
export type GameMap = z.infer<typeof mapSchema>;
export type Lang = z.infer<typeof langSchema>;
