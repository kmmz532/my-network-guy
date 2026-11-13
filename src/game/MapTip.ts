// マップ上の説明（機器・家具・社員）。マウスは乗せてから、タッチは長押ししてから出す。説明の中身は、その時点の状態から作る。
import type { FederatedPointerEvent } from 'pixi.js';
import { balance } from 'virtual:game-data';
import { nodeLabel } from '../components/nodeLabel';
import { hideTip, showTipAt } from '../components/Tooltip';
import { t, tDyn } from '../i18n/t';
import { viewingOffice, useGameStore } from '../stores/useGameStore';
import { gameEnv } from '../sim/env';
import type { Project } from '../sim/project';
import type { NetworkState } from '../network/public';
import { effectText } from './effectText';
import { staffAt, type StaffHit } from './staffHit';
import type { MapHit } from './MapHit';

// 補完したアドレスの構成と設計の不備
type Compiled = { net: NetworkState['net']; issues: NetworkState['addressing']['issues'] };

export interface MapTipHost {
  hit: MapHit;
  project(): Project | null;
  compiled(): Compiled | null;
  staffHits(): StaffHit[];
}

export class MapTip {
  private tipKey: string | null = null;
  private tipTimer: number | null = null;
  private tipHideTimer: number | null = null;
  private tipShown = false;

  constructor(private host: MapTipHost) {}

  // 機器・家具・社員の説明。社員は、描いている社員のスプライトの範囲で判定する（机のマスでは机の説明）。なければ null
  private mapTipAt(p: { x: number; y: number }): { key: string; text: string } | null {
    const store = useGameStore.getState();
    const staffUid = staffAt(this.host.staffHits(), p);
    const member = staffUid ? store.staff.find((m) => m.uid === staffUid) : undefined;
    if (member) {
      const lines = [tDyn(member.name), tDyn(`staff.job.${member.job}`), t('ui.staff.level', { level: member.level })];
      return { key: `s:${member.uid}`, text: lines.join('\n') };
    }
    const tile = this.host.hit.tileOf(p);
    if (!tile) return null;
    const { tx, ty } = tile;
    const node = this.host.project()?.nodes.find((n) => n.x === tx && n.y === ty);
    if (node) {
      const ips = this.host.compiled()?.net.nodes.find((n) => n.uid === node.uid)?.interfaces.map((i) => `${i.ip}/${i.prefix}`) ?? [];
      return { key: `n:${node.uid}`, text: [nodeLabel(store, node, this.host.project()?.nodes ?? []), ...ips].join('\n') };
    }
    if (viewingOffice(store)) {
      const f = store.office.furniture.find((x) => x.x === tx && x.y === ty);
      if (f) {
        const lines = [tDyn(`furniture.${f.id}.name`), effectText(gameEnv.furniture?.[f.id]?.effect)];
        return { key: `f:${f.uid}`, text: lines.filter((l): l is string => l !== null).join('\n') };
      }
    }
    return null;
  }

  // 乗せてから hoverMs のあとに、指定の説明を出す（マップの外のボタンなど、説明の中身を呼び出し側が決めるとき）
  showAfterHover(text: string, x: number, y: number): void {
    this.tipTimer = window.setTimeout(() => this.showTip(text, x, y), balance.tooltip.hoverMs);
  }

  private showTip(text: string, x: number, y: number): void {
    this.tipShown = true;
    showTipAt({ x: x - 8, y: y - 8, w: 16, h: 16 }, text);
  }

  // 説明を消して、予約をやめる
  reset(): void {
    if (this.tipTimer !== null) window.clearTimeout(this.tipTimer);
    if (this.tipHideTimer !== null) window.clearTimeout(this.tipHideTimer);
    this.tipTimer = null;
    this.tipHideTimer = null;
    if (this.tipShown) hideTip();
    this.tipShown = false;
    this.tipKey = null;
  }

  // マウス: 乗った機器が変わったら、説明を予約する（hoverMs のあとに出す）
  updateMouse(e: FederatedPointerEvent): void {
    const hit = this.mapTipAt(this.host.hit.toMap(e));
    const key = hit?.key ?? null;
    if (key === this.tipKey) return;
    this.reset();
    this.tipKey = key;
    if (!hit) return;
    this.tipTimer = window.setTimeout(() => this.showTip(hit.text, e.clientX, e.clientY), balance.tooltip.hoverMs);
  }

  // タッチ: 押した機器の説明を、長押しのあとに出す
  startTouch(e: FederatedPointerEvent): void {
    const hit = this.mapTipAt(this.host.hit.toMap(e));
    this.reset();
    this.tipKey = hit?.key ?? null;
    if (!hit) return;
    this.tipTimer = window.setTimeout(() => this.showTip(hit.text, e.clientX, e.clientY), balance.tooltip.longPressMs);
  }

  // タッチを離したら、説明を少し残して消す
  endTouch(): void {
    if (this.tipTimer !== null) window.clearTimeout(this.tipTimer);
    this.tipTimer = null;
    if (this.tipShown) this.tipHideTimer = window.setTimeout(() => this.reset(), balance.tooltip.touchHideMs);
  }
}
