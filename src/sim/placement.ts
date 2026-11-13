import { applyMoney, recordSaving } from './ledger';
import type { Balance, GameMap } from '../data/schema';
import { tileKind } from '../data/tileKind';
import { furnitureOf } from '../contracts/layout';
import { nextHostname } from '../network/hostname';
import { nextMacSerial } from '../network/mac';
import { fillSegments } from '../network/segments';
import type { NetLink, NetNode, Service } from '../network/types';
import { isPcCategory } from '../data/categories';
import { cableLengthOf, checkCableLength } from './cableLength';
import { levelOf } from './level';
import { Core, End, Env, NetTarget, OFFICE_UPLINK_UID, Outcome, PlacedFurniture, Project, cableCost, factoryConfigOf, fail, focusedOf, isDeskFurniture, isPcIn, netOf, officeLocked, officeUplinkOf, paidCable, requireDesign, withNet, withProject } from './project';

// 機材を置いたときに動いているサービス（ゲームデータの defaultServices を写す）
const servicesOf = (env: Env, deviceId: string): Service[] => (env.devices[deviceId]?.defaultServices ?? []).map((s) => ({ ...s }));

// 自社オフィスに機器を置けるかを判定する。置けなければ失敗の理由を返す
// PCは机の家具があり、その上に機器がないマスだけ。PC以外は床で、家具も機器もないマスだけ。
// anyFloor（サンドボックス）のときは、PCは床（家具も機器もないマス）か机の上（機器がないマス）に置ける。机以外の家具の上は置けない
const officePlaceReason = (
  furniture: PlacedFurniture[],
  nodes: NetNode[],
  deviceId: string,
  x: number,
  y: number,
  map: GameMap,
  env: Env,
  anyFloor = false,
): string | null => {
  const hasNode = nodes.some((n) => n.x === x && n.y === y);
  const device = env.devices[deviceId];
  const isPc = isPcCategory(device.category);
  // 机の上にも床にも置ける機器（N91）は、PC のような机の上の判定を使い、床にも置ける。PC でも deskable でもない機器は床だけ
  const desktop = device.deskable === true;
  if (isPc && !desktop && !anyFloor) {
    const onDesk = furniture.some((f) => f.x === x && f.y === y && isDeskFurniture(f.id, env));
    return !onDesk || hasNode ? 'desk' : null;
  }
  const kind = tileKind(map, x, y);
  if (kind !== 'floor') return 'tile';
  if (hasNode) return 'tile';
  const here = furniture.filter((f) => f.x === x && f.y === y);
  if (isPc || desktop) return here.some((f) => !isDeskFurniture(f.id, env)) ? 'tile' : null;
  return here.length > 0 ? 'tile' : null;
};

// 機材を置けるマスか（配置と移動で共通）。自社案件は自社オフィスの規則、それ以外は床（PCは机の上も可）。置けなければ理由を返す
const placeReason = (
  inhouse: boolean,
  furniture: PlacedFurniture[],
  nodes: NetNode[],
  deviceId: string,
  x: number,
  y: number,
  map: GameMap,
  env: Env,
  anyFloor = false,
): string | null => {
  if (inhouse) return officePlaceReason(furniture, nodes, deviceId, x, y, map, env, anyFloor);
  const kind = tileKind(map, x, y);
  const deskOk = isPcIn(env, deviceId) || env.devices[deviceId].deskable === true;
  if (kind !== 'floor' && !(kind === 'desk' && deskOk)) return 'tile';
  if (nodes.some((n) => n.x === x && n.y === y)) return 'tile';
  // 依頼先の家具（机・棚・飾り。N76）のあるマスには置けない
  if (furniture.some((f) => f.x === x && f.y === y)) return 'tile';
  return null;
};

// 機器が机の上にあるか。deskAt は置く処理と同じ規則で机のマスを答える（自社オフィスは机の家具、依頼先は地図の desk のマス）
export const restsOnDesk = (node: NetNode, deskAt: (x: number, y: number) => boolean): boolean => deskAt(node.x, node.y);

export const placeDevice = (core: Core, deviceId: string, x: number, y: number, map: GameMap, env: Env): Outcome => {
  const p = requireDesign(core);
  if (typeof p === 'string') return fail(p);
  if (!env.devices[deviceId]) return fail('none');
  if ((core.owned[deviceId] ?? 0) < 1) return fail('stock');
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return fail('tile');
  const furniture = p.contract.inhouse ? core.office.furniture : furnitureOf(map.furniture, p.contract.furniture);
  const reason = placeReason(p.contract.inhouse, furniture, p.nodes, deviceId, x, y, map, env);
  if (reason) return fail(reason);
  const node: NetNode = { ports: [],
    uid: `u${p.seq}`,
    device: deviceId,
    // ホスト名は種類の略号と番号を自動で付ける（N68）
    hostname: nextHostname(p.nodes, env.devices[deviceId].category),
    macSerial: nextMacSerial(p.nodes),
    x,
    y,
    locked: false,
    configLocked: false,
    ...factoryConfigOf(env, deviceId),
    gateway: null,
    routes: [],
    services: servicesOf(env, deviceId),
  };
  const next: Project = { ...p, nodes: [...p.nodes, node], seq: p.seq + 1, testedOk: false };
  return {
    ok: true,
    core: { ...withProject(core, next), owned: { ...core.owned, [deviceId]: core.owned[deviceId] - 1 } },
  };
};

// 案件がないときに、在庫の機材を自社オフィスへ置く。配線は自社案件と同じ規則で行う
// sandbox のときは在庫を数えない（置いても在庫は減らず、撤去しても増えない）
export const placeInOffice = (core: Core, deviceId: string, x: number, y: number, map: GameMap, env: Env, anyFloor = false, sandbox = false): Outcome => {
  if (officeLocked(core)) return fail('inhouse');
  if (!env.devices[deviceId]) return fail('none');
  if (!sandbox && (core.owned[deviceId] ?? 0) < 1) return fail('stock');
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return fail('tile');
  const office = core.office;
  const reason = officePlaceReason(office.furniture, office.nodes, deviceId, x, y, map, env, anyFloor);
  if (reason) return fail(reason);
  const node: NetNode = { ports: [],
    uid: `u${office.seq}`,
    device: deviceId,
    hostname: nextHostname(office.nodes, env.devices[deviceId].category),
    macSerial: nextMacSerial(office.nodes),
    x,
    y,
    locked: false,
    configLocked: false,
    ...factoryConfigOf(env, deviceId),
    gateway: null,
    routes: [],
    services: servicesOf(env, deviceId),
  };
  return {
    ok: true,
    core: {
      ...core,
      office: { ...office, nodes: [...office.nodes, node], seq: office.seq + 1 },
      owned: sandbox ? core.owned : { ...core.owned, [deviceId]: core.owned[deviceId] - 1 },
    },
  };
};

// 自社オフィスの機器を在庫に戻す。つながるケーブルも一緒に撤去する（ケーブルは在庫を持たない）
export const removeFromOffice = (core: Core, uid: string, env: Env, sandbox = false): Outcome => {
  if (officeLocked(core)) return fail('inhouse');
  const node = core.office.nodes.find((n) => n.uid === uid);
  if (!node) return fail('none');
  const removed = core.office.links.filter((l) => l.a.node === uid || l.b.node === uid);
  const nodes = core.office.nodes.filter((n) => n.uid !== uid);
  const links = core.office.links.filter((l) => !removed.includes(l));
  const segments = fillSegments({ nodes, links, segments: core.office.segments }, env.engine);
  return {
    ok: true,
    core: {
      ...core,
      office: { ...core.office, nodes, links, segments },
      owned: sandbox ? core.owned : { ...core.owned, [node.device]: (core.owned[node.device] ?? 0) + 1 },
    },
  };
};

// 機器を撤去する（在庫に戻す）。既設の機器（node.locked）以外は、施工済みでも撤去できる。
// つながるケーブルも一緒に撤去する（ケーブルは在庫を持たず、費用も返さない）
export const removeNode = (core: Core, uid: string, env: Env): Outcome => {
  const p = requireDesign(core);
  if (typeof p === 'string') return fail(p);
  const node = p.nodes.find((n) => n.uid === uid);
  if (!node) return fail('none');
  if (node.locked) return fail('locked');
  const removed = p.links.filter((l) => l.a.node === uid || l.b.node === uid);
  const removedUids = removed.map((l) => l.uid);
  const nodes = p.nodes.filter((n) => n.uid !== uid);
  const links = p.links.filter((l) => !removed.includes(l));
  const next: Project = {
    ...p,
    nodes,
    links,
    testedOk: false,
    segments: fillSegments({ nodes, links, segments: p.segments }, env.engine),
    built: {
      nodes: p.built.nodes.filter((x) => x !== uid),
      links: p.built.links.filter((x) => !removedUids.includes(x)),
    },
  };
  const owned = { ...core.owned, [node.device]: (core.owned[node.device] ?? 0) + 1 };
  return { ok: true, core: { ...withProject(core, next), owned } };
};

// 配線を撤去する。ケーブルは在庫を持たないため戻さない。案件では、施工前の配線の費用を案件と所持金に戻す（施工済みは戻さない）。
// 案件の既設の配線（自社案件の引き継ぎ分）は撤去できない
export const removeLink = (core: Core, uid: string, target: NetTarget, env: Env): Outcome => {
  const net = netOf(core, target);
  if (typeof net === 'string') return fail(net);
  const link = net.links.find((l) => l.uid === uid);
  if (!link) return fail('none');
  let refund = 0;
  if (target === 'focus') {
    const p = focusedOf(core) as Project;
    if (p.inheritedLinks.includes(uid)) return fail('locked');
    // 返金は、配線・移動・挿し替えで実際に払った額（割引のあとの額）。撤去の時点の割引では計算しない（N113）
    if (!p.built.links.includes(uid)) refund = link.paid;
  }
  const links = net.links.filter((l) => l.uid !== uid);
  let next = withNet(core, target, { ...net, links, segments: fillSegments({ nodes: net.nodes, links, segments: net.segments }, env.engine) });
  if (target === 'focus') {
    const p = focusedOf(next) as Project;
    next = withProject(next, { ...p, cost: p.cost - refund, built: { ...p.built, links: p.built.links.filter((x) => x !== uid) } });
  }
  return {
    ok: true,
    core: {
      ...next,
      clock: applyMoney(next.clock, refund, 'construction'),
    },
  };
};

export const replug = (core: Core, linkUid: string, end: End, port: number, env: Env, target: NetTarget = 'focus'): Outcome => {
  const net = netOf(core, target);
  if (typeof net === 'string') return fail(net);
  const link = net.links.find((l) => l.uid === linkUid);
  if (!link) return fail('none');
  if (target === 'focus' && (focusedOf(core)?.inheritedLinks ?? []).includes(linkUid)) return fail('locked');
  const endpoint = end === 'a' ? link.a : link.b;
  const node = net.nodes.find((n) => n.uid === endpoint.node);
  if (!node) return fail('none');
  const count = env.devices[node.device]?.portCount ?? 0;
  if (!Number.isInteger(port) || port < 0 || port >= count) return fail('port');
  if (port === endpoint.port) return fail('portUsed');
  const used = net.links.some(
    (l) => l.uid !== linkUid && ((l.a.node === node.uid && l.a.port === port) || (l.b.node === node.uid && l.b.port === port)),
  );
  if (used) return fail('portUsed');
  const moved: NetLink = { ...link, [end]: { node: node.uid, port } };
  const links = net.links.map((l) => (l.uid === linkUid ? moved : l));
  const segments = fillSegments({ nodes: net.nodes, links, segments: net.segments }, env.engine);
  return { ok: true, core: withNet(core, target, { ...net, links, segments }) };
};

// 2つの機器の位置をつなぐ配線の経路（折れ点を1つ入れたL字。connect と同じ形）
const cablePath = (a: NetNode, b: NetNode): NetLink['path'] => [
  [a.x, a.y],
  [b.x, a.y],
  [b.x, b.y],
];

// ケーブル1本の定価の増減（delta）を、払う額（paid）と節約（saved）に分ける。増えたときだけ割引が効き、浮いた額は節約に残す。
// 減ったときは定価のまま返すが、そのケーブルで払った額（paidSoFar）を超えては返さない（N113）
const paymentFor = (core: Core, delta: number, paidSoFar: number): { paid: number; saved: number } => {
  if (delta > 0) {
    const paid = paidCable(core, delta);
    return { paid, saved: delta - paid };
  }
  return { paid: Math.max(delta, -paidSoFar), saved: 0 };
};

// 配線の費用を払う（正）か返す（負）。案件では案件の費用も増減する。自社オフィスの費用は案件の費用に入れない
const payCable = (core: Core, target: NetTarget, paid: number, saved: number): Core => {
  const next = { ...core, clock: recordSaving(applyMoney(core.clock, -paid, 'construction'), saved) };
  if (target !== 'focus') return next;
  const p = focusedOf(next) as Project;
  return withProject(next, { ...p, cost: p.cost + paid });
};

// 機器を別のマスへ動かす。置ける条件は配置と同じ（自社オフィスの規則、または床）。
// つながるケーブルは新しい位置に合わせて経路と長さを引き直し、費用の差額を払う（返す）。
// 施工済みの機器を動かすと、その機器とつながるケーブルは施工前に戻る。既設（locked）の機器と、既設のケーブルにつながる機器は動かせない
export const moveNode = (core: Core, uid: string, x: number, y: number, env: Env, target: NetTarget, map: GameMap, anyFloor = false): Outcome => {
  const net = netOf(core, target);
  if (typeof net === 'string') return fail(net);
  const node = net.nodes.find((n) => n.uid === uid);
  if (!node) return fail('none');
  const project = target === 'focus' ? (focusedOf(core) as Project) : null;
  const attached = net.links.filter((l) => l.a.node === uid || l.b.node === uid);
  if (node.locked || attached.some((l) => (project?.inheritedLinks ?? []).includes(l.uid))) return fail('locked');
  if (x === node.x && y === node.y) return { ok: true, core };
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return fail('tile');
  const inhouse = project === null || project.contract.inhouse;
  const others = net.nodes.filter((n) => n.uid !== uid);
  const furniture = inhouse ? core.office.furniture : furnitureOf(map.furniture, project?.contract.furniture);
  const reason = placeReason(inhouse, furniture, others, node.device, x, y, map, env, anyFloor);
  if (reason) return fail(reason);

  const nodes = net.nodes.map((n) => (n.uid === uid ? { ...node, x, y } : n));
  const after = new Map(nodes.map((n) => [n.uid, n] as const));
  const before = new Map(net.nodes.map((n) => [n.uid, n] as const));
  let paidTotal = 0;
  let savedTotal = 0;
  const links: NetLink[] = [];
  for (const l of net.links) {
    if (l.a.node !== uid && l.b.node !== uid) {
      links.push(l);
      continue;
    }
    const cable = env.cables[l.cable];
    const a = after.get(l.a.node)!;
    const b = after.get(l.b.node)!;
    const length = cableLengthOf(a, b);
    if (!cable) return fail('cable');
    const lengthCheck = checkCableLength(length, cable.maxLengthTiles);
    if (lengthCheck !== 'ok') return fail(lengthCheck);
    const oldA = before.get(l.a.node)!;
    const oldB = before.get(l.b.node)!;
    const oldLength = cableLengthOf(oldA, oldB);
    const pay = paymentFor(core, cableCost(cable, length) - cableCost(cable, oldLength), l.paid);
    paidTotal += pay.paid;
    savedTotal += pay.saved;
    links.push({ ...l, path: cablePath(a, b), paid: l.paid + pay.paid });
  }
  if (paidTotal > 0 && core.clock.money < paidTotal) return fail('money');

  const segments = fillSegments({ nodes, links, segments: net.segments }, env.engine);
  let next = withNet(core, target, { nodes, links, seq: net.seq, segments });
  if (project) {
    // 動かした機器とつながるケーブルは、施工前に戻す
    const p = focusedOf(next) as Project;
    const attachedUids = attached.map((l) => l.uid);
    next = withProject(next, {
      ...p,
      built: {
        nodes: p.built.nodes.filter((x) => x !== uid),
        links: p.built.links.filter((x) => !attachedUids.includes(x)),
      },
    });
  }
  return { ok: true, core: payCable(next, target, paidTotal, savedTotal) };
};

// 配線の片方の端（end）を、ほかの機器（nodeUid）の空いているポートへ挿し替える。相手の機器を変えられる。
// port が null なら、相手の機器の空いている最小の番号を使う。空きがなければ失敗する（port。番号を指定して埋まっていれば portUsed）。
// ケーブルは新しい長さで経路と費用を引き直し、差額を払う（返す）。挿し替えたケーブルは施工前に戻す。既設のケーブルは挿し替えられない
export const replugTo = (
  core: Core,
  linkUid: string,
  end: End,
  nodeUid: string,
  port: number | null,
  env: Env,
  target: NetTarget = 'focus',
): Outcome => {
  const net = netOf(core, target);
  if (typeof net === 'string') return fail(net);
  const link = net.links.find((l) => l.uid === linkUid);
  if (!link) return fail('none');
  const project = target === 'focus' ? (focusedOf(core) as Project) : null;
  if ((project?.inheritedLinks ?? []).includes(linkUid)) return fail('locked');
  const endpoint = end === 'a' ? link.a : link.b;
  const other = end === 'a' ? link.b : link.a;
  const node = net.nodes.find((n) => n.uid === nodeUid);
  if (!node || nodeUid === other.node) return fail('none');
  const count = env.devices[node.device]?.portCount ?? 0;
  // 相手の機器のポートが埋まっているか（同じ機器なら、この端が今つないでいるポートも埋まっている）
  const taken = (p: number): boolean =>
    (nodeUid === endpoint.node && p === endpoint.port) ||
    net.links.some(
      (l) => l.uid !== linkUid && ((l.a.node === nodeUid && l.a.port === p) || (l.b.node === nodeUid && l.b.port === p)),
    );
  let to: number;
  if (port === null) {
    let free: number | undefined;
    for (let p = 0; p < count && free === undefined; p++) if (!taken(p)) free = p;
    if (free === undefined) return fail('port');
    to = free;
  } else {
    if (!Number.isInteger(port) || port < 0 || port >= count) return fail('port');
    if (taken(port)) return fail('portUsed');
    to = port;
  }

  const before = new Map(net.nodes.map((n) => [n.uid, n] as const));
  const a = end === 'a' ? node : before.get(link.a.node)!;
  const b = end === 'b' ? node : before.get(link.b.node)!;
  const cable = env.cables[link.cable];
  const length = cableLengthOf(a, b);
  if (!cable) return fail('cable');
  const lengthCheck = checkCableLength(length, cable.maxLengthTiles);
  if (lengthCheck !== 'ok') return fail(lengthCheck);
  const oldA = before.get(link.a.node)!;
  const oldB = before.get(link.b.node)!;
  const pay = paymentFor(core, cableCost(cable, length) - cableCost(cable, cableLengthOf(oldA, oldB)), link.paid);
  if (pay.paid > 0 && core.clock.money < pay.paid) return fail('money');

  const moved: NetLink = { ...link, [end]: { node: nodeUid, port: to }, path: cablePath(a, b), paid: link.paid + pay.paid };
  const links = net.links.map((l) => (l.uid === linkUid ? moved : l));
  const segments = fillSegments({ nodes: net.nodes, links, segments: net.segments }, env.engine);
  let next = withNet(core, target, { ...net, links, segments });
  if (project) {
    // 挿し替えたケーブルは、施工前に戻す
    const p = focusedOf(next) as Project;
    next = withProject(next, { ...p, built: { ...p.built, links: p.built.links.filter((x) => x !== linkUid) } });
  }
  return { ok: true, core: payCable(next, target, pay.paid, pay.saved) };
};

export const placeOfficeUplink = (core: Core, x: number, y: number, map: GameMap, env: Env, balance: Balance): Outcome => {
  if (levelOf(core.companyExp, balance) < balance.featureUnlocks.uplink) return fail('uplink.locked');
  if (officeLocked(core)) return fail('inhouse');
  if (officeUplinkOf(core.office, env)) return fail('uplink.placed');
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return fail('tile');
  const office = core.office;
  const reason = officePlaceReason(office.furniture, office.nodes, 'uplink', x, y, map, env);
  if (reason) return fail(reason);
  const node: NetNode = { uid: OFFICE_UPLINK_UID, device: 'uplink', macSerial: nextMacSerial(office.nodes), x, y, locked: true, configLocked: true, interfaces: [], gateway: null, routes: [], services: [], ports: [] };
  return { ok: true, core: { ...core, office: { ...office, nodes: [...office.nodes, node] } } };
};

// 回線終端の位置を変更する。つながるケーブルは moveNode と同じく引き直し、その差額に加えて移設の費用を支払う
export const moveOfficeUplink = (core: Core, x: number, y: number, map: GameMap, env: Env, balance: Balance): Outcome => {
  const uplink = officeUplinkOf(core.office, env);
  if (!uplink) return fail('none');
  if (x === uplink.x && y === uplink.y) return { ok: true, core };
  const cost = balance.office.uplinkMoveCost;
  if (core.clock.money < cost) return fail('money');
  const setLocked = (c: Core, locked: boolean): Core => ({
    ...c,
    office: { ...c.office, nodes: c.office.nodes.map((n) => (n.uid === uplink.uid ? { ...n, locked } : n)) },
  });
  const moved = moveNode(setLocked(core, false), uplink.uid, x, y, env, 'office', map);
  if (!moved.ok) return moved;
  if (moved.core.clock.money < cost) return fail('money');
  const next = setLocked(moved.core, true);
  return { ok: true, core: { ...next, clock: applyMoney(next.clock, -cost, 'construction') } };
};
