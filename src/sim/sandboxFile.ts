// サンドボックスの構成の書き出しと読み込み（JSON のファイル）。読み込んだ内容は形を検証し、合わなければ読み込まずに理由を返す。
import { z } from 'zod';
import type { Office } from './project';
import { segmentsToPlans } from '../services/legacySegments';
import { gameEnv } from './env';

export const SANDBOX_FILE_FORMAT = 'network-ya.sandbox';
// 版2でアドレスの計画を L2 ドメインの鍵（plans）にした。版1のファイル（セグメントの鍵の segments）は読み込むときに付け替える
export const SANDBOX_FILE_VERSION = 2;
const SANDBOX_FILE_VERSION_SEGMENTS = 1;

const int = z.number().int();
const cell = z.object({ x: int, y: int });
const endpoint = z.object({ node: z.string().min(1), port: int });

// 機器と配線は、読み込みに要る項目だけを検査する（そのほかの項目は、書き出したものをそのまま戻す）
const officeSchema = z.object({
  floors: z.record(z.string(), z.string()).optional(),
  bought: z.array(z.string()),
  size: z.object({ w: int.min(1), h: int.min(1) }),
  innerWalls: z.array(cell),
  doors: z.array(cell),
  annexes: z.array(z.unknown()),
  nodes: z.array(z.object({ uid: z.string().min(1), device: z.string().min(1), x: int, y: int }).passthrough()),
  links: z.array(z.object({ uid: z.string().min(1), cable: z.string().min(1), a: endpoint, b: endpoint, path: z.array(z.tuple([int, int])) }).passthrough()),
  seq: int.min(0),
  furniture: z.array(z.object({ uid: z.string().min(1), id: z.string().min(1), x: int, y: int })),
  furnitureSeq: int.min(0),
  plans: z.record(z.string(), z.unknown()),
});
const planSchema = z.object({ network: z.string(), prefix: int });
const officeV1Schema = officeSchema.omit({ plans: true }).extend({ segments: z.record(z.string(), planSchema) });

const fileSchema = z.object({
  format: z.literal(SANDBOX_FILE_FORMAT),
  version: z.literal(SANDBOX_FILE_VERSION),
  office: officeSchema,
});

// 書き出す文字列（見やすいように字下げする）
export const writeSandboxFile = (office: Office): string =>
  JSON.stringify({ format: SANDBOX_FILE_FORMAT, version: SANDBOX_FILE_VERSION, office }, null, 2);

export type ReadSandboxResult = { ok: true; office: Office } | { ok: false; reason: 'json' | 'format' | 'version' | 'shape' };

// 読み込む。JSON として読めない・形式の名前が違う・版が違う・中身の形が合わない、のどれかなら理由を返す
export const readSandboxFile = (text: string): ReadSandboxResult => {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'json' };
  }
  if (typeof data !== 'object' || data === null) return { ok: false, reason: 'format' };
  const head = data as Record<string, unknown>;
  if (head.format !== SANDBOX_FILE_FORMAT) return { ok: false, reason: 'format' };
  if (head.version === SANDBOX_FILE_VERSION_SEGMENTS) {
    const old = z.object({ format: z.literal(SANDBOX_FILE_FORMAT), version: z.literal(SANDBOX_FILE_VERSION_SEGMENTS), office: officeV1Schema }).safeParse(data);
    if (!old.success) return { ok: false, reason: 'shape' };
    const { segments, ...rest } = old.data.office as unknown as Office & { segments: Office['plans'] };
    return { ok: true, office: { ...rest, plans: segmentsToPlans(rest, segments, gameEnv.engine) } };
  }
  if (head.version !== SANDBOX_FILE_VERSION) return { ok: false, reason: 'version' };
  const parsed = fileSchema.safeParse(data);
  if (!parsed.success) return { ok: false, reason: 'shape' };
  return { ok: true, office: parsed.data.office as unknown as Office };
};
