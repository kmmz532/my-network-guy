// 画面の状態（道具・配線の途中・通知・結果・表示の切り替え）の操作。
import type { TerminalLine } from '../../network/terminal';
import type { TerminalSession } from '../../network/command/types';
import { appendLog, pushCommand } from '../../network/terminalLog';
import { loadSettings, saveSettings } from '../../settings/settings';
import { MODE_TRAITS } from '../../company/company';
import { TOOL_HINTS, toolHintOf, type ToolEvent } from '../../sim/toolHint';
import { gameEnv } from '../../sim/env';
import { learnFromPing } from '../../network/learn';

import { dismissNotice, openOf, promoteNotices } from '../../ui/notices';
import { useUiStore, type ItemDrag } from '../useUiStore';

import { editNetOf, plannedKey, type PlannedNet } from '../gameHelpers';
import type { GameState, Tool } from '../useGameStore';
import type { StateCreator } from 'zustand';

export interface UiSlice {
  dismissReport: () => void;
  // 通知を押して閉じる（開く画面があれば開く）
  openNotice: (id: number) => void;
  dismissNotice: (id: number) => void;
  // 期限の過ぎた通知を消し、待っている通知を出す
  tickNotices: () => void;
  setTool: (tool: Tool) => void;
  // 道具と合わない操作の出来事を受け、出せるなら一言を出す（種類ごとに1回。出した種類は端末に覚える）
  toolEvent: (event: ToolEvent) => void;
  closeToolHint: () => void;
  // 案件などの案内の手順を出している間か（Guide が置く。保存しない）
  setGuideShowing: (showing: boolean) => void;
  // 画面の対象を、自社オフィス（null）か進行中の案件に切り替える（N111）。配線の途中と置く予定は取り消す
  setFocus: (id: string | null) => void;
  // 配線の道具で機器を押したとき、ポートの一覧を開く（起点を選ぶか、相手を選ぶかは起点の有無で決まる）
  // blocked を渡すと、ケーブルの端を持ったまま機器の上に出す一覧（drag）になる（blocked は差せない口の番号）
  openPortMenu: (uid: string, x: number, y: number, blocked?: readonly number[]) => void;
  // drag の一覧で、指・カーソルの下の行を示す（口の番号、おまかせは auto、なければ null）
  hotPort: (hot: number | 'auto' | null) => void;
  // drag の一覧だけを閉じる（ほかの一覧と配線の途中は残す）
  closeDragPortMenu: () => void;
  // ポートの一覧で選んだポート（null は「おまかせ」）。起点なら起点にし、相手なら配線する
  pickPort: (port: number | null) => void;
  // 配線の途中（起点と一覧）を取り消す
  cancelWire: () => void;
  setHelpUid: (uid: string | null) => void;
  setShowIp: (on: boolean) => void;
  setShowNames: (on: boolean) => void;
  // 端末の記録（機器ごと）。出力の追加・命令の履歴・出力だけの消去・機器の撤去
  appendTerminal: (uid: string, lines: TerminalLine[]) => void;
  recordTerminalCommand: (uid: string, line: string) => void;
  clearTerminalLog: (uid: string) => void;
  setTerminalSession: (uid: string, session: TerminalSession) => void;
  clearTerminalSessions: () => void;
  dropTerminal: (uid: string) => void;
  setTaskOpen: (open: boolean) => void;
  setPlacing: (deviceId: string | null) => void;
  setItemDrag: (drag: ItemDrag | null) => void;
  setWireCable: (cableId: string) => void;
  // 詳しくで選んだ、まだ設定のないポートのネットワーク（null で消す）。配線・セグメントの設定のときに使う
  setPlanned: (uid: string, port: number, net: PlannedNet | null) => void;
  // ping が通ったときに、ARP と MAC の表へ覚える（N69）
  learnPing: (srcUid: string, dstUid: string) => void;
}

export const createUiSlice: StateCreator<GameState, [], [], UiSlice> = (set, get) => {
  return {
    dismissReport: () => set({ lastReport: null, showcase: null, traces: [] }),
    dismissNotice: (id) => set((s) => ({ notices: dismissNotice(s.notices, id) })),
    tickNotices: () => set((s) => ({ notices: promoteNotices(s.notices, Date.now()) })),
    openNotice: (id) => {
      const item = get().notices.find((n) => n.id === id);
      if (!item) return;
      const open = openOf(item.kind);
      const s = get();
      if (open === 'funds') s.openWindow('funds', '');
      else if (open === 'offers') s.openWindow('offers', '');
      else if (open === 'staff' && typeof item.params.uid === 'string') s.openWindow('staff', item.params.uid);
      else if (open === 'staff' || open === 'staffList') s.openWindow('staffList', '');
      else if (open === 'hiring') useUiStore.getState().openHiring('hiring');
      set((st) => ({ notices: dismissNotice(st.notices, id) }));
    },
    setHelpUid: (uid) => set({ helpUid: uid }),
    // 道具を変えると、配線の途中・一覧・置く予定の機材を取り消す。選択の道具以外では機器の画面を閉じる
    setFocus: (id) => {
      const s = get();
      if (id !== null && !s.active.some((p) => p.id === id)) return;
      if (s.focus === id) return;
      set({ focus: id, placing: null });
      useUiStore.setState({ wireStart: null, portMenu: null });
    },
    setTool: (tool) => {
      const s = get();
      if (s.tool === tool && !s.placing) return;
      set({ tool, placing: null });
      // 合う道具を選んだら、道具の一言を下げる
      if (s.toolHint !== null && TOOL_HINTS[s.toolHint].target === `tool.${tool}`) set({ toolHint: null });
      useUiStore.setState({ wireStart: null, portMenu: null });
    },
    toolEvent: (event) => {
      const s = get();
      const settings = loadSettings();
      const kind = toolHintOf(event, s.tool, settings.toolHintsShown, {
        offers: MODE_TRAITS[s.mode].offers,
        companiesStarted: settings.companiesStarted,
        guideOn: settings.guide,
        guideShowing: s.guideShowing,
      });
      if (kind === null) return;
      saveSettings({ toolHintsShown: [...settings.toolHintsShown, kind] });
      set({ toolHint: kind });
    },
    closeToolHint: () => set((s) => (s.toolHint === null ? {} : { toolHint: null })),
    setGuideShowing: (showing) => set((s) => (s.guideShowing === showing ? {} : { guideShowing: showing })),
    openPortMenu: (uid, x, y, blocked) => {
      if (blocked) {
        useUiStore.setState({ portMenu: { uid, x, y, role: 'drag', blocked, hot: null } });
        return;
      }
      const wireStart = useUiStore.getState().wireStart;
      useUiStore.setState({
        portMenu: { uid, x, y, role: wireStart && wireStart.uid !== uid ? 'to' : 'from', blocked: [], hot: null },
      });
    },
    hotPort: (hot) => {
      const menu = useUiStore.getState().portMenu;
      if (menu?.role === 'drag' && menu.hot !== hot) useUiStore.setState({ portMenu: { ...menu, hot } });
    },
    closeDragPortMenu: () => {
      if (useUiStore.getState().portMenu?.role === 'drag') useUiStore.setState({ portMenu: null });
    },
    pickPort: (port) => {
      const menu = useUiStore.getState().portMenu;
      if (!menu) return;
      if (menu.role === 'from') {
        useUiStore.setState({ wireStart: { uid: menu.uid, port }, portMenu: null });
        return;
      }
      const start = useUiStore.getState().wireStart;
      if (!start) {
        useUiStore.setState({ portMenu: null });
        return;
      }
      // 配線できたら途中を終える。できなければ起点を残し、理由を出す
      const reason = get().connect(start.uid, menu.uid, get().wireCable, {
        a: start.port ?? undefined,
        b: port ?? undefined,
      });
      useUiStore.setState({ portMenu: null, wireStart: reason === null ? null : start });
    },
    cancelWire: () => useUiStore.setState({ wireStart: null, portMenu: null }),
    setShowIp: (on) => {
      set({ showIp: on });
      saveSettings({ showIp: on });
    },
    setShowNames: (on) => {
      set({ showNames: on });
      saveSettings({ showNames: on });
    },
    appendTerminal: (uid, lines) => set((s) => ({ terminalLog: { ...s.terminalLog, [uid]: appendLog(s.terminalLog[uid] ?? [], lines) } })),
    recordTerminalCommand: (uid, line) => set((s) => ({ terminalCommands: { ...s.terminalCommands, [uid]: pushCommand(s.terminalCommands[uid] ?? [], line) } })),
    setTerminalSession: (uid, session) => set((s) => ({ terminalSession: { ...s.terminalSession, [uid]: session } })),
    clearTerminalSessions: () => set({ terminalSession: {} }),
    clearTerminalLog: (uid) => set((s) => ({ terminalLog: { ...s.terminalLog, [uid]: [] } })),
    dropTerminal: (uid) =>
      set((s) => {
        const log = { ...s.terminalLog };
        const commands = { ...s.terminalCommands };
        const sessions = { ...s.terminalSession };
        delete log[uid];
        delete commands[uid];
        delete sessions[uid];
        return { terminalLog: log, terminalCommands: commands, terminalSession: sessions };
      }),
    setTaskOpen: (open) => set({ taskOpen: open }),
    setPlacing: (deviceId) => set({ placing: deviceId }),
    setItemDrag: (itemDrag) => useUiStore.setState({ itemDrag }),
    setWireCable: (cableId) => set({ wireCable: cableId }),
    setPlanned: (uid, port, net) =>
      set((s) => {
        const key = plannedKey(uid, port);
        const next = { ...s.planned };
        if (net) next[key] = net;
        else delete next[key];
        return { planned: next };
      }),
    learnPing: (srcUid, dstUid) => {
      const s = get();
      const net = editNetOf(s);
      if (!net) return;
      const r = learnFromPing(net.nodes, net.links, gameEnv.engine, srcUid, dstUid);
      if (r.arp === null && r.macs.length === 0) return;
      const netKey = s.focus ?? 'office';
      const arpKey = `${netKey}:${srcUid}`;
      const arp = r.arp === null ? (s.arpTable[arpKey] ?? []) : [...(s.arpTable[arpKey] ?? []).filter((x) => x.ip !== r.arp?.ip), r.arp];
      const macTable = { ...s.macTable };
      for (const { switchUid, entry } of r.macs) {
        const k = `${netKey}:${switchUid}`;
        macTable[k] = [...(macTable[k] ?? []).filter((x) => x.port !== entry.port), entry];
      }
      set({ arpTable: { ...s.arpTable, [arpKey]: arp }, macTable });
    },
  };
};
