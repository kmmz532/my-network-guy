// 案件 lb_web_public（通販サイトの Web を2台に分ける）: ロードバランサーの仮想サーバーに2台の Web を振り分け、ヘルスチェックを入れると合格する。ヘルスチェックなしは、1台止まったときに不合格
import { describe, expect, it } from 'vitest';
import { analyze } from './engine/analyze';
import contractJson from '../assets/data/contracts/lb_web_public.json';
import { gameEnv } from '../sim/env';
import { contractLinks, fixedNodes } from '../sim/project';
import type { Contract } from '../data/schema';
import { evaluateContract } from './goals';
import type { NetNode, Network } from './types';

const contract = contractJson as unknown as Contract;
const data = gameEnv.engine;

// 社内の PC から VIP へ、2台の Web を振り分ける（ヘルスチェックは healthCheck で決める）
const withVirtualServer = (healthCheck: 'http' | 'none'): Network => ({
  nodes: fixedNodes(contract).map((n: NetNode) =>
    n.uid === 'LB'
      ? {
          ...n,
          components: {
            loadBalancer: [{ vip: '192.168.1.80', port: 80, members: [{ ip: '192.168.1.81', port: 80 }, { ip: '192.168.1.82', port: 80 }], method: 'round_robin', healthCheck, snat: true }],
          },
        }
      : n,
  ),
  links: contractLinks(contract),
  plans: {},
});

describe('案件 lb_web_public: 通販サイトの Web を2台に分ける', () => {
  it('ヘルスチェックを入れた仮想サーバーで、1台止まっても振り分け先2台が健全なら合格する', () => {
    expect(evaluateContract(contract, analyze(withVirtualServer('http'), data)).passed).toBe(true);
  });
  it('ヘルスチェックなし（none）では、1台止まったときに不合格になる', () => {
    expect(evaluateContract(contract, analyze(withVirtualServer('none'), data)).passed).toBe(false);
  });
});
