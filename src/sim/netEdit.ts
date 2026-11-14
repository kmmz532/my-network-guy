import { renameNode } from '../network/nodeName';
import type { OpFailReason } from './failReason';
import { inSubnet, ipToInt } from '../network/engine';
import { PREFIX_MAX, PREFIX_MIN, hostCapacity, networkAddress } from '../network/segments';
import { fillPlans } from '../network/query/plans';
import type { VrrpGroup } from '../network/vrrp';
import type { FirewallRule, Iface, IspLine, NetNode, PortConfig, Route, Service } from '../network/types';
import { WIRELESS_SECURITIES } from '../network/types';
import { makeIface, makeSvi } from '../network/iface';
import { can } from '../network/capabilities';
import { registries } from '../registry/game';
import { BgpOp, Project, ChannelOp, Core, DhcpOp, Env, NatOp, NetTarget, OspfOp, Outcome, PortModeChange, StpOp, VrrpOp, fail, netOf, planDomainAt, withNet, zoneFromNodes } from './project';
import { portCountOf } from '../registry/query';
import { analyze } from '../network/engine/analyze';
import type { NetworkState } from '../network/engine/state';
import type { GameMap } from '../data/schema';
import { engineWithWalls } from './walls';

// 機器の設定を書き換える。配線の設定が固定された機器は変えられない。
const editNode = (core: Core, uid: string, edit: (n: NetNode) => NetNode | OpFailReason, target: NetTarget = 'focus'): Outcome => {
  const net = netOf(core, target);
  if (typeof net === 'string') return fail(net);
  const node = net.nodes.find((n) => n.uid === uid);
  if (!node) return fail('none');
  if (node.configLocked) return fail('locked');
  const result = edit(node);
  if (typeof result === 'string') return fail(result);
  return { ok: true, core: withNet(core, target, { ...net, nodes: net.nodes.map((n) => (n.uid === uid ? result : n)) }) };
};

// 機器の名前を付け直す。名前は見た目だけなので、設定が固定された機器でも変えられる。空なら既定の名前に戻す
// ホスト名を付ける（null で外す）。画面の名前（setName）とは別に持つ（N46）
export const setHostname = (core: Core, uid: string, hostname: string | null, target: NetTarget = 'focus'): Outcome =>
  editNode(core, uid, (node) => ({ ...node, hostname: hostname ?? undefined }), target);

// ネームサーバー（ip name-server）を設定する。null で外す（N68）
export const setNameServer = (core: Core, uid: string, ip: string | null, target: NetTarget = 'focus'): Outcome =>
  editNode(core, uid, (node) => ({ ...node, nameServer: ip ?? undefined }), target);

// DNS の役割を付ける（zone は空から）。外すと表も消える（N68）
export const setDnsRole = (core: Core, uid: string, on: boolean, target: NetTarget = 'focus'): Outcome =>
  editNode(core, uid, (node) => ({ ...node, dns: on ? (node.dns ?? { zone: [] }) : undefined }), target);

// 「自動で登録する」: 対象のネットワークの機器から DNS の表を作り直す（DNS の役割のある機器だけ）
export const autoRegisterZone = (core: Core, uid: string, target: NetTarget = 'focus'): Outcome => {
  const net = netOf(core, target);
  if (typeof net === 'string') return fail(net);
  const zone = zoneFromNodes(net.nodes);
  return editNode(core, uid, (node) => (node.dns ? { ...node, dns: { zone } } : 'none'), target);
};

export const setName = (core: Core, uid: string, name: string, target: NetTarget = 'focus'): Outcome => {
  const net = netOf(core, target);
  if (typeof net === 'string') return fail(net);
  const node = net.nodes.find((n) => n.uid === uid);
  if (!node) return fail('none');
  const renamed = renameNode(node, name);
  if ((renamed.name ?? '') === (node.name ?? '')) return { ok: true, core };
  return { ok: true, core: withNet(core, target, { ...net, nodes: net.nodes.map((n) => (n.uid === uid ? renamed : n)) }) };
};

// 対応表に名前と IPアドレスを登録する（同じ名前があれば入れ替える）。名前は機器の中だけで有効
export const setHost = (core: Core, uid: string, name: string, ip: string, target: NetTarget = 'focus'): Outcome =>
  editNode(core, uid, (node) => ({ ...node, hosts: [...(node.hosts ?? []).filter((h) => h.name !== name), { name, ip }] }), target);

// 対応表から名前を消す。なければ none
export const removeHost = (core: Core, uid: string, name: string, target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => ((node.hosts ?? []).some((h) => h.name === name) ? { ...node, hosts: (node.hosts ?? []).filter((h) => h.name !== name) } : 'none'),
    target,
  );

// IPアドレスの書式（各区切りは 0〜255）
const isIp = (s: string): boolean => /^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split('.').every((n) => Number(n) <= 255);

// 「a.b.c.d/nn」（ネットワークの指定）
const isCidr = (s: string): boolean => {
  const [ip, prefix] = s.split('/');
  return prefix !== undefined && isIp(ip) && /^\d{1,2}$/.test(prefix) && Number(prefix) <= 32;
};

// ポートのIPアドレスを設定する。ip が空文字なら設定を外す（機器の IP は未設定に戻る）。
// そのポートのセグメントに設定がなければ、入力したアドレスのネットワークを設定にする（配線の後に入力した場合など）
export const setInterface = (
  core: Core,
  uid: string,
  port: number,
  ip: string,
  prefix: number,
  env: Env,
  target: NetTarget = 'focus',
): Outcome => {
  const net = netOf(core, target);
  if (typeof net === 'string') return fail(net);
  const node = net.nodes.find((n) => n.uid === uid);
  if (!node) return fail('none');
  if (node.configLocked) return fail('locked');
  if (ip !== '' && !isIp(ip)) return fail('ip');
  const interfaces: Iface[] =
    ip === ''
      ? node.interfaces.filter((i) => i.port !== port)
      : [...node.interfaces.filter((i) => i.port !== port), makeIface(node.device, port, ip, prefix)];
  const nodes = net.nodes.map((n) => (n.uid === uid ? { ...node, interfaces } : n));
  const plans = fillPlans(analyze({ nodes, links: net.links, plans: net.plans }, env.engine));
  return { ok: true, core: withNet(core, target, { ...net, nodes, plans }) };
};

// SVI（VLAN のインターフェース・N138）を設定する。ip が '' なら外す。SVI を持てるのは sviMax の機器だけ
export const setSvi = (core: Core, uid: string, vlan: number, ip: string, prefix: number, env: Env, target: NetTarget = 'focus'): Outcome => {
  const net = netOf(core, target);
  if (typeof net === 'string') return fail(net);
  const node = net.nodes.find((n) => n.uid === uid);
  if (!node) return fail('none');
  if (node.configLocked) return fail('locked');
  if (!can(node.device, 'svi')) return fail('svi.none');
  if (!Number.isInteger(vlan) || vlan < 1 || vlan > 4094) return fail('vlan.range');
  if (ip !== '' && !isIp(ip)) return fail('ip');
  const others = node.interfaces.filter((i) => !(i.kind === 'svi' && i.vlan === vlan));
  const interfaces: Iface[] = ip === '' ? others : [...others, makeSvi(vlan, ip, prefix)];
  if (interfaces.filter((i) => i.kind === 'svi').length > sviMaxOf(node.device)) return fail('svi.max');
  const nodes = net.nodes.map((n) => (n.uid === uid ? { ...node, interfaces } : n));
  const plans = fillPlans(analyze({ nodes, links: net.links, plans: net.plans }, env.engine));
  return { ok: true, core: withNet(core, target, { ...net, nodes, plans }) };
};

// 機器の SVI の上限（機器の定義の sviMax。持てない機器は 0）
export const sviMaxOf = (device: string): number => registries.devices.get(device).sviMax ?? 0;

// 口の VLAN（access）・トランク（trunk）か、ルーターの口（routed・no switchport）を設定する（N137・N138）
export const setPortMode = (
  core: Core,
  uid: string,
  port: number,
  mode: PortModeChange,
  target: NetTarget = 'focus',
): Outcome => {
  const net = netOf(core, target);
  if (typeof net === 'string') return fail(net);
  const node = net.nodes.find((n) => n.uid === uid);
  if (!node) return fail('none');
  if (node.configLocked) return fail('locked');
  if (!Number.isInteger(port) || port < 0 || port >= (portCountOf(node.device))) return fail('port.none');
  if (mode.kind === 'access') {
    if (!can(node.device, 'switchport')) return fail('port.mode');
    if (!Number.isInteger(mode.vlan) || mode.vlan < 1 || mode.vlan > 4094) return fail('vlan.range');
  } else if (mode.kind === 'trunk') {
    if (!can(node.device, 'switchport')) return fail('port.mode');
    const vlans = [...(mode.allowed ?? []), ...(mode.native === undefined ? [] : [mode.native])];
    if (vlans.some((v) => !Number.isInteger(v) || v < 1 || v > 4094)) return fail('vlan.range');
  } else if (!can(node.device, 'routedPort')) {
    return fail('port.mode');
  }
  const prev = (node.ports ?? []).find((p) => p.port === port);
  const prevTrunk = prev?.mode === 'trunk' ? prev : undefined;
  const next: PortConfig =
    mode.kind === 'access'
      ? { ...prev, port, mode: 'access', vlan: mode.vlan, allowed: undefined, native: undefined }
      : mode.kind === 'trunk'
        ? {
            ...prev,
            port,
            mode: 'trunk',
            vlan: undefined,
            allowed: mode.allowed === undefined ? prevTrunk?.allowed : (mode.allowed ?? undefined),
            native: mode.native ?? prevTrunk?.native,
          }
        : { ...prev, port, mode: 'routed', vlan: undefined, allowed: undefined, native: undefined };
  const ports = [...(node.ports ?? []).filter((p) => p.port !== port), next];
  const nodes = net.nodes.map((n) => (n.uid === uid ? { ...node, ports } : n));
  return { ok: true, core: withNet(core, target, { ...net, nodes }) };
};

// デフォルトゲートウェイを設定する。null で外す
// RIP・OSPF の参加（N141b・N142・N143）。network 文は、そのサブネットのインターフェースを参加させる。router rip / ospf は、参加を止める（on が false のとき全部）
export const setRouting = (core: Core, uid: string, change: { proto: 'rip' | 'ospf'; on: boolean; ip?: string; area?: number; process?: number | null }, target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      const touches = (i: Iface) => (change.ip === undefined ? true : inSubnet(change.ip, i.ip, i.prefix));
      const interfaces = node.interfaces.map((i) => {
        if (!touches(i)) return i;
        if (change.proto === 'rip') return { ...i, rip: change.on };
        return change.on ? { ...i, ospf: { ...i.ospf, area: change.area ?? i.ospf?.area ?? 0 } } : { ...i, ospf: undefined };
      });
      if (change.ip !== undefined && change.on && !node.interfaces.some(touches)) return 'iface.none';
      // OSPF の番号（process）は、指定があるときだけ書く（null で外す）
      const ospf = change.proto === 'ospf' && change.process !== undefined ? { ...node.ospf, process: change.process ?? undefined } : node.ospf;
      return { ...node, interfaces, ospf };
    },
    target,
  );

export const setOspf = (core: Core, uid: string, change: OspfOp, target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      if (change.op === 'iface') {
        const iface = node.interfaces.find((i) => i.id === change.id);
        if (!iface) return 'iface.none';
        if (iface.ospf === undefined) return 'ospf.not_joined';
        const ospf = { ...iface.ospf, [change.key]: change.value };
        return { ...node, interfaces: node.interfaces.map((i) => (i.id === change.id ? { ...i, ospf } : i)) };
      }
      const prev = node.ospf ?? {};
      const next = change.op === 'routerId' ? { ...prev, routerId: change.ip ?? undefined } : { ...prev, defaultOriginate: change.on };
      return { ...node, ospf: next };
    },
    target,
  );

// 機器の電源の入・切（障害の再現・VRRP の引き継ぎの確認に使う）。切った機器は、すべての口が停止したものとして扱う
export const setPower = (core: Core, uid: string, on: boolean, target: NetTarget = 'focus'): Outcome =>
  editNode(core, uid, (node) => ({ ...node, powered: on ? undefined : false }), target);

export const setVrrp = (core: Core, uid: string, change: VrrpOp, target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      if (!can(node.device, 'vrrp')) return 'vrrp.unsupported';
      const iface = node.interfaces.find((i) => i.id === change.id);
      if (!iface) return 'iface.none';
      if (!Number.isInteger(change.vrid) || change.vrid < 1 || change.vrid > 255) return 'vrrp.vrid';
      const groups = iface.vrrp ?? [];
      const cur = groups.find((g) => g.vrid === change.vrid);
      let next: VrrpGroup[];
      if (change.op === 'ip') {
        if (!isIp(change.ip) || !inSubnet(change.ip, iface.ip, iface.prefix)) return 'vrrp.vip';
        next = cur ? groups.map((g) => (g.vrid === change.vrid ? { ...g, ip: change.ip } : g)) : [...groups, { vrid: change.vrid, ip: change.ip, priority: 100, preempt: true }];
      } else if (change.op === 'remove') {
        if (!cur) return 'vrrp.none';
        next = groups.filter((g) => g.vrid !== change.vrid);
      } else {
        if (!cur) return 'vrrp.none';
        if (change.op === 'priority' && (!Number.isInteger(change.value) || change.value < 1 || change.value > 254)) return 'vrrp.priority';
        if (change.op === 'track' && (!Number.isInteger(change.decrement) || change.decrement < 1 || change.decrement > 253 || !node.interfaces.some((i) => i.id === change.iface))) return 'vrrp.track';
        next = groups.map((g) =>
          g.vrid !== change.vrid
            ? g
            : change.op === 'priority'
              ? { ...g, priority: change.value }
              : change.op === 'preempt'
                ? { ...g, preempt: change.on }
                : { ...g, track: [...(g.track ?? []).filter((t) => t.iface !== change.iface), { iface: change.iface, decrement: change.decrement }] },
        );
      }
      return { ...node, interfaces: node.interfaces.map((i) => (i.id === change.id ? { ...i, vrrp: next.length > 0 ? next : undefined } : i)) };
    },
    target,
  );

export const setStp = (core: Core, uid: string, change: StpOp, target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      if (!can(node.device, 'stp')) return 'port.mode';
      if (change.op === 'priority') {
        if (!Number.isInteger(change.value) || change.value < 0 || change.value > 61440 || change.value % 4096 !== 0) return 'stp.priority';
        return { ...node, stpPriority: change.value };
      }
      if (!Number.isInteger(change.value) || change.value < 1) return 'stp.cost';
      const prev = node.ports.find((p) => p.port === change.port);
      const next: PortConfig = { mode: 'access', ...prev, port: change.port, stpCost: change.value };
      return { ...node, ports: [...node.ports.filter((p) => p.port !== change.port), next] };
    },
    target,
  );

export const setDhcp = (core: Core, uid: string, change: DhcpOp, target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      const portOk = (port: number) => Number.isInteger(port) && port >= 0 && port < (portCountOf(node.device));
      if (change.op === 'client') {
        if (!portOk(change.port)) return 'port.none';
        if (can(node.device, 'switchport') && !can(node.device, 'routedPort')) return 'dhcp.unsupported';
        const others = node.interfaces.filter((i) => i.port !== change.port);
        return { ...node, interfaces: [...others, { ...makeIface(node.device, change.port, '0.0.0.0', 24), dhcp: true }] };
      }
      if (change.op === 'helper') {
        if (!can(node.device, 'dhcpRelay')) return 'dhcp.unsupported';
        const iface = node.interfaces.find((i) => i.port === change.port && i.dhcp !== true);
        if (!iface) return 'iface.none';
        if (change.ip !== null && !isIp(change.ip)) return 'ip';
        return { ...node, interfaces: node.interfaces.map((i) => (i === iface ? { ...i, helper: change.ip ?? undefined } : i)) };
      }
      if (!can(node.device, 'services')) return 'dhcp.unsupported';
      if (change.op === 'noPool') {
        const next = (node.dhcpPools ?? []).filter((p) => p.network !== change.network);
        return { ...node, dhcpPools: next.length > 0 ? next : undefined };
      }
      const p = change.pool;
      if (![p.network, p.start, p.end].every(isIp) || ipToInt(p.start) > ipToInt(p.end) || !inSubnet(p.start, p.network, p.prefix) || !inSubnet(p.end, p.network, p.prefix)) return 'dhcp.pool';
      if ((p.gateway !== undefined && !isIp(p.gateway)) || (p.dns !== undefined && !isIp(p.dns))) return 'dhcp.pool';
      if ((p.excluded ?? []).some((r) => ![r.start, r.end].every(isIp) || ipToInt(r.start) > ipToInt(r.end))) return 'dhcp.pool';
      return { ...node, dhcpPools: [...(node.dhcpPools ?? []).filter((x) => x.network !== p.network), p] };
    },
    target,
  );

export const setChannel = (core: Core, uid: string, change: ChannelOp, target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      if (!can(node.device, 'lag')) return 'lag.unsupported';
      if (!Number.isInteger(change.port) || change.port < 0 || change.port >= (portCountOf(node.device))) return 'port.none';
      const prev = node.ports.find((p) => p.port === change.port);
      const base: PortConfig = prev ?? { port: change.port, mode: can(node.device, 'switchport') ? 'access' : 'routed' };
      if (change.group === null) {
        const { channelGroup: _group, lacp: _lacp, ...rest } = base;
        return { ...node, ports: [...node.ports.filter((p) => p.port !== change.port), rest] };
      }
      if (!Number.isInteger(change.group) || change.group < 1 || change.group > 64 || change.lacp === undefined) return 'lag.group';
      return { ...node, ports: [...node.ports.filter((p) => p.port !== change.port), { ...base, channelGroup: change.group, lacp: change.lacp }] };
    },
    target,
  );

// 回線終端の回線の情報（ISP の名前・アドレス・AS 番号）。回線終端だけに設定できる
export const setIsp = (core: Core, uid: string, line: IspLine, target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      if (!isIp(line.ispIp)) return 'ip';
      return { ...node, isp: line };
    },
    target,
  );

// 無線の設定（N151）。SSID・パスワード・チャネル・VLAN
export const setWireless = (core: Core, uid: string, key: 'ssid' | 'password' | 'channel' | 'vlan' | 'security', value: string | number, target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      if (key === 'security' && !(WIRELESS_SECURITIES as readonly unknown[]).includes(value)) return 'wireless.security';
      return { ...node, wireless: { ...(node.wireless ?? {}), [key]: value } };
    },
    target,
  );

export const setNat = (core: Core, uid: string, change: NatOp, target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      switch (change.op) {
        case 'iface': {
          if (!node.interfaces.some((i) => i.id === change.id)) return 'iface.none';
          return { ...node, interfaces: node.interfaces.map((i) => (i.id === change.id ? { ...i, nat: change.nat ?? undefined } : i)) };
        }
        case 'napt':
          return { ...node, napt: change.on || undefined };
        case 'static':
          return { ...node, statics: [...(node.statics ?? []).filter((s) => s.port !== change.port), { port: change.port, insideIp: change.insideIp, insidePort: change.insidePort }] };
        case 'noStatic':
          return { ...node, statics: (node.statics ?? []).filter((s) => s.port !== change.port) };
      }
    },
    target,
  );

export const setBgp = (core: Core, uid: string, change: BgpOp, target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      const cur = node.bgp ?? { asn: 0, neighbors: [], networks: [] };
      switch (change.op) {
        case 'asn':
          return { ...node, bgp: { ...cur, asn: change.asn } };
        case 'off':
          return { ...node, bgp: undefined };
        case 'neighbor':
          return { ...node, bgp: { ...cur, neighbors: [...cur.neighbors.filter((n) => n.ip !== change.ip), { ...cur.neighbors.find((n) => n.ip === change.ip), ip: change.ip, remoteAs: change.remoteAs }] } };
        case 'removeNeighbor':
          return { ...node, bgp: { ...cur, neighbors: cur.neighbors.filter((n) => n.ip !== change.ip) } };
        case 'removeNetwork':
          return { ...node, bgp: { ...cur, networks: cur.networks.filter((n) => !(n.dest === change.dest && n.prefix === change.prefix)) } };
        case 'attr': {
          if (!cur.neighbors.some((n) => n.ip === change.ip)) return 'bgp.no_neighbor';
          return { ...node, bgp: { ...cur, neighbors: cur.neighbors.map((n) => (n.ip === change.ip ? { ...n, [change.key]: change.value } : n)) } };
        }
        case 'network':
          return { ...node, bgp: { ...cur, networks: [...cur.networks.filter((n) => !(n.dest === change.dest && n.prefix === change.prefix)), { dest: change.dest, prefix: change.prefix }] } };
      }
    },
    target,
  );

export const setGateway = (core: Core, uid: string, gateway: string | null, target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      if (gateway !== null && !isIp(gateway)) return 'ip';
      return { ...node, gateway };
    },
    target,
  );

// ファイアウォールの規則を置き換える（N38）。規則の送信元・宛先は 'any' か「a.b.c.d/nn」。一覧にない通信は通さない
export const setFirewallRules = (core: Core, uid: string, rules: FirewallRule[], target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      for (const r of rules) {
        if (r.src !== 'any' && !isCidr(r.src)) return 'ip';
        if (r.dst !== 'any' && !isCidr(r.dst)) return 'ip';
      }
      return { ...node, rules };
    },
    target,
  );

// ルーターに静的ルートを追加する
export const addRoute = (core: Core, uid: string, route: Route, target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      if (!isIp(route.dest) || !isIp(route.nextHop)) return 'ip';
      return { ...node, routes: [...node.routes, route] };
    },
    target,
  );

// ルーターの静的ルートを削除する
export const removeRoute = (core: Core, uid: string, index: number, target: NetTarget = 'focus'): Outcome =>
  editNode(core, uid, (node) => ({ ...node, routes: node.routes.filter((_, i) => i !== index) }), target);

// サービスの既定の待ち受けポート（プロトコルごと）。起動するときに使う
const DEFAULT_SERVICE_PORT: Record<Service['protocol'], number> = { http: 80 };

// サービスを起動する（on）または停止する（off）。配線の設定が固定された機器は変えられない
export const setService = (
  core: Core,
  uid: string,
  protocol: Service['protocol'],
  on: boolean,
  target: NetTarget = 'focus',
): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      const others = node.services.filter((s) => s.protocol !== protocol);
      if (!on) return { ...node, services: others };
      const current = node.services.find((s) => s.protocol === protocol);
      return { ...node, services: [...others, current ?? { protocol, port: DEFAULT_SERVICE_PORT[protocol] }] };
    },
    target,
  );

// 機器の口が属する L2 ドメインのアドレスの計画を設定する。計画だけを行い、機器のアドレスは変えない（未設定のアドレスは IPアドレスの自動割り当て autoAssign が振る）。
// 案件で設定が固定された機器を含むドメインは変えられない。
// 対象は、機器の口が属する L2 ドメイン（無線の端末は、つながるアクセスポイントのドメイン。配線がなければ none）
export const setPlan = (
  core: Core,
  uid: string,
  port: number,
  network: string,
  prefix: number,
  env: Env,
  target: NetTarget = 'focus',
): Outcome => {
  const net = netOf(core, target);
  if (typeof net === 'string') return fail(net);
  const domain = planDomainAt(net, env, uid, port);
  if (!domain) return fail('none');
  const byUid = new Map(net.nodes.map((n) => [n.uid, n]));
  if (domain.members.some((m) => byUid.get(m.node)?.configLocked)) return fail('locked');
  if (!isIp(network) || prefix < PREFIX_MIN || prefix > PREFIX_MAX || networkAddress(network, prefix) !== network) return fail('ip');
  if (domain.members.length > hostCapacity(prefix)) return fail('segment.too_small');
  const plans = { ...net.plans, [domain.key]: { network, prefix } };
  return { ok: true, core: withNet(core, target, { ...net, plans }) };
};

// 機器の並びの計算の結果（自社オフィスと、設計中の案件）。核の状態が変わるたびに、ストアがこの関数で求め直す
export const analyzeCore = (
  core: Pick<Core, 'office' | 'active' | 'focus'> & { showcase?: Project | null },
  env: Env,
  maps: Record<string, GameMap>,
): { office: NetworkState; focus: NetworkState | null; showcase: NetworkState | null } => {
  const office = analyze(
    { nodes: core.office.nodes, links: core.office.links, plans: core.office.plans },
    engineWithWalls(env.engine, maps.hq),
  );
  const p = core.focus === null ? null : (core.active.find((q) => q.id === core.focus) ?? null);
  const focus = p === null ? null : analyze(
    { nodes: p.nodes, links: p.links, plans: p.plans },
    engineWithWalls(env.engine, maps[p.contract.map]),
  );
  const q = core.showcase ?? null;
  const showcase = q === null ? null : analyze({ nodes: q.nodes, links: q.links, plans: q.plans }, engineWithWalls(env.engine, maps[q.contract.map]));
  return { office, focus, showcase };
};
