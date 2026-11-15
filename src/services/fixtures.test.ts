import { ping } from '../network/engine';
import { dhcpOf } from '../network/query/dhcp';
// セーブの fixture（架空の内容）: 今の版の fixture があること、すべての fixture を最新版まで移行でき、検証に通り、計算が例外なく動くこと
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gameEnv } from '../sim/env';
import { can } from '../network/capabilities';
import { warningsOf } from '../network/query/warnings';
import { portStatesOf } from '../network/query/portStates';
import { analyze } from '../network/engine/analyze';
import { stpOf } from '../network/query/stp';
import { SAVE_VERSION, isCompany, migrate } from './migrations';

const dir = join(import.meta.dirname, '__fixtures__');
const files = readdirSync(dir).filter((f) => /^save-v\d+\.json$/.test(f));
type Fixture = Record<string, { saveVersion: number; data: unknown }>;

describe('OSPF の設定の移行（機器の ospf を components.ospf へ移す）', () => {
  it('移行前の機器の ospf は、移行後は components.ospf に入り、機器の直下には残らない', () => {
    const old = JSON.parse(readFileSync(join(dir, 'save-v52.json'), 'utf8')) as Fixture;
    const entry = Object.values(old)[0];
    const data = structuredClone(entry.data) as { office: { nodes: Record<string, unknown>[] } };
    const r1 = data.office.nodes.find((n) => n.uid === 'r1');
    if (r1 === undefined) throw new Error('fixture に r1 がない');
    r1.ospf = { routerId: '10.0.0.1', process: 1 };
    const moved = migrate(entry.saveVersion, data).office.nodes.find((n) => n.uid === 'r1');
    expect(moved?.components).toEqual({ ospf: { routerId: '10.0.0.1', process: 1 } });
    expect('ospf' in (moved ?? {})).toBe(false);
  });
});

describe('回線終端の設定の移行（機器の isp を components.isp へ移す）', () => {
  it('移行前の機器の isp は、移行後は components.isp に入り、機器の直下には残らない', () => {
    const old = JSON.parse(readFileSync(join(dir, 'save-v53.json'), 'utf8')) as Fixture;
    const entry = Object.values(old)[0];
    const data = structuredClone(entry.data) as { office: { nodes: Record<string, unknown>[] } };
    const line = { name: 'ISP-A', network: '198.51.100.0', prefix: 24, ispIp: '198.51.100.1', asn: 65001 };
    const uplink = { uid: 'u1', device: 'uplink', isp: line };
    data.office.nodes.push(uplink);
    const moved = migrate(entry.saveVersion, data).office.nodes.find((n) => n.uid === 'u1');
    expect(moved?.components).toEqual({ isp: line });
    expect('isp' in (moved ?? {})).toBe(false);
  });
});

describe('DHCP のプールの移行（機器の dhcpPools を components.dhcpServer へ移す）', () => {
  it('移行前の機器の dhcpPools は、移行後は components.dhcpServer に入り、機器の直下には残らない', () => {
    const old = JSON.parse(readFileSync(join(dir, 'save-v54.json'), 'utf8')) as Fixture;
    const entry = Object.values(old)[0];
    const data = structuredClone(entry.data) as { office: { nodes: Record<string, unknown>[] } };
    const pool = { network: '192.168.1.0', prefix: 24, start: '192.168.1.100', end: '192.168.1.199', gateway: '192.168.1.1' };
    data.office.nodes.push({ uid: 'srv1', device: 'server_basic', dhcpPools: [pool] });
    const moved = migrate(entry.saveVersion, data).office.nodes.find((n) => n.uid === 'srv1');
    expect(moved?.components).toEqual({ dhcpServer: [pool] });
    expect('dhcpPools' in (moved ?? {})).toBe(false);
  });
});

describe('スパニングツリーの優先度の移行（機器の stpPriority を components.stp へ移す）', () => {
  it('移行前の機器の stpPriority は、移行後は components.stp.priority に入り、機器の直下には残らない', () => {
    const old = JSON.parse(readFileSync(join(dir, 'save-v55.json'), 'utf8')) as Fixture;
    const entry = Object.values(old)[0];
    const data = structuredClone(entry.data) as { office: { nodes: Record<string, unknown>[] } };
    data.office.nodes.push({ uid: 'sw_moved', device: 'l2_switch_8p', stpPriority: 0 });
    const moved = migrate(entry.saveVersion, data).office.nodes.find((n) => n.uid === 'sw_moved');
    expect(moved?.components).toEqual({ stp: { priority: 0 } });
    expect('stpPriority' in (moved ?? {})).toBe(false);
  });
});

describe('BGP の設定の移行（機器の bgp を components.bgp へ移す）', () => {
  it('移行前の機器の bgp は、移行後は components.bgp に入り、機器の直下には残らない', () => {
    const old = JSON.parse(readFileSync(join(dir, 'save-v56.json'), 'utf8')) as Fixture;
    const entry = Object.values(old)[0];
    const data = structuredClone(entry.data) as { office: { nodes: Record<string, unknown>[] } };
    const bgp = { asn: 65001, neighbors: [{ ip: '10.0.12.2', remoteAs: 65002 }], networks: [{ dest: '10.0.1.0', prefix: 24 }] };
    data.office.nodes.push({ uid: 'r_bgp', device: 'router_basic', bgp });
    const moved = migrate(entry.saveVersion, data).office.nodes.find((n) => n.uid === 'r_bgp');
    expect(moved?.components).toEqual({ bgp });
    expect('bgp' in (moved ?? {})).toBe(false);
  });
});

describe('セーブの fixture', () => {
  it('今の版（SAVE_VERSION）の fixture がある', () => {
    expect(existsSync(join(dir, `save-v${SAVE_VERSION}.json`))).toBe(true);
  });

  for (const file of files) {
    const fixture = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Fixture;
    for (const [name, entry] of Object.entries(fixture)) {
      it(`${file} の ${name}: 最新版まで移行でき、検証に通り、ネットワークの計算が例外なく動く`, () => {
        const data = migrate(entry.saveVersion, entry.data);
        expect(isCompany(data)).toBe(true);
        const net = { nodes: data.office.nodes, links: data.office.links, plans: data.office.plans };
        // 端末は、スイッチの口もルーテッドポートも持たない機器
        const ends = net.nodes.filter((n) => n.interfaces.length > 0 && !can(n.device, 'switchport') && !can(n.device, 'routedPort')).map((n) => n.uid);
        for (const a of ends) for (const b of ends) if (a !== b) ping(analyze(net, gameEnv.engine), a, b);
        warningsOf(analyze(net, gameEnv.engine));
        dhcpOf(analyze(net, gameEnv.engine));
        stpOf(analyze(net, gameEnv.engine));
        for (const n of net.nodes) portStatesOf(analyze(net, gameEnv.engine), n.uid);
      });
    }
  }
});
