// 802.1X（RADIUS）の SSID: アクセスポイントから RADIUS サーバーへ届くときだけ、端末がつながる
import { describe, expect, it } from 'vitest';
import { gameEnv } from '../sim/env';
import { ping } from './engine';
import { analyze } from './engine/analyze';
import { evaluateGoal } from './goals';
import type { Iface, NetNode, Network, Service, WirelessSecurity } from './types';

const data = gameEnv.engine;
const f = (port: number, ip: string): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix: 24 });
const n = (uid: string, device: string, interfaces: Iface[], x: number, extra: Partial<NetNode> = {}): NetNode =>
  ({ uid, device, macSerial: x + 1, x, y: 0, locked: false, configLocked: false, interfaces, gateway: null, routes: [], services: [], ports: [], ...extra }) as NetNode;
const l = (uid: string, a: string, pa: number, b: string, pb: number) => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]] as [number, number][], paid: 0 });

interface Options {
  security?: WirelessSecurity;
  radius?: string | null;
  services?: Service[];
  device?: string;
  // 端末の設定のパスワード（802.1X では求めない）
  password?: string;
}

// 有線の PC・RADIUS サーバー・アクセスポイントを同じスイッチにつなぎ、端末（cl）は電波で届く距離に置く
const build = ({ security = 'wpa2_eap', radius = '192.168.1.50', services = [{ protocol: 'radius' }], device = 'laptop', password }: Options = {}): Network => ({
  nodes: [
    n('pc', 'pc_basic', [f(0, '192.168.1.10')], 0),
    n('sw', 'l2_switch_8p', [], 1),
    n('ap', 'access_point', [], 2, { components: { wireless: { ssid: 'corp', password: 'unused', band: '2.4', security, ...(radius === null ? {} : { radius }) } } }),
    n('srv', 'server_basic', [f(0, '192.168.1.50')], 3, { services }),
    n('cl', device, [f(0, '192.168.1.20')], 4, { components: { wireless: { ssid: 'corp', ...(password === undefined ? {} : { password }) } } }),
  ],
  links: [l('a', 'pc', 0, 'sw', 0), l('b', 'sw', 1, 'ap', 0), l('c', 'sw', 2, 'srv', 0)],
  plans: {},
});

const reason = (opts: Options) => ping(analyze(build(opts), data), 'pc', 'cl').failure?.reason;

describe('802.1X の無線', () => {
  it('RADIUS サーバーへ届けば、パスワードがなくてもつながる（WPA2・WPA3 の両方の方式）', () => {
    expect(ping(analyze(build(), data), 'pc', 'cl').ok).toBe(true);
    expect(ping(analyze(build({ security: 'wpa3_eap' }), data), 'pc', 'cl').ok).toBe(true);
  });

  it('アクセスポイントに RADIUS のアドレスがなければ、つながらず wlan.no_radius', () => {
    expect(reason({ radius: null })).toBe('wlan.no_radius');
  });

  it('アドレスのサーバーが radius のサービスを持たなければ、つながらず wlan.no_radius', () => {
    expect(reason({ services: [] })).toBe('wlan.no_radius');
  });

  it('アドレスのサーバーがなければ、つながらず wlan.no_radius', () => {
    expect(reason({ radius: '192.168.1.99' })).toBe('wlan.no_radius');
  });

  it('サーバーへ届かなければ（配線がなければ）、つながらず wlan.no_radius', () => {
    const net = build();
    const cut = { ...net, links: net.links.filter((x) => x.uid !== 'c') };
    expect(ping(analyze(cut, data), 'pc', 'cl').failure?.reason).toBe('wlan.no_radius');
  });

  it('サーバーがルーターの先にあるとき、配線がつながれば届き、切れていれば wlan.no_radius', () => {
    const routed = (connected: boolean): Network => {
      const base = build({ radius: '10.0.0.50' });
      return {
        ...base,
        nodes: [...base.nodes.filter((x) => x.uid !== 'srv'), n('r', 'router_basic', [f(0, '192.168.1.1'), f(1, '10.0.0.1')], 5), n('srv', 'server_basic', [f(0, '10.0.0.50')], 3, { services: [{ protocol: 'radius' }], gateway: '10.0.0.1' })],
        links: [l('a', 'pc', 0, 'sw', 0), l('b', 'sw', 1, 'ap', 0), l('r0', 'sw', 2, 'r', 0), ...(connected ? [l('r1', 'r', 1, 'srv', 0)] : [])],
      };
    };
    expect(ping(analyze(routed(true), data), 'pc', 'cl').ok).toBe(true);
    expect(ping(analyze(routed(false), data), 'pc', 'cl').failure?.reason).toBe('wlan.no_radius');
  });

  it('方式に対応しない端末（WPA3 の 802.1X に pc_wifi）は、wlan.auth_mismatch', () => {
    expect(reason({ security: 'wpa3_eap', device: 'pc_wifi' })).toBe('wlan.auth_mismatch');
    expect(reason({ security: 'wpa2_eap', device: 'pc_wifi' })).toBeUndefined();
  });

  it('達成条件 wireless_secure は、802.1X の方式で満たされる', () => {
    const ok = (security: WirelessSecurity) => evaluateGoal({ type: 'wireless_secure', ssid: 'corp' }, analyze(build({ security }), data)).every((r) => r.ok);
    expect([ok('wpa2_eap'), ok('wpa3_eap')]).toEqual([true, true]);
  });
});
