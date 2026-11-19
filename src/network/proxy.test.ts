// プロキシ: プロキシ経由で外へ出る HTTP（送信元はプロキシ）、PAC の direct、サービスがないときの失敗、ファイアウォールで止まる構成
import { describe, expect, it } from 'vitest';
import { lessons } from 'virtual:game-data';
import { lessonLinks, lessonNodes } from '../sim/lesson';
import { analyze } from './engine/analyze';
import { http } from './engine/forward';
import { internetStateOf } from './external';
import { evaluateGoal } from './goals';
import { seenIpOf } from './query/seenSources';
import type { EngineData, NetNode } from './types';

const engine: EngineData = { wallAt: () => false, interferers: [] };
const lesson = lessons.find((l) => l.id === 'proxy_firewall');
if (!lesson) throw new Error('教材 proxy_firewall がない');

const PROXY = { ip: '203.0.113.20', port: 8080 };

// 教材の構成。PC1 にだけ、与えたプロキシの設定を付ける
const build = (client: NonNullable<NetNode['components']>['proxyClient'], edit: (n: NetNode) => NetNode = (n) => n) => {
  const nodes = lessonNodes(lesson).map((n) => edit(n.uid === 'PC1' && client ? { ...n, components: { ...n.components, proxyClient: client } } : n));
  const state = analyze({ nodes, links: lessonLinks(lesson), plans: {} }, engine);
  const world = internetStateOf(state);
  if (!world) throw new Error('回線がつながっていない');
  return { state, world, internet: world.net.nodes.find((n) => n.uid.startsWith('__internet'))!.uid };
};

describe('プロキシ経由の HTTP', () => {
  it('外へ届き、外から見た送信元はプロキシのアドレスになる', () => {
    const { world, internet } = build({ proxy: PROXY });
    const r = http(world, 'PC1', internet, 80);
    expect(r.ok).toBe(true);
    expect(r.proxy?.uid).toBe('PROXY');
    expect(r.path).toEqual(['PC1', 'PROXY', 'FW1', internet]);
    expect(seenIpOf(world.net.nodes, 'PC1', r)).toBe('203.0.113.20');
  });

  it('プロキシのない PC は、ファイアウォールに止められる', () => {
    const { world, internet } = build(undefined);
    expect(http(world, 'PC1', internet, 80).failure).toMatchObject({ reason: 'firewall.denied', node: 'FW1' });
  });

  it('PAC の direct に名前が合う宛先は、プロキシを通さず直接つなぐ', () => {
    const { world } = build({ proxy: PROXY, pac: { direct: ['.corp.example'] } });
    const direct = http(world, 'PC1', 'WEB', 80, 'intranet.corp.example');
    expect(direct.ok).toBe(true);
    expect(direct.proxy).toBeUndefined();
    expect(http(world, 'PC1', 'WEB', 80, 'intranet.other.example').proxy?.uid).toBe('PROXY');
  });

  it('プロキシのサービスが動いていなければ、proxy.unreachable で止まる', () => {
    const { world, internet } = build({ proxy: PROXY }, (n) => (n.uid === 'PROXY' ? { ...n, services: [] } : n));
    expect(http(world, 'PC1', internet, 80).failure).toMatchObject({ reason: 'proxy.unreachable', node: 'PROXY' });
  });

  it('プロキシのアドレスの機器がなければ、proxy.unreachable で止まる', () => {
    const { world, internet } = build({ proxy: { ip: '203.0.113.99', port: 8080 } });
    expect(http(world, 'PC1', internet, 80).failure).toMatchObject({ reason: 'proxy.unreachable', node: 'PC1' });
  });

  it('達成条件 outside_sees は、外から見た送信元が by のアドレスのときだけ満たす', () => {
    const { state } = build({ proxy: PROXY });
    const sees = (by: string) => evaluateGoal({ type: 'outside_sees', from: ['PC1'], port: 80, by }, state).every((r) => r.ok);
    expect(sees('PROXY')).toBe(true);
    expect(sees('WEB')).toBe(false);
  });
});
