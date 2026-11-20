// 案件 lb_web_public（通販サイトの Web を2台に分ける）: ルーターの静的 NAT で外のポート80をロードバランサーの仮想の IPアドレスへ向け、2台の Web を振り分ける。ヘルスチェックなしは、1台止まったときに不合格
import { describe, expect, it } from 'vitest';
import { analyze } from './engine/analyze';
import contractJson from '../../resources/data/contracts/lb_web_public.json';
import { gameEnv } from '../sim/env';
import { contractLinks, fixedNodes } from '../sim/project';
import type { Contract } from '../data/schema';
import { evaluateContract } from './goals';
import type { NetLink, NetNode, Network } from './types';

const contract = contractJson as unknown as Contract;
const data = gameEnv.engine;

const router = (statics: { port: number; insideIp: string; insidePort: number }[]): NetNode =>
  ({
    uid: 'R',
    device: 'router_basic',
    x: 10,
    y: 5,
    locked: false,
    configLocked: false,
    interfaces: [
      { id: 'g0/0', kind: 'port', port: 0, ip: '198.51.100.2', prefix: 24, nat: 'outside' },
      { id: 'g0/1', kind: 'port', port: 1, ip: '192.168.1.1', prefix: 24, nat: 'inside' },
    ],
    gateway: null,
    routes: [{ dest: '0.0.0.0', prefix: 0, nextHop: '198.51.100.1' }],
    services: [],
    ports: [],
    macSerial: 900,
    components: { nat: { napt: true, statics } },
  }) as NetNode;
const wire = (uid: string, a: string, pa: number, b: string, pb: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });

// プレイヤーの作業: ルーターを置いて回線と社内につなぎ、静的 NAT を設定し、負荷分散の仮想サーバーを作る
const solved = (opts: { healthCheck: 'http' | 'none'; statics?: { port: number; insideIp: string; insidePort: number }[] }): Network => ({
  nodes: [
    ...fixedNodes(contract).map((n: NetNode) =>
      n.uid === 'LB'
        ? {
            ...n,
            components: {
              loadBalancer: [{ vip: '192.168.1.80', port: 80, members: [{ ip: '192.168.1.81', port: 80 }, { ip: '192.168.1.82', port: 80 }], method: 'round_robin' as const, healthCheck: opts.healthCheck, snat: true }],
            },
          }
        : n,
    ),
    router(opts.statics ?? [{ port: 80, insideIp: '192.168.1.80', insidePort: 80 }]),
  ],
  links: [...contractLinks(contract), wire('wan', 'LINE', 0, 'R', 0), wire('lan', 'R', 1, 'SW1', 4)],
  plans: {},
});

const passed = (net: Network) => evaluateContract(contract, analyze(net, data));

describe('案件 lb_web_public: 通販サイトの Web を2台に分ける', () => {
  it('ルーターの静的 NAT で外から VIP へ届き、ヘルスチェックを入れれば、1台止まっても合格する', () => {
    expect(passed(solved({ healthCheck: 'http' })).passed).toBe(true);
  });
  it('静的 NAT がなければ不合格になる', () => {
    expect(passed(solved({ healthCheck: 'http', statics: [] })).passed).toBe(false);
  });
  it('ヘルスチェックなし（none）では、survive_device_failure が不合格になる', () => {
    const r = passed(solved({ healthCheck: 'none' }));
    expect(r.results.find((x) => x.goal.type === 'public_http')?.ok).toBe(true);
    expect(r.results.find((x) => x.goal.type === 'survive_device_failure')?.ok).toBe(false);
  });
});
