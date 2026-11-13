// 自社オフィスの家具・床・広さ・機材の配置の操作。
import { balance, furniture } from 'virtual:game-data';
import type { FloorId } from '../../data/schema';
import { levelOf } from '../../sim/level';
import { gameEnv } from '../../sim/env';

import { changeOfficeFloor as changeFloorOp, type ExpandSide, expandOffice as expandOfficeOp, mapOfOffice } from '../../sim/office';
import { OFFICE_HISTORY_KEY } from '../../sim/history';
import { placeFurniture as placeFurnitureOp, moveFurniture as moveFurnitureOp, removeFurniture as removeFurnitureOp, rotateFurniture as rotateFurnitureOp } from '../../sim/furniture';
import { clearsPlacing } from '../../sim/shop';
import { type RoomId, officeUplinkOf, type Outcome } from '../../sim/project';
import { placeDevice, placeInOffice, placeOfficeUplink, moveOfficeUplink } from '../../sim/placement';

import { SANDBOX_EXPAND_CONFIG, coreOf, focusedProject } from '../gameHelpers';
import type { GameState } from '../useGameStore';
import type { StateCreator } from 'zustand';
import { createOps } from '../gameOps';

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
  const { apply, dropHistory, recorded } = createOps(set, get);
  // 置いて在庫が0になったら、選んでいる品目を外す
  const releaseWhenEmpty = (deviceId: string, reason: string | null): string | null => {
    const s = get();
    if (reason === null && clearsPlacing(s.owned, deviceId, s.mode === 'sandbox')) set({ placing: null });
    return reason;
  };
  return {
    // 在庫の機材・家具を配置する（購入はショップで行う）。案件がなければ自社オフィスに置く
    place: (deviceId, x, y) => {
      if (deviceId in furniture) return get().placeFurniture(deviceId, x, y);
      if (!focusedProject(get())) {
        const hq = get().maps.hq;
        if (!hq) return 'map';
        // 回線終端は在庫を持たない。まだなければ置き、置いてあれば有料で位置を変更する
        if (deviceId === 'uplink') {
          const core = coreOf(get());
          const op = officeUplinkOf(core.office) ? moveOfficeUplink : placeOfficeUplink;
          const reason = recorded(() => apply(op(core, x, y, hq, gameEnv, balance), { tx: x, ty: y }));
          if (reason === null) set({ placing: null });
          return reason;
        }
        return releaseWhenEmpty(deviceId, recorded(() => apply(placeInOffice(coreOf(get()), deviceId, x, y, hq, gameEnv, get().mode === 'sandbox', get().mode === 'sandbox'), { tx: x, ty: y })));
      }
      const project = focusedProject(get());
      if (!project) return 'map';
      const map = get().maps[project.contract.map];
      if (!map) return 'map';
      return releaseWhenEmpty(deviceId, recorded(() => apply(placeDevice(coreOf(get()), deviceId, x, y, map, gameEnv), { tx: x, ty: y })));
    },
    expandOffice: (side) => {
      const office = get().office;
      // 失敗の吹き出しは、広げる辺の内側の壁のマスに出す（広げる前の大きさで決める）
      const at = {
        tx: side === 'right' ? office.size.w + 1 : side === 'left' ? 0 : Math.floor((office.size.w + 2) / 2),
        ty: side === 'bottom' ? office.size.h + 1 : Math.floor((office.size.h + 2) / 2),
      };
      // サンドボックスは、解放（レベル）も費用も問わず広げる。拡張の上限は通常と同じ（N59）。費用は、資金を変えないよう一時的に大きな資金で計算してから戻す
      const sandboxExpand = get().mode === 'sandbox';
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
      const reason = recorded(() => apply(placeFurnitureOp(coreOf(get()), id, x, y, hq, get().mode === 'sandbox'), { tx: x, ty: y }));
      if (reason === null) get().grantCompanyExp('furniture');
      return reason;
    },
    removeFurniture: (uid) => {
      const f = get().office.furniture.find((x) => x.uid === uid);
      return recorded(() => apply(removeFurnitureOp(coreOf(get()), uid, get().mode === 'sandbox'), f ? { tx: f.x, ty: f.y } : undefined));
    },
    rotateFurniture: (uid) => apply(rotateFurnitureOp(coreOf(get()), uid)),
    changeFloor: (room, floor) => {
      const reason = apply(changeFloorOp(coreOf(get()), room, floor, balance));
      // 床の絵が変わるので、マップを作り直す（機器と家具はそのまま）
      if (reason === null) set((s) => ({ maps: { ...s.maps, hq: mapOfOffice(s.office) } }));
      return reason;
    },
    moveFurniture: (uid, x, y) => {
      const hq = get().maps.hq;
      if (!hq) return 'map';
      return recorded(() => apply(moveFurnitureOp(coreOf(get()), uid, x, y, hq), { tx: x, ty: y }));
    },
  };
};
