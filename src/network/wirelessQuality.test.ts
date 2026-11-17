// 干渉源（電子レンジ）の近くの 2.4GHz のアクセスポイントの警告と、無線の端末の通信の品質（良・可・不可）
import { describe, expect, it } from 'vitest';
import { gameEnv } from '../sim/env';
import { analyze } from './engine/analyze';
import { warningsOf } from './query/warnings';
import { wirelessQualityOf } from './query/wirelessQuality';
import { interferenceRadius } from '../registry/wireless';
import type { EngineData, NetNode, Network } from './types';

const node = (uid: string, device: string, x: number, wireless: NonNullable<NetNode['components']>['wireless']): NetNode =>
  ({ uid, device, macSerial: x + 1, x, y: 0, locked: false, configLocked: false, interfaces: [], gateway: null, routes: [], services: [], ports: [], components: { wireless } }) as NetNode;

const apOf = (uid: string, x: number, band: '2.4' | '5', ssid = 'home', channel?: number) => node(uid, 'access_point', x, { ssid, password: 'pass1234', band, ...(channel === undefined ? {} : { channel }) });
const client = () => node('cl', 'laptop', 3, { ssid: 'home', password: 'pass1234' });
const net = (...nodes: NetNode[]): Network => ({ nodes, links: [], plans: {} });
const withOven = (x: number): EngineData => ({ ...gameEnv.engine, interferers: [{ x, y: 0 }] });
const noOven: EngineData = { ...gameEnv.engine, interferers: [] };
const interference = (n: Network, d: EngineData) => warningsOf(analyze(n, d)).filter((w) => w.id === 'wlan.interference');

describe('干渉源の警告', () => {
  it('電子レンジの半径の中の 2.4GHz のアクセスポイントに、wlan.interference を出す', () => {
    expect(interference(net(apOf('ap', 0, '2.4')), withOven(interferenceRadius()))).toEqual([{ id: 'wlan.interference', a: 'ap', b: 'ap' }]);
  });
  it('5GHz のアクセスポイントには出さない', () => {
    expect(interference(net(apOf('ap', 0, '5')), withOven(1))).toEqual([]);
  });
  it('半径の外には出さない', () => {
    expect(interference(net(apOf('ap', 0, '2.4')), withOven(interferenceRadius() + 1))).toEqual([]);
  });
});

describe('通信の品質', () => {
  const quality = (n: Network, d: EngineData) => wirelessQualityOf(analyze(n, d), 'cl');
  // 別の SSID のアクセスポイントを同じチャネルの近くに置くと、チャネルが重なる
  const crowded = (channel: number) => net(apOf('ap', 0, '2.4', 'home', 1), apOf('other', 5, '2.4', 'other', channel), client());
  it('重なりも干渉もなければ、良', () => {
    expect(quality(crowded(11), noOven)).toBe('good');
  });
  it('チャネルの重なりだけ、または干渉源だけなら、可', () => {
    expect(quality(crowded(1), noOven)).toBe('fair');
    expect(quality(crowded(11), withOven(1))).toBe('fair');
  });
  it('両方なら、不可', () => {
    expect(quality(crowded(1), withOven(1))).toBe('poor');
  });
  it('つながっていない端末は品質を持たない', () => {
    expect(quality(net(apOf('ap', 0, '2.4'), node('cl', 'laptop', 3, { ssid: 'home', password: 'wrong' })), noOven)).toBeNull();
  });
});
