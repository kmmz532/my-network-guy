// セーブの fixture（架空の内容）: 今の版の fixture があること、すべての fixture を最新版まで移行でき、検証に通り、計算が例外なく動くこと
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gameEnv } from '../sim/env';
import { can } from '../network/capabilities';
import { dhcpOf, ping, warningsOf } from '../network/netState';
import { portStatesOf } from '../network/query/portStates';
import { analyze } from '../network/engine/analyze';
import { stpOf } from '../network/query/stp';
import { SAVE_VERSION, isSaveData, migrate } from './migrations';

const dir = join(import.meta.dirname, '__fixtures__');
const files = readdirSync(dir).filter((f) => /^save-v\d+\.json$/.test(f));
type Fixture = Record<string, { saveVersion: number; data: unknown }>;

describe('セーブの fixture', () => {
  it('今の版（SAVE_VERSION）の fixture がある', () => {
    expect(existsSync(join(dir, `save-v${SAVE_VERSION}.json`))).toBe(true);
  });

  for (const file of files) {
    const fixture = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Fixture;
    for (const [name, entry] of Object.entries(fixture)) {
      it(`${file} の ${name}: 最新版まで移行でき、検証に通り、ネットワークの計算が例外なく動く`, () => {
        const data = migrate(entry.saveVersion, entry.data);
        expect(isSaveData(data)).toBe(true);
        const net = { nodes: data.office.nodes, links: data.office.links, segments: data.office.segments };
        // 端末は、スイッチの口もルーテッドポートも持たない機器
        const ends = net.nodes.filter((n) => n.interfaces.length > 0 && !can(n.device, 'switchport') && !can(n.device, 'routedPort')).map((n) => n.uid);
        for (const a of ends) for (const b of ends) if (a !== b) ping(net, gameEnv.engine, a, b);
        warningsOf(net, gameEnv.engine);
        dhcpOf(net, gameEnv.engine);
        stpOf(analyze(net, gameEnv.engine));
        for (const n of net.nodes) portStatesOf(analyze(net, gameEnv.engine), n.uid);
      });
    }
  }
});
