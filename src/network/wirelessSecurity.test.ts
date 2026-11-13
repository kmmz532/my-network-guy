import { ping } from './engine';
import { analyze } from './engine/analyze';
// 無線の暗号化と認証の方式（pre-task §4.9）: 方式ごとのつながり・警告・失敗の理由・達成条件
import { describe, expect, it } from 'vitest';
import { gameEnv } from '../sim/env';
import { evaluateGoal } from './goals';
import { warningsOf } from './netState';
import type { Iface, NetNode, Network, WirelessSecurity } from './types';

const data = gameEnv.engine;
const f = (port: number, ip: string): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix: 24 });
const n = (uid: string, device: string, interfaces: Iface[], x: number, wireless?: NetNode['wireless']): NetNode =>
  ({ uid, device, macSerial: x + 1, x, y: 0, locked: false, configLocked: false, interfaces, gateway: null, routes: [], services: [], ports: [], ...(wireless ? { wireless } : {}) }) as NetNode;
const l = (uid: string, a: string, pa: number, b: string, pb: number) => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]] as [number, number][], paid: 0 });

// 有線の PC — スイッチ — アクセスポイント。端末（device）は電波で届く距離に置く
const build = (security: WirelessSecurity | undefined, device: string, password = 'pass1234'): Network => ({
  nodes: [
    n('pc', 'pc_basic', [f(0, '192.168.1.10')], 0),
    n('sw', 'l2_switch_8p', [], 1),
    n('ap', 'access_point', [], 2, { ssid: 'home', password: 'pass1234', ...(security ? { security } : {}) }),
    n('cl', device, [f(0, '192.168.1.20')], 4, { ssid: 'home', password }),
  ],
  links: [l('a', 'pc', 0, 'sw', 0), l('b', 'sw', 1, 'ap', 0)],
  segments: {},
});

describe('無線の方式', () => {
  it('既定（WPA2）では、パスワードが合う端末がつながる。違えば wlan.psk_mismatch', () => {
    expect(ping(analyze(build(undefined, 'laptop'), data), 'pc', 'cl').ok).toBe(true);
    expect(ping(analyze(build(undefined, 'laptop', 'wrong'), data), 'pc', 'cl').failure?.reason).toBe('wlan.psk_mismatch');
  });
  it('暗号化なし（open）は、パスワードが違ってもつながり、警告 wlan.open を出す', () => {
    expect(ping(analyze(build('open', 'laptop', 'wrong'), data), 'pc', 'cl').ok).toBe(true);
    expect(warningsOf(build('open', 'laptop'), data)).toContainEqual({ id: 'wlan.open', a: 'ap', b: 'ap' });
  });
  it('WEP・WPA は、つながるが wlan.weak_cipher の警告', () => {
    for (const s of ['wep', 'wpa'] as const) {
      expect(ping(analyze(build(s, 'laptop'), data), 'pc', 'cl').ok).toBe(true);
      expect(warningsOf(build(s, 'laptop'), data).map((w) => w.id)).toContain('wlan.weak_cipher');
    }
  });
  it('WPA3 のみの SSID に、WPA3 に対応しない端末（pc_wifi）はつながらず wlan.auth_mismatch。対応する端末（laptop）はつながる', () => {
    expect(ping(analyze(build('wpa3', 'pc_wifi'), data), 'pc', 'cl').failure?.reason).toBe('wlan.auth_mismatch');
    expect(ping(analyze(build('wpa3', 'laptop'), data), 'pc', 'cl').ok).toBe(true);
  });
  it('WPA2/WPA3 の移行モードは、どちらの端末もつながり、警告 wlan.transition を出す', () => {
    expect(ping(analyze(build('wpa2wpa3', 'pc_wifi'), data), 'pc', 'cl').ok).toBe(true);
    expect(ping(analyze(build('wpa2wpa3', 'laptop'), data), 'pc', 'cl').ok).toBe(true);
    expect(warningsOf(build('wpa2wpa3', 'laptop'), data).map((w) => w.id)).toContain('wlan.transition');
  });
  it('達成条件 wireless_secure: WPA2・WPA3 は合格、WEP・暗号化なし・移行モードは不合格', () => {
    const ok = (s: WirelessSecurity | undefined) => evaluateGoal({ type: 'wireless_secure', ssid: 'home' }, build(s, 'laptop'), data).every((r) => r.ok);
    expect([undefined, 'wpa2', 'wpa3'].map((s) => ok(s as WirelessSecurity | undefined))).toEqual([true, true, true]);
    expect((['wep', 'open', 'wpa2wpa3'] as const).map(ok)).toEqual([false, false, false]);
  });
  it('ターミナルの wireless security を読む', async () => {
    const { parseConfig } = await import('./terminalConfig');
    const tr = (k: string) => k;
    expect(parseConfig('wireless security wpa2-wpa3', tr)).toEqual({ kind: 'action', action: { kind: 'wireless', key: 'security', value: 'wpa2wpa3' } });
    expect(parseConfig('wireless security wpa5', tr)).toEqual({ kind: 'error', text: 'ui.terminal.usageWireless' });
  });
});
