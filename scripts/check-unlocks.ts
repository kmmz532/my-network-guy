// レベルごとの解放を、クリアの画面（レベルアップの画面）と同じ数え方で出し、規則を確かめる。
// 数え方は ゲームの関数（levelUpsBetween・unlockItems）と Overlay.tsx の札の作り方（職種・部屋の拡張を足す）に従い、手で数えない。
// 規則:
//   1. 1つのレベルの解放は4つまで（告知しない変化形の依頼は数えない）
//   2. 新しい仕組み（職種・機能・部屋の拡張・倍速）は1つのレベルに1つまで
//   3. Lv11〜40 で、解放が0件のレベルを2つ続けない
//   5. 依頼の種類（定型・固定）は、要る機器の解放より後（要る機器の最小の解放のレベル以上）
//   6. 固定の依頼の requires の順と、unlockLevel の順を食い違わせない
// 使い方: npx vite-node scripts/check-unlocks.ts [--quiet]（違反があれば終了コード 1）
import { balance, contracts, contractTemplates, devices, levelMilestones } from 'virtual:game-data';
import { unlockItems } from '../src/stores/gameHelpers';
import { levelUpsBetween } from '../src/sim/level';
import { JOB_DEFS } from '../src/sim/jobs';
import type { Goal } from '../src/data/schema';

const MAX_LEVEL = 40;
const MAX_PER_LEVEL = 4;
const quiet = process.argv.includes('--quiet');

const ups = levelUpsBetween(0, MAX_LEVEL, balance, levelMilestones, unlockItems);
const mechanismKinds = new Set(['feature', 'speed']);
const rows = ups.map((u) => {
  const jobs = JOB_DEFS.filter((j) => j.unlockLevel === u.level).map((j) => `job:${j.id}`);
  const expansion = balance.office.expand.unlockLevels.includes(u.level) ? ['expansion'] : [];
  const items = u.unlocks.map((x) => `${x.kind}:${x.id}`);
  const mechanisms = [...jobs, ...expansion, ...u.unlocks.filter((x) => mechanismKinds.has(x.kind)).map((x) => `${x.kind}:${x.id}`)];
  return { level: u.level, labels: [...jobs, ...expansion, ...items], mechanisms };
});

const errors: string[] = [];
for (const r of rows) {
  if (r.level > 1 && r.labels.length > MAX_PER_LEVEL) errors.push(`規則1: Lv${r.level} の解放が ${r.labels.length} 件（${r.labels.join(', ')}）`);
  if (r.level > 1 && r.mechanisms.length > 1) errors.push(`規則2: Lv${r.level} に新しい仕組みが ${r.mechanisms.length} 件（${r.mechanisms.join(', ')}）`);
}
for (let n = 11; n < MAX_LEVEL; n++) {
  if (rows[n - 1].labels.length === 0 && rows[n].labels.length === 0) errors.push(`規則3: Lv${n} と Lv${n + 1} の解放が 0 件`);
}

// 規則5: 依頼の種類は、要る機器の解放より後でなければならない。
// 要る機器は、達成条件から決まるものだけを数える（カテゴリの機器は、そのカテゴリで最も早く解放される機器の解放のレベル）。
// 固定で置かれている機器（placed）はプレイヤーが買わないため数えない
const categoryLevel = (category: string): number => {
  const levels = Object.values(devices).filter((d) => d.category === category).map((d) => d.unlockLevel);
  if (levels.length === 0) throw new Error(`機器のカテゴリがない: ${category}`);
  return Math.min(...levels);
};
const deviceLevelOf = (id: string): number => {
  const d = devices[id];
  if (!d) throw new Error(`機器の定義がない: ${id}`);
  return d.unlockLevel;
};
// 達成条件が要る機器（名前と解放のレベル）
const needOfGoal = (g: Goal): { name: string; level: number }[] => {
  const cat = (name: string) => ({ name, level: categoryLevel(name) });
  switch (g.type) {
    case 'count':
    case 'reach_category':
      return g.category === 'pc' || g.category === 'uplink' ? [] : [cat(g.category)];
    case 'count_device':
      return [{ name: g.device, level: deviceLevelOf(g.device) }];
    case 'vpn_up':
      return [{ name: 'vpn_router', level: deviceLevelOf('vpn_router') }];
    case 'load_balanced':
      return [cat('load_balancer')];
    case 'wireless_clients':
    case 'wireless_secure':
    case 'wireless_clean':
      return [cat('access_point')];
    case 'bgp_established':
    case 'bgp_usable':
    case 'bgp_exit':
    case 'ospf_dr':
    case 'no_static_route':
    case 'public_http':
    case 'outside_reachable':
    case 'outside_sees':
      return [cat('router')];
    case 'firewall':
    case 'blocked':
    case 'blocked_all':
      return [cat('firewall')];
    case 'stp_root':
      return [cat('l2_switch')];
    default:
      return [];
  }
};
const checkNeed = (kind: string, id: string, level: number, goals: Goal[]): void => {
  for (const g of goals) {
    for (const n of needOfGoal(g)) {
      if (level < n.level) errors.push(`規則5: ${kind} ${id}（Lv${level}）が、要る機器 ${n.name}（Lv${n.level}、条件 ${g.type}）より前`);
    }
  }
};
for (const t of contractTemplates) if (t.announce) checkNeed('template', t.id, t.unlockLevel, t.goals);
for (const c of contracts) if (!c.inhouse) checkNeed('contract', c.id, c.unlockLevel, c.goals);

// 規則6: requires の順（依頼の要る依頼は、先に解放されること）
const levelOfContract = new Map(contracts.map((c) => [c.id, c.unlockLevel]));
for (const c of contracts) {
  for (const r of c.requires) {
    const rl = levelOfContract.get(r);
    if (rl === undefined) continue;
    if (rl > c.unlockLevel) errors.push(`規則6: ${c.id}（Lv${c.unlockLevel}）の requires の ${r} が Lv${rl}`);
  }
}

if (!quiet) {
  for (const r of rows) console.log(`Lv${String(r.level).padStart(2)}: ${String(r.labels.length).padStart(2)} 件  ${r.labels.join(', ')}`);
}
if (errors.length > 0) {
  console.error(`解放の規則の違反 ${errors.length} 件:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  process.exit(1);
}
console.log('解放の規則: 合格');
