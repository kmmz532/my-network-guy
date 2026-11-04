// セーブデータのバージョン管理。形式を変えたら SAVE_VERSION を上げ、migrations[n]（n → n+1 の変換）を追加する。
import type { Effects, Office, Project } from '../sim/project';
import { colorsFromConfig } from '../network/compile';

export const SAVE_VERSION = 6;

export interface SaveData {
  clock: { minute: number; money: number; paidMonths: number; bankrupt: boolean };
  reputation: number;
  // 在庫の機材（機材ID → 個数）
  owned: Record<string, number>;
  // 完了した固定案件のID
  completed: string[];
  // 依頼一覧（案件の内容を含む）
  offers: unknown[];
  nextOfferMinute: number;
  offerSeq: number;
  // 乱数の状態
  rng: number;
  // 受注中の案件（なければ null）
  active: Project | null;
  // 自社オフィスのネットワークと、自社案件で得た効果
  office: Office;
  effects: Effects;
}

type Migration = (data: unknown) => unknown;

// n → n+1 の変換。古い形式に足りない項目を補う
export const migrations: Record<number, Migration> = {
  // v1 → v2: 在庫と完了案件を追加する
  1: (data) => ({ ...(data as object), owned: {}, completed: [] }),
  // v2 → v3: 依頼と乱数の状態を追加する
  2: (data) => ({ ...(data as object), offers: [], nextOfferMinute: 0, offerSeq: 0, rng: 1 }),
  // v3 → v4: 受注中の案件を追加する
  3: (data) => ({ ...(data as object), active: null }),
  // v4 → v5: 手入力のIPアドレスを色（サブネット）に置き換える
  4: (data) => {
    const d = data as { active: Project | null };
    if (!d.active) return d;
    return { ...d, active: { ...d.active, nodes: colorsFromConfig(d.active.nodes) } };
  },
  // v5 → v6: 自社オフィスと効果を追加する
  5: (data) => ({ ...(data as object), office: { nodes: [], links: [], seq: 0 }, effects: { buildSpeed: 0 } }),
};

export const isSaveData = (value: unknown): value is SaveData => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const clock = v.clock as Record<string, unknown> | undefined;
  const owned = v.owned as Record<string, unknown> | undefined;
  return (
    typeof clock === 'object' &&
    clock !== null &&
    Number.isInteger(clock.minute) &&
    Number.isInteger(clock.money) &&
    Number.isInteger(clock.paidMonths) &&
    typeof clock.bankrupt === 'boolean' &&
    Number.isInteger(v.reputation) &&
    typeof owned === 'object' &&
    owned !== null &&
    Object.values(owned).every((n) => Number.isInteger(n) && (n as number) >= 0) &&
    Array.isArray(v.completed) &&
    v.completed.every((id) => typeof id === 'string') &&
    Array.isArray(v.offers) &&
    Number.isInteger(v.nextOfferMinute) &&
    Number.isInteger(v.offerSeq) &&
    Number.isInteger(v.rng) &&
    (v.active === null || (typeof v.active === 'object' && v.active !== null))
  );
};

// 保存されたバージョンから現在のバージョンまで順に移行する
export const migrate = (saveVersion: number, data: unknown): SaveData => {
  if (!Number.isInteger(saveVersion) || saveVersion < 1) throw new Error('セーブデータのバージョンが不正');
  if (saveVersion > SAVE_VERSION) throw new Error('このバージョンより新しいセーブデータは読み込めない');
  let current = data;
  for (let v = saveVersion; v < SAVE_VERSION; v++) {
    const step = migrations[v];
    if (!step) throw new Error(`バージョン ${v} からの移行が定義されていない`);
    current = step(current);
  }
  if (!isSaveData(current)) throw new Error('セーブデータの形式が不正');
  return current;
};
