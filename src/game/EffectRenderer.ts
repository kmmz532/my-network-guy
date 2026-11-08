// 一時的な操作状態を描く。効果範囲・ホバー枠・失敗フラッシュ・押下エフェクトを受け持つ。
import { Graphics, Container, Text } from 'pixi.js';
import { focusedProject, useGameStore } from '../stores/useGameStore';
import { gameEnv } from '../sim/env';
import type { Project } from '../sim/project';
import { rangeTiles } from './effectRange';
import { PRESS_MS, type MapInput } from './MapInput';
import { tDyn } from '../i18n/t';

const OUTLINE = 0x3b2a33;
const FAIL = 0xe84a4a;
const SELECT = 0xffd866;
const FLASH_MS = 2500;
const SHAKE_MS = 320;

type EffectRendererOptions = {
  graphics: Graphics;
  bubbles: Container;
  input: MapInput;
  map: () => { width: number; height: number } | null;
  scale: () => number;
  textResolution: () => number;
};

export class EffectRenderer {
  constructor(private readonly options: EffectRendererOptions) {}

  drawEffectRange(ts: number): void {
    const store = useGameStore.getState();
    const map = this.options.map();
    if (!store.placing || focusedProject(store) || !this.options.input.cursorTile || !map) return;
    const range = gameEnv.furniture?.[store.placing]?.effect?.range;
    if (range === undefined) return;
    for (const { tx, ty } of rangeTiles(this.options.input.cursorTile.tx, this.options.input.cursorTile.ty, range, map.width, map.height)) {
      this.options.graphics.rect(tx * ts, ty * ts, ts, ts).fill({ color: 0x62d26f, alpha: 0.35 });
    }
  }

  drawHover(project: Project, ts: number): void {
    const hover = this.options.input.hover;
    if (!hover) return;
    const node = project.nodes.find((n) => n.uid === hover.uid);
    if (!node) return;
    const color = hover.reason === null ? 0x62d26f : FAIL;
    const x = node.x * ts;
    const y = node.y * ts;
    this.options.graphics.rect(x + 1, y + 1, ts - 2, ts - 2).stroke({ width: 2, color });
    if (hover.reason !== null) {
      this.options.graphics.moveTo(x + 8, y + 8).lineTo(x + ts - 8, y + ts - 8)
        .moveTo(x + ts - 8, y + 8).lineTo(x + 8, y + ts - 8)
        .stroke({ width: 2, color: FAIL });
    }
  }

  drawFlash(ts: number): void {
    const flash = useGameStore.getState().flash;
    if (!flash) return;
    const age = Date.now() - flash.at;
    if (age >= FLASH_MS) return;
    const scale = this.options.scale();
    const text = new Text({
      text: tDyn(flash.key),
      style: { fontFamily: 'sans-serif', fontSize: 12 / scale, fill: SELECT, stroke: { color: OUTLINE, width: 3 / scale } },
      resolution: this.options.textResolution(),
    });
    text.anchor.set(0.5, 1);
    const shake = age < SHAKE_MS ? Math.sin((age / SHAKE_MS) * Math.PI * 4) * 3 * (1 - age / SHAKE_MS) : 0;
    text.position.set(flash.tx * ts + ts / 2 + shake, flash.ty * ts - 4);
    this.options.bubbles.addChild(text);
    if (age < SHAKE_MS) {
      const k = age / SHAKE_MS;
      this.options.graphics.circle(flash.tx * ts + ts / 2, flash.ty * ts + ts / 2, ts * (0.35 + 0.3 * k))
        .stroke({ width: 2, color: FAIL, alpha: 1 - k });
    }
  }

  drawPressFx(project: Project, ts: number): void {
    const fx = this.options.input.pressFx;
    if (!fx || !this.options.input.pressActive()) return;
    const node = project.nodes.find((n) => n.uid === fx.uid);
    if (!node) return;
    const k = (Date.now() - fx.at) / PRESS_MS;
    this.options.graphics.circle(node.x * ts + ts / 2, node.y * ts + ts / 2, ts * (0.35 + 0.3 * k))
      .stroke({ width: 2, color: SELECT, alpha: 1 - k });
  }
}
