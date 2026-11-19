import { beforeAll, describe, expect, it } from 'vitest';
import { loadLang } from '../i18n/t';
import { isWanPort, portLabel } from './devicePorts';

// 口の表示名は命令の口の番号（0 から）と揃える。WAN の口は家庭用ルーターとスイッチ付きルーターの口0だけ
describe('口の表示名', () => {
  beforeAll(async () => {
    await loadLang('ja_jp');
  });

  it('L2スイッチは口の番号を 0 から出す', () => {
    expect(portLabel('l2_switch', 0)).toBe('0');
    expect(portLabel('l2_switch', 3)).toBe('3');
  });

  it('ルーターは G0/番号（命令と同じ 0 から）', () => {
    expect(portLabel('router', 0)).toBe('G0/0');
    expect(portLabel('router', 2)).toBe('G0/2');
  });

  it('家庭用ルーターの口0は WAN、続く口は LAN（番号は 0 から）', () => {
    expect(portLabel('home_router', 0)).toBe('WAN');
    expect(portLabel('home_router', 1)).toBe('LAN1');
    expect(isWanPort('home_router', 0)).toBe(true);
    expect(isWanPort('home_router', 1)).toBe(false);
  });

  it('WAN の口を持たない機器は WAN にしない', () => {
    expect(isWanPort('router', 0)).toBe(false);
    expect(isWanPort('pc', 0)).toBe(false);
    expect(portLabel('pc', 0)).toBe('LAN');
  });
});
