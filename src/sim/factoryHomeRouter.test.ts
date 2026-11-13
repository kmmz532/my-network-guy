// 家庭用ルーターの出荷時の設定（NET.md §4）: LAN の口に 192.168.1.1/24・NAPT 有効。無線つきは SSID とパスワードを持つ
import { describe, expect, it } from 'vitest';

import { factoryConfigOf } from './project';

describe('家庭用ルーターの出荷時の設定', () => {
  it('家庭用ルーターは、LAN の口（1）に 192.168.1.1/24 を持ち、NAPT が有効', () => {
    const c = factoryConfigOf('home_router');
    expect(c.interfaces).toHaveLength(1);
    expect(c.interfaces[0]).toMatchObject({ port: 1, ip: '192.168.1.1', prefix: 24, nat: 'inside' });
    expect(c.napt).toBe(true);
    expect(c.rules).toEqual([{ src: '192.168.1.0/24', dst: 'any', service: 'any' }]);
    expect(c.wireless).toBeUndefined();
  });
  it('家庭用ルーターは、DHCP のプールを持ち、LAN の PC に 192.168.1.100 から配る', () => {
    const c = factoryConfigOf('home_router');
    expect(c.dhcpPools).toEqual([{ network: '192.168.1.0', prefix: 24, start: '192.168.1.100', end: '192.168.1.199', gateway: '192.168.1.1', dns: '192.168.1.1' }]);
  });
  it('無線つきの家庭用ルーターは、SSID とパスワードを持つ', () => {
    const c = factoryConfigOf('home_router_ap');
    expect(c.wireless?.ssid).toBe('HOME');
    expect(c.wireless?.password).toBe('home1234');
  });
  it('ほかの機器は、何も持たない', () => {
    expect(factoryConfigOf('pc_basic')).toEqual({ interfaces: [] });
  });
});
