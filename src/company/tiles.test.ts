// タイルの引き方（机の有無・家具・機器）の試験
import { describe, expect, it } from 'vitest';
import type { GameMap } from '../data/schema';
import type { NetNode } from '../network/types';
import { gameEnv } from '../sim/env';
import { needsDeskSprite, restsOnDesk, tileAt, type TileSource } from './tiles';

const map = { id: 't', width: 3, height: 1, legend: { '.': 'floor', d: 'desk' }, tiles: ['.d.'] } as unknown as GameMap;
const nodeAt = (x: number, device: string): NetNode => ({ uid: `u${x}`, device, x, y: 0, ports: [] } as unknown as NetNode);
const source = (patch: Partial<TileSource>): TileSource => ({ map, furniture: [], nodes: [], office: false, anyFloor: false, ...patch });

describe('tileAt', () => {
  it('自社オフィスでは、机の家具のあるマスが机', () => {
    const src = source({ office: true, furniture: [{ uid: 'f0', id: 'desk', x: 0, y: 0 }] });
    expect(tileAt(src, 0, 0, gameEnv).desk).toBe(true);
    expect(tileAt(src, 0, 0, gameEnv).furniture).toHaveLength(1);
    expect(tileAt(src, 1, 0, gameEnv).desk).toBe(false);
  });

  it('依頼先では、地図の desk のマスが机', () => {
    const src = source({});
    expect(tileAt(src, 1, 0, gameEnv).desk).toBe(true);
    expect(tileAt(src, 1, 0, gameEnv).kind).toBe('desk');
    expect(tileAt(src, 0, 0, gameEnv).desk).toBe(false);
  });

  it('机のないマスは机でなく、置いた機器を引ける', () => {
    const node = nodeAt(2, 'pc_basic');
    const tile = tileAt(source({ nodes: [node] }), 2, 0, gameEnv);
    expect(tile.desk).toBe(false);
    expect(tile.node).toBe(node);
    expect(tileAt(source({}), 0, 0, gameEnv).node).toBeNull();
  });
});

describe('restsOnDesk と needsDeskSprite', () => {
  it('机のマスの機器は机の上にあり、机の絵は要らない', () => {
    const src = source({});
    expect(restsOnDesk(src, nodeAt(1, 'pc_basic'), gameEnv)).toBe(true);
    expect(needsDeskSprite(src, nodeAt(1, 'pc_basic'), gameEnv)).toBe(false);
  });

  it('机のないマスの PC は机の絵が要り、サンドボックスでは要らない', () => {
    expect(needsDeskSprite(source({}), nodeAt(0, 'pc_basic'), gameEnv)).toBe(true);
    expect(needsDeskSprite(source({ anyFloor: true }), nodeAt(0, 'pc_basic'), gameEnv)).toBe(false);
  });

  it('PC 以外は机の絵が要らない', () => {
    expect(needsDeskSprite(source({}), nodeAt(0, 'router_basic'), gameEnv)).toBe(false);
  });
});
