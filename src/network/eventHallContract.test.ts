// 案件 w005（イベント会場の無線）: 運営と来客の親機を配線でつながず、近い2台のチャネルを分け、暗号化すると、8台がつながり、運営と来客が分かれて合格する
import { describe, expect, it } from 'vitest';
import { analyze } from './engine/analyze';
import contractJson from '../../resources/data/contracts/w005_event_hall.json';
import { gameEnv } from '../sim/env';
import { contractLinks, fixedNodes } from '../sim/project';
import type { Contract } from '../data/schema';
import { evaluateContract } from './goals';
import type { NetNode, Network } from './types';

const contract = contractJson as unknown as Contract;
const data = gameEnv.engine;

const ap = (uid: string, x: number, ssid: string, password: string, channel?: number): NetNode =>
  ({
    uid,
    device: 'access_point',
    macSerial: x,
    ports: [],
    x,
    y: 5,
    locked: false,
    configLocked: false,
    interfaces: [],
    gateway: null,
    routes: [],
    services: [],
    components: { wireless: { ssid, password, security: 'wpa2', band: '2.4', ...(channel !== undefined ? { channel } : {}) } },
  }) as unknown as NetNode;

// 想定の解答: 運営の親機を（6,5）、来客の親機を（22,5）に置く。2台は16マス離れていて重なるため、来客の親機のチャネルを 6 にする。配線はつながない
const net: Network = {
  nodes: [...fixedNodes(contract), ap('staff_ap', 6, 'event-staff', 'staff-pass-2026'), ap('guest_ap', 22, 'event-guest', 'guest-pass-2026', 6)],
  links: contractLinks(contract),
  plans: {},
};

describe('案件 w005: イベント会場の無線', () => {
  it('運営と来客の親機を配線でつながず、チャネルを分けて暗号化すると、8台がつながり来客と運営が分かれて合格する', () => {
    expect(evaluateContract(contract, analyze(net, data)).passed).toBe(true);
  });
});
