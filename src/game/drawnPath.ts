// 画面に描くケーブルの経路（マス単位の点列）。設定で直線を選んでいれば両端だけを結び、そうでなければ保存した L字の経路を使う。
// 長さと費用は保存した経路（マンハッタン距離）で数えるため、ここは描き方と当たり判定にだけ使う。
import type { NetLink } from '../network/types';
import { useGameStore } from '../stores/useGameStore';

export const drawnPath = (link: NetLink): NetLink['path'] =>
  useGameStore.getState().straightCables && link.path.length > 2 ? [link.path[0], link.path[link.path.length - 1]] : link.path;
