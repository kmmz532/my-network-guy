// アクセスポイント（N151 の最初の段）: 有線の口1つと無線。電波の計算は後続
import { describe, expect, it } from 'vitest';
import { devices } from 'virtual:game-data';
import { can } from './capabilities';
import { isRelayPort, isFabricPort } from './category';

describe('アクセスポイント', () => {
  it('無線の能力を持ち、有線の口は1つ', () => {
    expect(can('access_point', 'wireless')).toBe(true);
    const d = devices.access_point as { ports: { count: number }[] };
    expect(d.ports.reduce((s, p) => s + p.count, 0)).toBe(1);
  });

  it('機器の中で中継する（口は中継の口。機器の一員として数えない）', () => {
    expect(isFabricPort('access_point', 0)).toBe(true);
    expect(isRelayPort('access_point', 0)).toBe(true);
  });
});
