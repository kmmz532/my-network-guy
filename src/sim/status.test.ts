import { describe, expect, it } from 'vitest';
import { firstContractGuide, currentGuideStep } from './guide';
import type { Project } from './project';

const project = (over: Partial<Project>): Project =>
  ({
    nodes: [
      { uid: 'pc_a', device: 'pc_basic', x: 3, y: 4, locked: true, configLocked: false, interfaces: [], gateway: null, routes: [], services: [] },
      { uid: 'pc_b', device: 'pc_basic', x: 10, y: 4, locked: true, configLocked: false, interfaces: [], gateway: null, routes: [], services: [] },
    ],
    links: [],
    phase: 'design',
    ...over,
  }) as unknown as Project;

describe('最初の案件の手順', () => {
  it('何もしていなければ最初の手順（受注）を案内する', () => {
    const items = firstContractGuide(null, null, []);
    expect(currentGuideStep(items)).toBe('accept');
  });

  it('IPと配線が済むと、次は疎通テストを案内する', () => {
    const active = project({
      nodes: [
        { ...project({}).nodes[0], interfaces: [{ port: 0, ip: '192.168.1.10', prefix: 24 }] },
        { ...project({}).nodes[1], interfaces: [{ port: 0, ip: '192.168.1.11', prefix: 24 }] },
      ],
      links: [{ uid: 'l0' } as never],
    });
    expect(currentGuideStep(firstContractGuide(active, null, []))).toBe('probe');
  });

  it('完了した後は手順を案内しない', () => {
    expect(currentGuideStep(firstContractGuide(null, null, ['c001_direct_link']))).toBeNull();
  });
});
