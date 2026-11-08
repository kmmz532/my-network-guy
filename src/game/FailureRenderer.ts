// 検収結果の失敗表示と、修正方法の吹き出しを描く。
import { Container, Graphics, Text } from 'pixi.js';
import { t, tDyn } from '../i18n/t';
import type { FailureReason, NetNode } from '../network/types';

const OUTLINE = 0x3b2a33;
const FAIL = 0xe84a4a;
const SELECT = 0xffd866;

type FailureRendererOptions = {
  bubbles: Container;
  spriteTopOf: (node: NetNode, ts: number) => number;
  scale: () => number;
  textResolution: () => number;
  helpUid: () => string | null;
};

export class FailureRenderer {
  readonly helpRects = new Map<string, { x: number; y: number; w: number; h: number }>();

  constructor(private readonly options: FailureRendererOptions) {}

  draw(project: { nodes: readonly NetNode[] }, ts: number, byNode: ReadonlyMap<string, FailureReason>): void {
    this.helpRects.clear();
    if (byNode.size === 0) return;
    const scale = this.options.scale();
    const resolution = this.options.textResolution();
    const style = (fill: number, bold: boolean) => ({
      fontFamily: 'sans-serif',
      fontSize: 12 / scale,
      fontWeight: bold ? ('bold' as const) : ('normal' as const),
      fill,
      stroke: { color: OUTLINE, width: 2 / scale },
    });
    const gap = 3 / scale;
    for (const [uid, reason] of byNode) {
      const node = project.nodes.find((candidate) => candidate.uid === uid);
      if (!node) continue;
      const mark = new Text({ text: '×', style: style(FAIL, true), resolution });
      const message = new Text({ text: tDyn(`error.${reason}`), style: style(0xf4f1e6, false), resolution });
      const help = new Text({ text: t('ui.fail.help'), style: style(SELECT, true), resolution });
      const parts = [mark, message, help];
      const width = parts.reduce((sum, part) => sum + part.width, 0) + gap * (parts.length - 1);
      const bottom = this.options.spriteTopOf(node, ts) + 4 - gap;
      const cx = node.x * ts + ts / 2;
      let x = cx - width / 2;
      for (const part of parts) {
        part.anchor.set(0, 1);
        part.position.set(x, bottom);
        this.options.bubbles.addChild(part);
        x += part.width + gap;
      }
      this.helpRects.set(uid, { x: help.x - gap, y: bottom - help.height - gap, w: help.width + gap * 2, h: help.height + gap * 2 });
      if (this.options.helpUid() === uid) {
        const fix = new Text({ text: tDyn(`error.${reason}.fix`), style: style(0xf4f1e6, false), resolution });
        const pad = 4 / scale;
        const boxW = fix.width + pad * 2;
        const boxH = fix.height + pad * 2;
        const boxX = cx - boxW / 2;
        const boxY = bottom - help.height - gap * 2 - boxH;
        const box = new Graphics().roundRect(boxX, boxY, boxW, boxH, 3 / scale).fill({ color: OUTLINE, alpha: 0.92 });
        this.options.bubbles.addChild(box);
        fix.position.set(boxX + pad, boxY + pad);
        this.options.bubbles.addChild(fix);
      }
    }
  }
}
