// ゲームデータ（JSON）を検証・正規化し、型と仮想モジュールを生成するViteプラグイン。
// 検証に失敗した場合はファイル名と項目を示してビルド（開発サーバーではエラーオーバーレイ）を止める。
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import type { ZodTypeAny } from 'zod';
import {
  balanceSchema,
  cablesFileSchema,
  contractSchema,
  devicesFileSchema,
  langSchema,
  mapSchema,
  shopFileSchema,
  templateSchema,
  type Balance,
  type Cable,
  type Contract,
  type ContractTemplate,
  type Device,
  type Goal,
  type GameMap,
  type Lang,
  type ShopItem,
} from '../src/data/schema';

const BASE_LANG = 'ja_jp';

// 実行時に存在が必要な翻訳キー（ID以外から導出されない固定のもの）
const REQUIRED_UI_KEYS = ['ui.hud.money', 'ui.hud.reputation'];
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
  cables: Cable[];
  devices: Device[];
  shop: ShopItem[];
  contracts: Contract[];
  templates: ContractTemplate[];
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

const jsonFiles = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && statSync(join(dir, f)).isFile())
    .sort()
    .map((f) => join(dir, f));
};

const loadData = (dataDir: string, langDir: string): GameData => {
  const balance = parseWith(balanceSchema, readJson(join(dataDir, 'balance.json')), 'balance.json');
  const cables = parseWith(cablesFileSchema, readJson(join(dataDir, 'cables.json')), 'cables.json').cables;
  const devices = jsonFiles(join(dataDir, 'devices')).flatMap((file) =>
    parseWith(devicesFileSchema, readJson(file), file).devices,
  );
  const shop = parseWith(shopFileSchema, readJson(join(dataDir, 'shop.json')), 'shop.json').items;

  const contractsDir = join(dataDir, 'contracts');
  const contracts = jsonFiles(contractsDir).map((file) => {
    const contract = parseWith(contractSchema, readJson(file), file);
    if (contract.id !== basename(file, '.json')) {
      throw new GameDataError([`${file}: id（${contract.id}）がファイル名と一致しない`]);
    }
    return contract;
  });
  const templates = jsonFiles(join(contractsDir, 'templates')).map((file) => {
    const template = parseWith(templateSchema, readJson(file), file);
    if (template.id !== basename(file, '.json')) {
      throw new GameDataError([`${file}: id（${template.id}）がファイル名と一致しない`]);
    }
    return template;
  });
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
    cables,
    devices,
    shop,
    contracts,
    templates,
    maps,
    langs,
    missingFilled: {},
  };
  validateReferences(data);
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
    case 'http_all':
      return [];
  }
};

const validateReferences = (data: GameData): void => {
  const errors: string[] = [];
  const cableIds = unique(data.cables, (c) => c.id, 'cables.json');
  const deviceIds = unique(data.devices, (d) => d.id, 'devices/');
  const mapsById = new Map(data.maps.map((m) => [m.id, m]));
  unique(data.maps, (m) => m.id, 'maps/');
  // 案件とテンプレートはどちらも requires や解禁条件から参照されるため、ID の集合を共通で作る
  const contractIdSet = unique([...data.contracts, ...data.templates], (c) => c.id, 'contracts/');

  const ensure = (ok: boolean, message: string) => {
    if (!ok) errors.push(message);
  };

  for (const item of data.shop) {
    if (item.device !== undefined) ensure(deviceIds.has(item.device), `shop.json: 未定義の機材 ${item.device}`);
    if (item.cable !== undefined) ensure(cableIds.has(item.cable), `shop.json: 未定義のケーブル ${item.cable}`);
    if (item.unlock) {
      ensure(contractIdSet.has(item.unlock.contract), `shop.json: 解禁条件の案件 ${item.unlock.contract} が未定義`);
    }
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
      if (map.legend[tile] === 'wall') {
        errors.push(`${owner}: placed ${p.ref} の位置 (${p.x}, ${p.y}) が壁`);
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
    const map = mapsById.get(contract.map);
    ensure(!!map, `${owner}: 未定義のマップ ${contract.map}`);
    const refs = checkPlacement(owner, contract.placed, map);
    checkGoals(owner, contract.goals, refs);
  }

  for (const template of data.templates) {
    const owner = `contracts/templates/${template.id}.json`;
    for (const req of template.requires) {
      ensure(contractIdSet.has(req), `${owner}: requires の案件 ${req} が未定義`);
    }
    ensure(mapsById.has(template.map), `${owner}: 未定義のマップ ${template.map}`);
    // テンプレートの機器は実行時に生成されるため、goals の参照は ping_all の $all_pcs 以外を検証しない
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
  for (const c of [...data.contracts, ...data.templates]) {
    required.add(`contract.${c.id}.title`);
    required.add(`contract.${c.id}.story`);
  }
  for (const c of data.contracts) required.add(`contract.${c.id}.hint`);
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
  if (errors.length) throw new GameDataError(errors);
};

const toTypeUnion = (values: string[]): string => (values.length ? values.map((v) => JSON.stringify(v)).join(' | ') : 'never');

const writeGenerated = (generatedDir: string, data: GameData): void => {
  mkdirSync(generatedDir, { recursive: true });
  const ids = [
    `// このファイルはビルド時に game-data プラグインが生成する。編集しない。`,
    `export type DeviceId = ${toTypeUnion(data.devices.map((d) => d.id))};`,
    `export type CableId = ${toTypeUnion(data.cables.map((c) => c.id))};`,
    `export type ContractId = ${toTypeUnion(data.contracts.map((c) => c.id))};`,
    `export type TemplateId = ${toTypeUnion(data.templates.map((t) => t.id))};`,
    `export type MapId = ${toTypeUnion(data.maps.map((m) => m.id))};`,
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
  return [
    `export const balance = ${JSON.stringify(data.balance)};`,
    `export const devices = ${JSON.stringify(devices)};`,
    `export const cables = ${JSON.stringify(cables)};`,
    `export const shop = ${JSON.stringify(data.shop)};`,
    `export const contracts = ${JSON.stringify(data.contracts)};`,
    `export const contractTemplates = ${JSON.stringify(data.templates)};`,
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

export default function gameData(): Plugin {
  let config: ResolvedConfig;
  let data: GameData;
  let dataDir = '';
  let langDir = '';
  let generatedDir = '';

  const generate = (): void => {
    data = loadData(dataDir, langDir);
    writeGenerated(generatedDir, data);
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
