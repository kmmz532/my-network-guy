// 転送（ping・http・配送）。往路と復路の判定は、計算の結果（配線・L2・アドレス・経路の層）を読むだけで、計算し直さない
import { CATEGORY } from '../../data/categories';
import { can } from '../capabilities';
import { isRoutingCategory } from '../category';
import { inSubnet, isPrivateIp } from '../ip';
import { macOf } from '../mac';
import type { Endpoint, Failure, FailureReason, FirewallRule, Iface, NetNode, PathResult, PortConfig } from '../types';
import { deviceCategory } from '../../registry/query';
import type { NetworkState } from './state';
import type { L2Domain } from './stages/l2';
import { adOf } from './stages/routing';

// 転送が読む層。解析の結果（NetworkState）と、DHCP のリレーの到達を仮に確かめるときの仮の層が、同じ形で渡せる
export type ForwardView = Pick<NetworkState, 'links' | 'l2' | 'addressing' | 'routing'>;

const MAX_HOPS = 16;

const kindOf = (view: ForwardView, uid: string): string => {
  const node = view.addressing.nodeOf(uid);
  return node ? deviceCategory(node.device) : '';
};
const isRouter = (view: ForwardView, uid: string): boolean => isRoutingCategory(kindOf(view, uid));
const ifaceAt = (view: ForwardView, uid: string, port: number): Iface | undefined => view.addressing.nodeOf(uid)?.interfaces.find((i) => i.port === port);
// 口の設定（PortConfig）。設定のない口は、VLAN 1 の access として動く
const portCfg = (view: ForwardView, uid: string, port: number): PortConfig | undefined => view.addressing.nodeOf(uid)?.ports?.find((p) => p.port === port);

export const fail = (reason: FailureReason, node: string): Failure => ({ reason, node });

// 重複したアドレスのどれかが DHCP で配られたものなら、理由を分けて示す
const duplicateReason = (view: ForwardView, members: { node: string; port: number }[]): FailureReason =>
  members.some((m) => ifaceAt(view, m.node, m.port)?.dhcp) ? 'ip.duplicate.dhcp' : 'ip.duplicate';

// 片道の判定（src → dst）。dstIp は宛先のIPアドレス
// 通信の種類（ping は ICMP、http は指定のポートへの TCP）。ファイアウォールの規則の判定に使う
export type Traffic = { kind: 'ping' } | { kind: 'http'; port: number };

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
const unpluggedReason = (view: ForwardView, uid: string): 'link.unplugged' | 'wireless.unassociated' | 'wlan.psk_mismatch' | 'wlan.auth_mismatch' => {
  const node = view.addressing.nodeOf(uid);
  if (node === undefined || !can(node.device, 'wireless')) return 'link.unplugged';
  // 同じ SSID のアクセスポイントがあるのに、パスワードか暗号化の方式が合わない
  const same = view.addressing.net.nodes.filter((n) => n.uid !== uid && n.wireless?.ssid !== undefined && n.wireless.ssid === node.wireless?.ssid && can(n.device, 'wireless') && n.wireless.password !== undefined);
  if (same.some((ap) => (ap.wireless?.security ?? 'wpa2') !== 'open' && ap.wireless?.password !== node.wireless?.password)) return 'wlan.psk_mismatch';
  if (same.some((ap) => ap.wireless?.security === 'wpa3') && !can(node.device, 'wpa3')) return 'wlan.auth_mismatch';
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

export const deliver = (view: ForwardView, srcUid: string, dstUid: string, traffic: Traffic = { kind: 'ping' }, check = true, srcIp?: string, dstIp?: string): PathResult => {
  const path: string[] = [];
  const src = view.addressing.nodeOf(srcUid);
  const dst = view.addressing.nodeOf(dstUid);
  const err = (failure: Failure): PathResult => ({ ok: false, path, failure });

  if (!src || !dst) return err(fail('ip.unset', srcUid));

  // 送信元・宛先のアドレスを指定したときは、そのインターフェース（省略は最初の口）
  const srcIface = srcIp === undefined ? src.interfaces[0] : src.interfaces.find((i) => i.ip === srcIp);
  if (!srcIface) return err(fail('ip.unset', src.uid));
  // 自動（DHCP）の口がアドレスを受け取れなかった
  if (srcIface.dhcp === true && view.addressing.dhcp.failed.some((f) => f.uid === src.uid && f.port === srcIface.port)) return err(fail(view.addressing.dhcp.failed.find((f) => f.uid === src.uid && f.port === srcIface.port)?.reason ?? 'dhcp.no_offer', src.uid));
  const srcEp: Endpoint = { node: src.uid, port: srcIface.port };
  if (view.links.isShut(src.uid, srcIface.port)) return err(fail('port.shutdown', src.uid));
  if (!view.l2.linkAt(srcEp)) return err(fail(unpluggedReason(view, src.uid), src.uid));
  const srcSecurity = securityDenied(view, src, srcIface.port);
  if (srcSecurity) return err(srcSecurity);
  // 相手の口が停止していれば、その口で止まる（port.shutdown）
  const srcPeer = view.l2.linkAt(srcEp)!.peer;
  if (view.links.isShut(srcPeer.node, srcPeer.port)) return err(fail('port.shutdown', srcPeer.node));

  const dstIface = dstIp === undefined ? dst.interfaces[0] : dst.interfaces.find((i) => i.ip === dstIp);
  if (!dstIface) return err(fail('ip.unset', dst.uid));
  const dstEp: Endpoint = { node: dst.uid, port: dstIface.port };
  if (!view.l2.linkAt(dstEp)) return err(fail(unpluggedReason(view, dst.uid), dst.uid));
  const dstSecurity = securityDenied(view, dst, dstIface.port);
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
    // 仮想の IP アドレスの持ち主（マスター）がいない: 同じ VRID の全員が止まっている
    if (view.addressing.net.nodes.some((n) => n.interfaces.some((i) => i.vrrp?.some((g) => g.ip === src.gateway)))) return err(fail('vrrp.no_master', src.uid));
    return err(fail('gateway.unreachable', src.uid));
  }

  let current: Endpoint = gwMember;
  // 今の送信元のアドレス（NAPT で変わる）と、変換の記録
  let curSrcIp = srcIface.ip;
  let natHit: PathResult['nat'];
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const cur = view.addressing.nodeOf(current.node);
    if (!cur) return err(fail('route.none', current.node));

    if (cur.uid === dst.uid) {
      path.push(cur.uid);
      return { ok: true, path, nat: natHit };
    }
    if (!isRouter(view, cur.uid)) return err(fail('route.none', cur.uid));
    path.push(cur.uid);
    // ファイアウォールは、規則に合う通信だけを通す（既定は拒否）
    if (check && kindOf(view, cur.uid) === CATEGORY.firewall && !allows(cur.rules, srcIface.ip, dstIface.ip, traffic)) {
      return err(fail('firewall.denied', cur.uid));
    }

    // 家庭用ルーターは、外から始まる通信を既定で止める（社内へ向かう往路を外の口から受けたら拒否。静的 NAT の転送は別の経路で届く・NET.md §4）
    const arrivedFrom = cur.interfaces.find((i) => i.port === current.port);
    if (check && kindOf(view, cur.uid) === CATEGORY.homeRouter && arrivedFrom?.nat === 'outside') {
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
      const domain = view.l2.domainOf({ node: cur.uid, port: connected.port });
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
    const matches = view.routing.routesOf(cur.uid).filter((r) => inSubnet(dstIface.ip, r.dest, r.prefix));
    if (matches.length === 0) {
      // BGP の相手と隣接しない（アドレスか AS 番号が合わない）ときは bgp.no_session（N147）
      const bgp = cur.bgp ? view.routing.bgpOf(cur.uid) : undefined;
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
  const insideIface = view.addressing.nodeOf(router)?.interfaces.find((i) => inSubnet(insideIp, i.ip, i.prefix));
  if (!insideIface || !src || !dst) return { ok: false, path: toRouter.path, failure: fail('route.none', router) };
  const rest = deliver(view, router, srcUid, traffic, false, insideIface.ip, undefined);
  return rest.ok ? { ...rest, path: [...toRouter.path, ...rest.path.slice(1)] } : rest;
};


// 静的 NAT（ポートの転送）: 外からルーターの外の口へのポートの通信を、社内のサーバーへ届ける。往路は外→外の口→社内の口→サーバー、復路は逆に戻す（N145）
const viaStatic = (view: ForwardView, srcUid: string, routerUid: string, traffic: Traffic): PathResult | null => {
  const r = view.addressing.nodeOf(routerUid);
  if (!r || traffic.kind !== 'http') return null;
  const map = r.statics?.find((s) => s.port === traffic.port);
  if (!map) return null;
  const outside = r.interfaces.find((i) => i.nat === 'outside');
  const inside = r.interfaces.find((i) => i.nat === 'inside' && inSubnet(map.insideIp, i.ip, i.prefix));
  const server = view.addressing.net.nodes.find((n) => n.interfaces.some((i) => i.ip === map.insideIp));
  if (!outside || !inside || !server) return { ok: false, path: [], failure: fail('route.none', routerUid) };
  const toRouter = deliver(view, srcUid, routerUid, traffic, true, undefined, outside.ip);
  if (!toRouter.ok) return toRouter;
  const toServer = deliver(view, routerUid, server.uid, { kind: 'http', port: map.insidePort }, false, inside.ip, map.insideIp);
  if (!toServer.ok) return { ok: false, path: toRouter.path, failure: toServer.failure };
  if (!server.services.some((s) => s.protocol === 'http' && s.port === map.insidePort)) return { ok: false, path: toRouter.path, failure: fail('service.closed', server.uid) };
  const back = deliver(view, server.uid, routerUid, traffic, false, map.insideIp, inside.ip);
  if (!back.ok) return { ok: false, path: toRouter.path, failure: { reason: 'return.failed', node: server.uid, cause: back.failure } };
  return { ok: true, path: [...toRouter.path, ...toServer.path.slice(1)], staticNat: { router: routerUid, insideIp: map.insideIp, outsideIp: outside.ip } };
};

// Ping（ICMP）の判定。往路と復路の両方が通る必要がある
export const ping = (view: ForwardView, srcUid: string, dstUid: string): PathResult => {
  const forward = deliver(view, srcUid, dstUid, { kind: 'ping' });
  if (!forward.ok) return forward;
  const back = backOf(view, dstUid, srcUid, { kind: 'ping' }, forward);
  if (!back.ok) {
    return { ok: false, path: forward.path, failure: { reason: 'return.failed', node: dstUid, cause: back.failure }, nat: forward.nat };
  }
  return { ...forward, back: back.path };
};

// HTTP の判定。往路で宛先に届き、宛先が指定ポートでサービスを待ち受けていて、復路も通ること
export const http = (view: ForwardView, srcUid: string, dstUid: string, port: number): PathResult => {
  // 外の口への通信が、静的 NAT で社内のサーバーへ届く場合（N145）
  const nat = viaStatic(view, srcUid, dstUid, { kind: 'http', port });
  if (nat !== null) return nat;
  const forward = deliver(view, srcUid, dstUid, { kind: 'http', port });
  if (!forward.ok) return forward;
  const dst = view.addressing.nodeOf(dstUid);
  // 外から、NAT のルーターの外の口へ来た通信に、静的 NAT の転送先がない（nat.no_forward・NET.md §6）
  if (dst && dst.napt && dst.interfaces.some((i) => i.nat === 'outside') && !dst.statics?.some((s) => s.port === port)) {
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
