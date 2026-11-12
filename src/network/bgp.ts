// BGP の計算（純粋関数）: セッション・経路の広告・最適経路の選択
// - eBGP（相手の AS が自分と違う）は、AS パスに自分の AS を足して広告する。iBGP（同じ AS）は AS パスを変えず、iBGP で学んだ経路を別の iBGP の相手へ伝えない
// - 最適経路: ローカルプリファレンス（大）→ AS パス（短）→ MED（小。同じ隣の AS から来た経路の間だけ）→ eBGP を iBGP より優先 → 隣接のアドレス（小）
// - 経路のネクストホップに届かないと使えない（iBGP は next-hop-self がないと外の相手のアドレスのまま。bgp.nexthop_unreachable）
import { ipToInt } from './engine';
import type { NetNode } from './types';

export const BGP_DEFAULT_LOCAL_PREF = 100;

export interface BgpEnv {
  // 相手のアドレス ip が、r と同じ L2 のドメインにあり、r のインターフェースのサブネットに入る（直結）
  direct: (r: NetNode, ip: string) => boolean;
  // r が ip へ届く（直結・静的・OSPF・RIP の経路が覆う）
  reaches: (r: NetNode, ip: string) => boolean;
}

export interface BgpCandidate {
  dest: string;
  prefix: number;
  path: number[];
  localPref: number;
  med: number;
  ebgp: boolean;
  // 自分で広告する経路（network 文）か
  local: boolean;
  nextHop: string | null;
  // 学んだ相手のアドレス（自分の経路は null）
  from: string | null;
  // ネクストホップに届く（届かない経路は使えない）
  valid: boolean;
  best: boolean;
}

export type BgpSessionState =
  | { state: 'established' }
  | { state: 'idle'; reason: 'no_peer' | 'as_mismatch' | 'not_configured_back' | 'unreachable' };

export interface BgpSession {
  ip: string;
  remoteAs: number;
  ebgp: boolean;
  peer: string | null;
  status: BgpSessionState;
}

export interface BgpResult {
  sessions: BgpSession[];
  candidates: BgpCandidate[];
}

const keyOf = (dest: string, prefix: number) => `${dest}/${prefix}`;

// 同じ宛先の候補から最適経路を選ぶ（ネクストホップに届く候補だけが対象）
const better = (a: BgpCandidate, b: BgpCandidate): boolean => {
  if (a.localPref !== b.localPref) return a.localPref > b.localPref;
  if (a.path.length !== b.path.length) return a.path.length < b.path.length;
  // MED は、同じ隣の AS から来た経路の間だけ比べる
  if (a.path[0] === b.path[0] && a.med !== b.med) return a.med < b.med;
  if (a.ebgp !== b.ebgp) return a.ebgp;
  return ipToInt(a.from ?? '0.0.0.0') < ipToInt(b.from ?? '0.0.0.0');
};

export const computeBgp = (routers: NetNode[], env: BgpEnv): Map<string, BgpResult> => {
  const byUid = new Map(routers.map((r) => [r.uid, r]));
  const ownerOf = (ip: string) => routers.find((r) => r.interfaces.some((i) => i.ip === ip));

  // セッション: 双方が相手を neighbor に書き、AS 番号が合い、届く（eBGP は直結、iBGP は経路で届く）
  const sessionsOf = new Map<string, BgpSession[]>();
  for (const r of routers) {
    const list: BgpSession[] = [];
    for (const nb of r.bgp!.neighbors) {
      const ebgp = nb.remoteAs !== r.bgp!.asn;
      const peer = ownerOf(nb.ip);
      let status: BgpSessionState;
      if (!peer || peer.uid === r.uid) status = { state: 'idle', reason: 'no_peer' };
      else if (peer.bgp!.asn !== nb.remoteAs) status = { state: 'idle', reason: 'as_mismatch' };
      else if (!peer.bgp!.neighbors.some((x) => x.remoteAs === r.bgp!.asn && r.interfaces.some((i) => i.ip === x.ip))) status = { state: 'idle', reason: 'not_configured_back' };
      else if (ebgp ? !env.direct(r, nb.ip) : !env.direct(r, nb.ip) && !env.reaches(r, nb.ip)) status = { state: 'idle', reason: 'unreachable' };
      else status = { state: 'established' };
      list.push({ ip: nb.ip, remoteAs: nb.remoteAs, ebgp, peer: peer?.uid ?? null, status });
    }
    sessionsOf.set(r.uid, list);
  }

  // 各機器の候補（自分の経路と、相手から受け取った経路）。収束するまで繰り返す
  const tables = new Map<string, BgpCandidate[]>();
  const bestOf = (cands: BgpCandidate[]): Map<string, BgpCandidate> => {
    const best = new Map<string, BgpCandidate>();
    for (const c of cands) {
      if (!c.valid) continue;
      const k = keyOf(c.dest, c.prefix);
      const cur = best.get(k);
      if (!cur || better(c, cur)) best.set(k, c);
    }
    return best;
  };
  for (const r of routers) {
    tables.set(
      r.uid,
      r.bgp!.networks.map((n) => ({ dest: n.dest, prefix: n.prefix, path: [], localPref: BGP_DEFAULT_LOCAL_PREF, med: 0, ebgp: false, local: true, nextHop: null, from: null, valid: true, best: false })),
    );
  }
  for (let round = 0; round < routers.length + 2; round++) {
    let changed = false;
    const next = new Map<string, BgpCandidate[]>();
    for (const r of routers) {
      const own = tables.get(r.uid)!.filter((c) => c.local);
      const received: BgpCandidate[] = [];
      for (const s of sessionsOf.get(r.uid)!) {
        if (s.status.state !== 'established' || s.peer === null) continue;
        const peer = byUid.get(s.peer)!;
        const mine = r.bgp!.neighbors.find((n) => n.ip === s.ip)!;
        // 相手（広告する側）の、自分（r）に向けた設定（プリペンド・next-hop-self）
        const peerNb = peer.bgp!.neighbors.find((n) => n.remoteAs === r.bgp!.asn && r.interfaces.some((i) => i.ip === n.ip))!;
        const peerBest = bestOf(tables.get(peer.uid)!);
        for (const c of peerBest.values()) {
          // iBGP で学んだ経路は、別の iBGP の相手へ伝えない
          if (!s.ebgp && !c.local && !c.ebgp) continue;
          // 受け取る側（r）が自分の AS を含む経路は捨てる（ループ）
          const advPath = s.ebgp ? [peer.bgp!.asn, ...Array.from({ length: peerNb.prepend ?? 0 }, () => peer.bgp!.asn), ...c.path] : c.path;
          if (advPath.includes(r.bgp!.asn)) continue;
          // eBGP は、相手のアドレスがネクストホップ。iBGP は、そのまま（next-hop-self なら相手のアドレス）
          const peerAddr = s.ip;
          const nextHop = s.ebgp || peerNb.nextHopSelf === true || c.local ? peerAddr : c.nextHop;
          if (nextHop === null) continue;
          received.push({
            dest: c.dest,
            prefix: c.prefix,
            path: advPath,
            localPref: s.ebgp ? (mine.localPref ?? BGP_DEFAULT_LOCAL_PREF) : c.localPref,
            med: mine.med ?? 0,
            ebgp: s.ebgp,
            local: false,
            nextHop,
            from: s.ip,
            valid: env.direct(r, nextHop) || env.reaches(r, nextHop),
            best: false,
          });
        }
      }
      next.set(r.uid, [...own, ...received]);
    }
    for (const [uid, list] of next) {
      if (JSON.stringify(list) !== JSON.stringify(tables.get(uid))) changed = true;
      tables.set(uid, list);
    }
    if (!changed) break;
  }

  const out = new Map<string, BgpResult>();
  for (const r of routers) {
    const cands = tables.get(r.uid)!;
    const best = bestOf(cands);
    const marked = cands.map((c) => ({ ...c, best: best.get(keyOf(c.dest, c.prefix)) === c }));
    out.set(r.uid, { sessions: sessionsOf.get(r.uid)!, candidates: marked });
  }
  return out;
};
