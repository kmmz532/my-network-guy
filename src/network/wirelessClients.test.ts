// 目標 wireless_clients（N152）: 無線の端末が、アクセスポイントに一定数以上つながること
import { describe, expect, it } from 'vitest';
import { evaluateGoal } from './goals';
import type { EngineData, NetNode, Network } from './types';

const data: EngineData = {
  categoryOf: (device) => ({ laptop: 'pc', access_point: 'access_point' })[device] ?? 'unknown',
  maxLengthOf: () => 30,
};
const WIFI = { ssid: 'home', password: 'pass1234' };
const node = (uid: string, device: string, x: number, wireless?: NetNode['wireless']): NetNode =>
  ({ uid, device, x, y: 0, locked: false, configLocked: false, interfaces: [], gateway: null, routes: [], services: [], ports: [], ...(wireless ? { wireless } : {}) }) as NetNode;
const net = (clients: number, password = WIFI.password): Network => ({
  nodes: [node('ap', 'access_point', 0, WIFI), ...Array.from({ length: clients }, (_, i) => node(`c${i}`, 'laptop', 1 + i % 3, { ssid: WIFI.ssid, password }))],
  links: [],
  segments: {},
});

describe('wireless_clients', () => {
  it('つながった端末が必要な数あれば合格', () => {
    expect(evaluateGoal({ type: 'wireless_clients', min: 2 }, net(2), data).every((r) => r.ok)).toBe(true);
  });
  it('つながる端末が足りなければ不合格', () => {
    expect(evaluateGoal({ type: 'wireless_clients', min: 2 }, net(1), data).every((r) => r.ok)).toBe(false);
  });
  it('パスワードが違う端末はつながらない（数えない）', () => {
    expect(evaluateGoal({ type: 'wireless_clients', min: 1 }, net(1, 'wrong'), data).every((r) => r.ok)).toBe(false);
  });
});
