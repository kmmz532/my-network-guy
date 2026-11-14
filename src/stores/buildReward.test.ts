// 施工が終わった納品の結果を、毎ティックの系がストアへ写すとき、報酬の機器が持ち物に残ること
import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import c001 from '../assets/data/contracts/c001_direct_link.json';
import type { Balance, Contract } from '../data/schema';
import type { Offer } from '../contracts/template';
import { minutesPerDay } from '../sim/clock';
import { familiarKeyOf } from '../sim/familiar';
import { buildSystem } from './tickSystems';
import { useGameStore } from './useGameStore';

const balance = balanceJson as unknown as Balance;
const base = c001 as unknown as Contract;
const contract: Contract = { ...base, reward: { ...base.reward, devices: [{ device: 'server_basic', count: 1 }] } };
const offer: Offer = { id: 'c001_direct_link', kind: 'fixed', baseId: 'c001_direct_link', params: {}, contract };
const st = () => useGameStore.getState();

describe('施工の完了と報酬の機器', () => {
  it('任せた依頼の納品で、報酬の機器が持ち物に入る', () => {
    // 3回納品した依頼は、型紙なしでも社員に任せられる
    const familiarity = { counts: { [familiarKeyOf('fixed', offer.baseId, contract.map)]: 3 }, blueprints: {} };
    useGameStore.setState({ offers: [offer], active: [], focus: null, owned: {}, showcase: null, lastReport: null, familiarity });
    expect(st().delegateBlind(offer.id, st().staff.map((m) => m.uid))).toBeNull();
    // 勤務時間の初めから、施工が終わるまで1時間ずつ進める
    let state = st();
    const start = Math.ceil(state.clock.minute / minutesPerDay) * minutesPerDay + balance.build.workStartHour * 60;
    for (let i = 0; i < 200 && state.active.length > 0; i++) {
      const clock = { ...state.clock, minute: start + (i % 8) * 60 + Math.floor(i / 8) * minutesPerDay };
      state = { ...state, ...buildSystem(state, {}, clock, 0) } as typeof state;
    }
    expect(state.active).toHaveLength(0);
    expect(state.owned.server_basic).toBe(1);
  });
});
