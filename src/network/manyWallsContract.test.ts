// 案件 w003（壁の多い病棟の無線）: 親機を廊下に2台置き、廊下のスイッチにつなぐと、4つの病室のPCがつながり互いに届いて合格する。壁の減衰は病棟の地図の壁で数える
import { describe, expect, it } from 'vitest';
import { analyze } from './engine/analyze';
import contractJson from '../../resources/data/contracts/w003_many_walls.json';
import hospitalWard from '../../resources/data/maps/hospital_ward.json';
import { gameEnv } from '../sim/env';
import { engineWithSite } from '../sim/walls';
import { contractLinks, fixedNodes } from '../sim/project';
import type { Contract, GameMap } from '../data/schema';
import { evaluateContract } from './goals';
import type { NetLink, NetNode, Network } from './types';

const contract = contractJson as unknown as Contract;
// 病棟の壁（病室の仕切り）を、電波の減衰に使う
const data = engineWithSite(gameEnv.engine, hospitalWard as unknown as GameMap, []);

const ap = (uid: string, x: number): NetNode =>
  ({
    uid,
    device: 'access_point',
    macSerial: x,
    ports: [],
    x,
    y: 6,
    locked: false,
    configLocked: false,
    interfaces: [],
    gateway: null,
    routes: [],
    services: [],
    components: { wireless: { ssid: 'ward-wifi', password: 'ward-pass-2026', security: 'wpa2', band: '2.4' } },
  }) as unknown as NetNode;

const cable = (uid: string, ap: string, apX: number, port: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: ap, port: 0 }, b: { node: 'SW', port }, path: [[apX, 6], [16, 6]], paid: 0 });

// 想定の解答: 親機を廊下（8,6）と（24,6）に置き、廊下のスイッチの口0と口1につなぐ。どちらの親機も、2つの病室に届く
const net: Network = {
  nodes: [...fixedNodes(contract), ap('ap1', 8), ap('ap2', 24)],
  links: [...contractLinks(contract), cable('w1', 'ap1', 8, 0), cable('w2', 'ap2', 24, 1)],
  plans: {},
};

describe('案件 w003: 壁の多い病棟の無線', () => {
  it('親機を廊下に2台置き、廊下のスイッチにつなぐと、4つの病室のPCがつながって互いに届く', () => {
    expect(evaluateContract(contract, analyze(net, data)).passed).toBe(true);
  });
});
