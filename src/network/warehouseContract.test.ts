// 案件 w004（広い倉庫の無線）: 親機を2台置き、近い2台のチャネルを重ならないように分けると、干渉がなく4台がつながって合格する
import { describe, expect, it } from 'vitest';
import { analyze } from './engine/analyze';
import contractJson from '../../resources/data/contracts/w004_warehouse.json';
import { gameEnv } from '../sim/env';
import { contractLinks, fixedNodes } from '../sim/project';
import type { Contract } from '../data/schema';
import { evaluateContract } from './goals';
import type { NetNode, Network } from './types';

const contract = contractJson as unknown as Contract;
const data = gameEnv.engine;

const ap = (uid: string, x: number, channel: number): NetNode =>
  ({
    uid,
    device: 'access_point',
    macSerial: x,
    ports: [],
    x,
    y: 4,
    locked: false,
    configLocked: false,
    interfaces: [],
    gateway: null,
    routes: [],
    services: [],
    components: { wireless: { ssid: 'warehouse-wifi', password: 'warehouse-pass-2026', security: 'wpa2', band: '2.4', channel } },
  }) as unknown as NetNode;

// 想定の解答: 親機を（9,4）と（25,4）に置く。2台は16マス離れていて重なる範囲に入るため、2台目のチャネルを 1 と重ならない 6 にする
const net: Network = {
  nodes: [...fixedNodes(contract), ap('ap1', 9, 1), ap('ap2', 25, 6)],
  links: contractLinks(contract),
  plans: {},
};

describe('案件 w004: 広い倉庫の無線', () => {
  it('2台の親機のチャネルを分けると、干渉がなく4台がつながって合格する', () => {
    expect(evaluateContract(contract, analyze(net, data)).passed).toBe(true);
  });
});
