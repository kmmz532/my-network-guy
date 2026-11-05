// セーブデータのバージョン管理。形式を変えたら SAVE_VERSION を上げ、migrations[n]（n → n+1 の変換）を追加する。
import type { Effects, Office, Project } from '../sim/project';
import type { EngineData, NetLink, NetNode } from '../network/types';
import { fillSegments } from '../network/segments';
import { colorsFromConfig, legacyInterfaces } from './legacyColors';
import { initialOffice } from '../sim/furniture';
import type { Balance, Staff } from '../data/schema';
import { createStaff, specAt } from '../sim/staff';
import balanceJson from '../assets/data/balance.json';
import pcJson from '../assets/data/devices/pc.json';
import serverJson from '../assets/data/devices/server.json';
import routerJson from '../assets/data/devices/router.json';
import switchJson from '../assets/data/devices/l2_switch.json';

export const SAVE_VERSION = 13;

// 移行で使う機器の種類（色の時代の規則で IPアドレスを作るときに使う）
const migrationCategories: Record<string, string> = {};
for (const d of [...pcJson.devices, ...serverJson.devices, ...routerJson.devices, ...switchJson.devices]) {
  migrationCategories[d.id] = d.category;
}
const migrationEngine: EngineData = {
  categoryOf: (device) => migrationCategories[device] ?? 'unknown',
  maxLengthOf: () => 0,
};

// 色を持つ機器のネットワーク（案件・自社オフィス）を、セグメントの設定と機器のIPアドレス・ルートに置き換える。色を持たないものはそのまま
const colorsToSegments = <T extends { nodes: NetNode[]; links?: NetLink[] }>(x: T): T => {
  if (!x.nodes.some((n) => (n as NetNode & { colors?: unknown }).colors !== undefined)) return x;
  const links = x.links ?? [];
  const nodes = legacyInterfaces(x.nodes, links, migrationEngine).map((n) => {
    const copy = { ...n };
    delete (copy as { colors?: unknown }).colors;
    return copy;
  });
  return { ...x, nodes, links, segments: fillSegments({ nodes, links }, migrationEngine) };
};

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
  active: Project[];
  // いま設計・表示している案件のID
  focus: string | null;
  // 自社オフィスのネットワークと、自社案件で得た効果
  office: Office;
  effects: Effects;
  // 雇用中の社員と、社員の uid の連番
  staff: Staff[];
  staffSeq: number;
  // 採用の候補
  candidates: Staff[];
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
  // v6 → v7: 社員の人数と家具を追加する。初期の机を置き、旧マップの机のマスに置いたPCで机がないものには机を足す
  6: (data) => {
    const d = data as { office: Office };
    const balance = balanceJson as Balance;
    const pcIds = new Set(pcJson.devices.map((p) => p.id));
    const init = initialOffice(balance);
    const furniture = [...init.furniture];
    let seq = furniture.length;
    for (const n of d.office.nodes) {
      if (!pcIds.has(n.device)) continue;
      if (furniture.some((f) => f.x === n.x && f.y === n.y)) continue;
      furniture.push({ uid: `f${seq}`, id: 'desk', x: n.x, y: n.y });
      seq++;
    }
    return { ...d, staff: balance.staff.initialCount, office: { ...d.office, furniture, furnitureSeq: seq } };
  },
  // v7 → v8: 人数の社員を、社員のデータとして作る。1人目と2人目は初期の職種、3人目以降は network・level 1
  7: (data) => {
    const d = data as { staff: number; rng: number };
    const balance = balanceJson as Balance;
    let rng = d.rng;
    const staff: Staff[] = [];
    for (let i = 0; i < d.staff; i++) {
      const made = createStaff(specAt(balance, i), rng, i);
      rng = made.rng;
      staff.push(made.staff);
    }
    return { ...d, staff, staffSeq: staff.length, rng };
  },
  // v8 → v9: 受注中の案件を複数にする。単独の案件は一覧にし、設計の対象にする
  8: (data) => {
    const d = data as { active: Project | null };
    const active = d.active ? [d.active] : [];
    return { ...d, active, focus: d.active?.id ?? null };
  },
  // v9 → v10: 案件に期日を追加する。移行前に受注した案件は期日がないものとする
  9: (data) => {
    const d = data as { active: Project[] };
    return { ...d, active: d.active.map((p) => ({ ...p, due: null })) };
  },
  // v11 → v12: 採用の候補を追加する。移行直後は候補がいない（次の月に作られる）
  11: (data) => ({ ...(data as object), candidates: [] }),
  // v12 → v13: 色（サブネット）をやめ、セグメントの設定と機器のIPアドレス・ルートにする。色の時代の規則で、IPアドレスとルートを作る
  12: (data) => {
    const d = data as { active: Project[]; office: Office };
    return { ...d, active: d.active.map(colorsToSegments), office: colorsToSegments(d.office) };
  },
  // v10 → v11: 案件に担当の社員を追加する。移行前の案件は、全社員が担当だったものとする
  10: (data) => {
    const d = data as { active: Project[]; staff: Staff[] };
    return { ...d, active: d.active.map((p) => ({ ...p, crew: d.staff.map((s) => s.uid) })) };
  },
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
    Array.isArray(v.active) &&
    (v.focus === null || typeof v.focus === 'string') &&
    Array.isArray(v.staff) &&
    Number.isInteger(v.staffSeq) &&
    Array.isArray(v.candidates) &&
    Array.isArray((v.office as { furniture?: unknown } | undefined)?.furniture)
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
