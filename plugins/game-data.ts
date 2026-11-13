// ゲームデータ（JSON）を検証・正規化し、型と仮想モジュールを生成するViteプラグイン。
// 検証に失敗した場合はファイル名と項目を示してビルド（開発サーバーではエラーオーバーレイ）を止める。
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import type { ZodTypeAny } from 'zod';
import { isBlocked } from '../src/data/tileKind';
import {
  balanceSchema,
  certFileSchema,
  trainingFileSchema,
  cablesFileSchema,
  contractSchema,
  devicesFileSchema,
  furnitureFileSchema,
  guidesFileSchema,
  lessonSchema,
  langSchema,
  levelsFileSchema,
  mapSchema,
  shopFileSchema,
  templateSchema,
  variantSchema,
  type Balance,
  type Cable,
  type Contract,
  type ContractTemplate,
  type Device,
  type Furniture,
  type GuideFile,
  type Lesson,
  type Goal,
  type GameMap,
  type Lang,
  type ShopItem,
  type TrainingCourse,
  type CertDef,
} from '../src/data/schema';

const BASE_LANG = 'ja_jp';
// 案内の1手順の文言の最大の文字数（CORE.md「4. 最初の20分の流れ」）
const GUIDE_TEXT_MAX = 20;
// 案内の文言のキー（案件ごとの i 番目の手順。0から数える）
const lessonKey = (id: string, part: string): string => `lesson.${id}.${part}`;
const guideKey = (contract: string, index: number): string => `guide.${contract}.${index + 1}`;

// 実行時に存在が必要な翻訳キー（ID以外から導出されない固定のもの）
const REQUIRED_UI_KEYS = ['ui.hud.money', 'ui.company.title'];
// 失敗理由ID（error.<id> の翻訳キーが言語ファイルに必要）
const ERROR_IDS = [
  'link.unplugged',
  'link.too_long',
  'ip.unset',
  'ip.duplicate',
  'ip.unreachable',
  'gateway.unset',
  'gateway.unreachable',
  'route.none',
  'route.loop',
  'return.failed',
  'service.closed',
];

interface GameData {
  balance: Balance;
  // 会社のレベルの節目の報酬（N45）
  levelMilestones: { level: number; reward: { devices: { device: string; count: number }[] } }[];
  training: TrainingCourse[];
  certs: CertDef[];
  cables: Cable[];
  devices: Device[];
  furniture: Furniture[];
  shop: ShopItem[];
  contracts: Contract[];
  templates: ContractTemplate[];
  guides: GuideFile[];
  lessons: Lesson[];
  maps: GameMap[];
  langs: Record<string, Lang>;
  missingFilled: Record<string, number>;
}

class GameDataError extends Error {
  constructor(messages: string[]) {
    super(`ゲームデータの検証に失敗した:\n${messages.map((m) => `  - ${m}`).join('\n')}`);
  }
}

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch (e) {
    throw new GameDataError([`${file}: JSONを読み込めない（${(e as Error).message}）`]);
  }
};

const parseWith = <S extends ZodTypeAny>(schema: S, value: unknown, file: string): ReturnType<S['parse']> => {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'} ${i.message}`);
    throw new GameDataError(issues.map((m) => `${file}: ${m}`));
  }
  return result.data;
};

// 定型案件のファイルを読み、変化形（variantOf）を元のひな形と合わせて完全な形にする（N51a）。
// 変化形は元のひな形の値を引き継ぎ、書いた項目だけを置き換える。変化形は通知（announce）を出さず、文言は元のひな形のものを使う。
const resolveTemplates = (files: string[]): ContractTemplate[] => {
  const roots: ContractTemplate[] = [];
  const variants: { file: string; raw: unknown }[] = [];
  for (const file of files) {
    const raw = readJson(file);
    if (raw !== null && typeof raw === 'object' && 'variantOf' in raw) {
      variants.push({ file, raw });
      continue;
    }
    const template = parseWith(templateSchema, raw, file);
    if (template.id !== basename(file, '.json')) {
      throw new GameDataError([`${file}: id（${template.id}）がファイル名と一致しない`]);
    }
    roots.push({ ...template, textId: template.id });
  }
  const rootsById = new Map(roots.map((t) => [t.id, t] as const));
  const resolved: ContractTemplate[] = [...roots];
  for (const { file, raw } of variants) {
    const variant = parseWith(variantSchema, raw, file);
    const root = rootsById.get(variant.variantOf);
    if (!root) {
      throw new GameDataError([`${file}: variantOf の元のひな形 ${variant.variantOf} が未定義（変化形の変化形は使えない）`]);
    }
    if (variant.id !== basename(file, '.json')) {
      throw new GameDataError([`${file}: id（${variant.id}）がファイル名と一致しない`]);
    }
    const { variantOf: _variantOf, ...own } = variant;
    const defined = Object.fromEntries(Object.entries(own).filter(([, v]) => v !== undefined));
    const merged = parseWith(templateSchema, { ...root, ...defined, announce: false, textId: root.id }, file);
    resolved.push(merged);
  }
  return resolved;
};

const jsonFiles = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && statSync(join(dir, f)).isFile())
    .sort()
    .map((f) => join(dir, f));
};

const loadData = (dataDir: string, langDir: string, spriteDir: string): GameData => {
  const balance = parseWith(balanceSchema, readJson(join(dataDir, 'balance.json')), 'balance.json');
  const cables = parseWith(cablesFileSchema, readJson(join(dataDir, 'cables.json')), 'cables.json').cables;
  const devices = jsonFiles(join(dataDir, 'devices')).flatMap((file) =>
    parseWith(devicesFileSchema, readJson(file), file).devices,
  );
  const furniture = parseWith(furnitureFileSchema, readJson(join(dataDir, 'furniture.json')), 'furniture.json').furniture;
  const shop = parseWith(shopFileSchema, readJson(join(dataDir, 'shop.json')), 'shop.json').items;
  const training = parseWith(trainingFileSchema, readJson(join(dataDir, 'training.json')), 'training.json').courses;
  const certs = parseWith(certFileSchema, readJson(join(dataDir, 'certs.json')), 'certs.json').certs;
  const levelMilestones = parseWith(levelsFileSchema, readJson(join(dataDir, 'levels.json')), 'levels.json').milestones;
  const guides = parseWith(guidesFileSchema, readJson(join(dataDir, 'guides.json')), 'guides.json').guides;

  const lessons = jsonFiles(join(dataDir, 'lessons')).map((file) => {
    const lesson = parseWith(lessonSchema, readJson(file), file);
    if (lesson.id !== basename(file, '.json')) {
      throw new GameDataError([`${file}: id（${lesson.id}）がファイル名と一致しない`]);
    }
    return lesson;
  });

  const contractsDir = join(dataDir, 'contracts');
  const contracts = jsonFiles(contractsDir).map((file) => {
    const contract = parseWith(contractSchema, readJson(file), file);
    if (contract.id !== basename(file, '.json')) {
      throw new GameDataError([`${file}: id（${contract.id}）がファイル名と一致しない`]);
    }
    return contract;
  });
  const templates = resolveTemplates(jsonFiles(join(contractsDir, 'templates')));
  const maps = jsonFiles(join(dataDir, 'maps')).map((file) => {
    const map = parseWith(mapSchema, readJson(file), file);
    if (map.id !== basename(file, '.json')) {
      throw new GameDataError([`${file}: id（${map.id}）がファイル名と一致しない`]);
    }
    return map;
  });

  const langs: Record<string, Lang> = {};
  for (const file of jsonFiles(langDir)) {
    langs[basename(file, '.json')] = parseWith(langSchema, readJson(file), file);
  }
  if (!langs[BASE_LANG]) {
    throw new GameDataError([`${BASE_LANG}.json（基準となる言語ファイル）がない`]);
  }

  const data: GameData = {
    balance,
    levelMilestones,
    training,
    certs,
    cables,
    devices,
    furniture,
    shop,
    contracts,
    templates,
    guides,
    lessons,
    maps,
    langs,
    missingFilled: {},
  };
  validateReferences(data, spriteDir);
  data.contracts = sortContracts(contracts);
  fillLanguages(data);
  return data;
};

const unique = <T>(items: T[], key: (item: T) => string, label: string): Set<string> => {
  const ids = new Set<string>();
  const errors: string[] = [];
  for (const item of items) {
    const id = key(item);
    if (ids.has(id)) errors.push(`${label} の id（${id}）が重複している`);
    ids.add(id);
  }
  if (errors.length) throw new GameDataError(errors);
  return ids;
};

const goalRefs = (goal: Goal): string[] => {
  switch (goal.type) {
    case 'ping':
    case 'http':
      return [goal.from, goal.to];
    case 'ping_all':
      return goal.nodes === '$all_pcs' ? [] : goal.nodes;
    case 'count':
    case 'count_device':
    case 'http_all':
    case 'firewall':
    case 'reach_category':
    case 'wireless_clients':
    case 'no_static_route':
    case 'reach_by_name':
      return [];
    case 'survive_uplink_failure':
      return [];
    case 'stp_root':
    case 'lag_bundled':
      return [goal.node];
    case 'survive_device_failure':
      return goal.nodes;
    case 'bgp_established':
      return [goal.node];
    case 'ospf_dr':
      return [goal.node];
    case 'blocked':
      return [goal.from, goal.to];
    case 'dhcp_all':
      return goal.nodes;
    case 'wireless_secure':
      return [];
    case 'isolated':
    case 'blocked_all':
      return [...goal.from, ...goal.to];
    case 'http_from':
      return goal.nodes;
  }
};

const validateReferences = (data: GameData, spriteDir: string): void => {
  const errors: string[] = [];
  const cableIds = unique(data.cables, (c) => c.id, 'cables.json');
  const deviceIds = unique(data.devices, (d) => d.id, 'devices/');
  const furnitureIds = unique(data.furniture, (f) => f.id, 'furniture.json');
  const mapsById = new Map(data.maps.map((m) => [m.id, m]));
  unique(data.maps, (m) => m.id, 'maps/');
  for (const m of data.maps) {
    for (const f of m.furniture ?? []) {
      if (!furnitureIds.has(f.id)) errors.push(`maps/${m.id}.json: 未定義の家具 ${f.id}`);
    }
  }
  // 案件とテンプレートはどちらも requires や解禁条件から参照されるため、ID の集合を共通で作る
  const contractIdSet = unique([...data.contracts, ...data.templates], (c) => c.id, 'contracts/');

  const ensure = (ok: boolean, message: string) => {
    if (!ok) errors.push(message);
  };

  // 案内は固定案件ごとに1つ。案件のIDは固定案件のものだけ
  unique(data.guides, (g) => g.contract, 'guides.json');
  for (const g of data.guides) {
    ensure(
      data.contracts.some((c) => c.id === g.contract),
      `guides.json: 固定案件 ${g.contract} がない`,
    );
  }

  // 教材: ref の重複・配線の端の機器と口・機材とケーブルの ID を確かめる
  unique(data.lessons, (l) => l.id, 'lessons/');
  for (const l of data.lessons) {
    const refs = new Set(l.placed.map((p) => p.ref));
    ensure(refs.size === l.placed.length, `lessons/${l.id}.json: ref が重複している`);
    for (const p of l.placed) {
      ensure(deviceIds.has(p.device), `lessons/${l.id}.json: ${p.ref} の機材 ${p.device} がない`);
    }
    for (const k of l.links) {
      ensure(cableIds.has(k.cable), `lessons/${l.id}.json: ケーブル ${k.cable} がない`);
      for (const end of [k.a, k.b]) {
        const placed = l.placed.find((p) => p.ref === end.ref);
        const device = placed ? data.devices.find((d) => d.id === placed.device) : undefined;
        const ports = device ? device.ports.reduce((sum, port) => sum + port.count, 0) : 0;
        ensure(placed !== undefined && end.port < ports, `lessons/${l.id}.json: 配線の端 ${end.ref}:${end.port} がない`);
      }
    }
  }

  // 家具のIDは機材・ケーブルのIDと重複させない（在庫の表を共通で使うため）
  for (const f of data.furniture) {
    ensure(!deviceIds.has(f.id) && !cableIds.has(f.id), `furniture.json: ID ${f.id} が機材かケーブルと重複している`);
    ensure(existsSync(join(spriteDir, `${f.sprite}.png`)), `furniture.json: ${f.id} のスプライト ${f.sprite} がない`);
    if (f.icon !== undefined) ensure(existsSync(join(spriteDir, `${f.icon}.png`)), `furniture.json: ${f.id} のアイコン ${f.icon} がない`);
  }

  // 機材のスプライトは、描画のときに必ず使うため、ビルドで存在を確かめる
  for (const d of data.devices) {
    ensure(existsSync(join(spriteDir, `${d.sprite}.png`)), `devices/: ${d.id} のスプライト ${d.sprite} がない`);
  }

  for (const item of data.shop) {
    if (item.device !== undefined) ensure(deviceIds.has(item.device), `shop.json: 未定義の機材 ${item.device}`);
    if (item.cable !== undefined) ensure(cableIds.has(item.cable), `shop.json: 未定義のケーブル ${item.cable}`);
    if (item.furniture !== undefined) ensure(furnitureIds.has(item.furniture), `shop.json: 未定義の家具 ${item.furniture}`);
  }

  const checkGoals = (owner: string, goals: Goal[], refs: Set<string>) => {
    for (const goal of goals) {
      for (const ref of goalRefs(goal)) {
        ensure(refs.has(ref), `${owner}: goals の参照 ${ref} が placed にない`);
      }
    }
  };

  const checkPlacement = (owner: string, placed: Contract['placed'], map: GameMap | undefined) => {
    const refs = unique(placed, (p) => p.ref, `${owner} の placed`);
    const used = new Set<string>();
    for (const p of placed) {
      ensure(deviceIds.has(p.device), `${owner}: placed ${p.ref} の機材 ${p.device} が未定義`);
      if (!map) continue;
      if (p.x >= map.width || p.y >= map.height) {
        errors.push(`${owner}: placed ${p.ref} の位置 (${p.x}, ${p.y}) がマップ ${map.id} の外`);
        continue;
      }
      const tile = map.tiles[p.y][p.x];
      if (isBlocked(map.legend[tile])) {
        errors.push(`${owner}: placed ${p.ref} の位置 (${p.x}, ${p.y}) が壁・柱など通れない場所`);
      }
      const key = `${p.x},${p.y}`;
      if (used.has(key)) errors.push(`${owner}: placed ${p.ref} の位置 (${p.x}, ${p.y}) が他の機器と重なる`);
      used.add(key);
    }
    return refs;
  };

  for (const contract of data.contracts) {
    const owner = `contracts/${contract.id}.json`;
    for (const req of contract.requires) {
      ensure(contractIdSet.has(req), `${owner}: requires の案件 ${req} が未定義`);
    }
    // 自社オフィスのマップは大きさで決まるため、位置の検証は行わない（置く機器の指定がない）
    const map = mapsById.get(contract.map);
    ensure(!!map || contract.map === OFFICE_MAP_ID, `${owner}: 未定義のマップ ${contract.map}`);
    const refs = checkPlacement(owner, contract.placed, map);
    checkGoals(owner, contract.goals, refs);
  }

  for (const template of data.templates) {
    const owner = `contracts/templates/${template.id}.json`;
    for (const req of template.requires) {
      ensure(contractIdSet.has(req), `${owner}: requires の案件 ${req} が未定義`);
    }
    ensure(mapsById.has(template.map) || template.map === OFFICE_MAP_ID, `${owner}: 未定義のマップ ${template.map}`);
    for (const d of template.decor ?? []) ensure(furnitureIds.has(d), `${owner}: decor の家具 ${d} が未定義`);
    // テンプレートの機器は実行時に生成されるため、goals の参照は $role:<役割> だけを書ける。役割は spawnGroups の role にあること
    const roles = new Set((template.spawnGroups ?? []).flatMap((g) => (g.role === undefined ? [] : [g.role])));
    for (const goal of template.goals) {
      for (const ref of goalRefs(goal)) {
        ensure(ref.startsWith('$role:') && roles.has(ref.slice('$role:'.length)), `${owner}: goals の参照 ${ref} が spawnGroups の役割にない`);
      }
    }
  }

  // 節目の報酬の機器は、その節目のレベルで解放されていること（新しい機器を先に渡さない）
  const unlockOf = new Map(data.devices.map((d) => [d.id, d.unlockLevel] as const));
  for (const m of data.levelMilestones) {
    for (const r of m.reward.devices) {
      const unlock = unlockOf.get(r.device);
      ensure(unlock !== undefined, `levels.json: 節目 ${m.level} の機材 ${r.device} が未定義`);
      ensure(unlock === undefined || unlock <= m.level, `levels.json: 節目 ${m.level} の機材 ${r.device} は Lv${unlock} で解放される`);
    }
  }

  if (errors.length) throw new GameDataError(errors);
};

// requires に従って並べる。同じ条件の案件は stage と order で並べる。循環は検出してエラーにする。
const sortContracts = (contracts: Contract[]): Contract[] => {
  const pending = [...contracts].sort((a, b) => a.stage - b.stage || a.order - b.order || a.id.localeCompare(b.id));
  const done = new Set<string>();
  const sorted: Contract[] = [];
  while (pending.length) {
    const index = pending.findIndex((c) => c.requires.every((r) => done.has(r)));
    if (index < 0) {
      throw new GameDataError([`contracts/: requires に循環がある（${pending.map((c) => c.id).join(', ')}）`]);
    }
    const [next] = pending.splice(index, 1);
    done.add(next.id);
    sorted.push(next);
  }
  return sorted;
};

// 翻訳キーの存在を検証する。非基準言語で欠けたキーは基準言語の値で補完する（件数をログに出す）。
const fillLanguages = (data: GameData): void => {
  const base = data.langs[BASE_LANG];
  const required = new Set<string>(REQUIRED_UI_KEYS);
  for (const id of ERROR_IDS) required.add(`error.${id}`);
  for (const d of data.devices) {
    required.add(`device.${d.id}.name`);
    required.add(`device.${d.id}.desc`);
  }
  for (const c of data.cables) required.add(`cable.${c.id}.name`);
  for (const f of data.furniture) {
    required.add(`furniture.${f.id}.name`);
    required.add(`furniture.${f.id}.desc`);
  }
  for (const c of data.contracts) {
    required.add(`contract.${c.id}.title`);
    required.add(`contract.${c.id}.story`);
  }
  // 変化形は元のひな形の文言を使う（textId）
  for (const t of data.templates) {
    if (t.textId === undefined) throw new GameDataError([`contracts/templates/${t.id}.json: textId がない`]);
    required.add(`contract.${t.textId}.title`);
    required.add(`contract.${t.textId}.story`);
  }
  for (const c of data.contracts) required.add(`contract.${c.id}.hint`);
  // 案内の文言は guide.<案件>.<n>（n は1から）。1手順20文字以内
  for (const g of data.guides) {
    g.steps.forEach((_, i) => required.add(guideKey(g.contract, i)));
  }
  for (const l of data.lessons) {
    required.add(lessonKey(l.id, 'title'));
    required.add(lessonKey(l.id, 'brief'));
    l.guide.forEach((_, i) => required.add(lessonKey(l.id, `step.${i + 1}`)));
    for (const g of l.goals) required.add(`goal.${g.type}`);
  }
  for (const g of [...data.contracts.flatMap((c) => c.goals), ...data.templates.flatMap((t) => t.goals)]) {
    required.add(`goal.${g.type}`);
  }

  const errors: string[] = [];
  for (const key of required) {
    if (!(key in base)) errors.push(`${BASE_LANG}.json: 翻訳キー ${key} がない`);
  }
  for (const [code, lang] of Object.entries(data.langs)) {
    for (const key of Object.keys(lang)) {
      if (!(key in base)) errors.push(`${code}.json: ${BASE_LANG}.json にない翻訳キー ${key}`);
    }
    if (code === BASE_LANG) continue;
    let filled = 0;
    for (const key of Object.keys(base)) {
      if (!(key in lang)) {
        lang[key] = base[key];
        filled++;
      }
    }
    data.missingFilled[code] = filled;
  }
  for (const key of required) {
    if (key.startsWith('guide.') && key in base && [...base[key]].length > GUIDE_TEXT_MAX) {
      errors.push(`${BASE_LANG}.json: ${key} は${GUIDE_TEXT_MAX}文字以内にする`);
    }
  }
  if (errors.length) throw new GameDataError(errors);
};

const toTypeUnion = (values: string[]): string => (values.length ? values.map((v) => JSON.stringify(v)).join(' | ') : 'never');

// スプライト（src/assets/sprites/ の PNG）の名前。拡張子を除いた相対パス（例: device/pc_basic）
const spriteNamesIn = (spriteDir: string): string[] => {
  const names: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name), `${prefix}${entry.name}/`);
      else if (entry.name.endsWith('.png')) names.push(`${prefix}${entry.name.slice(0, -4)}`);
    }
  };
  walk(spriteDir, '');
  return names.sort();
};

const writeGenerated = (generatedDir: string, data: GameData, spriteDir: string): void => {
  mkdirSync(generatedDir, { recursive: true });
  const ids = [
    `// このファイルはビルド時に game-data プラグインが生成する。編集しない。`,
    `export type DeviceId = ${toTypeUnion(data.devices.map((d) => d.id))};`,
    `export type FurnitureId = ${toTypeUnion(data.furniture.map((f) => f.id))};`,
    `export type CableId = ${toTypeUnion(data.cables.map((c) => c.id))};`,
    `export type ContractId = ${toTypeUnion(data.contracts.map((c) => c.id))};`,
    `export type TemplateId = ${toTypeUnion(data.templates.map((t) => t.id))};`,
    `export type MapId = ${toTypeUnion([...data.maps.map((m) => m.id), OFFICE_MAP_ID])};`,
    `export type SpriteId = ${toTypeUnion(spriteNamesIn(spriteDir))};`,
    `export type LangCode = ${toTypeUnion(Object.keys(data.langs))};`,
    '',
  ].join('\n');
  const langKeys = [
    `// このファイルはビルド時に game-data プラグインが生成する。編集しない。`,
    `export type LangKey = ${toTypeUnion(Object.keys(data.langs[BASE_LANG]))};`,
    '',
  ].join('\n');
  writeFileSync(join(generatedDir, 'ids.ts'), ids);
  writeFileSync(join(generatedDir, 'lang-keys.ts'), langKeys);
};

const gameDataModule = (data: GameData): string => {
  const devices = Object.fromEntries(data.devices.map((d) => [d.id, d]));
  const cables = Object.fromEntries(data.cables.map((c) => [c.id, c]));
  const furniture = Object.fromEntries(data.furniture.map((f) => [f.id, f]));
  return [
    `export const balance = ${JSON.stringify(data.balance)};`,
    `export const devices = ${JSON.stringify(devices)};`,
    `export const furniture = ${JSON.stringify(furniture)};`,
    `export const cables = ${JSON.stringify(cables)};`,
    `export const shop = ${JSON.stringify(data.shop)};`,
    `export const training = ${JSON.stringify(Object.fromEntries(data.training.map((c) => [c.id, c])))};`,
    `export const certs = ${JSON.stringify(Object.fromEntries(data.certs.map((c) => [c.id, c])))};`,
    `export const levelMilestones = ${JSON.stringify(data.levelMilestones)};`,
    `export const contracts = ${JSON.stringify(data.contracts)};`,
    `export const contractTemplates = ${JSON.stringify(data.templates)};`,
    `export const lessons = ${JSON.stringify(data.lessons)};`,
    `export const guides = ${JSON.stringify(
      Object.fromEntries(
        data.guides.map((g) => [
          g.contract,
          g.steps.map((s, i) => ({ key: guideKey(g.contract, i), target: s.target, done: s.done })),
        ]),
      ),
    )};`,
  ].join('\n');
};

const loadersModule = (data: GameData): string => {
  const langs = Object.keys(data.langs).map((code) => `  ${JSON.stringify(code)}: () => import(${JSON.stringify(`virtual:lang/${code}`)}),`);
  const maps = data.maps.map((m) => `  ${JSON.stringify(m.id)}: () => import(${JSON.stringify(`virtual:map/${m.id}`)}),`);
  return [
    'export const langLoaders = {',
    ...langs,
    '};',
    'export const mapLoaders = {',
    ...maps,
    '};',
  ].join('\n');
};

const PREFIX = '\0';
const VIRTUAL_GAME_DATA = 'virtual:game-data';
const VIRTUAL_LOADERS = 'virtual:loaders';
// 自社オフィスの部屋のマップ。ファイルはなく、床の大きさ（office.size）からゲームの実行時に作る
const OFFICE_MAP_ID = 'hq';

export default function gameData(): Plugin {
  let config: ResolvedConfig;
  let data: GameData;
  let dataDir = '';
  let langDir = '';
  let generatedDir = '';
  let spriteDir = '';

  const generate = (): void => {
    data = loadData(dataDir, langDir, spriteDir);
    writeGenerated(generatedDir, data, spriteDir);
    for (const [code, count] of Object.entries(data.missingFilled)) {
      if (count > 0) config.logger.info(`[game-data] ${code}.json: ${count} 件の翻訳キーを ${BASE_LANG} の値で補完した`);
    }
  };

  return {
    name: 'game-data',
    enforce: 'pre',

    configResolved(resolved) {
      config = resolved;
      dataDir = resolve(resolved.root, 'src/assets/data');
      langDir = resolve(resolved.root, 'src/assets/lang');
      generatedDir = resolve(resolved.root, 'src/generated');
      spriteDir = resolve(resolved.root, 'src/assets/sprites');
      generate();
    },

    configureServer(server: ViteDevServer) {
      const onChange = (file: string) => {
        const path = resolve(file);
        if (!path.startsWith(dataDir) && !path.startsWith(langDir)) return;
        try {
          generate();
        } catch (e) {
          server.ws.send({ type: 'error', err: { message: (e as Error).message, stack: '', plugin: 'game-data' } });
          return;
        }
        for (const id of [VIRTUAL_GAME_DATA, VIRTUAL_LOADERS]) {
          const mod = server.moduleGraph.getModuleById(PREFIX + id);
          if (mod) server.moduleGraph.invalidateModule(mod);
        }
        server.moduleGraph.invalidateAll();
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.add([dataDir, langDir]);
      server.watcher.on('change', onChange);
      server.watcher.on('add', onChange);
      server.watcher.on('unlink', onChange);
    },

    resolveId(id) {
      if (id === VIRTUAL_GAME_DATA || id === VIRTUAL_LOADERS) return PREFIX + id;
      if (id.startsWith('virtual:lang/') || id.startsWith('virtual:map/')) return PREFIX + id;
      return null;
    },

    load(id) {
      if (!id.startsWith(PREFIX + 'virtual:')) return null;
      const name = id.slice(PREFIX.length + 'virtual:'.length);
      if (name === 'game-data') return gameDataModule(data);
      if (name === 'loaders') return loadersModule(data);
      if (name.startsWith('lang/')) {
        const code = name.slice('lang/'.length);
        const lang = data.langs[code];
        if (!lang) throw new GameDataError([`言語 ${code} は存在しない`]);
        return `export default ${JSON.stringify(lang)};`;
      }
      if (name.startsWith('map/')) {
        const mapId = name.slice('map/'.length);
        const map = data.maps.find((m) => m.id === mapId);
        if (!map) throw new GameDataError([`マップ ${mapId} は存在しない`]);
        return `export default ${JSON.stringify(map)};`;
      }
      return null;
    },
  };
}
