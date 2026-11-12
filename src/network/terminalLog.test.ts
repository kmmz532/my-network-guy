// 端末の記録の上限と、直前と同じ命令を重ねないこと
import { describe, expect, it } from 'vitest';
import { HISTORY_COMMANDS, LOG_LINES, appendLog, pushCommand } from './terminalLog';

describe('端末の記録', () => {
  it('出力は最新の 500 行だけを残す', () => {
    const many = Array.from({ length: LOG_LINES + 3 }, (_, i) => ({ text: `${i}`, kind: 'out' as const }));
    const log = appendLog([], many);
    expect(log).toHaveLength(LOG_LINES);
    expect(log[0].text).toBe('3');
  });

  it('命令の履歴は、直前と同じ命令を重ねず、100 件までにする', () => {
    expect(pushCommand(['show ip'], 'show ip')).toEqual(['show ip']);
    const many = Array.from({ length: HISTORY_COMMANDS + 2 }, (_, i) => `ping ${i}`).reduce<string[]>((c, l) => pushCommand(c, l), []);
    expect(many).toHaveLength(HISTORY_COMMANDS);
    expect(many[0]).toBe('ping 2');
  });
});
