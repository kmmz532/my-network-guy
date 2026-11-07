// セーブデータのバージョン管理。形式を変えたら SAVE_VERSION を上げ、migrations[n]（n → n+1 の変換）を追加する。
import type { Effects, Office, Project } from '../sim/project';
import type { EngineData, NetLink, NetNode, Service } from '../network/types';
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
import { CATEGORY } from '../data/categories';
import { nextHostname } from '../network/hostname';
import type { Familiarity } from '../sim/familiar';
import type { LedgerMonth } from '../sim/ledger';
import l3Json from '../assets/data/devices/l3_switch.json';
import routerSwitchJson from '../assets/data/devices/router_switch.json';
import firewallJson from '../assets/data/devices/firewall.json';
import firewallDmzJson from '../assets/data/devices/firewall_dmz.json';
import printerJson from '../assets/data/devices/printer.json';
import furnitureDefsJson from '../assets/data/furniture.json';
import cablesJson from '../assets/data/cables.json';

export const SAVE_VERSION = 39;

// 遊び方。career は案件の経営ゲーム、sandbox は自由に設計する練習場（別の枠に保存する）
export type GameMode = 'career' | 'sandbox';

// 移行前の部屋の床の大きさ（移行前の固定のマップ hq の内側）。移行後の部屋は、この大きさのまま続く
const legacyOfficeSize = { w: 14, h: 8 };

// 移行で使う機器の種類（色の時代の規則で IPアドレスを作るときに使う）
const migrationCategories: Record<string, string> = {};
// ホスト名の略号に使う種類（全部の機器。v27 の移行で使う）
const categoryForHost: Record<string, string> = {};
for (const d of [...pcJson.devices, ...serverJson.devices, ...routerJson.devices, ...switchJson.devices, ...l3Json.devices, ...routerSwitchJson.devices, ...firewallJson.devices, ...firewallDmzJson.devices, ...printerJson.devices]) {
  categoryForHost[d.id] = d.category;
}
// 移行で使う機器の既定のサービス（defaultServices）
const migrationDefaultServices: Record<string, Service[]> = {};
for (const d of [...pcJson.devices, ...serverJson.devices, ...routerJson.devices, ...switchJson.devices]) {
  migrationCategories[d.id] = d.category;
  migrationDefaultServices[d.id] = (d as { defaultServices?: Service[] }).defaultServices ?? [];
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

// サービスが空のサーバーに、機材の既定のサービスを入れる。設定を変えられない機器は変えない
const withDefaultServices = (n: NetNode): NetNode => {
  if (migrationCategories[n.device] !== CATEGORY.server || n.configLocked || n.services.length > 0) return n;
  const services = migrationDefaultServices[n.device] ?? [];
  if (services.length === 0) return n;
  return { ...n, services: services.map((s) => ({ ...s })) };
};

export interface SaveData {
  // 遊び方（移行前のセーブデータは career）
  mode: GameMode;
  clock: { minute: number; money: number; paidMonths: number; bankrupt: boolean; ledger: LedgerMonth[] | null };
  companyExp: number;
  // 評判（★の数の積み上げ。解放の条件には使わない。N55）
  reputation: number;
  // 経験値の1日分（納品以外の源の上限に使う。N55）
  expDay: number;
  expToday: number;
  // 在庫の機材（機材ID → 個数）
  owned: Record<string, number>;
  // 完了した固定案件のID
  completed: string[];
  // 納品した案件の数（N66）
  deliveries: number;
  // なじみの依頼の回数と型紙（N70）
  familiarity: Familiarity;
  // 依頼一覧（案件の内容を含む）
  offers: unknown[];
  nextOfferMinute: number;
  offerSeq: number;
  // 新しく解放した種類の届いた件数（N51b）
  newArrivals: Record<string, number>;
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
  // 初めての概念の案内を終えた（または飛ばした）固定案件のID
  guidesDone: string[];
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
    const balance = balanceJson as unknown as Balance;
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
    const balance = balanceJson as unknown as Balance;
    let rng = d.rng;
    const staff: Staff[] = [];
    for (let i = 0; i < d.staff; i++) {
      const made = createStaff(specAt(balance, i), rng, i, staff.map((s) => s.name));
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
  // v13 → v14: サーバーに機材の既定のサービスを入れる。移行前に置いたサーバーは services が空のため、受注中の案件と自社オフィスのものを補う
  13: (data) => {
    const d = data as { active: Project[]; office: Office };
    const fill = <T extends { nodes: NetNode[] }>(x: T): T => ({ ...x, nodes: x.nodes.map(withDefaultServices) });
    return { ...d, active: d.active.map(fill), office: fill(d.office) };
  },
  // v14 → v15: 案件にテストの合格の状態（testedOk）を追加する。移行前の案件は、テストに合格していないものとする
  14: (data) => {
    const d = data as { active: Project[] };
    return { ...d, active: d.active.map((p) => ({ ...p, testedOk: false })) };
  },
  // v15 → v16: 初めての概念の案内を終えた案件を追加する。移行前は、どの案件の案内も終えていないものとする
  15: (data) => ({ ...(data as object), guidesDone: [] }),
  // v16 → v17: 自社オフィスの部屋の大きさを追加する。移行前の部屋は、固定のマップ hq の大きさ（14×8）とする
  16: (data) => {
    const d = data as { office: Office };
    return { ...d, office: { ...d.office, size: { ...legacyOfficeSize } } };
  },
  // v17 → v18: 自社オフィスに、内側の壁・ドア・別室を追加する。移行前の部屋は、別室も内側の壁もドアもないものとする
  17: (data) => {
    const d = data as { office: Office };
    return { ...d, office: { ...d.office, innerWalls: [], doors: [], annexes: [] } };
  },
  // v18 → v19: 遊び方を追加する。移行前のセーブデータは、すべて案件の経営ゲーム（career）とする
  18: (data) => ({ ...(data as object), mode: 'career' }),
  // v23 → v24: 評判（★の数の積み上げ）を足す。移行前のセーブの評判は 0 から始める（検収の★は残っていないため。N55）
  23: (data) => ({ ...(data as object), reputation: 0 }),
  // v24 → v25: 納品以外の経験値の1日分を足す。移行前のセーブは、0 から始める（N55）
  24: (data) => ({ ...(data as object), expDay: 0, expToday: 0 }),
  // v25 → v26: 新しく解放した種類の届いた件数を追加する（N51b）
  25: (data) => ({ ...(data as object), newArrivals: {} }),
  // v22 → v23: 社員と候補に勤務の区分（shift）を足す。移行前の社員は全員日勤（N48）
  22: (data) => {
    const d = data as { staff: object[]; candidates: object[] };
    const day = (m: object) => ({ ...m, shift: 'day' });
    return { ...d, staff: d.staff.map(day), candidates: d.candidates.map(day) };
  },
  // v26 → v27: 納品した案件の数を追加する。移行前の納品の数は数えていないため 0 とする（N66）
  26: (data) => ({ ...(data as object), deliveries: 0 }),
  // v31 → v32: 依頼に家具（机・棚・飾り）を足す。移行前の依頼は家具を持たない（N76）
  31: (data) => data as object,
  // v38 → v39: 配線に払った額（paid）を足す。移行前は実際に払った額を記録していないため、割引なしの定価（配線の長さで計算した額）を入れる（N113）。
  // 定価を引けない配線（ケーブルや機器が見つからない）は、埋めずに例外で止める
  38: (data) => {
    const d = data as { active: Project[]; office: Office };
    const cables = cablesJson.cables as { id: string; pricePerLink: number; pricePerTile: number }[];
    const withPaid = <T extends { nodes: NetNode[]; links?: NetLink[] }>(net: T): T => ({
      ...net,
      ...(net.links === undefined ? {} : { links: net.links.map((l) => {
        const cable = cables.find((c) => c.id === l.cable);
        if (!cable) throw new Error(`ケーブル ${l.cable} の定価が見つからない`);
        const a = net.nodes.find((n) => n.uid === l.a.node);
        const b = net.nodes.find((n) => n.uid === l.b.node);
        if (!a || !b) throw new Error(`配線 ${l.uid} の機器が見つからない`);
        const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
        return { ...l, paid: cable.pricePerLink + cable.pricePerTile * length };
      }) }),
    });
    return { ...d, active: d.active.map(withPaid), office: withPaid(d.office) };
  },
  // v37 → v38: 家具に向き（facing）を足す。移行前の家具は向きを書いていないため、up（今の絵のまま）として扱う（N95）
  37: (data) => data as object,
  // v36 → v37: 社員に level の上限（levelCap）を足す。移行前の社員は、今の level を含む段階の上端を上限にする（今より下がる社員を作らない・N101）。給与は変えない
  36: (data) => {
    const d = data as { staff: { level: number }[]; candidates: { level: number }[] };
    const cap = (m: { level: number }) => ({ ...m, levelCap: Math.max(10, Math.ceil(m.level / 10) * 10) });
    return { ...d, staff: d.staff.map(cap), candidates: d.candidates.map(cap) };
  },
  // v35 → v36: 自社オフィスに、部屋ごとの床の種類（floors）を足す。移行前は床の記録がないため、すべての部屋を木として扱う（N92）
  35: (data) => data as object,
  // v34 → v35: 社員ごとに机を持たせる（辞めた社員の机は空いたままにする）。移行前は、社員の並び順と机の並び順で座っていたため、その割り当てをそのまま記録する（机のない社員は、歩き回る社員のまま）
  34: (data) => {
    const d = data as { staff: { uid: string }[]; candidates: object[]; office: { furniture: { uid: string; id: string }[] } };
    const seatIds = new Set((furnitureDefsJson.furniture as { id: string; seat?: boolean }[]).filter((f) => f.seat === true).map((f) => f.id));
    const desks = d.office.furniture.filter((f) => seatIds.has(f.id)).map((f) => f.uid);
    return { ...d, staff: d.staff.map((m, i) => ({ ...m, desk: desks[i] ?? null })), candidates: d.candidates.map((m) => ({ ...m, desk: null })) };
  },
  // v33 → v34: 社員に採用した月（hiredMonth）と退職の予定（leaving）を足す。移行前の社員は、いつでも退職させられるよう採用の月を0、退職の予定はなしとする（N90）
  33: (data) => {
    const d = data as { staff: object[]; candidates: object[] };
    const fields = { hiredMonth: 0, leaving: false };
    return { ...d, staff: d.staff.map((m) => ({ ...m, ...fields })), candidates: d.candidates.map((m) => ({ ...m, ...fields })) };
  },
  // v32 → v33: 帳簿に、経理の割引で浮いた額（saved）を足す。移行前は0。サンドボックス（帳簿なし）は変えない
  32: (data) => {
    const d = data as { clock: { ledger: { month: number; totals: object }[] | null } };
    const ledger = d.clock.ledger === null ? null : d.clock.ledger.map((m) => ({ ...m, totals: { ...m.totals, saved: 0 } }));
    return { ...d, clock: { ...d.clock, ledger } };
  },
  // v30 → v31: 時計に帳簿を足す。移行前は空から始める。サンドボックスは帳簿を持たない（null）
  30: (data) => {
    const d = data as { mode: string; clock: object };
    return { ...d, clock: { ...d.clock, ledger: d.mode === 'sandbox' ? null : [] } };
  },
  // v29 → v30: なじみの依頼の回数と型紙を追加する。移行前は、まだ数えていないため空から始める（N70）
  29: (data) => ({ ...(data as object), familiarity: { counts: {}, blueprints: {} } }),
  // v28 → v29: 機器に MAC アドレスの連番を付ける（N69）。既存の機器は、ネットワークの中の並び順に 1 から振る
  28: (data) => {
    const d = data as { office: { nodes: NetNode[] }; active: { nodes: NetNode[] }[] };
    const serial = (nodes: NetNode[]): NetNode[] => nodes.map((n, i) => ({ ...n, macSerial: n.macSerial ?? i + 1 }));
    return { ...d, office: { ...d.office, nodes: serial(d.office.nodes) }, active: d.active.map((p) => ({ ...p, nodes: serial(p.nodes) })) };
  },
  // v27 → v28: 機器にホスト名（種類の略号-番号）を付ける。ホスト名のない機器は、並び順に自動で付ける（N68）
  27: (data) => {
    const d = data as { office: { nodes: NetNode[] }; active: { nodes: NetNode[] }[] };
    const named = (nodes: NetNode[]): NetNode[] => {
      const done: NetNode[] = [];
      for (const n of nodes) {
        const hostname = n.hostname ?? nextHostname(done, categoryForHost[n.device]);
        done.push({ ...n, hostname });
      }
      return done;
    };
    return { ...d, office: { ...d.office, nodes: named(d.office.nodes) }, active: d.active.map((p) => ({ ...p, nodes: named(p.nodes) })) };
  },  // v21 → v22: 評判（reputation）を会社の経験値（companyExp）に名前を変える。値はそのまま（N45）
  21: (data) => {
    const d = data as { reputation: number };
    const { reputation, ...rest } = d;
    return { ...rest, companyExp: reputation };
  },
  // v20 → v21: 依頼に届いた時刻を追加する。移行前の依頼は、読み込んだ時刻に届いたものとする（期限は付けない）
  20: (data) => {
    const d = data as { clock: { minute: number }; offers: object[] };
    return { ...d, offers: d.offers.map((o) => ({ ...o, arrivedMinute: d.clock.minute })) };
  },
  // v19 → v20: 機器に、名前と IPアドレスの対応表（hosts）を追加する。移行前の機器は、対応表が空だったものとする
  19: (data) => {
    const d = data as { office: { nodes: NetNode[] }; active: { nodes: NetNode[] }[] };
    const withHosts = (nodes: NetNode[]) => nodes.map((n) => ({ ...n, hosts: n.hosts ?? [] }));
    return {
      ...d,
      office: { ...d.office, nodes: withHosts(d.office.nodes) },
      active: d.active.map((p) => ({ ...p, nodes: withHosts(p.nodes) })),
    };
  },
  // v10 → v11: 案件に担当の社員を追加する。移行前の案件は、全社員が担当だったものとする
  10: (data) => {
    const d = data as { active: Project[]; staff: Staff[] };
    return { ...d, active: d.active.map((p) => ({ ...p, crew: d.staff.map((s) => s.uid) })) };
  },
};

const isOfficeSize = (value: unknown): boolean => {
  const s = value as { w?: unknown; h?: unknown } | null;
  return typeof s === 'object' && s !== null && Number.isInteger(s.w) && Number.isInteger(s.h);
};

// 依頼の形（保存の中身の検査。案件の本体は、読み込みのあとで案件の定義と照らす）
const isOfferShape = (value: unknown): boolean => {
  const o = value as Record<string, unknown> | null;
  return (
    typeof o === 'object' &&
    o !== null &&
    typeof o.id === 'string' &&
    (o.kind === 'fixed' || o.kind === 'template') &&
    typeof o.baseId === 'string' &&
    typeof o.params === 'object' &&
    o.params !== null &&
    typeof o.contract === 'object' &&
    o.contract !== null &&
    (o.arrivedMinute === undefined || Number.isFinite(o.arrivedMinute)) &&
    (o.expiresMinute === undefined || Number.isFinite(o.expiresMinute))
  );
};

export const isSaveData = (value: unknown): value is SaveData => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const clock = v.clock as Record<string, unknown> | undefined;
  const owned = v.owned as Record<string, unknown> | undefined;
  return (
    (v.mode === 'career' || v.mode === 'sandbox') &&
    typeof clock === 'object' &&
    clock !== null &&
    Number.isInteger(clock.minute) &&
    Number.isInteger(clock.money) &&
    (clock.ledger === null || Array.isArray(clock.ledger)) &&
    Number.isInteger(clock.paidMonths) &&
    typeof clock.bankrupt === 'boolean' &&
    Number.isInteger(v.companyExp) &&
    Number.isInteger(v.reputation) &&
    Number.isInteger(v.expDay) &&
    Number.isInteger(v.expToday) &&
    typeof owned === 'object' &&
    owned !== null &&
    Object.values(owned).every((n) => Number.isInteger(n) && (n as number) >= 0) &&
    Array.isArray(v.completed) &&
    Number.isInteger(v.deliveries) &&
    typeof v.familiarity === 'object' &&
    v.familiarity !== null &&
    v.completed.every((id) => typeof id === 'string') &&
    Array.isArray(v.offers) &&
    v.offers.every(isOfferShape) &&
    Number.isInteger(v.nextOfferMinute) &&
    Number.isInteger(v.offerSeq) &&
    typeof v.newArrivals === 'object' &&
    v.newArrivals !== null &&
    Object.values(v.newArrivals).every((n) => Number.isInteger(n) && (n as number) >= 0) &&
    Number.isInteger(v.rng) &&
    Array.isArray(v.active) &&
    (v.focus === null || typeof v.focus === 'string') &&
    Array.isArray(v.staff) &&
    Number.isInteger(v.staffSeq) &&
    Array.isArray(v.candidates) &&
    Array.isArray(v.guidesDone) &&
    v.guidesDone.every((id) => typeof id === 'string') &&
    Array.isArray((v.office as { furniture?: unknown } | undefined)?.furniture) &&
    isOfficeSize((v.office as { size?: unknown }).size) &&
    Array.isArray((v.office as { innerWalls?: unknown }).innerWalls) &&
    Array.isArray((v.office as { doors?: unknown }).doors) &&
    Array.isArray((v.office as { annexes?: unknown }).annexes)
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
