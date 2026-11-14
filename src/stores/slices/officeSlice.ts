// 自社オフィスの家具・床・広さ・機材の配置の操作。
import { balance } from 'virtual:game-data';
import type { FloorId } from '../../data/schema';
import { levelOf } from '../../sim/level';
import { gameEnv } from '../../sim/env';

import { changeOfficeFloor as changeFloorOp, type ExpandSide, expandOffice as expandOfficeOp, mapOfOffice } from '../../sim/office';
import { OFFICE_HISTORY_KEY } from '../../sim/history';
import { clearsPlacing } from '../../sim/shop';
import { type RoomId, officeUplinkOf, type Outcome } from '../../sim/project';
import { placeOfficeUplink, moveOfficeUplink } from '../../sim/placement';

import { SANDBOX_BALANCE, SANDBOX_EXPAND_CONFIG, coreOf, focusedProject } from '../gameHelpers';
import type { GameState } from '../useGameStore';
import type { StateCreator } from 'zustand';
import { createOps } from '../gameOps';
import { hasFurniture } from '../../registry/query';

export interface OfficeSlice {
  place: (deviceId: string, x: number, y: number) => string | null;
  // 自社オフィスの家具と社員。失敗したら理由を返す
  placeFurniture: (id: string, x: number, y: number) => string | null;
  // 自社オフィスの部屋の辺を買って2マス広げる（確認なし。取り消しの対象外）。失敗したら理由を返す
  expandOffice: (side: ExpandSide) => string | null;
  removeFurniture: (uid: string) => string | null;
  // 家具を90度回す（N95）
  rotateFurniture: (uid: string) => string | null;
  // 自社の床を張り替える（N92）
  changeFloor: (room: RoomId, floor: FloorId) => string | null;
  moveFurniture: (uid: string, x: number, y: number) => string | null;
}

export const createOfficeSlice: StateCreator<GameState, [], [], OfficeSlice> = (set, get) => {
  const { apply, applyUnrecorded, dispatch, dropHistory, recorded } = createOps(set, get);
  // 解放（レベル）も費用も問わない遊び方か。遊び方の名前を見るのはここだけにする
  const freePlay = (): boolean => get().mode === 'sandbox';
  // 置いて在庫が0になったら、選んでいる品目を外す
  const releaseWhenEmpty = (deviceId: string, reason: string | null): string | null => {
    const s = get();
    if (reason === null && clearsPlacing(s.owned, deviceId, freePlay())) set({ placing: null });
    return reason;
  };
  return {
    // 在庫の機材・家具を配置する（購入はショップで行う）。案件がなければ自社オフィスに置く
    place: (deviceId, x, y) => {
      if (hasFurniture(deviceId)) return get().placeFurniture(deviceId, x, y);
      if (!focusedProject(get())) {
        const hq = get().maps.hq;
        if (!hq) return 'map';
        // 回線終端は在庫を持たない。まだなければ置き、置いてあれば有料で位置を変更する
        if (deviceId === 'uplink') {
          // サンドボックスは、解放（レベル）も費用も問わず置く。資金は apply が元のまま残す
          const free = freePlay();
          const base = coreOf(get());
          const core = free ? { ...base, clock: { ...base.clock, money: Number.MAX_SAFE_INTEGER } } : base;
          const op = officeUplinkOf(core.office) ? moveOfficeUplink : placeOfficeUplink;
          const reason = recorded(() => apply(op(core, x, y, hq, gameEnv, free ? SANDBOX_BALANCE : balance), { tx: x, ty: y }));
          if (reason === null) set({ placing: null });
          return reason;
        }
        return releaseWhenEmpty(deviceId, dispatch({ kind: 'placeDevice', device: deviceId, x, y }, { tx: x, ty: y }));
      }
      const project = focusedProject(get());
      if (!project) return 'map';
      const map = get().maps[project.contract.map];
      if (!map) return 'map';
      return releaseWhenEmpty(deviceId, dispatch({ kind: 'placeDevice', device: deviceId, x, y }, { tx: x, ty: y }));
    },
    expandOffice: (side) => {
      const office = get().office;
      // 失敗の吹き出しは、広げる辺の内側の壁のマスに出す（広げる前の大きさで決める）
      const at = {
        tx: side === 'right' ? office.size.w + 1 : side === 'left' ? 0 : Math.floor((office.size.w + 2) / 2),
        ty: side === 'bottom' ? office.size.h + 1 : Math.floor((office.size.h + 2) / 2),
      };
      // サンドボックスは、解放（レベル）も費用も問わず広げる。拡張の上限は通常と同じ（N59）。費用は、資金を変えないよう一時的に大きな資金で計算してから戻す
      const sandboxExpand = freePlay();
      const core = coreOf(get());
      const outcome = sandboxExpand
        ? expandOfficeOp({ ...core, clock: { ...core.clock, money: Number.MAX_SAFE_INTEGER } }, side, SANDBOX_EXPAND_CONFIG, 0)
        : expandOfficeOp(core, side, balance.office, levelOf(get().companyExp, balance));
      const restored: Outcome = outcome.ok && sandboxExpand ? { ...outcome, core: { ...outcome.core, clock: { ...outcome.core.clock, money: core.clock.money } } } : outcome;
      const reason = apply(restored, at);
      if (reason !== null) return reason;
      get().grantCompanyExp('expansion');
      // 部屋の大きさが変わったので、マップを作り直す。広げる前の操作の取り消しは、座標が合わないため消す
      dropHistory(OFFICE_HISTORY_KEY);
      set((s) => ({ maps: { ...s.maps, hq: mapOfOffice(s.office) } }));
      return null;
    },
    placeFurniture: (id, x, y) => {
      const hq = get().maps.hq;
      if (!hq) return 'map';
      const reason = dispatch({ kind: 'placeFurniture', id, x, y }, { tx: x, ty: y });
      if (reason === null) get().grantCompanyExp('furniture');
      return reason;
    },
    removeFurniture: (uid) => {
      const f = get().office.furniture.find((x) => x.uid === uid);
      return dispatch({ kind: 'removeFurniture', uid }, f ? { tx: f.x, ty: f.y } : undefined);
    },
    rotateFurniture: (uid) => applyUnrecorded({ kind: 'rotateFurniture', uid }),
    changeFloor: (room, floor) => {
      // サンドボックスは、解放（レベル）も費用も問わず張り替える。資金は apply が元のまま残す
      const base = coreOf(get());
      const core = freePlay() ? { ...base, clock: { ...base.clock, money: Number.MAX_SAFE_INTEGER } } : base;
      const reason = apply(changeFloorOp(core, room, floor, freePlay() ? SANDBOX_BALANCE : balance));
      // 床の絵が変わるので、マップを作り直す（機器と家具はそのまま）
      if (reason === null) set((s) => ({ maps: { ...s.maps, hq: mapOfOffice(s.office) } }));
      return reason;
    },
    moveFurniture: (uid, x, y) => {
      const hq = get().maps.hq;
      if (!hq) return 'map';
      return dispatch({ kind: 'moveFurniture', uid, x, y }, { tx: x, ty: y });
    },
  };
};
