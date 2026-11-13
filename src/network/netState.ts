// 疎通判定の計算（N136）。段1 配線 → 段2 L2 ドメイン → 段3 IP と直結 → 段4 静的経路 → 段5 転送（ping・http）の順に読む。
// L1（配線）→ L2（スイッチによるL2ドメイン）→ L3（IPアドレスとルーティング）の順に確認する。
// 失敗理由は ID で返し、文言は言語ファイルで表示する。
import { isRoutingCategory } from './category';
import { analyze } from './engine/analyze';
import type { EngineData, Endpoint, Failure, FailureReason, FirewallRule, Iface, NetLink, NetNode, Network, PathResult, PortConfig, Route } from './types';
import { CATEGORY } from '../data/categories';
import { can } from './capabilities';
import { macOf } from './mac';
import type { StpResult } from './stp';
import type { DhcpResult } from './dhcp';
import type { AddressLayer } from './engine/stages/addressing';
import type { LinkLayer } from './engine/stages/links';
import type { L2Domain, L2Layer } from './engine/stages/l2';
import type { BgpResult } from './bgp';
import { inSubnet, isPrivateIp } from './ip';
import { adOf, type RoutingLayer } from './engine/stages/routing';
import { deviceCategory } from '../registry/query';

export { accessPointsOf, linkLength, wallsBetween, WALL_LOSS, WIRELESS_RADIUS, wirelessAssociations, withWireless } from './engine/stages/links';

const MAX_HOPS = 16;

export { inSubnet, ipToInt, isPrivateIp } from './ip';

export class Topology {
  private nodes = new Map<string, NetNode>();

  // 機器の列は、アドレスの層の実効の構成（補完と DHCP の割り当てを入れたもの）から取る
  constructor(
    private links: LinkLayer,
    private l2: L2Layer,
    private addressing: AddressLayer,
    private routing: RoutingLayer,
  ) {
    for (const node of addressing.net.nodes) this.nodes.set(node.uid, node);
  }

  // DHCP の割り当ての結果（自動の口がなければ空）
  get dhcp(): DhcpResult {
    return this.addressing.dhcp;
  }

  // 機器の経路表（静的・RIP・OSPF・BGP）。経路の層から読む
  routesOf(uid: string): Route[] {
    return this.routing.routesOf(uid);
  }

  // BGP の計算結果（セッション・候補の経路）
  bgpOf(uid: string): BgpResult | undefined {
    return this.routing.bgpOf(uid);
  }

  // すべての機器（静的 NAT の宛先を探すときに使う）
  allNodes(): NetNode[] {
    return [...this.nodes.values()];
  }

  node(uid: string): NetNode | undefined {
    return this.nodes.get(uid);
  }

  categoryOf(uid: string): string {
    const node = this.nodes.get(uid);
    return node ? deviceCategory(node.device) : '';
  }

  // 口が機器の内部のスイッチにつながるか
  isFabric(uid: string, port: number): boolean {
    return this.l2.isFabric(uid, port);
  }

  // 口に IP のインターフェースがあるか（L3スイッチの口の扱いに使う）
  hasIpOn(uid: string, port: number): boolean {
    return (this.nodes.get(uid)?.interfaces ?? []).some((i) => i.kind === 'port' && i.port === port);
  }

  // 機器の SVI（VLAN のインターフェース）
  svisOf(uid: string): Iface[] {
    return (this.nodes.get(uid)?.interfaces ?? []).filter((i) => i.kind === 'svi');
  }

  // 口が機器の一員として数えられないか（中継だけの口）
  isRelay(uid: string, port: number): boolean {
    return this.l2.isRelay(uid, port);
  }

  isRouter(uid: string): boolean {
    return isRoutingCategory(this.categoryOf(uid));
  }

  // 端点に配線があるか（L1）
  linkAt(ep: Endpoint): { link: NetLink; peer: Endpoint } | undefined {
    return this.l2.linkAt(ep);
  }

  ifaceAt(uid: string, port: number) {
    return this.nodes.get(uid)?.interfaces.find((i) => i.port === port);
  }

  // 口の設定（PortConfig）。設定のない口は、VLAN 1 の access として動く（N137）
  portCfg(uid: string, port: number): PortConfig | undefined {
    return this.nodes.get(uid)?.ports?.find((p) => p.port === port);
  }

  // この口が、仮想の IP アドレス ip のマスターか
  vrrpOwns(uid: string, port: number, ip: string): boolean {
    return this.addressing.vrrpOwns(uid, port, ip);
  }

  stp(): StpResult {
    return this.l2.stp();
  }

  // スパニングツリーが止めている口（ブロッキング）か
  isStpBlocked(uid: string, port: number): boolean {
    return this.l2.isStpBlocked(uid, port);
  }

  // 口が停止しているか（shutdown）
  isShut(uid: string, port: number): boolean {
    // 電源を切った機器は、すべての口が停止している
    return this.links.isShut(uid, port);
  }

  // 口に入るフレームの VLAN
  vlanOf(uid: string, port: number): number {
    return this.l2.vlanOf(uid, port);
  }

  // 口がその VLAN のフレームを通すか
  carries(uid: string, port: number, vlan: number): boolean {
    return this.l2.carries(uid, port, vlan);
  }

  // 端点と同じL2ドメインに属する機器の端点
  domainOf(start: Endpoint): L2Domain {
    return this.l2.domainOf(start);
  }
}

export const fail = (reason: FailureReason, node: string): Failure => ({ reason, node });

// 重複したアドレスのどれかが DHCP で配られたものなら、理由を分けて示す
const duplicateReason = (topo: Topology, members: { node: string; port: number }[]): FailureReason =>
  members.some((m) => topo.ifaceAt(m.node, m.port)?.dhcp) ? 'ip.duplicate.dhcp' : 'ip.duplicate';

// 片道の判定（src → dst）。dstIp は宛先のIPアドレス
// 通信の種類（ping は ICMP、http は指定のポートへの TCP）。ファイアウォールの規則の判定に使う
export type Traffic = { kind: 'ping' } | { kind: 'http'; port: number };

export { adOf };

// 規則の送信元・宛先（'any' か「a.b.c.d/nn」）に、IPアドレスが入るか
const matchNet = (spec: string, ip: string): boolean => {
  if (spec === 'any') return true;
  const [network, prefix] = spec.split('/');
  return inSubnet(ip, network, Number(prefix));
};

// ファイアウォールが、この通信を通すか（規則のどれかに合えば通す。規則がなければ拒否）
const allows = (rules: readonly FirewallRule[] | undefined, srcIp: string, dstIp: string, traffic: Traffic): boolean =>
  (rules ?? []).some(
    (r) =>
      matchNet(r.src, srcIp) &&
      matchNet(r.dst, dstIp) &&
      (r.service === 'any' ||
        (r.service === 'ping' && traffic.kind === 'ping') ||
        (r.service === 'http' && traffic.kind === 'http' && (r.port === undefined || r.port === traffic.port))),
  );

// 通信を1方向に届ける。check が true のときは、通り道のファイアウォールの規則を確かめる（戻りの通信は、往路で許した通信の戻りとして確かめない）
// 口に線がないときの理由。無線の端末は、ケーブルがないのではなく、アクセスポイントにつながっていない（N152）
const unpluggedReason = (topo: Topology, uid: string): 'link.unplugged' | 'wireless.unassociated' | 'wlan.psk_mismatch' | 'wlan.auth_mismatch' => {
  const node = topo.node(uid);
  if (node === undefined || !can(node.device, 'wireless')) return 'link.unplugged';
  // 同じ SSID のアクセスポイントがあるのに、パスワードか暗号化の方式が合わない
  const same = topo.allNodes().filter((n) => n.uid !== uid && n.wireless?.ssid !== undefined && n.wireless.ssid === node.wireless?.ssid && can(n.device, 'wireless') && n.wireless.password !== undefined);
  if (same.some((ap) => (ap.wireless?.security ?? 'wpa2') !== 'open' && ap.wireless?.password !== node.wireless?.password)) return 'wlan.psk_mismatch';
  if (same.some((ap) => ap.wireless?.security === 'wpa3') && !can(node.device, 'wpa3')) return 'wlan.auth_mismatch';
  return 'wireless.unassociated';
};

// ポートセキュリティ（N153）: 機器の口が、登録のない MAC の機器をつないだとき、つないだ先のスイッチの口で止める
// 登録（macs）のない口は制限しない。機器の MAC は、機器の連番と口から求める
const securityDenied = (topo: Topology, device: NetNode, devicePort: number): Failure | null => {
  const link = topo.linkAt({ node: device.uid, port: devicePort });
  if (!link) return null;
  const sw = link.peer;
  const macs = topo.portCfg(sw.node, sw.port)?.macs;
  if (macs === undefined) return null;
  if (device.macSerial === undefined) return fail('port.security', sw.node);
  const mac = macOf(topo.categoryOf(device.uid), device.macSerial, devicePort);
  return macs.includes(mac) ? null : fail('port.security', sw.node);
};

export const deliver = (topo: Topology, srcUid: string, dstUid: string, traffic: Traffic = { kind: 'ping' }, check = true, srcIp?: string, dstIp?: string): PathResult => {
  const path: string[] = [];
  const src = topo.node(srcUid);
  const dst = topo.node(dstUid);
  const err = (failure: Failure): PathResult => ({ ok: false, path, failure });

  if (!src || !dst) return err(fail('ip.unset', srcUid));

  // 送信元・宛先のアドレスを指定したときは、そのインターフェース（省略は最初の口）
  const srcIface = srcIp === undefined ? src.interfaces[0] : src.interfaces.find((i) => i.ip === srcIp);
  if (!srcIface) return err(fail('ip.unset', src.uid));
  // 自動（DHCP）の口がアドレスを受け取れなかった
  if (srcIface.dhcp === true && topo.dhcp.failed.some((f) => f.uid === src.uid && f.port === srcIface.port)) return err(fail(topo.dhcp.failed.find((f) => f.uid === src.uid && f.port === srcIface.port)?.reason ?? 'dhcp.no_offer', src.uid));
  const srcEp: Endpoint = { node: src.uid, port: srcIface.port };
  if (topo.isShut(src.uid, srcIface.port)) return err(fail('port.shutdown', src.uid));
  if (!topo.linkAt(srcEp)) return err(fail(unpluggedReason(topo, src.uid), src.uid));
  const srcSecurity = securityDenied(topo, src, srcIface.port);
  if (srcSecurity) return err(srcSecurity);
  // 相手の口が停止していれば、その口で止まる（port.shutdown）
  const srcPeer = topo.linkAt(srcEp)!.peer;
  if (topo.isShut(srcPeer.node, srcPeer.port)) return err(fail('port.shutdown', srcPeer.node));

  const dstIface = dstIp === undefined ? dst.interfaces[0] : dst.interfaces.find((i) => i.ip === dstIp);
  if (!dstIface) return err(fail('ip.unset', dst.uid));
  const dstEp: Endpoint = { node: dst.uid, port: dstIface.port };
  if (!topo.linkAt(dstEp)) return err(fail(unpluggedReason(topo, dst.uid), dst.uid));
  const dstSecurity = securityDenied(topo, dst, dstIface.port);
  if (dstSecurity) return err(dstSecurity);

  path.push(src.uid);

  const srcDomain = topo.domainOf(srcEp);
  if (srcDomain.tooLong) return err(fail('link.too_long', srcDomain.tooLong.node));
  if (srcDomain.loop) return err(fail('link.loop', srcDomain.loop.node));
  const sameIp = srcDomain.members.filter((m) => topo.ifaceAt(m.node, m.port)?.ip === srcIface.ip);
  if (sameIp.length > 1) return err(fail(duplicateReason(topo, sameIp), src.uid));

  const inDomain = (domain: L2Domain, ep: Endpoint) =>
    domain.members.some((m) => m.node === ep.node && m.port === ep.port);

  // 同じサブネット: 同じL2ドメインに宛先があるか
  if (inSubnet(dstIface.ip, srcIface.ip, srcIface.prefix)) {
    if (inDomain(srcDomain, dstEp)) {
      // 宛先のIPアドレスが同じL2ドメイン内で重複していれば、宛先への到達は確定しない
      const dstDuplicates = srcDomain.members.filter((m) => topo.ifaceAt(m.node, m.port)?.ip === dstIface.ip);
      if (dstDuplicates.length > 1) return err(fail(duplicateReason(topo, dstDuplicates), dst.uid));
      path.push(dst.uid);
      return { ok: true, path };
    }
    return err(fail('ip.unreachable', src.uid));
  }

  // 異なるサブネット: デフォルトゲートウェイを経由する
  if (!src.gateway) return err(fail('gateway.unset', src.uid));
  const gwMember = srcDomain.members.find((m) => topo.ifaceAt(m.node, m.port)?.ip === src.gateway || topo.vrrpOwns(m.node, m.port, src.gateway as string));
  if (!gwMember) {
    // 仮想の IP アドレスの持ち主（マスター）がいない: 同じ VRID の全員が止まっている
    if (topo.allNodes().some((n) => n.interfaces.some((i) => i.vrrp?.some((g) => g.ip === src.gateway)))) return err(fail('vrrp.no_master', src.uid));
    return err(fail('gateway.unreachable', src.uid));
  }

  let current: Endpoint = gwMember;
  // 今の送信元のアドレス（NAPT で変わる）と、変換の記録
  let curSrcIp = srcIface.ip;
  let natHit: PathResult['nat'];
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const cur = topo.node(current.node);
    if (!cur) return err(fail('route.none', current.node));

    if (cur.uid === dst.uid) {
      path.push(cur.uid);
      return { ok: true, path, nat: natHit };
    }
    if (!topo.isRouter(cur.uid)) return err(fail('route.none', cur.uid));
    path.push(cur.uid);
    // ファイアウォールは、規則に合う通信だけを通す（既定は拒否）
    if (check && topo.categoryOf(cur.uid) === CATEGORY.firewall && !allows(cur.rules, srcIface.ip, dstIface.ip, traffic)) {
      return err(fail('firewall.denied', cur.uid));
    }

    // 家庭用ルーターは、外から始まる通信を既定で止める（社内へ向かう往路を外の口から受けたら拒否。静的 NAT の転送は別の経路で届く・NET.md §4）
    const arrivedFrom = cur.interfaces.find((i) => i.port === current.port);
    if (check && topo.categoryOf(cur.uid) === CATEGORY.homeRouter && arrivedFrom?.nat === 'outside') {
      return err(fail('firewall.denied', cur.uid));
    }
    // 直結しているサブネットに宛先があるか
    const connected = cur.interfaces.find((i) => inSubnet(dstIface.ip, i.ip, i.prefix));
    if (connected) {
      // 直結の外の口へ出るときも、NAPT で送信元を外の口のアドレスに変える（N145）
      const inIf = cur.interfaces.find((i) => i.port === current.port);
      if (cur.napt && inIf?.nat === 'inside' && connected.nat === 'outside' && natHit === undefined) {
        natHit = { router: cur.uid, insideIp: curSrcIp, outsideIp: connected.ip };
        curSrcIp = connected.ip;
      }
      // 社内のアドレス（プライベート）のまま外の口へ出たら、回線の先で届かない（nat.private_source・NET.md §6）。戻りは確かめない
      if (check && connected.nat === 'outside' && natHit === undefined && isPrivateIp(curSrcIp)) return err(fail('nat.private_source', cur.uid));
      const domain = topo.domainOf({ node: cur.uid, port: connected.port });
      if (domain.tooLong) return err(fail('link.too_long', domain.tooLong.node));
      if (domain.loop) return err(fail('link.loop', domain.loop.node));
      if (inDomain(domain, dstEp)) {
        path.push(dst.uid);
        return { ok: true, path, nat: natHit };
      }
      return err(fail('ip.unreachable', cur.uid));
    }

    // 最長一致で静的ルートを選ぶ
    // 設定した経路（static）と、RIP・OSPF の経路を合わせ、最長一致で選ぶ。同じ長さなら管理距離（AD）の小さい方（static 1・OSPF 110・RIP 120）
    const matches = topo.routesOf(cur.uid).filter((r) => inSubnet(dstIface.ip, r.dest, r.prefix));
    if (matches.length === 0) {
      // BGP の相手と隣接しない（アドレスか AS 番号が合わない）ときは bgp.no_session（N147）
      const bgp = cur.bgp ? topo.bgpOf(cur.uid) : undefined;
      // 経路は学んだが、ネクストホップに届かない（iBGP の next-hop-self がない）ときは bgp.nexthop_unreachable
      if (bgp?.candidates.some((c) => !c.valid && inSubnet(dstIface.ip, c.dest, c.prefix))) return err(fail('bgp.nexthop_unreachable', cur.uid));
      if (bgp?.sessions.some((x) => x.status.state !== 'established')) return err(fail('bgp.no_session', cur.uid));
      // RIP に参加している機器で経路がないのは、16 ホップ以上で届かない（rip.unreachable・NET.md §6）
      if (cur.interfaces.some((i) => i.rip === true)) return err(fail('rip.unreachable', cur.uid));
      // OSPF のエリア 0 に接していないエリアだけに参加している機器は、経路がエリア 0 へ届かない（ospf.area_detached・NET.md §6）
      const ospfAreas = cur.interfaces.filter((i) => i.ospf !== undefined).map((i) => i.ospf!.area);
      if (ospfAreas.length > 0 && !ospfAreas.includes(0)) return err(fail('ospf.area_detached', cur.uid));
      return err(fail(ospfAreas.length > 0 ? 'ospf.no_neighbor' : 'route.none', cur.uid));
    }
    const route = matches.reduce((best, r) => (r.prefix > best.prefix || (r.prefix === best.prefix && adOf(r) < adOf(best)) ? r : best));

    const egress = cur.interfaces.find((i) => inSubnet(route.nextHop, i.ip, i.prefix));
    if (!egress) return err(fail('route.none', cur.uid));
    // NAPT: 社内の口（inside）から外の口（outside）へ出る通信の送信元を、外の口のアドレスに変える（N145）
    const ingress = cur.interfaces.find((i) => i.port === current.port);
    if (cur.napt && ingress?.nat === 'inside' && egress.nat === 'outside' && natHit === undefined) {
      natHit = { router: cur.uid, insideIp: curSrcIp, outsideIp: egress.ip };
      curSrcIp = egress.ip;
    }
    const egressDomain = topo.domainOf({ node: cur.uid, port: egress.port });
    if (egressDomain.tooLong) return err(fail('link.too_long', egressDomain.tooLong.node));
    if (egressDomain.loop) return err(fail('link.loop', egressDomain.loop.node));
    const next = egressDomain.members.find((m) => topo.ifaceAt(m.node, m.port)?.ip === route.nextHop);
    if (!next) return err(fail('route.none', cur.uid));
    current = next;
  }
  return err(fail('route.loop', current.node));
};

// 戻りの通信。往路で NAPT を行ったときは、外から変換後のアドレス（外の口）へ届き、NAPT の機器が社内のアドレスへ戻す（N145）
export const backOf = (topo: Topology, dstUid: string, srcUid: string, traffic: Traffic, forward: PathResult): PathResult => {
  const dst = topo.node(dstUid);
  const src = topo.node(srcUid);
  if (!forward.nat) return deliver(topo, dstUid, srcUid, traffic, false);
  // 往路の宛先のアドレス（戻りの送信元）から、NAPT の機器の外の口へ。そこから社内の口を経て、元の送信元へ
  const { router, insideIp, outsideIp } = forward.nat;
  const toRouter = deliver(topo, dstUid, router, traffic, false, undefined, outsideIp);
  if (!toRouter.ok) return toRouter;
  const insideIface = topo.node(router)?.interfaces.find((i) => inSubnet(insideIp, i.ip, i.prefix));
  if (!insideIface || !src || !dst) return { ok: false, path: toRouter.path, failure: fail('route.none', router) };
  const rest = deliver(topo, router, srcUid, traffic, false, insideIface.ip, undefined);
  return rest.ok ? { ...rest, path: [...toRouter.path, ...rest.path.slice(1)] } : rest;
};

// 同じチャネルのアクセスポイントどうしの重なり（電波が届く範囲の2倍以内で、同じチャネル。N152）。チャネルは未設定なら 1


// 通れば通るが直すべき設定（警告・NET.md §6）: 直結の両端の口の VLAN が違う access（vlan.mismatch）、両端の native が違う trunk（vlan.native_mismatch）
export type VlanWarning = { id: 'wlan.open' | 'wlan.weak_cipher' | 'wlan.transition' | 'dhcp.multiple_servers' | 'lag.mismatch' | 'vlan.mismatch' | 'vlan.native_mismatch' | 'ospf.duplicate_router_id' | 'vrrp.gateway_real_ip' | 'vrrp.vip_mismatch'; a: string; b: string };


// 受け取れた自動の口の ip・prefix を機器へ書き戻す（前回のアドレスとして保存する。NET.md §5.7）。変わる機器がなければ同じ配列を返す
export const dhcpWriteBack = <T extends { uid: string; interfaces: Iface[] }>(nodes: readonly T[], links: readonly NetLink[], segments: Network['segments'], data: EngineData): readonly T[] => {
  if (!nodes.some((n) => n.interfaces.some((i) => i.dhcp === true))) return nodes;
  const leases = analyze({ nodes: nodes as unknown as NetNode[], links: [...links], segments }, data).addressing.dhcp.leases;
  let changed = false;
  const next = nodes.map((n) => {
    const interfaces = n.interfaces.map((i) => {
      const l = i.dhcp === true ? leases.find((x) => x.uid === n.uid && x.port === i.port) : undefined;
      if (!l || (l.ip === i.ip && l.prefix === i.prefix)) return i;
      changed = true;
      return { ...i, ip: l.ip, prefix: l.prefix };
    });
    return interfaces.some((i, k) => i !== n.interfaces[k]) ? { ...n, interfaces } : n;
  });
  return changed ? next : nodes;
};


// BGP の計算結果（show ip bgp・show ip bgp summary に出す）。BGP を動かしていない機器は undefined
