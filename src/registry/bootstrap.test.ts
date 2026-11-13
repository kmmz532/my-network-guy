import { describe, expect, it } from 'vitest';
import type { Cable, Device, Furniture } from '../data/schema';
import { bootstrap } from './bootstrap';
import { registries } from './game';

const device = (id: string, over: Partial<Device> = {}): Device => ({
  id,
  category: 'pc',
  capabilities: ['switchport'],
  deskable: false,
  price: 10,
  ports: [
    { type: 'rj45', count: 2, speedMbps: 1000 },
    { type: 'sfp', count: 1, speedMbps: 10000 },
  ],
  features: [],
  defaultServices: [],
  sprite: 's',
  unlockLevel: 1,
  ...over,
});

describe('bootstrap', () => {
  it('架空のデータから登録表を作り、口を1口ずつ並べる', () => {
    const r = bootstrap({
      devices: { x: device('x') },
      cables: { c: { id: 'c', port: 'rj45', bandwidthMbps: 1000, maxLengthTiles: 5, pricePerLink: 1, pricePerTile: 1, unlockLevel: 1 } as Cable },
      furniture: { f: { id: 'f', price: 1, sprite: 's', seat: false, unlockLevel: 1 } as Furniture },
    });
    expect(r.devices.get('x').ports.map((p) => p.type)).toEqual(['rj45', 'rj45', 'sfp']);
    expect(r.devices.get('x').capabilities.has('switchport')).toBe(true);
    expect(r.cables.has('c')).toBe(true);
    expect(() => r.devices.register(r.devices.get('x'))).toThrow();
  });
  it('実データの登録表に機器が入っている', () => {
    expect(registries.devices.all().length).toBeGreaterThan(0);
  });
});
