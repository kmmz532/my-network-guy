// メールと NAS: メールの届け方（社内のメールサーバー → MX → 宛先のサーバー）、各失敗、ファイアウォールの smtp・smb、シーケンス図の並び
import { describe, expect, it } from 'vitest';
import { lessons } from 'virtual:game-data';
import type { Goal } from '../data/schema';
import { solutions } from '../__golden__/solutions';
import { lessonLinks, lessonNodes } from '../sim/lesson';
import { analyze } from './engine/analyze';
import { evaluateGoal } from './goals';
import { controlSequence } from './public';
import { mailDelivery } from './query/mail';
import type { EngineData, FirewallRule, NetNode } from './types';

const engine: EngineData = { wallAt: () => false, interferers: [] };
const lesson = lessons.find((l) => l.id === 'mail_mx');
if (!lesson) throw new Error('教材 mail_mx がない');

const ADDRESS = 'sales@partner.example';

// 教材の構成（solved が true なら取引先の MX と A を入れた状態）。edit で機器を書き換える
const build = (solved: boolean, edit: (n: NetNode) => NetNode = (n) => n) => {
  const base = lessonNodes(lesson);
  const nodes = (solved ? solutions.mail_mx(base) : base).map(edit);
  return analyze({ nodes, links: lessonLinks(lesson), plans: {} }, engine);
};

// R1 をファイアウォールに替え、与えた規則だけを通す
const behindFirewall = (rules: FirewallRule[]) => (n: NetNode): NetNode => (n.uid === 'R1' ? { ...n, device: 'firewall', components: { ...n.components, firewall: rules } } : n);
const DNS_RULE: FirewallRule = { src: 'any', dst: 'any', service: 'dns' };

describe('メールの届け方', () => {
  it('MX と A が取引先の DNS にあれば、PC1 から取引先のメールサーバーへ届く', () => {
    const r = mailDelivery(build(true), 'PC1', ADDRESS);
    expect(r.ok).toBe(true);
    expect(r.trace.client?.leg.path).toEqual(['PC1', 'MAIL']);
    expect(r.trace.relay?.leg.path).toEqual(['MAIL', 'R1', 'PMAIL']);
  });

  it('取引先のドメインの MX がなければ mail.no_mx で、MX を引いた社内のメールサーバーに札が付く', () => {
    const r = mailDelivery(build(false), 'PC1', ADDRESS);
    expect(r.ok ? null : r.failure).toEqual({ reason: 'mail.no_mx', node: 'MAIL' });
  });

  it('PC にメールサーバーの設定がなければ mail.no_server', () => {
    const r = mailDelivery(build(true, (n) => (n.uid === 'PC1' ? { ...n, components: undefined } : n)), 'PC1', ADDRESS);
    expect(r.ok ? null : r.failure).toEqual({ reason: 'mail.no_server', node: 'PC1' });
  });

  it('設定したアドレスのサーバーにメールのサービスがなければ mail.no_server', () => {
    const r = mailDelivery(build(true, (n) => (n.uid === 'MAIL' ? { ...n, services: [] } : n)), 'PC1', ADDRESS);
    expect(r.ok ? null : r.failure).toEqual({ reason: 'mail.no_server', node: 'MAIL' });
  });

  it('MX のサーバーへ 25 番が止められると mail.relay_failed で、届かなかった理由を cause に持つ', () => {
    const r = mailDelivery(build(true, behindFirewall([DNS_RULE])), 'PC1', ADDRESS);
    expect(r.ok ? null : r.failure).toMatchObject({ reason: 'mail.relay_failed', node: 'MAIL', cause: { reason: 'firewall.denied', node: 'R1' } });
  });

  it('ファイアウォールが smtp を通せば届く', () => {
    const r = mailDelivery(build(true, behindFirewall([DNS_RULE, { src: 'any', dst: 'any', service: 'smtp' }])), 'PC1', ADDRESS);
    expect(r.ok).toBe(true);
  });

  it('MX のサーバーにメールのサービスがなければ mail.relay_failed（service.closed）', () => {
    const r = mailDelivery(build(true, (n) => (n.uid === 'PMAIL' ? { ...n, services: [] } : n)), 'PC1', ADDRESS);
    expect(r.ok ? null : r.failure).toMatchObject({ reason: 'mail.relay_failed', cause: { reason: 'service.closed', node: 'PMAIL' } });
  });

  it('届いたサーバーが宛先のドメインを受け持たなければ mail.unknown_domain', () => {
    const r = mailDelivery(build(true, (n) => (n.uid === 'PMAIL' ? { ...n, services: [{ protocol: 'mail', domain: 'other.example' }] } : n)), 'PC1', ADDRESS);
    expect(r.ok ? null : r.failure).toEqual({ reason: 'mail.unknown_domain', node: 'PMAIL' });
  });

  it('達成条件 mail は、届くときだけ満たす', () => {
    const goal: Goal = { type: 'mail', from: 'PC1', to: ADDRESS };
    expect(evaluateGoal(goal, build(false)).map((x) => x.ok)).toEqual([false]);
    expect(evaluateGoal(goal, build(true)).map((x) => x.ok)).toEqual([true]);
  });
});

describe('NAS（SMB 445）', () => {
  const nasOn = (n: NetNode): NetNode => (n.uid === 'PMAIL' ? { ...n, services: [...n.services, { protocol: 'nas' }] } : n);
  const goal: Goal = { type: 'nas', from: ['PC1'], to: 'PMAIL' };
  const smb: FirewallRule = { src: 'any', dst: 'any', service: 'smb' };

  it('NAS のサービスがあれば届き、なければ service.closed', () => {
    expect(evaluateGoal(goal, build(true, nasOn)).map((x) => x.ok)).toEqual([true]);
    expect(evaluateGoal(goal, build(true))[0].failure).toMatchObject({ reason: 'service.closed', node: 'PMAIL' });
  });

  it('ファイアウォールは、smb の規則か any の規則だけが通す', () => {
    const through = (rules: FirewallRule[]) => evaluateGoal(goal, build(true, (n) => behindFirewall(rules)(nasOn(n))))[0];
    expect(through([{ src: 'any', dst: 'any', service: 'smtp' }]).failure).toMatchObject({ reason: 'firewall.denied', node: 'R1' });
    expect(through([smb]).ok).toBe(true);
    expect(through([{ src: 'any', dst: 'any', service: 'any' }]).ok).toBe(true);
  });
});

describe('メールのシーケンス図', () => {
  it('PC から社内のメールサーバー、MX と A の問い合わせ、社内のメールサーバーから取引先のサーバーの順に並ぶ', () => {
    const steps = controlSequence(build(true), { kind: 'mail', from: 'PC1', address: ADDRESS });
    const rows = steps.filter((s) => s.proto !== 'arp').map((s) => `${s.label}:${s.from}>${s.to}`);
    const smtp = rows.filter((r) => r.startsWith('seq.smtp.'));
    expect(smtp).toEqual([
      'seq.smtp.connect:PC1>MAIL', 'seq.smtp.send:PC1>MAIL', 'seq.smtp.quit:PC1>MAIL',
      'seq.smtp.connect:MAIL>PMAIL', 'seq.smtp.send:MAIL>PMAIL', 'seq.smtp.quit:MAIL>PMAIL',
    ]);
    expect(rows.findIndex((r) => r.startsWith('seq.dns.query_mx'))).toBeGreaterThan(rows.indexOf('seq.smtp.quit:PC1>MAIL'));
    expect(rows.findIndex((r) => r.startsWith('seq.dns.response'))).toBeLessThan(rows.indexOf('seq.smtp.connect:MAIL>PMAIL'));
    expect(steps.every((s) => s.failure === undefined)).toBe(true);
  });

  it('MX がなければ、MX の応答の行で mail.no_mx を出して止まる', () => {
    const steps = controlSequence(build(false), { kind: 'mail', from: 'PC1', address: ADDRESS });
    expect(steps[steps.length - 1]).toMatchObject({ label: 'seq.dns.response_mx', failure: { reason: 'mail.no_mx' } });
    expect(steps.some((s) => s.label === 'seq.smtp.connect' && s.from === 'MAIL')).toBe(false);
  });
});
