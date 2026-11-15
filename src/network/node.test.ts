// NetNode の項目の一覧を固定する。論点の設定を NetNode へ直接足さず、新しい設定はコンポーネントとして登録する
import { describe, expect, it } from 'vitest';
import type { NetNode } from './types';
import { withComponent } from './components';

// NetNode の項目を全部書く。項目を足し引きすると、型の検査と下の一覧の照合のどちらも落ちる
const KEYS: Record<keyof NetNode, true> = {
  uid: true,
  device: true,
  powered: true,
  components: true,
  ports: true,
  hostname: true,
  name: true,
  x: true,
  y: true,
  locked: true,
  configLocked: true,
  interfaces: true,
  gateway: true,
  routes: true,
  services: true,
  macSerial: true,
};

const base: NetNode = { uid: 'a', device: 'router_basic', x: 0, y: 0, locked: false, configLocked: false, interfaces: [], gateway: null, routes: [], services: [], ports: [] };

describe('NetNode の項目', () => {
  it('項目の一覧を固定する', () => {
    expect(Object.keys(KEYS).sort()).toEqual(
      ['uid', 'device', 'powered', 'components', 'ports', 'hostname', 'name', 'x', 'y', 'locked', 'configLocked', 'interfaces', 'gateway', 'routes', 'services', 'macSerial'].sort(),
    );
  });
});

describe('コンポーネントを付ける', () => {
  it('持てる機器には付き、持てない機器には例外で止める', () => {
    expect(withComponent(base, 'ospf', { routerId: '10.0.0.1' }).components).toEqual({ ospf: { routerId: '10.0.0.1' } });
    expect(() => withComponent({ ...base, device: 'pc_basic' }, 'ospf', { routerId: '10.0.0.1' })).toThrow();
  });
});
