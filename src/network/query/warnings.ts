import type { NetworkState } from '../engine/state';
import type { PortConfig } from '../types';
import { accessPointsOf, inSubnet, type VlanWarning } from '../netState';
import { dhcpOf } from './dhcp';
import { computeLags } from '../lag';
import { can } from '../capabilities';
import { portSpeed } from '../../registry/query';
import { duplicateRouterIds } from '../ospf';

export const warningsOf = (state: NetworkState): VlanWarning[] => {
  const net = state.input;
  const data = state.world;
  const cfgOf = (uid: string, port: number): PortConfig | undefined => net.nodes.find((n) => n.uid === uid)?.ports.find((p) => p.port === port);
  const out: VlanWarning[] = [];
  for (const l of net.links) {
    const ca = cfgOf(l.a.node, l.a.port);
    const cb = cfgOf(l.b.node, l.b.port);
    if (!ca || !cb) continue;
    if (ca.mode === 'access' && cb.mode === 'access' && (ca.vlan ?? 1) !== (cb.vlan ?? 1)) out.push({ id: 'vlan.mismatch', a: l.a.node, b: l.b.node });
    if (ca.mode === 'trunk' && cb.mode === 'trunk' && (ca.native ?? 1) !== (cb.native ?? 1)) out.push({ id: 'vlan.native_mismatch', a: l.a.node, b: l.b.node });
  }
  // 無線: 暗号化のない SSID・弱い暗号（WEP・WPA）・WPA2/WPA3 の移行モード（アクセスポイントごとに1件）
  for (const ap of accessPointsOf(net, data)) {
    if (ap.wireless?.ssid === undefined) continue;
    const s = ap.wireless.security ?? 'wpa2';
    const id = s === 'open' ? 'wlan.open' : s === 'wep' || s === 'wpa' ? 'wlan.weak_cipher' : s === 'wpa2wpa3' ? 'wlan.transition' : null;
    if (id) out.push({ id, a: ap.uid, b: ap.uid });
  }
  // DHCP: 同じドメインに DHCP サーバーが2台以上ある（サーバーの組ごとに1件）
  const pairs = new Set<string>();
  for (const m of dhcpOf(state).multiple) {
    const key = [...m.servers].sort().join('|');
    if (pairs.has(key)) continue;
    pairs.add(key);
    out.push({ id: 'dhcp.multiple_servers', a: m.servers[0], b: m.servers[1] });
  }
  // リンクアグリゲーション: まとまらない口がある2台（組ごとに1件）
  const lag = computeLags(net.nodes, net.links, (n) => can(n.device, 'lag'), (n, port) => portSpeed(n.device, port));
  const lagPairs = new Set<string>();
  for (const l of net.links) {
    if (!lag.mismatched.has(l.uid)) continue;
    const pair = [l.a.node, l.b.node].sort().join('|');
    if (lagPairs.has(pair)) continue;
    lagPairs.add(pair);
    out.push({ id: 'lag.mismatch', a: l.a.node, b: l.b.node });
  }
  // VRRP: 同じネットワーク・同じ VRID で仮想の IP アドレスが違う（組ごとに1件）と、端末のゲートウェイが仮想ではなく実の IP アドレス
  const groups = net.nodes.flatMap((n) => n.interfaces.flatMap((i) => (i.vrrp ?? []).map((g) => ({ uid: n.uid, iface: i, g }))));
  for (let x = 0; x < groups.length; x++) {
    for (let y = x + 1; y < groups.length; y++) {
      const a = groups[x];
      const b = groups[y];
      if (a.uid !== b.uid && a.g.vrid === b.g.vrid && a.g.ip !== b.g.ip && inSubnet(a.iface.ip, b.iface.ip, b.iface.prefix)) out.push({ id: 'vrrp.vip_mismatch', a: a.uid, b: b.uid });
    }
  }
  for (const n of net.nodes) {
    if (!n.gateway || n.interfaces.some((i) => i.vrrp !== undefined)) continue;
    const owner = groups.find((x) => x.iface.ip === n.gateway);
    if (owner) out.push({ id: 'vrrp.gateway_real_ip', a: n.uid, b: owner.uid });
  }
  // 同じルーター ID の OSPF のルーター（組ごとに1件）
  for (const uids of duplicateRouterIds(net.nodes)) out.push({ id: 'ospf.duplicate_router_id', a: uids[0], b: uids[1] });
  return out;
};
