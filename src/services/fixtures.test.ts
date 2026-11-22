import { ping, wirelessAssociations } from '../network/engine';
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

describe('無線の設定の移行（機器の wireless を components.wireless へ移す）', () => {
  it('移行前の機器の wireless は、移行後は components.wireless に入り、機器の直下には残らない', () => {
    const old = JSON.parse(readFileSync(join(dir, 'save-v57.json'), 'utf8')) as Fixture;
    const entry = Object.values(old)[0];
    const data = structuredClone(entry.data) as { office: { nodes: Record<string, unknown>[] } };
    const wireless = { ssid: 'lab', password: 'lab-pass', channel: 6, security: 'wpa3' };
    data.office.nodes.push({ uid: 'ap_new', device: 'access_point', wireless });
    const moved = migrate(entry.saveVersion, data).office.nodes.find((n) => n.uid === 'ap_new');
    expect(moved?.components).toEqual({ wireless: { ...wireless, band: '2.4' } });
    expect('wireless' in (moved ?? {})).toBe(false);
  });
});

describe('NAT の設定の移行（機器の napt・statics を components.nat へ移す）', () => {
  it('移行前の機器の napt・statics は、移行後は components.nat に入り、機器の直下には残らない', () => {
    const old = JSON.parse(readFileSync(join(dir, 'save-v58.json'), 'utf8')) as Fixture;
    const entry = Object.values(old)[0];
    const data = structuredClone(entry.data) as { office: { nodes: Record<string, unknown>[] } };
    const statics = [{ port: 80, insideIp: '192.168.1.20', insidePort: 8080 }];
    data.office.nodes.push({ uid: 'r_nat', device: 'router_basic', napt: true, statics });
    const moved = migrate(entry.saveVersion, data).office.nodes.find((n) => n.uid === 'r_nat');
    expect(moved?.components).toEqual({ nat: { napt: true, statics } });
    expect('napt' in (moved ?? {})).toBe(false);
    expect('statics' in (moved ?? {})).toBe(false);
  });
});

describe('ファイアウォールの規則の移行（機器の rules を components.firewall へ移す）', () => {
  it('移行前の機器の rules は、移行後は components.firewall に入り、機器の直下には残らない', () => {
    const old = JSON.parse(readFileSync(join(dir, 'save-v59.json'), 'utf8')) as Fixture;
    const entry = Object.values(old)[0];
    const data = structuredClone(entry.data) as { office: { nodes: Record<string, unknown>[] } };
    const rules = [{ src: '192.168.1.0/24', dst: 'any', service: 'any' }];
    data.office.nodes.push({ uid: 'fw_new', device: 'firewall', rules });
    const moved = migrate(entry.saveVersion, data).office.nodes.find((n) => n.uid === 'fw_new');
    expect(moved?.components).toEqual({ firewall: rules });
    expect('rules' in (moved ?? {})).toBe(false);
  });
});

describe('名前の引き方の移行（機器の hosts・nameServer を components.resolver へ移す）', () => {
  it('移行前の機器の hosts・nameServer は、移行後は components.resolver に入り、機器の直下には残らない', () => {
    const old = JSON.parse(readFileSync(join(dir, 'save-v60.json'), 'utf8')) as Fixture;
    const entry = Object.values(old)[0];
    const data = structuredClone(entry.data) as { office: { nodes: Record<string, unknown>[] } };
    const hosts = [{ name: 'files', ip: '192.168.1.20' }];
    data.office.nodes.push({ uid: 'pc_new', device: 'pc_basic', hosts, nameServer: '192.168.1.53' });
    data.office.nodes.push({ uid: 'pc_empty', device: 'pc_basic', hosts: [] });
    const nodes = migrate(entry.saveVersion, data).office.nodes;
    const moved = nodes.find((n) => n.uid === 'pc_new');
    expect(moved?.components).toEqual({ resolver: { hosts, nameServer: '192.168.1.53' } });
    expect('hosts' in (moved ?? {})).toBe(false);
    expect('nameServer' in (moved ?? {})).toBe(false);
    const empty = nodes.find((n) => n.uid === 'pc_empty');
    expect(empty?.components).toBeUndefined();
    expect('hosts' in (empty ?? {})).toBe(false);
  });
});

describe('無線の帯の移行（アクセスポイントの無線の設定に band を足す）', () => {
  it('移行前の電波を出すアクセスポイントに 2.4GHz の帯が付き、2.4GHz の範囲の外のチャネルは外れる。ほかの機器は変わらない', () => {
    const old = JSON.parse(readFileSync(join(dir, 'save-v61.json'), 'utf8')) as Fixture;
    const entry = Object.values(old)[0];
    const data = structuredClone(entry.data) as { office: { nodes: Record<string, unknown>[] } };
    data.office.nodes.push({ uid: 'ap_ok', device: 'access_point', components: { wireless: { ssid: 'lab', channel: 11 } } });
    data.office.nodes.push({ uid: 'ap_out', device: 'access_point', components: { wireless: { ssid: 'lab', channel: 36 } } });
    data.office.nodes.push({ uid: 'ap_bare', device: 'access_point' });
    data.office.nodes.push({ uid: 'hr_ap', device: 'home_router_ap', components: { wireless: { ssid: 'HOME', password: 'home1234' } } });
    data.office.nodes.push({ uid: 'hr_plain', device: 'home_router' });
    const nodes = migrate(entry.saveVersion, data).office.nodes;
    const wireless = (uid: string) => nodes.find((n) => n.uid === uid)?.components?.wireless;
    expect(wireless('ap_ok')).toEqual({ ssid: 'lab', channel: 11, band: '2.4' });
    expect(wireless('ap_out')).toEqual({ ssid: 'lab', band: '2.4' });
    expect(wireless('ap_bare')).toEqual({ band: '2.4' });
    expect(wireless('hr_ap')).toEqual({ ssid: 'HOME', password: 'home1234', band: '2.4' });
    expect(nodes.find((n) => n.uid === 'hr_plain')?.components).toBeUndefined();
  });
});

describe('無線なしの家庭用ルーターの移行（v64 → v65: 無線のつながりを外し、知らせる）', () => {
  const v64 = () => {
    const old = JSON.parse(readFileSync(join(dir, 'save-v64.json'), 'utf8')) as Fixture;
    return structuredClone(Object.values(old)[0]);
  };
  const wifiNodes = (withClient: boolean) => [
    { uid: 'hr_w', device: 'home_router', x: 1, y: 1, components: { wireless: { ssid: 'HOME', password: 'home1234', band: '2.4' } } },
    ...(withClient ? [{ uid: 'pc_w', device: 'pc_wifi', x: 2, y: 1, components: { wireless: { ssid: 'HOME', password: 'home1234' } } }] : []),
  ];

  it('無線の端末がつながっていた家庭用ルーターは、移行後は無線の設定を持たず、つながりが切れて知らせる', () => {
    const entry = v64();
    const data = structuredClone(entry.data) as { office: { nodes: Record<string, unknown>[] } };
    data.office.nodes.push(...wifiNodes(true));
    const migrated = migrate(64, data);
    expect(migrated.office.nodes.find((n) => n.uid === 'hr_w')?.components).toEqual({});
    expect(migrated.office.nodes.find((n) => n.uid === 'pc_w')?.components).toEqual({ wireless: { ssid: 'HOME', password: 'home1234' } });
    expect(migrated.homeRouterWirelessOff).toBe(true);
    expect(wirelessAssociations({ nodes: migrated.office.nodes, links: migrated.office.links, plans: migrated.office.plans }, gameEnv.engine).filter((p) => p.client.uid === 'pc_w')).toEqual([]);
  });

  it('つながっていた端末がなければ、無線の設定は外すが、知らせは出さない', () => {
    const entry = v64();
    const data = structuredClone(entry.data) as { office: { nodes: Record<string, unknown>[] } };
    data.office.nodes.push(...wifiNodes(false));
    const migrated = migrate(64, data);
    expect(migrated.office.nodes.find((n) => n.uid === 'hr_w')?.components).toEqual({});
    expect(migrated.homeRouterWirelessOff).toBeUndefined();
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
