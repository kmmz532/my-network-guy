// 機器・配線・設定の設計の操作。成功したものは履歴に積み、失敗したら理由を返す。
import { playConnect, playFail } from '../../audio/sfx';
import type { FirewallRule, IspLine, Route } from '../../network/types';
import { gameEnv } from '../../sim/env';
import { isPcDevice } from '../../sim/env';
import { pcDesksOf } from '../../sim/furniture';
import { missingPcCount } from '../../sim/backOffice';
import { pushNotice } from '../../ui/notices';
import { sandboxTest } from '../../sim/sandbox';
import { lessons } from 'virtual:game-data';
import { lessonLinks, lessonNodes, lessonPlans } from '../../sim/lesson';
import { mapOfOffice } from '../../sim/office';

import { closeRef } from '../../ui/windows';
import { type PortChoice, connect, type PortModeChange, type StpOp, type ChannelOp, type DhcpOp, type VrrpOp, type OspfOp, type NatOp, type BgpOp, emptyOffice, type End } from '../../sim/project';
import { testDesign } from '../../sim/progress';
import { removeNode, removeFromOffice, replug, moveNode, replugTo, removeLink } from '../../sim/placement';

import { coreOf, focusedProject, netTargetOf } from '../gameHelpers';
import type { GameState } from '../useGameStore';
import type { StateCreator } from 'zustand';
import { createOps } from '../gameOps';
import { useUiStore } from '../useUiStore';

export interface DesignSlice {
  // 設計の操作を1つ元に戻す・やり直す（戻せなければ何もしない）
  undo: () => void;
  redo: () => void;
  // テストを押す。失敗したら理由を返す
  test: () => string | null;
  // 教材を開く（今の構成を教材の初期の構成に置き換える）・終える（構成は残す）
  openLesson: (id: string) => void;
  closeLesson: () => void;
  // 教材を開いている間にターミナルで打った命令（保存しない。案内の cmd 条件に使う）
  lessonCommands: string[];
  recordLessonCommand: (line: string) => void;
  // 教材の案内を終えた（飛ばした）
  finishLessonGuide: () => void;
  connect: (aUid: string, bUid: string, cableId: string, ports?: PortChoice) => string | null;
  removeLink: (uid: string) => string | null;
  removeNode: (uid: string) => string | null;
  // 機器の設定（設計中のみ）。失敗したら理由を返す
  setIface: (uid: string, port: number, ip: string, prefix?: number) => string | null;
  setSvi: (uid: string, vlan: number, ip: string, prefix?: number) => string | null;
  setPortMode: (uid: string, port: number, mode: PortModeChange) => string | null;
  setGateway: (uid: string, gateway: string | null) => string | null;
  setRouting: (uid: string, change: { proto: 'rip' | 'ospf'; on: boolean; ip?: string; area?: number }) => string | null;
  setOspf: (uid: string, change: OspfOp) => string | null;
  setIsp: (uid: string, line: IspLine) => string | null;
  setStp: (uid: string, change: StpOp) => string | null;
  setChannel: (uid: string, change: ChannelOp) => string | null;
  setDhcp: (uid: string, change: DhcpOp) => string | null;
  setPower: (uid: string, on: boolean) => string | null;
  setVrrp: (uid: string, change: VrrpOp) => string | null;
  setBgp: (uid: string, change: BgpOp) => string | null;
  setNat: (uid: string, change: NatOp) => string | null;
  setWireless: (uid: string, key: 'ssid' | 'password' | 'channel' | 'vlan' | 'security', value: string | number) => string | null;
  // ファイアウォールの規則を置き換える（N38）
  setFirewallRules: (uid: string, rules: FirewallRule[]) => string | null;
  // セグメント（ポートが属するネットワーク）のアドレスを設定する
  setPlan: (uid: string, port: number, network: string, prefix: number) => string | null;
  // 配線の片方の端を、同じ機器の別のポートへ挿し替える
  replug: (linkUid: string, end: End, port: number) => string | null;
  // 機器・家具を別のマスへ動かす（配置と同じ判定。ケーブルは付いたまま、費用の差額を払う）。失敗したら理由を返す
  moveNode: (uid: string, x: number, y: number) => string | null;
  // ケーブルの端を、別の機器の空いているポートへ挿す（port が null なら空いている最小の番号）
  replugTo: (linkUid: string, end: End, nodeUid: string, port: number | null) => string | null;
  // サービスを起動（on）・停止する
  setService: (uid: string, protocol: 'http', on: boolean) => string | null;
  setName: (uid: string, name: string) => string | null;
  // ホスト名を付ける（null で外す）（N46）
  setHostname: (uid: string, hostname: string | null) => string | null;
  setNameServer: (uid: string, ip: string | null) => string | null;
  setDnsRole: (uid: string, on: boolean) => string | null;
  autoRegisterZone: (uid: string) => string | null;
  // 対応表（名前と IPアドレス）の登録と削除。失敗したら理由を返す
  setHost: (uid: string, name: string, ip: string) => string | null;
  removeHost: (uid: string, name: string) => string | null;
  addRoute: (uid: string, route: Route) => string | null;
  removeRoute: (uid: string, index: number) => string | null;
}

export const createDesignSlice: StateCreator<GameState, [], [], DesignSlice> = (set, get) => {
  const { apply, dispatch, recorded, stepHistory, tileOf, withAutoIp } = createOps(set, get);
  const missingPc = (state: GameState): number =>
    missingPcCount(state.staff, { pcDesks: pcDesksOf(state.office, isPcDevice), defs: gameEnv.furniture ?? {}, balance: gameEnv.balance, staff: state.staff });
  return {
    undo: () => stepHistory('undo'),
    redo: () => stepHistory('redo'),
    openLesson: (id) => {
      const s = get();
      if (s.mode !== 'sandbox') throw new Error('教材はサンドボックスだけで開ける');
      const lesson = lessons.find((l) => l.id === id);
      if (!lesson) throw new Error(`教材 ${id} がない`);
      // 教材の機器は IP アドレスから網の設定を補う（色は保存された設定から決まるため、補わないと灰色のまま）
      const nodes = lessonNodes(lesson);
      const links = lessonLinks(lesson);
      const office = { ...emptyOffice(lesson.size), nodes, links, plans: lessonPlans(nodes, links, gameEnv.engine) };
      set({ office, maps: { ...s.maps, hq: mapOfOffice(office) }, sandboxLesson: { id, step: 0, done: false }, lessonCommands: [], check: null, helpUid: null, traces: [] });
    },
    closeLesson: () => set({ sandboxLesson: null, lessonCommands: [] }),
    lessonCommands: [],
    recordLessonCommand: (line) => {
      if (get().sandboxLesson) set((s) => ({ lessonCommands: [...s.lessonCommands, line] }));
    },
    finishLessonGuide: () => set((s) => (s.sandboxLesson ? { sandboxLesson: { ...s.sandboxLesson, done: true } } : {})),
    test: () => {
      const s = get();
      // サンドボックスは、案件の達成条件なしで、PC とサーバーの疎通を判定する
      if (s.mode === 'sandbox') {
        const lesson = s.sandboxLesson ? lessons.find((l) => l.id === s.sandboxLesson?.id) : undefined;
        const sr = sandboxTest(s.office, gameEnv, lesson?.goals);
        if (!sr) {
          set({ lastError: 'none' });
          return 'none';
        }
        set({
          lastError: null,
          traces: sr.traces,
          check: { projectId: 'hq', goals: sr.goals, warnings: sr.warnings },
          helpUid: null,
        });
        return null;
      }
      const r = testDesign(coreOf(get()), { ...gameEnv, mapOf: (id) => get().maps[id] });
      if (!r.ok) {
        set({ lastError: r.reason });
        return r.reason;
      }
      set({
        lastError: null,
        active: r.core.active,
        traces: r.result.traces,
        check: { projectId: r.core.focus ?? '', goals: r.result.goals, warnings: r.result.warnings },
        helpUid: null,
      });
      return null;
    },
    connect: (aUid, bUid, cableId, ports = {}) => {
      const reason = recorded(() => apply(withAutoIp(connect(coreOf(get()), aUid, bUid, cableId, gameEnv, netTargetOf(get()), ports), netTargetOf(get())), tileOf(bUid)));
      // つながった音と、つなげなかった音（効果音の設定がオフのときは鳴らない）
      if (reason === null) {
        playConnect();
        useUiStore.setState({ linkPulse: { a: aUid, b: bUid, at: Date.now() } });
      } else {
        playFail();
      }
      return reason;
    },
    removeLink: (uid) => recorded(() => apply(removeLink(coreOf(get()), uid, netTargetOf(get()), gameEnv))),
    removeNode: (uid) => {
      const before = missingPc(get());
      const reason = recorded(() => {
        if (!focusedProject(get())) {
          const n = get().office.nodes.find((x) => x.uid === uid);
          return apply(removeFromOffice(coreOf(get()), uid, gameEnv, get().mode === 'sandbox'), n ? { tx: n.x, ty: n.y } : undefined);
        }
        return apply(removeNode(coreOf(get()), uid, gameEnv), tileOf(uid));
      });
      // 撤去した機器のタブは閉じる（最後のタブならウィンドウも閉じる）
      if (reason === null) set((s) => ({ windows: closeRef({ windows: s.windows, seq: s.windowSeq }, 'device', uid).windows }));
      // 撤去した機器の端末の出力と履歴も消す
      if (reason === null) get().dropTerminal(uid);
      if (reason === null) {
        const after = missingPc(get());
        if (after > before) set((s) => ({ notices: pushNotice(s.notices, 'pcMissing', { count: after }, Date.now()) }));
      }
      return reason;
    },
    setIface: (uid, port, ip, prefix = 24) => dispatch({ kind: 'config', uid, change: { kind: 'iface', port, ip, prefix } }, tileOf(uid)),
    setSvi: (uid, vlan, ip, prefix = 24) => dispatch({ kind: 'config', uid, change: { kind: 'svi', vlan, ip, prefix } }, tileOf(uid)),
    setPortMode: (uid, port, mode) => dispatch({ kind: 'config', uid, change: { kind: 'portMode', port, mode } }, tileOf(uid)),
    setGateway: (uid, gateway) => dispatch({ kind: 'config', uid, change: { kind: 'gateway', gateway } }, tileOf(uid)),
    setVrrp: (uid, change) => dispatch({ kind: 'config', uid, change: { kind: 'vrrp', change } }, tileOf(uid)),
    setPower: (uid, on) => dispatch({ kind: 'config', uid, change: { kind: 'power', on } }, tileOf(uid)),
    setStp: (uid, change) => dispatch({ kind: 'config', uid, change: { kind: 'stp', change } }, tileOf(uid)),
    setDhcp: (uid, change) => dispatch({ kind: 'config', uid, change: { kind: 'dhcp', change } }, tileOf(uid)),
    setChannel: (uid, change) => dispatch({ kind: 'config', uid, change: { kind: 'channel', change } }, tileOf(uid)),
    setIsp: (uid, line) => dispatch({ kind: 'config', uid, change: { kind: 'isp', line } }, tileOf(uid)),
    setOspf: (uid, change) => dispatch({ kind: 'config', uid, change: { kind: 'ospf', change } }, tileOf(uid)),
    setRouting: (uid, change) => dispatch({ kind: 'config', uid, change: { kind: 'routing', change } }, tileOf(uid)),
    setBgp: (uid, change) => dispatch({ kind: 'config', uid, change: { kind: 'bgp', change } }, tileOf(uid)),
    setNat: (uid, change) => dispatch({ kind: 'config', uid, change: { kind: 'nat', change } }, tileOf(uid)),
    setWireless: (uid, key, value) => dispatch({ kind: 'config', uid, change: { kind: 'wireless', key, value } }, tileOf(uid)),
    setFirewallRules: (uid, rules) => dispatch({ kind: 'config', uid, change: { kind: 'firewallRules', rules } }, tileOf(uid)),
    // セグメントの設定の後は、IPアドレスの自動割り当てをかける
    setPlan: (uid, port, network, prefix) => dispatch({ kind: 'config', uid, change: { kind: 'plan', port, network, prefix } }, tileOf(uid), netTargetOf(get())),
    replug: (linkUid, end, port) =>
      recorded(() => apply(replug(coreOf(get()), linkUid, end, port, gameEnv, netTargetOf(get())))),
    // 移動の地図は、設計中の案件のマップ（なければ自社オフィスの hq）
    moveNode: (uid, x, y) => {
      const before = missingPc(get());
      const map = get().maps[focusedProject(get())?.contract.map ?? 'hq'];
      if (!map) return 'map';
      const reason = recorded(() => apply(moveNode(coreOf(get()), uid, x, y, gameEnv, netTargetOf(get()), map, get().mode === 'sandbox'), tileOf(uid)));
      if (reason === null) {
        const after = missingPc(get());
        if (after > before) set((s) => ({ notices: pushNotice(s.notices, 'pcMissing', { count: after }, Date.now()) }));
      }
      return reason;
    },
    replugTo: (linkUid, end, nodeUid, port) =>
      recorded(() => apply(replugTo(coreOf(get()), linkUid, end, nodeUid, port, gameEnv, netTargetOf(get())), tileOf(nodeUid))),
    setService: (uid, protocol, on) => dispatch({ kind: 'config', uid, change: { kind: 'service', protocol, on } }, tileOf(uid)),
    setHostname: (uid, hostname) => dispatch({ kind: 'config', uid, change: { kind: 'hostname', hostname } }, tileOf(uid)),
    setNameServer: (uid, ip) => dispatch({ kind: 'config', uid, change: { kind: 'nameServer', ip } }, tileOf(uid)),
    setDnsRole: (uid, on) => dispatch({ kind: 'config', uid, change: { kind: 'dnsRole', on } }, tileOf(uid)),
    autoRegisterZone: (uid) => dispatch({ kind: 'config', uid, change: { kind: 'autoRegisterZone' } }, tileOf(uid)),
    setName: (uid, name) => dispatch({ kind: 'config', uid, change: { kind: 'name', name } }, tileOf(uid)),
    setHost: (uid, name, ip) => dispatch({ kind: 'config', uid, change: { kind: 'host', name, ip } }, tileOf(uid)),
    removeHost: (uid, name) => dispatch({ kind: 'config', uid, change: { kind: 'removeHost', name } }, tileOf(uid)),
    addRoute: (uid, route) => dispatch({ kind: 'config', uid, change: { kind: 'addRoute', route } }, tileOf(uid)),
    removeRoute: (uid, index) => dispatch({ kind: 'config', uid, change: { kind: 'removeRoute', index } }, tileOf(uid)),
  };
};
