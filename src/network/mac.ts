// MAC アドレス（N69）。形式は xx:xx:xx:xx:xx:xx。
// 先頭の3つ組は機器の種類ごとの架空のメーカーの番号（実在の OUI は使わない。ローカル管理のビット 02 で始める）、
// 次の2つは機器ごとの連番（機器を置いたときに決める。macSerial）、最後の1つはポートの番号。
import type { NetNode } from './types';

const VENDOR: Record<string, string> = {
  pc: '02:10:00',
  server: '02:20:00',
  l2_switch: '02:30:00',
  l3_switch: '02:31:00',
  router: '02:40:00',
  router_switch: '02:41:00',
  home_router: '02:42:00',
  firewall: '02:50:00',
  printer: '02:60:00',
  access_point: '02:70:00',
  uplink: '02:80:00',
};

const hex2 = (n: number): string => n.toString(16).padStart(2, '0');

// 機器のポートの MAC アドレス。種類の番号がない種類は、呼び出し側の誤り（例外）
export const macOf = (category: string, serial: number, port: number): string => {
  const vendor = VENDOR[category];
  if (!vendor) throw new Error(`MAC アドレスのメーカーの番号がない種類: ${category}`);
  if (serial < 1 || serial > 0xffff) throw new Error(`MAC アドレスの連番の範囲外: ${serial}`);
  if (port < 0 || port > 255) throw new Error(`MAC アドレスのポートの範囲外: ${port}`);
  return `${vendor}:${hex2(serial >> 8)}:${hex2(serial & 0xff)}:${hex2(port)}`;
};

// 新しい機器の連番。同じネットワークの最大の連番に1を足す（重ならない）
export const nextMacSerial = (nodes: readonly NetNode[]): number =>
  nodes.reduce((max, n) => Math.max(max, n.macSerial ?? 0), 0) + 1;

// スイッチの MAC の表の1行（ポート → MAC）
export interface MacEntry {
  mac: string;
  port: number;
}

// 送信元から宛先までの、L2スイッチだけを通る経路（BFS。端末は宛先だけを通る）。届かなければ null
export const l2Path = (
  srcUid: string,
  dstUid: string,
  nodes: readonly NetNode[],
  links: readonly { a: { node: string }; b: { node: string } }[],
  isSwitch: (uid: string) => boolean,
): string[] | null => {
  const parent = new Map<string, string | null>([[srcUid, null]]);
  const queue = [srcUid];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    if (cur === dstUid) {
      const path: string[] = [];
      for (let u: string | null | undefined = cur; u !== null && u !== undefined; u = parent.get(u)) path.unshift(u);
      return path;
    }
    // 途中で通るのはL2スイッチだけ（宛先の端末は経路の終わり）
    if (cur !== srcUid && !isSwitch(cur)) continue;
    for (const l of links) {
      const next = l.a.node === cur ? l.b.node : l.b.node === cur ? l.a.node : null;
      if (next === null || parent.has(next)) continue;
      if (!nodes.some((n) => n.uid === next)) continue;
      parent.set(next, cur);
      queue.push(next);
    }
  }
  return null;
};

// 通信の経路で、スイッチが覚える MAC（端末につながるポートだけ）。スイッチごとに、経路の両側の端末を覚える
export const learnedOnPath = (
  path: readonly string[],
  nodes: readonly NetNode[],
  links: readonly { a: { node: string; port: number }; b: { node: string; port: number } }[],
  categoryOf: (device: string) => string,
  isSwitch: (node: NetNode) => boolean,
): { switchUid: string; entry: MacEntry }[] => {
  const byUid = new Map(nodes.map((n) => [n.uid, n]));
  // 2つの機器をつなぐケーブルの、それぞれのポート（なければ null）
  const portsBetween = (x: string, y: string): { xPort: number; yPort: number } | null => {
    for (const l of links) {
      if (l.a.node === x && l.b.node === y) return { xPort: l.a.port, yPort: l.b.port };
      if (l.b.node === x && l.a.node === y) return { xPort: l.b.port, yPort: l.a.port };
    }
    return null;
  };
  const out: { switchUid: string; entry: MacEntry }[] = [];
  path.forEach((uid, i) => {
    const sw = byUid.get(uid);
    if (!sw || !isSwitch(sw)) return;
    for (const other of [path[i - 1], path[i + 1]]) {
      if (other === undefined) continue;
      const end = byUid.get(other);
      if (!end || isSwitch(end)) continue;
      const ports = portsBetween(uid, other);
      if (!ports) continue;
      out.push({ switchUid: uid, entry: { mac: macOf(categoryOf(end.device), end.macSerial ?? 0, ports.yPort), port: ports.xPort } });
    }
  });
  return out;
};
