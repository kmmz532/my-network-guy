// 転送（ping・http・配送）。往路と復路の判定は、計算の結果（配線・L2・アドレス・経路の層）を読むだけで、計算し直さない
import { CATEGORY } from '../../data/categories';
import { can } from '../capabilities';
import { isRoutingCategory, isSubPort, isSviPort, subParentOf } from '../category';
import { inSubnet, isPrivateIp } from '../ip';
import { macOf } from '../mac';
import { DNS_PORT } from '../types';
import { serviceOfPort, servicePort, type TcpService } from '../../registry/services';
import type { Endpoint, Failure, FailureReason, FirewallRule, Iface, NetNode, PathResult, PortConfig } from '../types';
import { deviceCategory } from '../../registry/query';
import type { NetworkState } from './state';
import type { L2Domain } from './stages/l2';
import { adOf } from './stages/routing';
import { getComponent } from '../components';
import { deviceBands, isEapSecurity, securitySupported } from '../../registry/wireless';
import { bandOf } from '../wirelessBand';
import { egressIface, healthyMembers, memberUp, pickMember, serverOf } from '../query/loadBalancer';
import type { Reach, VirtualServer } from '../query/loadBalancer';
import { tunnelFor } from '../query/vpn';
import { mtuAlong, pingProbe, HTTP_SIZE } from '../query/mtu';
import type { Probe } from '../query/mtu';
import type { Send } from '../query/vpn';

// 転送が読む層。解析の結果（NetworkState）と、DHCP のリレーの到達を仮に確かめるときの仮の層が、同じ形で渡せる
export type ForwardView = Pick<NetworkState, 'links' | 'l2' | 'addressing' | 'routing' | 'vpn'>;

const MAX_HOPS = 16;

const kindOf = (view: ForwardView, uid: string): string => {
  const node = view.addressing.nodeOf(uid);
  return node ? deviceCategory(node.device) : '';
};
const isRouter = (view: ForwardView, uid: string): boolean => isRoutingCategory(kindOf(view, uid));
const ifaceAt = (view: ForwardView, uid: string, port: number): Iface | undefined => view.addressing.nodeOf(uid)?.interfaces.find((i) => i.port === port);
// 口の設定（PortConfig）。設定のない口は、VLAN 1 の access として動く
const portCfg = (view: ForwardView, uid: string, port: number): PortConfig | undefined => view.addressing.nodeOf(uid)?.ports?.find((p) => p.port === port);

// 口がないときの理由。束ねていない Po が落ちているなら po.not_bundled、そうでなければ ip.unset
const noIfaceReason = (view: ForwardView, uid: string): FailureReason => (view.links.unbundledPo.has(uid) ? 'po.not_bundled' : 'ip.unset');

export const fail = (reason: FailureReason, node: string): Failure => ({ reason, node });

// 重複したアドレスのどれかが DHCP で配られたものなら、理由を分けて示す
const duplicateReason = (view: ForwardView, members: { node: string; port: number }[]): FailureReason =>
  members.some((m) => ifaceAt(view, m.node, m.port)?.dhcp) ? 'ip.duplicate.dhcp' : 'ip.duplicate';

// 片道の判定（src → dst）。dstIp は宛先のIPアドレス
// 通信の種類（ping は ICMP、http は指定のポートへの TCP、dns は 53 番への問い合わせ）。ファイアウォールの規則の判定に使う
// radius は UDP 1812 への認証の問い合わせ（アクセスポイントから RADIUS サーバーへ）。ファイアウォールは、サービスを any にした規則だけが通す
// ike は IPsec の鍵交換（UDP 500）。radius と同じく、サービスを any にした規則だけが通す
// tcp は、メール（smtp 25・imap 143）とファイル共有（smb 445）の TCP。規則は、同じ名前のサービスを許した規則と、any だけが通す
export type Traffic = { kind: 'ping' } | { kind: 'http'; port: number } | { kind: 'dns' } | { kind: 'radius' } | { kind: 'ike' } | { kind: 'tcp'; service: TcpService; port: number };
export type { TcpService };
export const tcpTraffic = (service: TcpService): Traffic => ({ kind: 'tcp', service, port: servicePort(service) });

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
        (r.service === 'http' && traffic.kind === 'http' && (r.port === undefined || r.port === traffic.port)) ||
        (r.service === 'dns' && traffic.kind === 'dns') ||
        (r.service === 'radius' && traffic.kind === 'radius') ||
        (traffic.kind === 'tcp' && r.service === traffic.service)),
  );

// 通信を1方向に届ける。check が true のときは、通り道のファイアウォールの規則を確かめる（戻りの通信は、往路で許した通信の戻りとして確かめない）
// 口に線がないときの理由。無線の端末は、ケーブルがないのではなく、アクセスポイントにつながっていない（N152）
const unpluggedReason = (view: ForwardView, uid: string): 'link.unplugged' | 'wireless.unassociated' | 'wlan.psk_mismatch' | 'wlan.auth_mismatch' | 'wlan.band_mismatch' | 'wlan.no_radius' => {
  const node = view.addressing.nodeOf(uid);
  if (node === undefined || !can(node.device, 'wireless')) return 'link.unplugged';
  // 同じ SSID のアクセスポイントがあるのに、パスワードか暗号化の方式が合わない
  const mine = getComponent(node, 'wireless');
  const same = view.addressing.net.nodes.filter((n) => {
    const w = getComponent(n, 'wireless');
    return n.uid !== uid && w?.ssid !== undefined && w.ssid === mine?.ssid && can(n.device, 'wireless') && (w.password !== undefined || isEapSecurity(w.security ?? 'wpa2'));
  });
  if (same.some((ap) => !['open', 'wpa2_eap', 'wpa3_eap'].includes(getComponent(ap, 'wireless')?.security ?? 'wpa2') && getComponent(ap, 'wireless')?.password !== mine?.password)) return 'wlan.psk_mismatch';
  // 同じ SSID のアクセスポイント（端末を除く）の、暗号化の方式と帯が、端末に合わない
  const aps = same.filter((n) => can(n.device, 'accessPoint'));
  if (aps.some((ap) => !securitySupported(node.device, getComponent(ap, 'wireless')?.security ?? 'wpa2'))) return 'wlan.auth_mismatch';
  if (aps.some((ap) => !deviceBands(node.device).includes(bandOf(ap)))) return 'wlan.band_mismatch';
  // 802.1X の SSID で、RADIUS サーバーへ届かない
  if (aps.some((ap) => isEapSecurity(getComponent(ap, 'wireless')?.security ?? 'wpa2') && view.links.radiusDown.has(ap.uid))) return 'wlan.no_radius';
  return 'wireless.unassociated';
};

// ポートセキュリティ（N153）: 機器の口が、登録のない MAC の機器をつないだとき、つないだ先のスイッチの口で止める
// 登録（macs）のない口は制限しない。機器の MAC は、機器の連番と口から求める
const securityDenied = (view: ForwardView, device: NetNode, devicePort: number): Failure | null => {
  const link = view.l2.linkAt({ node: device.uid, port: devicePort });
  if (!link) return null;
  const sw = link.peer;
  const macs = portCfg(view, sw.node, sw.port)?.macs;
  if (macs === undefined) return null;
  if (device.macSerial === undefined) return fail('port.security', sw.node);
  const mac = macOf(kindOf(view, device.uid), device.macSerial, devicePort);
  return macs.includes(mac) ? null : fail('port.security', sw.node);
};

// 配線・停止・ポートセキュリティを確かめる口。サブインターフェースは親の物理の口（配線があり、停止していないとき）。SVI は配線を持たないため、実機と同じく、その VLAN を通す有効な（配線があり停止していない）物理の口のどれかを使う。なければ undefined
const wiredPort = (view: ForwardView, uid: string, iface: Iface): number | undefined => {
  if (isSubPort(iface.port)) {
    const parent = subParentOf(iface.port);
    return view.l2.linkAt({ node: uid, port: parent }) ? parent : undefined;
  }
  if (!isSviPort(iface.port)) return view.l2.linkAt({ node: uid, port: iface.port }) ? iface.port : undefined;
  const vlan = iface.vlan;
  if (vlan === undefined) throw new Error(`SVI に VLAN がない: ${uid} ${iface.id}`);
  for (const l of view.addressing.net.links) {
    for (const end of [l.a, l.b]) {
      if (end.node === uid && !isSviPort(end.port) && view.l2.carries(uid, end.port, vlan) && !view.links.isShut(uid, end.port)) return end.port;
    }
  }
  return undefined;
};

export const deliver = (view: ForwardView, srcUid: string, dstUid: string, traffic: Traffic = { kind: 'ping' }, check = true, srcIp?: string, dstIp?: string): PathResult => {
  const path: string[] = [];
  const src = view.addressing.nodeOf(srcUid);
  const dst = view.addressing.nodeOf(dstUid);
  const err = (failure: Failure): PathResult => ({ ok: false, path, failure });

  if (!src || !dst) return err(fail('ip.unset', srcUid));

  // 送信元・宛先のアドレスを指定したときは、そのインターフェース（省略は最初の口）
  const srcIface = srcIp === undefined ? src.interfaces[0] : src.interfaces.find((i) => i.ip === srcIp);
  if (!srcIface) return err(fail(noIfaceReason(view, src.uid), src.uid));
  // 自動（DHCP）の口がアドレスを受け取れなかった
  if (srcIface.dhcp === true && view.addressing.dhcp.failed.some((f) => f.uid === src.uid && f.port === srcIface.port)) return err(fail(view.addressing.dhcp.failed.find((f) => f.uid === src.uid && f.port === srcIface.port)?.reason ?? 'dhcp.no_offer', src.uid));
  const srcEp: Endpoint = { node: src.uid, port: srcIface.port };
  if (view.links.isShut(src.uid, isSubPort(srcIface.port) ? subParentOf(srcIface.port) : srcIface.port)) return err(fail('port.shutdown', src.uid));
  const srcWired = wiredPort(view, src.uid, srcIface);
  if (srcWired === undefined) return err(fail(unpluggedReason(view, src.uid), src.uid));
  const srcSecurity = securityDenied(view, src, srcWired);
  if (srcSecurity) return err(srcSecurity);
  // 相手の口が停止していれば、その口で止まる（port.shutdown）
  const srcPeer = view.l2.linkAt({ node: src.uid, port: srcWired })!.peer;
  if (view.links.isShut(srcPeer.node, srcPeer.port)) return err(fail('port.shutdown', srcPeer.node));

  const dstIface = dstIp === undefined ? dst.interfaces[0] : dst.interfaces.find((i) => i.ip === dstIp);
  if (!dstIface) return err(fail(noIfaceReason(view, dst.uid), dst.uid));
  const dstEp: Endpoint = { node: dst.uid, port: dstIface.port };
  const dstWired = wiredPort(view, dst.uid, dstIface);
  if (dstWired === undefined) return err(fail(unpluggedReason(view, dst.uid), dst.uid));
  const dstSecurity = securityDenied(view, dst, dstWired);
  if (dstSecurity) return err(dstSecurity);

  path.push(src.uid);

  const srcDomain = view.l2.domainOf(srcEp);
  if (srcDomain.tooLong) return err(fail('link.too_long', srcDomain.tooLong.node));
  if (srcDomain.loop) return err(fail('link.loop', srcDomain.loop.node));
  const sameIp = srcDomain.members.filter((m) => ifaceAt(view, m.node, m.port)?.ip === srcIface.ip);
  if (sameIp.length > 1) return err(fail(duplicateReason(view, sameIp), src.uid));

  const inDomain = (domain: L2Domain, ep: Endpoint) =>
    domain.members.some((m) => m.node === ep.node && m.port === ep.port);

  // 同じサブネット: 同じL2ドメインに宛先があるか
  if (inSubnet(dstIface.ip, srcIface.ip, srcIface.prefix)) {
    if (inDomain(srcDomain, dstEp)) {
      // 宛先のIPアドレスが同じL2ドメイン内で重複していれば、宛先への到達は確定しない
      const dstDuplicates = srcDomain.members.filter((m) => ifaceAt(view, m.node, m.port)?.ip === dstIface.ip);
      if (dstDuplicates.length > 1) return err(fail(duplicateReason(view, dstDuplicates), dst.uid));
      path.push(dst.uid);
      return { ok: true, path };
    }
    return err(fail('ip.unreachable', src.uid));
  }

  // 異なるサブネット: デフォルトゲートウェイを経由する
  if (!src.gateway) return err(fail('gateway.unset', src.uid));
  const gwMember = srcDomain.members.find((m) => ifaceAt(view, m.node, m.port)?.ip === src.gateway || view.addressing.vrrpOwns(m.node, m.port, src.gateway as string));
  if (!gwMember) {
    // 仮想の IPアドレスの持ち主（マスター）がいない: 同じ VRID の全員が止まっている
    if (view.addressing.net.nodes.some((n) => n.interfaces.some((i) => i.vrrp?.some((g) => g.ip === src.gateway)))) return err(fail('vrrp.no_master', src.uid));
    return err(fail('gateway.unreachable', src.uid));
  }

  let current: Endpoint = gwMember;
  // 今の送信元のアドレス（NAPT で変わる）と、変換の記録
  let curSrcIp = srcIface.ip;
  let natHit: PathResult['nat'];
  // トンネルを通ったときの記録
  let tunnelHit: PathResult['tunnel'];
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const cur = view.addressing.nodeOf(current.node);
    if (!cur) return err(fail('route.none', current.node));

    if (cur.uid === dst.uid) {
      path.push(cur.uid);
      return { ok: true, path, nat: natHit, tunnel: tunnelHit };
    }
    if (!isRouter(view, cur.uid)) return err(fail('route.none', cur.uid));
    path.push(cur.uid);
    // ファイアウォールは、規則に合う通信だけを通す（既定は拒否）
    if (check && kindOf(view, cur.uid) === CATEGORY.firewall && !allows(getComponent(cur, 'firewall'), srcIface.ip, dstIface.ip, traffic)) {
      return err(fail('firewall.denied', cur.uid));
    }

    // 家庭用ルーターは、外から始まる通信を既定で止める（社内へ向かう往路を外の口から受けたら拒否。静的 NAT の転送は別の経路で届く・NET.md §4）
    const arrivedFrom = cur.interfaces.find((i) => i.port === current.port);
    if (check && kindOf(view, cur.uid) === CATEGORY.homeRouter && arrivedFrom?.nat === 'outside') {
      return err(fail('firewall.denied', cur.uid));
    }
    // IPsec VPN: 送信元が自拠点のネットワーク、宛先が相手のネットワークの通信は、トンネルに入れて相手の VPN ルーターから先を引く。
    // 同じ機器の NAPT はトンネルに入る通信から必ず外す（トンネルを先に判定する）。手前の機器が先に NAPT を掛けた通信は、送信元が変わっていて入れられない
    const tunnel = tunnelFor(view, cur.uid, srcIface.ip, dstIface.ip);
    if (tunnel) {
      if (!tunnel.ok) return err(fail(tunnel.reason, cur.uid));
      if (natHit !== undefined) return err(fail('vpn.nat_before_tunnel', cur.uid));
      tunnelHit = { ingress: cur.uid, egress: tunnel.peer, ingressIp: tunnel.localIp, egressIp: tunnel.peerIp };
      current = { node: tunnel.peer, port: tunnel.peerPort };
      continue;
    }
    // 直結しているサブネットに宛先があるか
    const connected = cur.interfaces.find((i) => inSubnet(dstIface.ip, i.ip, i.prefix));
    if (connected) {
      // 直結の外の口へ出るときも、NAPT で送信元を外の口のアドレスに変える（N145）
      const inIf = cur.interfaces.find((i) => i.port === current.port);
      if (getComponent(cur, 'nat')?.napt && inIf?.nat === 'inside' && connected.nat === 'outside' && natHit === undefined) {
        natHit = { router: cur.uid, insideIp: curSrcIp, outsideIp: connected.ip };
        curSrcIp = connected.ip;
      }
      // 社内のアドレス（プライベート）のまま外の口へ出たら、回線の先で届かない（nat.private_source・NET.md §6）。戻りは確かめない
      if (check && connected.nat === 'outside' && natHit === undefined && isPrivateIp(curSrcIp)) return err(fail('nat.private_source', cur.uid));
      const domain = view.l2.domainOf({ node: cur.uid, port: connected.port });
      if (domain.tooLong) return err(fail('link.too_long', domain.tooLong.node));
      if (domain.loop) return err(fail('link.loop', domain.loop.node));
      if (inDomain(domain, dstEp)) {
        path.push(dst.uid);
        return { ok: true, path, nat: natHit, tunnel: tunnelHit };
      }
      return err(fail('ip.unreachable', cur.uid));
    }

    // 最長一致で静的ルートを選ぶ
    // 設定した経路（static）と、RIP・OSPF の経路を合わせ、最長一致で選ぶ。同じ長さなら管理距離（AD）の小さい方（static 1・OSPF 110・RIP 120）
    const matches = view.routing.routesOf(cur.uid).filter((r) => inSubnet(dstIface.ip, r.dest, r.prefix));
    if (matches.length === 0) {
      // BGP の相手と隣接しない（アドレスか AS 番号が合わない）ときは bgp.no_session（N147）
      const bgp = getComponent(cur, 'bgp') ? view.routing.bgpOf(cur.uid) : undefined;
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
    if (getComponent(cur, 'nat')?.napt && ingress?.nat === 'inside' && egress.nat === 'outside' && natHit === undefined) {
      natHit = { router: cur.uid, insideIp: curSrcIp, outsideIp: egress.ip };
      curSrcIp = egress.ip;
    }
    const egressDomain = view.l2.domainOf({ node: cur.uid, port: egress.port });
    if (egressDomain.tooLong) return err(fail('link.too_long', egressDomain.tooLong.node));
    if (egressDomain.loop) return err(fail('link.loop', egressDomain.loop.node));
    const next = egressDomain.members.find((m) => ifaceAt(view, m.node, m.port)?.ip === route.nextHop);
    if (!next) return err(fail('route.none', cur.uid));
    current = next;
  }
  return err(fail('route.loop', current.node));
};

// 戻りの通信。往路で NAPT を行ったときは、外から変換後のアドレス（外の口）へ届き、NAPT の機器が社内のアドレスへ戻す（N145）
export const backOf = (view: ForwardView, dstUid: string, srcUid: string, traffic: Traffic, forward: PathResult): PathResult => {
  const dst = view.addressing.nodeOf(dstUid);
  const src = view.addressing.nodeOf(srcUid);
  if (!forward.nat) return deliver(view, dstUid, srcUid, traffic, false);
  // 往路の宛先のアドレス（戻りの送信元）から、NAPT の機器の外の口へ。そこから社内の口を経て、元の送信元へ
  const { router, insideIp, outsideIp } = forward.nat;
  const toRouter = deliver(view, dstUid, router, traffic, false, undefined, outsideIp);
  if (!toRouter.ok) return toRouter;
  // 元の送信元が NAPT の機器の直結のサブネットにいなければ（別のルーターの先にいる）、inside の口から戻す
  const natIfaces = view.addressing.nodeOf(router)?.interfaces ?? [];
  const insideIface = natIfaces.find((i) => inSubnet(insideIp, i.ip, i.prefix)) ?? natIfaces.find((i) => i.nat === 'inside');
  if (!insideIface || !src || !dst) return { ok: false, path: toRouter.path, failure: fail('route.none', router) };
  // 別のルーターの先なら、NAPT の機器を、inside の口のアドレスをゲートウェイとする端末として扱い、自分の経路表を引かせる（relayDeliver と同じ）
  const natNode = view.addressing.nodeOf(router)!;
  const from: ForwardView = natIfaces.some((i) => inSubnet(insideIp, i.ip, i.prefix))
    ? view
    : { ...view, addressing: { ...view.addressing, nodeOf: (uid) => (uid === router ? { ...natNode, gateway: insideIface.ip } : view.addressing.nodeOf(uid)) } };
  const rest = deliver(from, router, srcUid, traffic, false, insideIface.ip, undefined);
  const tail = rest.path.slice(1);
  return rest.ok ? { ...rest, path: [...toRouter.path, ...(tail[0] === router ? tail.slice(1) : tail)] } : rest;
};


// ロードバランサー・VPN ルーターの口からの片道。同じサブネットの宛先は直接、経路表に合う宛先は経路表で、どちらでもなければゲートウェイで届ける。check が true のときは通り道のファイアウォールの規則を確かめる
const relayDeliver = (view: ForwardView, from: string, to: string, traffic: Traffic, srcIp: string, dstIp: string, check: boolean): PathResult => {
  const node = view.addressing.nodeOf(from);
  if (node && (can(node.device, 'loadBalance') || can(node.device, 'vpn')) && view.routing.routesOf(from).some((r) => inSubnet(dstIp, r.dest, r.prefix))) {
    // ルーターを送信元にするため、ゲートウェイを自分の口のアドレスとした端末として扱い、自分から経路表を引かせる
    const relay: ForwardView = { ...view, addressing: { ...view.addressing, nodeOf: (uid) => (uid === from ? { ...node, gateway: srcIp } : view.addressing.nodeOf(uid)) } };
    return deliver(relay, from, to, traffic, check, srcIp, dstIp);
  }
  return deliver(view, from, to, traffic, check, srcIp, dstIp);
};

// 復路は確かめない片道
export const reach: Reach = (view, from, to, traffic, srcIp, dstIp) => relayDeliver(view, from, to, traffic, srcIp, dstIp, false);

// IPsec の鍵交換（UDP 500）の片道。通り道のファイアウォールの規則を確かめる
export const ikeSend: Send = (view, from, to, srcIp, dstIp) => relayDeliver(view, from, to, { kind: 'ike' }, srcIp, dstIp, true);

// ロードバランサーの振り分け。利用者の通信がロードバランサーの仮想の IPアドレスへ届いた後（entry）、健全な振り分け先から1つ選び、サーバーへ届けて戻りを確かめる。
// toUser は、戻りの通信の行き先（利用者、または静的 NAT の機器の社内の口）。SNAT があれば戻りはロードバランサーを経て toUser へ、なければサーバーから toUser へ直接で、ロードバランサーを通らなければ lb.asymmetric
const balance = (view: ForwardView, userUid: string, lb: NetNode, vs: VirtualServer, entry: PathResult, toUser: { uid: string; ip: string }): PathResult => {
  const userIp = view.addressing.nodeOf(userUid)?.interfaces[0]?.ip;
  if (userIp === undefined) return { ok: false, path: entry.path, failure: fail('ip.unset', userUid) };
  const down = (reason: 'lb.member_down' | 'lb.no_healthy_member'): PathResult => ({ ok: false, path: entry.path, failure: fail(reason, lb.uid) });
  const healthy = healthyMembers(view, lb, vs, reach);
  if (healthy.length === 0) return down('lb.no_healthy_member');
  const member = pickMember(view, vs.method, healthy, { uid: userUid, ip: userIp });
  // ヘルスチェックのない振り分け先、ping だけのヘルスチェックの振り分け先は、サービスが動いていないことがある
  if (!memberUp(view, lb, member, 'http', reach)) return down('lb.member_down');
  const server = serverOf(view, member);
  const iface = egressIface(view, lb, member.ip);
  if (!server || !iface) throw new Error(`振り分け先を選んだ後に、サーバーまたは出る口がない: ${member.ip}`);
  const traffic: Traffic = { kind: 'http', port: member.port };
  const toServer = reach(view, lb.uid, server.uid, traffic, iface.ip, member.ip);
  const path = [...entry.path, ...toServer.path.slice(1)];
  const returned = (cause: Failure): PathResult => ({ ok: false, path, failure: { reason: 'return.failed', node: server.uid, cause } });
  if (vs.snat) {
    // 送信元はロードバランサーのアドレス。戻りはサーバーからロードバランサーへ、ロードバランサーから利用者へ
    const toLb = deliver(view, server.uid, lb.uid, traffic, false, member.ip, iface.ip);
    if (!toLb.ok) return returned(toLb.failure!);
    const toBack = reach(view, lb.uid, toUser.uid, { kind: 'http', port: vs.port }, vs.vip, toUser.ip);
    if (!toBack.ok) return returned(toBack.failure!);
    return { ok: true, path, back: [...toLb.path, ...toBack.path.slice(1)] };
  }
  // 送信元は利用者のまま。戻りはサーバーから利用者へ直接で、ロードバランサーを通らなければ、利用者が応答を受け取れない
  const back = deliver(view, server.uid, toUser.uid, traffic, false, member.ip, toUser.ip);
  if (!back.ok) return returned(back.failure!);
  if (!back.path.includes(lb.uid)) return { ok: false, path, failure: fail('lb.asymmetric', server.uid) };
  return { ok: true, path, back: back.path };
};

// ロードバランサーの仮想の IPアドレスの HTTP のポートへ届いた通信を、振り分ける。仮想サーバーがなければ null
const viaBalancer = (view: ForwardView, srcUid: string, lbUid: string, port: number): PathResult | null => {
  const lb = view.addressing.nodeOf(lbUid);
  if (!lb || !can(lb.device, 'loadBalance')) return null;
  const vs = getComponent(lb, 'loadBalancer')?.find((v) => v.port === port && lb.interfaces.some((i) => i.ip === v.vip));
  if (!vs) return null;
  // ファイアウォールの規則は、仮想の IPアドレスで判定する
  const entry = deliver(view, srcUid, lbUid, { kind: 'http', port }, true, undefined, vs.vip);
  if (!entry.ok) return entry;
  const userIp = view.addressing.nodeOf(srcUid)?.interfaces[0]?.ip;
  if (userIp === undefined) return { ok: false, path: entry.path, failure: fail('ip.unset', srcUid) };
  return balance(view, srcUid, lb, vs, entry, { uid: srcUid, ip: userIp });
};

// 静的 NAT（ポートの転送）: 外からルーターの外の口へのポートの通信を、社内のサーバーへ届ける。往路は外→外の口→社内の口→サーバー、復路は逆に戻す（N145）
const viaStatic = (view: ForwardView, srcUid: string, routerUid: string, traffic: Traffic): PathResult | null => {
  const r = view.addressing.nodeOf(routerUid);
  if (!r || (traffic.kind !== 'http' && traffic.kind !== 'dns')) return null;
  const outerPort = traffic.kind === 'http' ? traffic.port : DNS_PORT;
  const map = getComponent(r, 'nat')?.statics?.find((s) => s.port === outerPort);
  if (!map) return null;
  const outside = r.interfaces.find((i) => i.nat === 'outside');
  const inside = r.interfaces.find((i) => i.nat === 'inside' && inSubnet(map.insideIp, i.ip, i.prefix));
  const server = view.addressing.net.nodes.find((n) => n.interfaces.some((i) => i.ip === map.insideIp));
  if (!outside || !inside || !server) return { ok: false, path: [], failure: fail('route.none', routerUid) };
  const toRouter = deliver(view, srcUid, routerUid, traffic, true, undefined, outside.ip);
  if (!toRouter.ok) return toRouter;
  const innerTraffic: Traffic = traffic.kind === 'http' ? { kind: 'http', port: map.insidePort } : traffic;
  // 転送を行う機器がファイアウォールなら、規則を変換の前のアドレス（外の機器の元の IP と社内のサーバーの IP）で判定する。公開のアドレスは規則に書かせない
  const srcIp = view.addressing.nodeOf(srcUid)?.interfaces[0]?.ip;
  if (srcIp === undefined) return { ok: false, path: toRouter.path, failure: fail('ip.unset', srcUid) };
  if (can(r.device, 'firewallRules') && !allows(getComponent(r, 'firewall'), srcIp, map.insideIp, innerTraffic)) {
    return { ok: false, path: toRouter.path, failure: fail('firewall.denied', routerUid) };
  }
  // 社内の宛先がロードバランサーの仮想の IPアドレスなら、振り分けへつなぐ
  const virtual = can(server.device, 'loadBalance') ? getComponent(server, 'loadBalancer')?.find((v) => v.vip === map.insideIp && v.port === map.insidePort) : undefined;
  if (virtual !== undefined && traffic.kind === 'http') {
    const toLb = deliver(view, routerUid, server.uid, innerTraffic, false, inside.ip, map.insideIp);
    if (!toLb.ok) return { ok: false, path: toRouter.path, failure: toLb.failure };
    const balanced = balance(view, srcUid, server, virtual, { ok: true, path: [...toRouter.path, ...toLb.path.slice(1)] }, { uid: routerUid, ip: inside.ip });
    return balanced.ok ? { ...balanced, staticNat: { router: routerUid, insideIp: map.insideIp, outsideIp: outside.ip } } : balanced;
  }
  const toServer = deliver(view, routerUid, server.uid, innerTraffic, false, inside.ip, map.insideIp);
  if (!toServer.ok) return { ok: false, path: toRouter.path, failure: toServer.failure };
  const listening = traffic.kind === 'http' ? server.services.some((s) => s.protocol === 'http' && s.port === map.insidePort) : server.services.some((s) => s.protocol === 'dns');
  if (!listening) return { ok: false, path: toRouter.path, failure: fail('service.closed', server.uid) };
  const back = deliver(view, server.uid, routerUid, traffic, false, map.insideIp, inside.ip);
  if (!back.ok) return { ok: false, path: toRouter.path, failure: { reason: 'return.failed', node: server.uid, cause: back.failure } };
  return { ok: true, path: [...toRouter.path, ...toServer.path.slice(1)], staticNat: { router: routerUid, insideIp: map.insideIp, outsideIp: outside.ip } };
};

// Ping（ICMP）の判定。往路と復路の両方が通る必要がある。opts の size は通信の大きさ（バイト。既定 100）、df は分割禁止。
// 区間の MTU を超えたとき、DF がなければ分割して届き（fragments）、DF があれば、その区間の入口の機器で止まる（mtu.exceeded）
export const ping = (view: ForwardView, srcUid: string, dstUid: string, opts: { size?: number; df?: boolean } = {}): PathResult => {
  const probe = pingProbe(opts);
  const forward = deliver(view, srcUid, dstUid, { kind: 'ping' });
  if (!forward.ok) return forward;
  const out = mtuAlong(view, forward.path, forward.tunnel, probe, 'ping');
  if (out.blockedAt !== undefined) return { ok: false, path: forward.path.slice(0, out.blockedAt + 1), failure: fail('mtu.exceeded', forward.path[out.blockedAt]) };
  const back = backOf(view, dstUid, srcUid, { kind: 'ping' }, forward);
  if (!back.ok) {
    return { ok: false, path: forward.path, failure: { reason: 'return.failed', node: dstUid, cause: back.failure }, nat: forward.nat, tunnel: forward.tunnel };
  }
  // 復路のトンネルは、往路のトンネルと同じもの（向きだけ逆）
  const returned = mtuAlong(view, back.path, forward.tunnel, probe, 'ping');
  if (returned.blockedAt !== undefined) {
    return { ok: false, path: forward.path, failure: { reason: 'return.failed', node: dstUid, cause: fail('mtu.exceeded', back.path[returned.blockedAt]) }, nat: forward.nat, tunnel: forward.tunnel };
  }
  return { ...forward, back: back.path, ...(out.fragments ? { fragments: out.fragments } : {}), ...(returned.fragments ? { backFragments: returned.fragments } : {}) };
};

// HTTP は 1500 バイトで DF は付かない。通る口の adjust-mss で大きさが抑えられ、区間の MTU を超えれば分割される
const withFragments = (view: ForwardView, r: PathResult): PathResult => {
  if (!r.ok) return r;
  const probe: Probe = { size: HTTP_SIZE, df: false };
  const fwd = mtuAlong(view, r.path, r.tunnel, probe, 'http');
  const back = r.back ? mtuAlong(view, r.back, r.tunnel, probe, 'http') : {};
  return { ...r, ...(fwd.fragments ? { fragments: fwd.fragments } : {}), ...(back.fragments ? { backFragments: back.fragments } : {}) };
};

// HTTP の判定。往路で宛先に届き、宛先が指定ポートでサービスを待ち受けていて、復路も通ること。
// 端末にプロキシの設定があれば、まず端末からプロキシへ届け、プロキシが宛先へ出し直す。name（名前で引いた HTTP の名前）が PAC の direct の接尾辞に合う宛先と、宛先がプロキシ自身のときは、直接つなぐ
export const http = (view: ForwardView, srcUid: string, dstUid: string, port: number, name?: string): PathResult => {
  const src = view.addressing.nodeOf(srcUid);
  const setting = src ? getComponent(src, 'proxyClient') : undefined;
  if (!setting?.proxy || (name !== undefined && (setting.pac?.direct ?? []).some((suffix) => name.endsWith(suffix)))) return withFragments(view, httpPath(view, srcUid, dstUid, port));
  const server = view.addressing.net.nodes.find((n) => n.interfaces.some((i) => i.ip === setting.proxy!.ip));
  if (server?.uid === dstUid) return withFragments(view, httpPath(view, srcUid, dstUid, port));
  return viaProxy(view, srcUid, dstUid, port, setting.proxy, server);
};

// 区間ごとの分割の数を、2つの区間をつないだ経路の分にそろえる（どちらにもなければ持たない）
const joinFragments = (a: PathResult, aFragments: number[] | undefined, b: PathResult, bFragments: number[] | undefined): number[] | undefined =>
  aFragments === undefined && bFragments === undefined
    ? undefined
    : [...(aFragments ?? Array<number>(a.path.length - 1).fill(1)), ...(bFragments ?? Array<number>(b.path.length - 1).fill(1))];

// プロキシ経由の HTTP。端末からプロキシ（設定のポート）へ届き、プロキシがサービスを動かしていること。続けて、プロキシが自分のアドレスから宛先へ出し直す（送信元はプロキシ）。
// プロキシへ届かない・サービスがない・戻れないときは proxy.unreachable（札はプロキシの機器。アドレスの機器がなければ端末）
const viaProxy = (view: ForwardView, srcUid: string, dstUid: string, port: number, setting: { ip: string; port: number }, server: NetNode | undefined): PathResult => {
  const unreachable = (path: string[]): PathResult => ({ ok: false, path, failure: fail('proxy.unreachable', server?.uid ?? srcUid) });
  if (!server) return unreachable([srcUid]);
  const traffic: Traffic = { kind: 'http', port: setting.port };
  const toProxy = deliver(view, srcUid, server.uid, traffic, true, undefined, setting.ip);
  if (!toProxy.ok || !server.services.some((s) => s.protocol === 'proxy' && s.port === setting.port)) return unreachable(toProxy.path);
  const toClient = backOf(view, server.uid, srcUid, traffic, toProxy);
  if (!toClient.ok) return unreachable(toProxy.path);
  const client = withFragments(view, { ...toProxy, back: toClient.path });
  const upstream = withFragments(view, httpPath(view, server.uid, dstUid, port));
  const path = [...client.path, ...upstream.path.slice(1)];
  const proxy = { uid: server.uid, port: setting.port, client, upstream };
  if (!upstream.ok || !upstream.back || !client.back) return { ok: false, path, ...(upstream.failure ? { failure: upstream.failure } : {}), proxy };
  const fragments = joinFragments(client, client.fragments, upstream, upstream.fragments);
  // 戻りは、宛先からプロキシ、プロキシから端末の順
  const backFragments = joinFragments(upstream, upstream.backFragments, client, client.backFragments);
  return {
    ok: true,
    path,
    back: [...upstream.back, ...client.back.slice(1)],
    ...(upstream.nat ? { nat: upstream.nat } : {}),
    ...(upstream.staticNat ? { staticNat: upstream.staticNat } : {}),
    ...(upstream.tunnel ? { tunnel: upstream.tunnel } : {}),
    ...(fragments ? { fragments } : {}),
    ...(backFragments ? { backFragments } : {}),
    proxy,
  };
};

const httpPath = (view: ForwardView, srcUid: string, dstUid: string, port: number): PathResult => {
  // 外の口への通信が、静的 NAT で社内のサーバーへ届く場合（N145）
  const nat = viaStatic(view, srcUid, dstUid, { kind: 'http', port });
  if (nat !== null) return nat;
  const balanced = viaBalancer(view, srcUid, dstUid, port);
  if (balanced !== null) return balanced;
  const forward = deliver(view, srcUid, dstUid, { kind: 'http', port });
  if (!forward.ok) return forward;
  const dst = view.addressing.nodeOf(dstUid);
  // 外から、NAT のルーターの外の口へ来た通信に、静的 NAT の転送先がない（nat.no_forward・NET.md §6）
  if (dst && getComponent(dst, 'nat')?.napt && dst.interfaces.some((i) => i.nat === 'outside') && !getComponent(dst, 'nat')?.statics?.some((s) => s.port === port)) {
    const srcIp = view.addressing.nodeOf(srcUid)?.interfaces[0]?.ip;
    if (srcIp !== undefined && !isPrivateIp(srcIp)) return { ok: false, path: forward.path, failure: fail('nat.no_forward', dstUid) };
  }
  if (!dst || !dst.services.some((s) => s.protocol === 'http' && s.port === port)) {
    return { ok: false, path: forward.path, failure: fail('service.closed', dstUid) };
  }
  const back = backOf(view, dstUid, srcUid, { kind: 'http', port }, forward);
  if (!back.ok) {
    return { ok: false, path: forward.path, failure: { reason: 'return.failed', node: dstUid, cause: back.failure }, nat: forward.nat };
  }
  return { ...forward, back: back.path };
};

// DNS の問い合わせの判定。往路で宛先に届き（53 番をファイアウォールが止めない）、宛先が DNS のサービスを動かしていて、復路も通ること。
// 宛先が DNS のサービスを持つかは、呼び出す側が決める（家庭用ルーターと ISP の DNS は、サービスの一覧に持たない）
export const dnsQuery = (view: ForwardView, srcUid: string, dstUid: string, dstIp?: string): PathResult => {
  const nat = viaStatic(view, srcUid, dstUid, { kind: 'dns' });
  if (nat !== null) return nat;
  const forward = deliver(view, srcUid, dstUid, { kind: 'dns' }, true, undefined, dstIp);
  if (!forward.ok) return forward;
  // 答えは、問い合わせを受けたアドレスから返る
  const back = forward.nat ? backOf(view, dstUid, srcUid, { kind: 'dns' }, forward) : deliver(view, dstUid, srcUid, { kind: 'dns' }, false, dstIp);
  if (!back.ok) {
    return { ok: false, path: forward.path, failure: { reason: 'return.failed', node: dstUid, cause: back.failure }, nat: forward.nat };
  }
  return { ...forward, back: back.path };
};

// メール・ファイル共有の TCP（smtp 25・imap 143・smb 445）の判定。往路で宛先に届き（ファイアウォールが止めない）、宛先がそのサービスを動かしていて、復路も通ること。
// 宛先のサービスは、口を受け持つサービス（登録表）。動いていなければ service.closed
export const tcpQuery = (view: ForwardView, srcUid: string, dstUid: string, service: TcpService, dstIp?: string): PathResult => {
  const traffic = tcpTraffic(service);
  const forward = deliver(view, srcUid, dstUid, traffic, true, undefined, dstIp);
  if (!forward.ok) return forward;
  const dst = view.addressing.nodeOf(dstUid);
  const wanted = serviceOfPort(service).id;
  if (!dst || !dst.services.some((s) => s.protocol === wanted)) return { ok: false, path: forward.path, failure: fail('service.closed', dstUid) };
  const back = backOf(view, dstUid, srcUid, traffic, forward);
  if (!back.ok) return { ok: false, path: forward.path, failure: { reason: 'return.failed', node: dstUid, cause: back.failure }, nat: forward.nat };
  return { ...forward, back: back.path };
};

// 802.1X の認証の問い合わせの判定。アクセスポイントから、設定した RADIUS のアドレスのサーバーへ UDP 1812 が往復できること。
// アクセスポイントは L2 の機器でアドレスを持たないため、上り口（口0）の L2 ドメインから見る。サーバーが同じドメインにあればそのまま届き、
// なければ、同じドメインにいるルーターが、自分の口のアドレスからサーバーへ届くこと（アクセスポイントの通信はそのルーターが中継する）。
// アドレスが未設定、そのアドレスのサーバーがない、サーバーが radius のサービスを持たない、のときも届かない（wlan.no_radius）
export const radiusQuery = (view: ForwardView, apUid: string, radiusIp: string | undefined): PathResult => {
  const noRadius = (): PathResult => ({ ok: false, path: [], failure: fail('wlan.no_radius', apUid) });
  if (radiusIp === undefined) return noRadius();
  const server = view.addressing.net.nodes.find((n) => n.interfaces.some((i) => i.ip === radiusIp));
  if (!server || !server.services.some((s) => s.protocol === 'radius')) return noRadius();
  const apEp: Endpoint = { node: apUid, port: 0 };
  if (!view.l2.linkAt(apEp)) return noRadius();
  const domain = view.l2.domainOf(apEp);
  if (domain.tooLong) return { ok: false, path: [], failure: fail('link.too_long', domain.tooLong.node) };
  if (domain.loop) return { ok: false, path: [], failure: fail('link.loop', domain.loop.node) };
  if (domain.members.some((m) => m.node === server.uid && ifaceAt(view, m.node, m.port)?.ip === radiusIp)) return { ok: true, path: [apUid, server.uid] };
  for (const m of domain.members) {
    if (!isRouter(view, m.node)) continue;
    const ip = ifaceAt(view, m.node, m.port)?.ip;
    if (ip === undefined || ip === '') continue;
    // ルーターを送信元にするため、ゲートウェイを自分の口のアドレスとした端末として扱い、自分から経路表を引かせる
    const relay: ForwardView = { ...view, addressing: { ...view.addressing, nodeOf: (uid) => (uid === m.node ? { ...view.addressing.nodeOf(uid)!, gateway: ip } : view.addressing.nodeOf(uid)) } };
    const forward = deliver(relay, m.node, server.uid, { kind: 'radius' }, true, ip, radiusIp);
    if (!forward.ok) continue;
    const back = forward.nat ? backOf(relay, server.uid, m.node, { kind: 'radius' }, forward) : deliver(relay, server.uid, m.node, { kind: 'radius' }, false, radiusIp, ip);
    if (back.ok) return { ok: true, path: [apUid, ...forward.path], back: back.path };
  }
  return noRadius();
};
