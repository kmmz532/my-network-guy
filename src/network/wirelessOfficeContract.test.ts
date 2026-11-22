// 案件 w002（小さな事務所の無線）: 親機を部屋の中央に置き、PC と同じ SSID・パスワードにすると、4台がつながり互いに届いて合格する
import { describe, expect, it } from 'vitest';
import { analyze } from './engine/analyze';
import contractJson from '../../resources/data/contracts/w002_wireless_office.json';
import { gameEnv } from '../sim/env';
import { contractLinks, fixedNodes } from '../sim/project';
import type { Contract } from '../data/schema';
import { evaluateContract } from './goals';
import type { NetNode, Network } from './types';

const contract = contractJson as unknown as Contract;
const data = gameEnv.engine;

// 想定の解答: 親機を部屋の中央（6,5）に置く。4台すべてに電波が届き、配線はいらない
const ap = {
  uid: 'ap',
  device: 'access_point',
  macSerial: 90,
  ports: [],
  x: 6,
  y: 5,
  locked: false,
  configLocked: false,
  interfaces: [],
  gateway: null,
  routes: [],
  services: [],
  components: { wireless: { ssid: 'office-wifi', password: 'office-pass-2026', security: 'wpa2', band: '2.4' } },
} as unknown as NetNode;

const net: Network = { nodes: [...fixedNodes(contract), ap], links: contractLinks(contract), plans: {} };

describe('案件 w002: 小さな事務所の無線', () => {
  it('親機を部屋の中央に置いて SSID を合わせると、4台がつながり、互いに届く', () => {
    expect(evaluateContract(contract, analyze(net, data)).passed).toBe(true);
  });
});
