// MAC アドレスの形と連番（N69）
import { describe, expect, it } from 'vitest';
import { l2Path, learnedOnPath, macOf, nextMacSerial } from './mac';
import type { NetNode } from './types';

const node = (macSerial?: number): NetNode => ({ ports: [],
  uid: `u${macSerial ?? 0}`,
  device: 'pc_basic',
  x: 0,
  y: 0,
  locked: false,
  configLocked: false,
  interfaces: [],
  gateway: null,
  routes: [],
  services: [],
  macSerial,
});

describe('MAC アドレス', () => {
  it('6組の16進で、ローカル管理のビット（02）で始まる', () => {
    const mac = macOf('pc', 0x0102, 3);
    expect(mac).toBe('02:10:00:01:02:03');
    expect(mac).toMatch(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/);
  });

  it('種類が違えば、メーカーの番号が違う', () => {
    expect(macOf('pc', 1, 0).slice(0, 8)).not.toBe(macOf('server', 1, 0).slice(0, 8));
  });

  it('連番は、同じネットワークの最大に1を足す（機器がなければ1）', () => {
    expect(nextMacSerial([])).toBe(1);
    expect(nextMacSerial([node(1), node(3)])).toBe(4);
    expect(nextMacSerial([node(undefined)])).toBe(1);
  });

  it('範囲外の値は例外にする（予備値で隠さない）', () => {
    expect(() => macOf('pc', 0, 0)).toThrow();
    expect(() => macOf('pc', 1, 256)).toThrow();
    expect(() => macOf('unknown', 1, 0)).toThrow();
  });
});


describe('スイッチが覚える MAC', () => {
  const sw = (uid: string): NetNode => ({ ...node(undefined), uid, device: 'l2_switch' });
  const pc2 = (uid: string, serial: number): NetNode => ({ ...node(serial), uid, device: 'pc_basic' });
  const link = (uid: string, a: string, ap: number, b: string, bp: number) => ({ uid, a: { node: a, port: ap }, b: { node: b, port: bp } });
  const categoryOf = (device: string) => (device === 'l2_switch' ? 'l2_switch' : 'pc');
  const isSwitch = (n: NetNode) => n.device === 'l2_switch';

  it('経路は L2 スイッチだけを通って宛先に届く', () => {
    const nodes = [pc2('a', 1), sw('s1'), sw('s2'), pc2('b', 2)];
    const links = [link('l1', 'a', 0, 's1', 0), link('l2', 's1', 5, 's2', 5), link('l3', 's2', 1, 'b', 0)];
    expect(l2Path('a', 'b', nodes, links, (u) => u.startsWith('s'))).toEqual(['a', 's1', 's2', 'b']);
  });

  it('途中に端末があれば、そこは通らない（届かなければ null）', () => {
    const nodes = [pc2('a', 1), pc2('m', 3), sw('s1'), pc2('b', 2)];
    const links = [link('l1', 'a', 0, 's1', 0), link('l2', 'm', 0, 's1', 1), link('l3', 'b', 0, 'm', 1)];
    expect(l2Path('a', 'b', nodes, links, (u) => u === 's1')).toBeNull();
  });

  it('経路の両側の端末を、スイッチの自分のポートに覚える', () => {
    const nodes = [pc2('a', 1), sw('s1'), pc2('b', 2)];
    const links = [link('l1', 'a', 0, 's1', 0), link('l2', 's1', 3, 'b', 0)];
    const learned = learnedOnPath(['a', 's1', 'b'], nodes, links, categoryOf, isSwitch);
    expect(learned).toEqual([
      { switchUid: 's1', entry: { mac: macOf('pc', 1, 0), port: 0 } },
      { switchUid: 's1', entry: { mac: macOf('pc', 2, 0), port: 3 } },
    ]);
  });
});
