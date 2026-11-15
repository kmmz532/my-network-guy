// DNS の問い合わせ（権威・キャッシュ・転送・CNAME・MX・ISP の DNS・ファイアウォールの dns）
import { describe, expect, it } from 'vitest';
import { analyze } from './engine/analyze';
import { evaluateGoal } from './goals';
import { lookupName } from './dns';
import { resolveName } from './resolve';
import type { DnsRecord, EngineData, Iface, IspLine, NetLink, NetNode, Network, Service } from './types';

const data: EngineData = { wallAt: () => false };
const f = (port: number, ip: string): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix: 24 });
const n = (uid: string, device: string, interfaces: Iface[], extra: Partial<NetNode> = {}): NetNode =>
  ({ uid, device, x: 0, y: 0, locked: false, configLocked: false, interfaces, gateway: null, routes: [], services: [], ports: [], ...extra }) as NetNode;
const l = (uid: string, a: string, pa: number, b: string, pb: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });
const auth = (zone: DnsRecord[]): Service => ({ protocol: 'dns', role: 'auth', zone });
const A = (name: string, value: string): DnsRecord => ({ type: 'A', name, value });

// PC a・キャッシュ c・権威 d。rules がなければ同じスイッチ s につなぐ。rules があれば、PC a とサーバーの間にファイアウォール fw を置く
const lan = (cache: Service, authZone: DnsRecord[], rules?: NetNode['rules']): Network => {
  const nodes = [
    n('a', 'pc_basic', [f(0, rules ? '10.0.0.10' : '10.1.0.10')], { nameServer: '10.1.0.53', gateway: rules ? '10.0.0.1' : null }),
    n('c', 'server_basic', [f(0, '10.1.0.53')], { services: [cache], gateway: rules ? '10.1.0.1' : null }),
    n('d', 'server_basic', [f(0, '10.1.0.54')], { services: [auth(authZone)], gateway: rules ? '10.1.0.1' : null }),
    n('s', 'l2_switch_8p', []),
  ];
  if (!rules) return { nodes, links: [l('l1', 'a', 0, 's', 0), l('l2', 'c', 0, 's', 1), l('l3', 'd', 0, 's', 2)], plans: {} };
  nodes.push(n('fw', 'firewall', [f(0, '10.0.0.1'), f(1, '10.1.0.1')], { rules }));
  return { nodes, links: [l('l0', 'a', 0, 'fw', 0), l('l4', 'fw', 1, 's', 3), l('l2', 'c', 0, 's', 1), l('l3', 'd', 0, 's', 2)], plans: {} };
};

const cacheTo = (forwarder: string, zone: DnsRecord[] = []): Service => ({ protocol: 'dns', role: 'cache', zone, forwarder });

describe('キャッシュと権威', () => {
  it('キャッシュは自分のゾーンにない名前を転送先へ聞き、問い合わせの経路を再帰で残す', () => {
    const net = lan(cacheTo('10.1.0.54'), [A('files.corp.test', '10.1.0.99')]);
    const r = resolveName(net.nodes[0], 'files.corp.test', net, data);
    expect(r).toMatchObject({ ok: true, ip: '10.1.0.99', via: 'dns', server: 'c' });
    expect(r.ok && r.steps).toEqual([{ from: 'a', to: 'c', mode: 'recursive' }, { from: 'c', to: 'd', mode: 'recursive' }]);
  });

  it('キャッシュは自分のゾーンを先に答え、転送先へは聞かない', () => {
    const net = lan(cacheTo('10.1.0.54', [A('files.corp.test', '10.0.0.1')]), [A('files.corp.test', '10.1.0.99')]);
    const r = resolveName(net.nodes[0], 'files.corp.test', net, data);
    expect(r.ok && r.ip).toBe('10.0.0.1');
    expect(r.ok && r.steps).toHaveLength(1);
  });

  it('権威は自分のゾーンだけを答え、転送先があっても再帰しない', () => {
    const net = lan(cacheTo('10.1.0.54'), [A('files.corp.test', '10.1.0.99')]);
    const asAuth = { ...net, nodes: net.nodes.map((x) => (x.uid === 'c' ? { ...x, services: [{ ...auth([]), forwarder: '10.1.0.54' } as Service] } : x)) };
    expect(resolveName(asAuth.nodes[0], 'files.corp.test', asAuth, data)).toEqual({ ok: false, reason: 'not_found', server: 'c' });
  });

  it('転送先まで届かなければ、引けない', () => {
    const net = lan(cacheTo('10.1.0.54'), [A('files.corp.test', '10.1.0.99')]);
    const cut = { ...net, links: net.links.filter((x) => x.uid !== 'l3') };
    expect(resolveName(cut.nodes[0], 'files.corp.test', cut, data)).toEqual({ ok: false, reason: 'dns.unreachable', server: 'c' });
  });
});

describe('CNAME と MX', () => {
  const zone: DnsRecord[] = [
    { type: 'CNAME', name: 'www.corp.test', value: 'web.corp.test' },
    A('web.corp.test', '10.0.0.80'),
    { type: 'MX', name: 'corp.test', value: 'mail.corp.test', pref: 10 },
  ];

  it('CNAME を辿って A を返す（別名の鎖は records の先頭に並ぶ）', () => {
    const net = lan(cacheTo('10.1.0.54'), zone);
    const r = lookupName(net.nodes[0], 'www.corp.test', 'A', net, data);
    expect(r.ok && r.records.map((x) => `${x.type}:${x.value}`)).toEqual(['CNAME:web.corp.test', 'A:10.0.0.80']);
    expect(resolveName(net.nodes[0], 'www.corp.test', net, data)).toMatchObject({ ok: true, ip: '10.0.0.80' });
  });

  it('CNAME が8回を超えて続けば、引けない', () => {
    const chain = Array.from({ length: 10 }, (_, i): DnsRecord => ({ type: 'CNAME', name: `h${i}.corp.test`, value: `h${i + 1}.corp.test` }));
    const net = lan(cacheTo('10.1.0.54'), [...chain, A('h10.corp.test', '10.0.0.1')]);
    expect(resolveName(net.nodes[0], 'h0.corp.test', net, data).ok).toBe(false);
    expect(resolveName(net.nodes[0], 'h5.corp.test', net, data).ok).toBe(true);
  });

  it('MX は優先度つきのメールサーバーの名前を返す', () => {
    const net = lan(cacheTo('10.1.0.54'), zone);
    const r = lookupName(net.nodes[0], 'corp.test', 'MX', net, data);
    expect(r.ok && r.records).toEqual([{ type: 'MX', name: 'corp.test', value: 'mail.corp.test', pref: 10 }]);
  });

  it('AAAA は値を返す', () => {
    const net = lan(cacheTo('10.1.0.54'), [{ type: 'AAAA', name: 'v6.corp.test', value: '2001:db8::1' }]);
    const r = lookupName(net.nodes[0], 'v6.corp.test', 'AAAA', net, data);
    expect(r.ok && r.records[0].value).toBe('2001:db8::1');
  });
});

describe('53 番とファイアウォール', () => {
  const rules = (...services: ('ping' | 'http' | 'dns')[]): NetNode['rules'] => services.map((service) => ({ src: 'any', dst: 'any', service }));

  it('通す規則が ping だけなら、DNS の問い合わせは止まる', () => {
    const net = lan(cacheTo('10.1.0.54'), [A('files.corp.test', '10.1.0.99')], rules('ping'));
    expect(resolveName(net.nodes[0], 'files.corp.test', net, data)).toMatchObject({ ok: false, reason: 'dns.unreachable' });
  });

  it('dns の規則があれば通る', () => {
    const net = lan(cacheTo('10.1.0.54'), [A('files.corp.test', '10.1.0.99')], rules('dns'));
    expect(resolveName(net.nodes[0], 'files.corp.test', net, data)).toMatchObject({ ok: true, ip: '10.1.0.99' });
  });
});

// 家庭用ルーター hr（WAN は回線終端 u につなぐ）の LAN の PC a は、hr をネームサーバーにする
describe('ISP の DNS', () => {
  const home = (isp: IspLine): Network => ({
    nodes: [
      n('hr', 'home_router', [f(0, '198.51.100.2'), f(1, '192.168.1.1')], { routes: [{ dest: '0.0.0.0', prefix: 0, nextHop: '198.51.100.1' }], components: { nat: { napt: true } } }),
      n('a', 'pc_basic', [f(0, '192.168.1.10')], { gateway: '192.168.1.1', nameServer: '192.168.1.1' }),
      n('u', 'uplink', [], { components: { isp } }),
    ],
    links: [l('l0', 'a', 0, 'hr', 1), l('l1', 'hr', 0, 'u', 0)],
    plans: {},
  });
  const line: IspLine = { name: 'isp', network: '198.51.100.1', prefix: 24, ispIp: '198.51.100.1', dns: '198.51.100.53' };

  it('家庭用ルーターは、回線の ISP の DNS へ転送するキャッシュとして、外の名前を引ける', () => {
    const net = home(line);
    const r = resolveName(net.nodes[1], 'example.com', net, data);
    expect(r).toMatchObject({ ok: true, ip: '192.0.2.80', via: 'dns', server: 'hr' });
    expect(r.ok && r.steps?.map((s) => s.to)).toEqual(['hr', '__internet']);
  });

  it('ISP の DNS の CNAME・MX も答える', () => {
    const net = home(line);
    expect(resolveName(net.nodes[1], 'www.example.com', net, data)).toMatchObject({ ok: true, ip: '192.0.2.80' });
    const mx = lookupName(net.nodes[1], 'example.com', 'MX', net, data);
    expect(mx.ok && mx.records[0].value).toBe('mail.example.com');
  });

  it('データの外の名前でなければ、見つからない', () => {
    const net = home(line);
    expect(resolveName(net.nodes[1], 'nothing.example.org', net, data)).toEqual({ ok: false, reason: 'not_found', server: 'hr' });
  });

  it('回線に DNS がなければ、家庭用ルーターは転送先がなく引けない', () => {
    const net = home({ ...line, dns: undefined });
    expect(resolveName(net.nodes[1], 'example.com', net, data)).toEqual({ ok: false, reason: 'not_found', server: 'hr' });
  });
});

describe('達成条件 resolve_name', () => {
  const run = (net: Network, ip?: string) =>
    evaluateGoal({ type: 'resolve_name', from: ['a'], name: 'files.corp.test', ...(ip ? { ip } : {}) }, analyze(net, data)).map((r) => r.ok);
  const net = lan(cacheTo('10.1.0.54'), [A('files.corp.test', '10.1.0.99')]);
  it('引ければ合格。ip の指定と違えば不合格', () => {
    expect(run(net)).toEqual([true]);
    expect(run(net, '10.1.0.99')).toEqual([true]);
    expect(run(net, '10.1.0.98')).toEqual([false]);
  });
  it('転送先へ届かなければ不合格', () => {
    expect(run({ ...net, links: net.links.filter((x) => x.uid !== 'l3') })).toEqual([false]);
  });
});
