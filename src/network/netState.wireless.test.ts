import { ping } from './engine';
import { analyze } from './engine/analyze';
// 電波の範囲（N151）: 範囲の中の無線の端末は、最も近いアクセスポイントの LAN に入る
import { describe, expect, it } from 'vitest';
import { gameEnv } from '../sim/env';
import { WIRELESS_RADIUS, wallsBetween } from './engine/stages/links';
import type { Iface, NetNode, Network } from './types';

const f = (port: number, ip: string): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix: 24 });
const n = (uid: string, device: string, interfaces: Iface[], gateway: string | null, x: number, y = 0, wireless?: NetNode['wireless']): NetNode =>
  ({ uid, device, x, y, locked: false, configLocked: false, interfaces, gateway, routes: [], services: [], ports: [], ...(wireless ? { wireless } : {}) }) as NetNode;
const WIFI = { ssid: 'home', password: 'pass1234' };
const l = (uid: string, a: string, pa: number, b: string, pb: number) => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]] as [number, number][], paid: 0 });

// 有線の PC（LAN 192.168.1.10）— L2 スイッチ — アクセスポイント（有線の口0）。ノート PC は電波で届く
const build = (laptopX: number): Network => ({
  nodes: [
    n('pc', 'pc_basic', [f(0, '192.168.1.10')], '192.168.1.1', 0),
    n('sw', 'l2_switch_8p', [], null, 1),
    n('ap', 'access_point', [], null, 2, 0, WIFI),
    n('lap', 'laptop', [f(0, '192.168.1.20')], '192.168.1.1', laptopX, 0, WIFI),
  ],
  links: [l('l0', 'pc', 0, 'sw', 0), l('l1', 'sw', 1, 'ap', 0)],
  segments: {},
});

describe('電波の範囲（N151）', () => {
  it('範囲の中のノート PC は、アクセスポイントの LAN に入り、有線の PC と届く', () => {
    expect(ping(analyze(build(2 + 3), gameEnv.engine), 'pc', 'lap').ok).toBe(true);
    expect(ping(analyze(build(2 + 3), gameEnv.engine), 'lap', 'pc').ok).toBe(true);
  });

  it('パスワードが違う端末は、アクセスポイントにつながらず届かない', () => {
    const net = build(2 + 3);
    const wrong = { ...net, nodes: net.nodes.map((x) => (x.uid === 'lap' ? { ...x, wireless: { ssid: 'home', password: 'wrong' } } : x)) };
    expect(ping(analyze(wrong, gameEnv.engine), 'pc', 'lap').ok).toBe(false);
  });

  it('範囲の外のノート PC は、LAN に入らず届かない', () => {
    expect(ping(analyze(build(2 + WIRELESS_RADIUS + 5), gameEnv.engine), 'pc', 'lap').ok).toBe(false);
  });
});

describe('壁による減衰（N151）', () => {
  const engine = (wallAt: (x: number, y: number) => boolean) => ({ ...gameEnv.engine, wallAt });
  it('壁が1マスなら、距離が伸びる分だけ届く範囲が縮む（届く）', () => {
    // AP x=2、ノート PC x=5（距離3）。間の x=3 に壁が1つ → 3+2×1=5 ≤ 6
    expect(ping(analyze(build(5), engine((x) => x === 3)), 'pc', 'lap').ok).toBe(true);
  });
  it('壁が2マスなら、減衰後に範囲の外になり届かない', () => {
    // 壁が x=3・x=4 → 3+2×2=7 > 6
    expect(ping(analyze(build(5), engine((x) => x === 3 || x === 4)), 'pc', 'lap').ok).toBe(false);
  });
  it('壁の判定が false のマス（ドアなど）は電波を減衰させない', () => {
    expect(ping(analyze(build(5), engine(() => false)), 'pc', 'lap').ok).toBe(true);
  });
});

describe('wallsBetween', () => {
  it('両端を除いて、経路の壁のマスを数える', () => {
    expect(wallsBetween(() => true, 0, 0, 3, 0)).toBe(2);
    expect(wallsBetween(() => true, 0, 0, 1, 1)).toBe(1);
    expect(wallsBetween(() => false, 0, 0, 3, 3)).toBe(0);
  });
});

describe('無線のつながり（画面の点線）', () => {
  it('範囲の中の端末は、つながるアクセスポイントの組になる。範囲の外は組にならない', async () => {
    const { wirelessAssociations } = await import('./engine/stages/links');
    const pairs = wirelessAssociations(build(2 + 3), gameEnv.engine);
    expect(pairs.map((p) => [p.ap.uid, p.client.uid])).toEqual([['ap', 'lap']]);
    expect(wirelessAssociations(build(2 + WIRELESS_RADIUS + 5), gameEnv.engine)).toEqual([]);
  });
});

describe('無線の MAC フィルター（N153）', () => {
  it('登録のない端末は、SSID とパスワードが合ってもつながらない', () => {
    const net = build(2 + 3);
    const ap = net.nodes.find((x) => x.uid === 'ap')!;
    const filtered = { ...net, nodes: net.nodes.map((x) => (x.uid === 'ap' ? { ...ap, wireless: { ...ap.wireless, macs: ['02:00:00:00:00:00'] } } : x)) };
    expect(ping(analyze(filtered, gameEnv.engine), 'pc', 'lap').ok).toBe(false);
  });
});
