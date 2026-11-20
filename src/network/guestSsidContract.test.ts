// 案件 w001（来客用の無線）: 来客用の親機を、ファイアウォールの来客用の口につなぐと合格する。社内のスイッチにつなぐと、来客の PC は社内へ届いて不合格
import { describe, expect, it } from 'vitest';
import { analyze } from './engine/analyze';
import contractJson from '../../resources/data/contracts/w001_guest_ssid.json';
import { gameEnv } from '../sim/env';
import { contractLinks, fixedNodes } from '../sim/project';
import type { Contract } from '../data/schema';
import { evaluateContract } from './goals';
import type { NetLink, Network } from './types';

const contract = contractJson as unknown as Contract;
const data = gameEnv.engine;

// 来客用の親機（GUEST_AP）の口0を、つなぐ先の口へ引く
const guestCable = (node: string, port: number): NetLink => ({
  uid: 'guest_cable',
  cable: 'utp_cat5e',
  a: { node: 'GUEST_AP', port: 0 },
  b: { node, port },
  path: [
    [14, 3],
    [10, 5],
  ],
  paid: 0,
});

const net = (guest?: NetLink): Network => ({
  nodes: fixedNodes(contract),
  links: [...contractLinks(contract), ...(guest ? [guest] : [])],
  plans: {},
});

describe('案件 w001: 来客用の無線を社内から分ける', () => {
  it('来客用の親機を、ファイアウォールの来客用の口（2番）につなぐと合格する', () => {
    expect(evaluateContract(contract, analyze(net(guestCable('FW1', 2)), data)).passed).toBe(true);
  });
  it('配線のないまま、または社内のスイッチにつないだままでは不合格（置いただけでは届かない。社内のスイッチにつなぐと社内へ届く）', () => {
    expect(evaluateContract(contract, analyze(net(), data)).passed).toBe(false);
    expect(evaluateContract(contract, analyze(net(guestCable('SW1', 3)), data)).passed).toBe(false);
  });
});
