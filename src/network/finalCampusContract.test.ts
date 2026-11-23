// 案件 z001（最後の山場。本社と支社の2拠点）: 部署の分離・拠点の間の OSPF・2社の ISP との BGP・DMZ の公開サーバー・回線の冗長をすべて満たすと合格し、★3 になる。1つでも欠けると不合格
import { describe, expect, it } from 'vitest';
import { analyze } from './engine/analyze';
import contractJson from '../../resources/data/contracts/z001_final_campus.json';
import balanceJson from '../../resources/data/balance.json';
import { gameEnv } from '../sim/env';
import { rate } from '../sim/rating';
import { designIssues, type Project } from '../sim/project';
import { costOfFinalCampus as costOf, solvedFinalCampus as solved } from '../shoot/finalCampusSolved';
import type { Balance, Contract } from '../data/schema';
import { evaluateContract } from './goals';
import type { Network } from './types';

const contract = contractJson as unknown as Contract;
const data = gameEnv.engine;
const balance = balanceJson as unknown as Balance;

const failed = (net: Network) => evaluateContract(contract, analyze(net, data)).results.filter((r) => !r.ok).map((r) => r.goal.type);

describe('案件 z001: 本社と支社の2拠点（最後の山場）', () => {
  it('想定の解答で、6つの達成条件がすべて合格する', () => {
    expect(failed(solved())).toEqual([]);
  });
  it('想定の解答は設計の不備がなく、費用は予算の 0.8 倍以下で、★3 になる', () => {
    const net = solved();
    const issues = Object.keys(designIssues({ contract, nodes: net.nodes, links: net.links, plans: net.plans } as unknown as Project, { ...gameEnv, balance } as never));
    expect(issues).toEqual([]);
    expect(rate(costOf(net), contract.budget, 0, false, issues.length, balance)).toBe(3);
  });
  it('予算は、想定の解答の費用の 1.25 倍（切り上げ）', () => {
    expect(contract.budget).toBe(Math.ceil(costOf(solved()) * 1.25));
  });
  it('経理サーバーの VLAN を分けなければ、分離の条件が不合格になる', () => {
    expect(new Set(failed(solved({ vlan: false })))).toEqual(new Set(['isolated']));
  });
  it('支社の ISP-B へ BGP を張らなければ、支社の隣接の条件が不合格になる', () => {
    expect(failed(solved({ bgpB: false }))).toContain('bgp_established');
  });
  it('静的 NAT がなければ、公開の条件が不合格になる', () => {
    expect(failed(solved({ staticNat: false }))).toEqual(['public_http']);
  });
  it('拠点の間を静的経路でつなぐと、OSPF の条件が不合格になる', () => {
    expect(failed(solved({ ospf: false }))).toContain('no_static_route');
  });
  it('支社の回線をつながなければ、回線の冗長の条件が不合格になる', () => {
    expect(failed(solved({ lineB: false }))).toContain('survive_uplink_failure');
  });
});
