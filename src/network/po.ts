// 束ねた口（ポートチャネル）のインターフェース（Po）を、まとまった配線の代表の口に読み替える。
// 代表の口は、その機器とチャネルの番号でまとまった配線のうち、止まっていない最初の口（全部止まっていれば最初の口）。
// 読み替えの後の構成には po が残らず、以降の層は kind: 'port' と同じに扱う。まとまっていない Po は落ちた口として取り除き、機器の uid で数える
import type { LagResult } from './lag';
import type { Iface, NetNode, Network } from './types';

export interface PoResolution {
  net: Network;
  // まとまっていない Po を持つ機器の uid
  unbundled: ReadonlySet<string>;
}

export const resolvePo = (net: Network, lag: LagResult, isShut: (uid: string, port: number) => boolean): PoResolution => {
  const unbundled = new Set<string>();
  if (!net.nodes.some((n) => n.interfaces.some((i) => i.kind === 'po'))) return { net, unbundled };
  const nodes = net.nodes.map((n): NetNode => {
    if (!n.interfaces.some((i) => i.kind === 'po')) return n;
    const interfaces: Iface[] = [];
    for (const i of n.interfaces) {
      if (i.kind !== 'po') {
        interfaces.push(i);
        continue;
      }
      const bundle = lag.bundles.find((b) => b.channel === i.channel && (b.a === n.uid || b.b === n.uid));
      if (bundle === undefined) {
        unbundled.add(n.uid);
        continue;
      }
      const endOf = (l: (typeof bundle.links)[number], uid: string) => (l.a.node === uid ? l.a : l.b);
      const rep = bundle.links.find((l) => !isShut(l.a.node, l.a.port) && !isShut(l.b.node, l.b.port)) ?? bundle.links[0];
      interfaces.push({ ...i, kind: 'port', port: endOf(rep, n.uid).port });
    }
    return { ...n, interfaces };
  });
  return { net: { ...net, nodes }, unbundled };
};
