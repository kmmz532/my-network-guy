import { renameNode } from '../network/nodeName';
import { isMac } from '../network/mac';
import type { OpFailReason } from './failReason';
import { inSubnet, ipToInt } from '../network/engine';
import { inWildcard } from '../network/ip';
import { PREFIX_MAX, PREFIX_MIN, hostCapacity, networkAddress } from '../network/segments';
import { fillPlans } from '../network/query/plans';
import type { VrrpGroup } from '../network/vrrp';
import type { DnsRecord, DnsService, FirewallRule, Iface, IspLine, NetNode, PortConfig, Route } from '../network/types';
import { MTU_MAX, MTU_MIN, WIRELESS_SECURITIES } from '../network/types';
import { makeIface, makePo, makeSvi } from '../network/iface';
import { refusalFor } from './capabilityGate';
import { getComponent, withComponent } from '../network/components';
import type { Components } from '../network/components';
import { can } from '../network/capabilities';
import { bandChannels, deviceBands } from '../registry/wireless';
import { bandOf } from '../network/wirelessBand';
import type { WirelessBand } from '../data/schema';
import { registries } from '../registry/game';
import { BgpOp, Project, ChannelOp, Core, DhcpOp, Env, NatOp, NetTarget, OspfOp, Outcome, PortModeChange, MacListOp, StpOp, VrrpOp, fail, netOf, planDomainAt, withNet, zoneFromNodes } from './project';
import { deviceDef, portCountOf } from '../registry/query';
import { analyze } from '../network/engine/analyze';
import type { NetworkState } from '../network/engine/state';
import type { GameMap } from '../data/schema';
import { engineWithSite, siteFurnitureOf } from './walls';

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
  editNode(core, uid, (node) => withComponent(node, 'resolver', { ...getComponent(node, 'resolver'), nameServer: ip ?? undefined }), target);

// 端末のメールサーバーのアドレス（メールソフトの設定）。null で外す。外すと、mailClient ごと外す
export const setMailServer = (core: Core, uid: string, ip: string | null, target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      if (ip === null) {
        const { mailClient: _removed, ...rest } = node.components ?? {};
        return { ...node, components: Object.keys(rest).length > 0 ? rest : undefined };
      }
      if (!isIp(ip)) return 'ip';
      return withComponent(node, 'mailClient', { server: ip });
    },
    target,
  );

// メールサーバーのサービスを動かし、受け持つメールのドメインを設定する。null で止める（サービスごと外す）
export const setMailDomain = (core: Core, uid: string, domain: string | null, target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      const others = node.services.filter((s) => s.protocol !== 'mail');
      if (domain === null) return { ...node, services: others };
      if (!/^[^@\s]+$/.test(domain)) return 'mail.domain';
      return { ...node, services: [...others, { protocol: 'mail', domain }] };
    },
    target,
  );

// 端末のプロキシの設定（ブラウザの設定）。null で外す。proxyClient が空になれば、コンポーネントごと外す
const setProxyClient = (core: Core, uid: string, edit: (cur: NonNullable<Components['proxyClient']>) => NonNullable<Components['proxyClient']> | OpFailReason, target: NetTarget): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      const next = edit(getComponent(node, 'proxyClient') ?? {});
      if (typeof next === 'string') return next;
      if (next.proxy === undefined && next.pac === undefined) {
        const { proxyClient: _removed, ...rest } = node.components ?? {};
        return { ...node, components: Object.keys(rest).length > 0 ? rest : undefined };
      }
      return withComponent(node, 'proxyClient', next);
    },
    target,
  );

// プロキシのアドレスとポートを設定する。null で外す（PAC は残す）
export const setProxy = (core: Core, uid: string, proxy: { ip: string; port: number } | null, target: NetTarget = 'focus'): Outcome =>
  setProxyClient(
    core,
    uid,
    (cur) => {
      if (proxy === null) {
        const { proxy: _old, ...rest } = cur;
        return rest;
      }
      if (!isIp(proxy.ip)) return 'ip';
      if (!Number.isInteger(proxy.port) || proxy.port < 1 || proxy.port > 65535) return 'port.none';
      return { ...cur, proxy };
    },
    target,
  );

// PAC の direct（プロキシを通さず直接つなぐ名前の接尾辞の一覧）を設定する。null か空の一覧で外す（プロキシは残す）
export const setPac = (core: Core, uid: string, direct: string[] | null, target: NetTarget = 'focus'): Outcome =>
  setProxyClient(
    core,
    uid,
    (cur) => {
      const { pac: _old, ...rest } = cur;
      return direct === null || direct.length === 0 ? rest : { ...rest, pac: { direct } };
    },
    target,
  );

// DNS のサービスを動かす（起動は権威で、ゾーンは空から。role で役割を選ぶ）。止めるとゾーンも消える（N68）。動いているときは role だけを変え、ゾーンと転送先は残す
export const setDnsRole = (core: Core, uid: string, on: boolean, target: NetTarget = 'focus', role?: 'auth' | 'cache'): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      const others = node.services.filter((s) => s.protocol !== 'dns');
      if (!on) return { ...node, services: others };
      const current = node.services.find((s): s is DnsService => s.protocol === 'dns');
      const next: DnsService = current ? { ...current, role: role ?? current.role } : { protocol: 'dns', role: role ?? 'auth', zone: [] };
      return { ...node, services: [...others, next] };
    },
    target,
  );

// 転送先（キャッシュの問い合わせを渡す DNS の IPアドレス）を設定する。null で外す。DNS のサービスが動いていなければ none
export const setDnsForwarder = (core: Core, uid: string, ip: string | null, target: NetTarget = 'focus'): Outcome => {
  if (ip !== null && !isIp(ip)) return fail('ip');
  return editNode(
    core,
    uid,
    (node) => {
      const current = node.services.find((s): s is DnsService => s.protocol === 'dns');
      if (!current) return 'none';
      const { forwarder: _old, ...rest } = current;
      const next: DnsService = ip === null ? rest : { ...rest, forwarder: ip };
      return { ...node, services: node.services.map((s) => (s === current ? next : s)) };
    },
    target,
  );
};

// ゾーンの記録を1件入れる（同じ種類と名前があれば入れ替える）。DNS のサービスが動いていなければ none
export const setDnsRecord = (core: Core, uid: string, record: DnsRecord, target: NetTarget = 'focus'): Outcome => {
  if (!isRecordValue(record)) return fail('ip');
  return editNode(
    core,
    uid,
    (node) => {
      const current = node.services.find((s): s is DnsService => s.protocol === 'dns');
      if (!current) return 'none';
      const zone = [...current.zone.filter((r) => !(r.type === record.type && r.name === record.name)), record];
      return { ...node, services: node.services.map((s) => (s === current ? { ...current, zone } : s)) };
    },
    target,
  );
};

// ゾーンの記録を消す（種類と名前で指定）。なければ none
export const removeDnsRecord = (core: Core, uid: string, type: DnsRecord['type'], name: string, target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      const current = node.services.find((s): s is DnsService => s.protocol === 'dns');
      if (!current || !current.zone.some((r) => r.type === type && r.name === name)) return 'none';
      const zone = current.zone.filter((r) => !(r.type === type && r.name === name));
      return { ...node, services: node.services.map((s) => (s === current ? { ...current, zone } : s)) };
    },
    target,
  );

// 「自動で登録する」: 対象のネットワークの機器から DNS の表を作り直す（DNS の役割のある機器だけ）
export const autoRegisterZone = (core: Core, uid: string, target: NetTarget = 'focus'): Outcome => {
  const net = netOf(core, target);
  if (typeof net === 'string') return fail(net);
  const registered = zoneFromNodes(net.nodes).map((h): DnsRecord => ({ type: 'A', name: h.name, value: h.ip }));
  return editNode(
    core,
    uid,
    (node) => {
      const current = node.services.find((s): s is DnsService => s.protocol === 'dns');
      if (!current) return 'none';
      const zone = [...current.zone.filter((r) => r.type !== 'A'), ...registered];
      return { ...node, services: node.services.map((s) => (s === current ? { ...current, zone } : s)) };
    },
    target,
  );
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
  editNode(core, uid, (node) => withComponent(node, 'resolver', { ...getComponent(node, 'resolver'), hosts: [...(getComponent(node, 'resolver')?.hosts ?? []).filter((h) => h.name !== name), { name, ip }] }), target);

// 対応表から名前を消す。なければ none
export const removeHost = (core: Core, uid: string, name: string, target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      const hosts = getComponent(node, 'resolver')?.hosts ?? [];
      return hosts.some((h) => h.name === name) ? withComponent(node, 'resolver', { ...getComponent(node, 'resolver'), hosts: hosts.filter((h) => h.name !== name) }) : 'none';
    },
    target,
  );

// IPアドレスの書式（各区切りは 0〜255）
const isIp = (s: string): boolean => /^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split('.').every((n) => Number(n) <= 255);

// 「a.b.c.d/nn」（ネットワークの指定）
const isCidr = (s: string): boolean => {
  const [ip, prefix] = s.split('/');
  return prefix !== undefined && isIp(ip) && /^\d{1,2}$/.test(prefix) && Number(prefix) <= 32;
};

// 記録の値の形: A は IPアドレス、MX は pref が 0 以上の整数。AAAA・名前の種類は値の形を問わない（値を返すだけ）
const isRecordValue = (r: DnsRecord): boolean => {
  if (r.name === '' || r.value === '') return false;
  if (r.type === 'A') return isIp(r.value);
  if (r.type === 'MX') return r.pref === undefined || (Number.isInteger(r.pref) && r.pref >= 0);
  return r.pref === undefined;
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
  // 束ねたメンバーの口は IP を持たない（IP は Po に設定する）
  if (ip !== '' && node.ports.some((p) => p.port === port && p.channelGroup !== undefined)) return fail('po.member_has_ip');
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
  const refusal = refusalFor(node.device, 'svi');
  if (refusal) return fail(refusal);
  if (!Number.isInteger(vlan) || vlan < 1 || vlan > 4094) return fail('vlan.range');
  if (ip !== '' && !isIp(ip)) return fail('ip');
  const others = node.interfaces.filter((i) => !(i.kind === 'svi' && i.vlan === vlan));
  const interfaces: Iface[] = ip === '' ? others : [...others, makeSvi(vlan, ip, prefix)];
  if (interfaces.filter((i) => i.kind === 'svi').length > sviMaxOf(node.device)) return fail('svi.max');
  const nodes = net.nodes.map((n) => (n.uid === uid ? { ...node, interfaces } : n));
  const plans = fillPlans(analyze({ nodes, links: net.links, plans: net.plans }, env.engine));
  return { ok: true, core: withNet(core, target, { ...net, nodes, plans }) };
};

// 束ねた口（Po・ポートチャネルのインターフェース）の IP を設定する。ip が '' なら外す。Po を持てるのは、リンクアグリゲーションと routed の口の両方を持つ機器だけ
export const setPo = (core: Core, uid: string, channel: number, ip: string, prefix: number, env: Env, target: NetTarget = 'focus'): Outcome => {
  const net = netOf(core, target);
  if (typeof net === 'string') return fail(net);
  const node = net.nodes.find((n) => n.uid === uid);
  if (!node) return fail('none');
  if (node.configLocked) return fail('locked');
  const refusal = refusalFor(node.device, 'lag') ?? refusalFor(node.device, 'routedPort');
  if (refusal) return fail(refusal);
  if (!Number.isInteger(channel) || channel < 1 || channel > 64) return fail('lag.group');
  if (ip !== '' && !isIp(ip)) return fail('ip');
  const others = node.interfaces.filter((i) => !(i.kind === 'po' && i.channel === channel));
  const interfaces: Iface[] = ip === '' ? others : [...others, makePo(channel, ip, prefix)];
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
  const refusal = refusalFor(node.device, mode.kind === 'routed' ? 'routedPort' : 'switchport');
  if (refusal) return fail(refusal);
  if (mode.kind === 'access') {
    if (!Number.isInteger(mode.vlan) || mode.vlan < 1 || mode.vlan > 4094) return fail('vlan.range');
  } else if (mode.kind === 'trunk') {
    const vlans = [...(mode.allowed ?? []), ...(mode.native === undefined ? [] : [mode.native])];
    if (vlans.some((v) => !Number.isInteger(v) || v < 1 || v > 4094)) return fail('vlan.range');
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
// RIP・OSPF の参加。RIP の network 文は、そのサブネットの口を参加させる。OSPF の network 文は、口のアドレスが prefix とワイルドカードで一致する口を、その文の area で参加させ、文を記録する。router rip / ospf は、参加を止める（on が false のとき全部）
export const setRouting = (core: Core, uid: string, change: { proto: 'rip' | 'ospf'; on: boolean; ip?: string; wildcard?: string; area?: number; process?: number | null }, target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      if (change.proto === 'ospf' && change.ip !== undefined && change.wildcard === undefined) throw new Error('OSPF の network 文にワイルドカードがない');
      const touches = (i: Iface) => {
        if (change.ip === undefined) return true;
        if (change.proto === 'ospf') return i.ip !== '' && inWildcard(i.ip, change.ip, change.wildcard!);
        return inSubnet(change.ip, i.ip, i.prefix);
      };
      const interfaces = node.interfaces.map((i) => {
        if (!touches(i)) return i;
        if (change.proto === 'rip') return { ...i, rip: change.on };
        return change.on ? { ...i, ospf: { ...i.ospf, area: change.area ?? i.ospf?.area ?? 0 } } : { ...i, ospf: undefined };
      });
      if (change.ip !== undefined && change.on && !node.interfaces.some(touches)) return 'iface.none';
      if (change.proto !== 'ospf') return { ...node, interfaces };
      const prev = getComponent(node, 'ospf');
      const statementOf = (n: { prefix: string; wildcard: string }) => n.prefix === change.ip && n.wildcard === change.wildcard;
      let networks = prev?.networks;
      if (change.ip === undefined) {
        if (!change.on) networks = undefined;
      } else if (change.on) {
        networks = [...(networks ?? []).filter((n) => !statementOf(n)), { prefix: change.ip, wildcard: change.wildcard!, area: change.area ?? 0 }];
      } else {
        // 止めた口に当たる文を外す
        const stopped = node.interfaces.filter(touches);
        networks = networks?.filter((n) => !stopped.some((i) => i.ip !== '' && inWildcard(i.ip, n.prefix, n.wildcard)));
      }
      const process = change.process === undefined ? prev?.process : (change.process ?? undefined);
      if (prev === undefined && networks === undefined && change.process === undefined) return { ...node, interfaces };
      return refusalFor(node.device, 'ospf') ?? withComponent({ ...node, interfaces }, 'ospf', { ...prev, process, networks });
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
      const refusal = refusalFor(node.device, 'ospf');
      if (refusal) return refusal;
      const prev = getComponent(node, 'ospf') ?? {};
      if (change.op === 'routerId') return withComponent(node, 'ospf', { ...prev, routerId: change.ip ?? undefined });
      if (change.op === 'referenceBandwidth') return withComponent(node, 'ospf', { ...prev, referenceBandwidth: change.mbps ?? undefined });
      return withComponent(node, 'ospf', { ...prev, defaultOriginate: change.on });
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
      const refusal = refusalFor(node.device, 'vrrp');
      if (refusal) return refusal;
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

// 口の MTU と adjust-mss。値が null なら設定を消す（MTU は既定の 1500 に戻る）。範囲の外は拒否する
export const setIfaceTune = (core: Core, uid: string, port: number, key: 'mtu' | 'adjustMss', value: number | null, target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      const iface = node.interfaces.find((i) => i.port === port && i.kind === 'port');
      if (!iface) return 'iface.none';
      if (value !== null) {
        if (key === 'mtu' && (!Number.isInteger(value) || value < MTU_MIN || value > MTU_MAX)) return 'mtu.range';
        if (key === 'adjustMss' && (!Number.isInteger(value) || value < MTU_MIN - 40 || value > MTU_MAX - 40)) return 'mtu.mss_range';
      }
      return { ...node, interfaces: node.interfaces.map((i) => (i === iface ? { ...i, [key]: value ?? undefined } : i)) };
    },
    target,
  );

// 口の QoS（出口の並べ方 qos・入口のマーキングの信頼 trust）。none・false は設定を消す。設定のない口は、機器の既定のモードで作る
export const setPortQos = (core: Core, uid: string, port: number, change: { qos: 'none' | 'priority' } | { trust: boolean }, target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      if (!Number.isInteger(port) || port < 0 || port >= portCountOf(node.device)) return 'port.none';
      const prev = node.ports.find((p) => p.port === port);
      const base: PortConfig = prev ?? { port, mode: refusalFor(node.device, 'switchport') === null ? 'access' : 'routed' };
      const next: PortConfig = 'qos' in change ? { ...base, qos: change.qos === 'priority' ? 'priority' : undefined } : { ...base, trust: change.trust ? true : undefined };
      return { ...node, ports: [...node.ports.filter((p) => p.port !== port), next] };
    },
    target,
  );

// MAC アドレスの登録の一覧を操作する。on は空の一覧で始め（どの機器も通さない）、off は一覧を消す（制限しない）。
// add・remove は1つを登録・解除する（大文字は小文字にそろえ、同じものは重ねない）。add は一覧がなければ始める
const nextMacs = (current: string[] | undefined, change: MacListOp): string[] | undefined | 'mac.format' => {
  if (change.op === 'on') return current ?? [];
  if (change.op === 'off') return undefined;
  const mac = change.mac.toLowerCase();
  if (!isMac(mac)) return 'mac.format';
  const list = current ?? [];
  return change.op === 'add' ? (list.includes(mac) ? list : [...list, mac]) : list.filter((m) => m !== mac);
};

// 無線の MAC フィルター（アクセスポイントだけ。N153）。一覧の操作はポートセキュリティと同じ
export const setWirelessMacs = (core: Core, uid: string, change: MacListOp, target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      const refusal = refusalFor(node.device, 'accessPoint');
      if (refusal) return refusal;
      const cur = getComponent(node, 'wireless') ?? {};
      const macs = nextMacs(cur.macs, change);
      if (macs === 'mac.format') return macs;
      const { macs: _old, ...rest } = cur;
      return withComponent(node, 'wireless', macs === undefined ? rest : { ...rest, macs });
    },
    target,
  );

// ポートセキュリティ（N153）。on は登録の一覧を空で始める（どの機器も通さない）、off は制限を外す。
// add・remove は MAC アドレスを1つ登録・解除する。add は制限のない口なら制限を始める。L2 の口を持たない機器は拒む
export const setPortSecurity = (core: Core, uid: string, port: number, change: MacListOp, target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      const refusal = refusalFor(node.device, 'switchport');
      if (refusal) return refusal;
      if (!Number.isInteger(port) || port < 0 || port >= portCountOf(node.device)) return 'port.none';
      const prev = node.ports.find((p) => p.port === port);
      const base: PortConfig = prev ?? { port, mode: 'access' };
      const macs = nextMacs(base.macs, change);
      if (macs === 'mac.format') return macs;
      const next: PortConfig = { ...base, macs };
      if (macs === undefined) delete next.macs;
      return { ...node, ports: [...node.ports.filter((p) => p.port !== port), next] };
    },
    target,
  );

export const setStp = (core: Core, uid: string, change: StpOp, target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      const refusal = refusalFor(node.device, 'stp');
      if (refusal) return refusal;
      if (change.op === 'priority') {
        if (!Number.isInteger(change.value) || change.value < 0 || change.value > 61440 || change.value % 4096 !== 0) return 'stp.priority';
        return withComponent(node, 'stp', { priority: change.value });
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
        if (refusalFor(node.device, 'switchport') === null && refusalFor(node.device, 'routedPort') !== null) return 'dhcp.unsupported';
        const others = node.interfaces.filter((i) => i.port !== change.port);
        return { ...node, interfaces: [...others, { ...makeIface(node.device, change.port, '0.0.0.0', 24), dhcp: true }] };
      }
      if (change.op === 'helper') {
        const refusal = refusalFor(node.device, 'dhcpRelay');
        if (refusal) return refusal;
        const iface = node.interfaces.find((i) => i.port === change.port && i.dhcp !== true);
        if (!iface) return 'iface.none';
        if (change.ip !== null && !isIp(change.ip)) return 'ip';
        return { ...node, interfaces: node.interfaces.map((i) => (i === iface ? { ...i, helper: change.ip ?? undefined } : i)) };
      }
      const refusal = refusalFor(node.device, 'services');
      if (refusal) return refusal;
      if (change.op === 'noPool') {
        const next = (getComponent(node, 'dhcpServer') ?? []).filter((p) => p.network !== change.network);
        return { ...node, components: { ...node.components, dhcpServer: next.length > 0 ? next : undefined } };
      }
      const p = change.pool;
      if (![p.network, p.start, p.end].every(isIp) || ipToInt(p.start) > ipToInt(p.end) || !inSubnet(p.start, p.network, p.prefix) || !inSubnet(p.end, p.network, p.prefix)) return 'dhcp.pool';
      if ((p.gateway !== undefined && !isIp(p.gateway)) || (p.dns !== undefined && !isIp(p.dns))) return 'dhcp.pool';
      if ((p.excluded ?? []).some((r) => ![r.start, r.end].every(isIp) || ipToInt(r.start) > ipToInt(r.end))) return 'dhcp.pool';
      return withComponent(node, 'dhcpServer', [...(getComponent(node, 'dhcpServer') ?? []).filter((x) => x.network !== p.network), p]);
    },
    target,
  );

export const setChannel = (core: Core, uid: string, change: ChannelOp, target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      const refusal = refusalFor(node.device, 'lag');
      if (refusal) return refusal;
      if (!Number.isInteger(change.port) || change.port < 0 || change.port >= (portCountOf(node.device))) return 'port.none';
      const prev = node.ports.find((p) => p.port === change.port);
      const base: PortConfig = prev ?? { port: change.port, mode: refusalFor(node.device, 'switchport') === null ? 'access' : 'routed' };
      if (change.group === null) {
        const { channelGroup: _group, lacp: _lacp, ...rest } = base;
        return { ...node, ports: [...node.ports.filter((p) => p.port !== change.port), rest] };
      }
      if (!Number.isInteger(change.group) || change.group < 1 || change.group > 64 || change.lacp === undefined) return 'lag.group';
      if (node.interfaces.some((i) => i.port === change.port)) return 'po.member_has_ip';
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
      const refusal = refusalFor(node.device, 'wan');
      if (refusal) return refusal;
      if (!isIp(line.ispIp)) return 'ip';
      return withComponent(node, 'isp', line);
    },
    target,
  );

// 無線の設定（N151）。SSID・パスワード・帯・チャネル・VLAN。帯は機器が選べるものだけ、チャネルは帯で選べるものだけ。帯を変えて今のチャネルが新しい帯で選べないときは、チャネルの設定を外す（帯の既定のチャネルになる）
export const setWireless = (core: Core, uid: string, key: 'ssid' | 'password' | 'band' | 'channel' | 'vlan' | 'security' | 'radius', value: string | number | null, target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      const refusal = refusalFor(node.device, 'wireless');
      if (refusal) return refusal;
      if (key === 'security' && !(WIRELESS_SECURITIES as readonly unknown[]).includes(value)) return 'wireless.security';
      // アクセスポイントは、機器が選べる方式だけ（家庭用ルーターは 802.1X を選べない）
      if (key === 'security' && can(node.device, 'accessPoint') && !(deviceDef(node.device).wlan?.security as readonly unknown[] | undefined)?.includes(value)) return 'wireless.security';
      // RADIUS のアドレスは、アクセスポイントだけが持つ。null なら外す（無線の設定から radius の鍵を消す）
      if (key === 'radius' && !can(node.device, 'accessPoint')) return 'ip';
      if (value === null && key !== 'radius') throw new Error(`無線の ${key} に null は渡せない（外せるのは radius だけ）`);
      const cur = getComponent(node, 'wireless');
      if (key === 'radius' && value === null) {
        const { radius: _old, ...rest } = cur ?? {};
        return withComponent(node, 'wireless', rest);
      }
      if (key === 'radius' && (typeof value !== 'string' || !isIp(value))) return 'ip';
      if (key === 'band') {
        if (!can(node.device, 'accessPoint') || !(deviceBands(node.device) as readonly unknown[]).includes(value)) return 'wireless.band';
        const band = value as WirelessBand;
        const { channel, ...rest } = { ...cur, band };
        return withComponent(node, 'wireless', channel !== undefined && bandChannels(band).includes(channel) ? { ...rest, channel } : rest);
      }
      if (key === 'channel' && (!can(node.device, 'accessPoint') || typeof value !== 'number' || !bandChannels(bandOf(node)).includes(value))) return 'wireless.channel';
      if (key === 'vlan' && (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 4094)) return 'vlan.range';
      return withComponent(node, 'wireless', { ...cur, [key]: value });
    },
    target,
  );

export const setNat = (core: Core, uid: string, change: NatOp, target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      const refusal = refusalFor(node.device, 'nat');
      if (refusal) return refusal;
      const cur = getComponent(node, 'nat') ?? {};
      switch (change.op) {
        case 'iface': {
          if (!node.interfaces.some((i) => i.id === change.id)) return 'iface.none';
          return { ...node, interfaces: node.interfaces.map((i) => (i.id === change.id ? { ...i, nat: change.nat ?? undefined } : i)) };
        }
        case 'napt':
          return withComponent(node, 'nat', { ...cur, napt: change.on || undefined });
        case 'static':
          return withComponent(node, 'nat', { ...cur, statics: [...(cur.statics ?? []).filter((s) => s.port !== change.port), { port: change.port, insideIp: change.insideIp, insidePort: change.insidePort }] });
        case 'noStatic':
          return withComponent(node, 'nat', { ...cur, statics: (cur.statics ?? []).filter((s) => s.port !== change.port) });
      }
    },
    target,
  );

export const setBgp = (core: Core, uid: string, change: BgpOp, target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      const refusal = refusalFor(node.device, 'bgp');
      if (refusal) return refusal;
      const cur = getComponent(node, 'bgp') ?? { asn: 0, neighbors: [], networks: [] };
      switch (change.op) {
        case 'asn':
          return withComponent(node, 'bgp', { ...cur, asn: change.asn });
        case 'off':
          return { ...node, components: { ...node.components, bgp: undefined } };
        case 'neighbor':
          return withComponent(node, 'bgp', { ...cur, neighbors: [...cur.neighbors.filter((n) => n.ip !== change.ip), { ...cur.neighbors.find((n) => n.ip === change.ip), ip: change.ip, remoteAs: change.remoteAs }] });
        case 'removeNeighbor':
          return withComponent(node, 'bgp', { ...cur, neighbors: cur.neighbors.filter((n) => n.ip !== change.ip) });
        case 'removeNetwork':
          return withComponent(node, 'bgp', { ...cur, networks: cur.networks.filter((n) => !(n.dest === change.dest && n.prefix === change.prefix)) });
        case 'attr': {
          if (!cur.neighbors.some((n) => n.ip === change.ip)) return 'bgp.no_neighbor';
          return withComponent(node, 'bgp', { ...cur, neighbors: cur.neighbors.map((n) => (n.ip === change.ip ? { ...n, [change.key]: change.value } : n)) });
        }
        case 'network':
          return withComponent(node, 'bgp', { ...cur, networks: [...cur.networks.filter((n) => !(n.dest === change.dest && n.prefix === change.prefix)), { dest: change.dest, prefix: change.prefix }] });
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
      const refusal = refusalFor(node.device, 'firewall');
      if (refusal) return refusal;
      for (const r of rules) {
        if (r.src !== 'any' && !isCidr(r.src)) return 'ip';
        if (r.dst !== 'any' && !isCidr(r.dst)) return 'ip';
      }
      return withComponent(node, 'firewall', rules);
    },
    target,
  );

// ロードバランサーの仮想サーバーの一覧を置き換える。仮想の IPアドレスは、その機器の口のアドレスでなければならない
export const setLoadBalancer = (core: Core, uid: string, servers: NonNullable<Components['loadBalancer']>, target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      const refusal = refusalFor(node.device, 'loadBalance');
      if (refusal) return refusal;
      if (servers.some((v) => !node.interfaces.some((i) => i.ip === v.vip))) return 'ip';
      return withComponent(node, 'loadBalancer', servers);
    },
    target,
  );

// VPN のトンネルの一覧を置き換える
export const setVpn = (core: Core, uid: string, tunnels: NonNullable<Components['vpn']>, target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      const refusal = refusalFor(node.device, 'vpn');
      if (refusal) return refusal;
      return withComponent(node, 'vpn', tunnels);
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
const HTTP_PORT = 80;
const PROXY_PORT = 8080;

// サービスを起動する（on）または停止する（off）。配線の設定が固定された機器は変えられない
export const setService = (
  core: Core,
  uid: string,
  protocol: 'http' | 'radius' | 'proxy' | 'nas',
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
      return { ...node, services: [...others, current ?? (protocol === 'http' ? { protocol, port: HTTP_PORT } : protocol === 'proxy' ? { protocol, port: PROXY_PORT } : { protocol })] };
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
    engineWithSite(env.engine, maps.hq, core.office.furniture),
  );
  const p = core.focus === null ? null : (core.active.find((q) => q.id === core.focus) ?? null);
  const focus = p === null ? null : analyze(
    { nodes: p.nodes, links: p.links, plans: p.plans },
    engineWithSite(env.engine, maps[p.contract.map], siteFurnitureOf(p.contract, maps[p.contract.map], core.office.furniture)),
  );
  const q = core.showcase ?? null;
  const showcase = q === null ? null : analyze({ nodes: q.nodes, links: q.links, plans: q.plans }, engineWithSite(env.engine, maps[q.contract.map], siteFurnitureOf(q.contract, maps[q.contract.map], core.office.furniture)));
  return { office, focus, showcase };
};
