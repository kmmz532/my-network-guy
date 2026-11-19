// IPsec VPN のトンネルが張れるかの判定。転送（forward.ts）は、ここで求めた結果を読んで、張れたトンネルへ通信を入れるだけ。
// 張れる条件は、(1) 両端が互いの WAN のアドレスを peer に持つ、(2) 両端の WAN が外（回線とインターネット）で UDP 500 で届く、
// (3) 事前共有鍵が同じ、(4) 暗号の方式が同じ、(5) 守るネットワークの組（local と remote）が左右対称。この順に確かめ、最初の違反を理由にする。
import { can } from '../capabilities';
import type { Components } from '../components';
import { getComponent } from '../components';
import type { ForwardView } from '../engine/forward';
import { inSubnet, networkOf } from '../ip';
import type { FailureReason, NetNode, PathResult } from '../types';

export type VpnTunnel = NonNullable<Components['vpn']>[number];

export type VpnFailure = Extract<FailureReason, 'vpn.peer_unreachable' | 'vpn.psk_mismatch' | 'vpn.proposal_mismatch' | 'vpn.selector_mismatch'>;

// トンネル1本の状態。張れたときは、相手の機器と、相手の WAN の口の番号を持つ
export type TunnelStatus =
  | { router: string; index: number; tunnel: VpnTunnel; ok: true; peer: string; localIp: string; peerIp: string; peerPort: number }
  | { router: string; index: number; tunnel: VpnTunnel; ok: false; reason: VpnFailure };

export interface VpnLayer {
  tunnels: readonly TunnelStatus[];
}

export const NO_VPN: VpnLayer = { tunnels: [] };

// 仮想のインターネット（ISP）を加えた構成の転送の層と、その ISP の機器の uid
export interface Internet {
  view: ForwardView;
  uids: readonly string[];
}

// 外の通信（UDP 500）の片道。通り道のファイアウォールの規則を確かめる
export type Send = (view: ForwardView, from: string, to: string, srcIp: string, dstIp: string) => PathResult;

const parseCidr = (spec: string): { network: string; prefix: number } => {
  const [network, prefix] = spec.split('/');
  return { network, prefix: Number(prefix) };
};

// アドレスが、a.b.c.d/nn のネットワークに入るか
export const inCidr = (ip: string, spec: string): boolean => {
  const { network, prefix } = parseCidr(spec);
  return inSubnet(ip, network, prefix);
};

// 2つの a.b.c.d/nn が同じネットワークか（ホスト部の書き方の違いは無視する）
const sameCidr = (a: string, b: string): boolean => {
  const x = parseCidr(a);
  const y = parseCidr(b);
  return x.prefix === y.prefix && networkOf(x.network, x.prefix) === networkOf(y.network, y.prefix);
};

const ispIpOf = (internet: Internet, isp: string): string => {
  const ip = internet.view.addressing.nodeOf(isp)?.interfaces[0]?.ip;
  if (ip === undefined) throw new Error(`ISP の機器にアドレスがない: ${isp}`);
  return ip;
};

// from（WAN のアドレス fromIp）から to（WAN のアドレス toIp）へ、UDP 500 が外を通って届くか。
// 出る側は from から回線の先（ISP）まで、入る側は ISP から to まで。どちらも通り道のファイアウォールを確かめる
const ikeReaches = (internet: Internet | null, send: Send, from: string, fromIp: string, to: string, toIp: string): boolean => {
  if (internet === null) return false;
  const out = internet.uids.some((isp) => send(internet.view, from, isp, fromIp, ispIpOf(internet, isp)).ok);
  const into = internet.uids.some((isp) => send(internet.view, isp, to, ispIpOf(internet, isp), toIp).ok);
  return out && into;
};

// 全トンネルの状態。base は外を加えない構成、internet は外を加えた構成（回線がなければ null）
export const tunnelsOf = (nodes: readonly NetNode[], internet: Internet | null, send: Send): VpnLayer => {
  const owners = nodes.filter((n) => can(n.device, 'vpn') && getComponent(n, 'vpn') !== undefined);
  const tunnels: TunnelStatus[] = [];
  for (const r of owners) {
    (getComponent(r, 'vpn') ?? []).forEach((t, index) => {
      const base = { router: r.uid, index, tunnel: t };
      const down = (reason: VpnFailure): TunnelStatus => ({ ...base, ok: false, reason });
      const peer = owners.find((n) => n.uid !== r.uid && n.interfaces.some((i) => i.ip === t.peer));
      // 相手が、こちらの WAN のアドレスを peer に持つトンネル
      const mirror = peer && (getComponent(peer, 'vpn') ?? []).find((x) => r.interfaces.some((i) => i.ip === x.peer));
      const peerIface = peer?.interfaces.find((i) => i.ip === t.peer);
      if (!peer || !mirror || !peerIface) return tunnels.push(down('vpn.peer_unreachable'));
      const localIp = mirror.peer;
      if (!ikeReaches(internet, send, r.uid, localIp, peer.uid, t.peer) || !ikeReaches(internet, send, peer.uid, t.peer, r.uid, localIp)) return tunnels.push(down('vpn.peer_unreachable'));
      if (t.psk !== mirror.psk) return tunnels.push(down('vpn.psk_mismatch'));
      if (t.cipher !== mirror.cipher) return tunnels.push(down('vpn.proposal_mismatch'));
      if (!sameCidr(t.local, mirror.remote) || !sameCidr(t.remote, mirror.local)) return tunnels.push(down('vpn.selector_mismatch'));
      return tunnels.push({ ...base, ok: true, peer: peer.uid, localIp, peerIp: t.peer, peerPort: peerIface.port });
    });
  }
  return { tunnels };
};

// 機器（router）が、送信元 srcIp から宛先 dstIp への通信に使うトンネル（自拠点のネットワークから相手のネットワークへ向かう通信）
export const tunnelFor = (view: ForwardView, router: string, srcIp: string, dstIp: string): TunnelStatus | undefined =>
  view.vpn.tunnels.find((t) => t.router === router && inCidr(srcIp, t.tunnel.local) && inCidr(dstIp, t.tunnel.remote));
