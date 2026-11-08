// 社員の頭上に出すドット絵の吹き出しを描く。
import { Container, Graphics, Text } from 'pixi.js';

const OUTLINE = 0x3b2a33;
const BUBBLE_FILL = 0xf4f1e6;

type SpeechRendererOptions = {
  bubbles: Container;
  mapSize: () => { w: number; h: number };
  scale: () => number;
  textResolution: () => number;
};

export class SpeechRenderer {
  constructor(private readonly options: SpeechRendererOptions) {}

  draw(message: string, cx: number, headTop: number): void {
    const map = this.options.mapSize();
    const u = 1 / this.options.scale();
    const pad = 4 * u;
    const text = new Text({
      text: message,
      style: { fontFamily: 'sans-serif', fontSize: 12 * u, fill: OUTLINE, align: 'center', wordWrap: true, wordWrapWidth: 160 * u },
      resolution: this.options.textResolution(),
    });
    const w = text.width + pad * 2;
    const h = text.height + pad * 2;
    const left = Math.min(Math.max(cx - w / 2, 0), Math.max(0, map.w - w));
    const top = Math.max(0, headTop - 4 * u - h);
    const tailX = Math.min(Math.max(cx, left + 4 * u), left + w - 4 * u);
    const tailY = top + h + u;
    const box = new Graphics();
    box.rect(left - u, top, w + 2 * u, h).fill(OUTLINE);
    box.rect(left, top - u, w, h + 2 * u).fill(OUTLINE);
    box.rect(left, top + u, w, h - 2 * u).fill(BUBBLE_FILL);
    box.rect(left + u, top, w - 2 * u, h).fill(BUBBLE_FILL);
    box.rect(tailX - 2 * u, tailY, 4 * u, u).fill(OUTLINE);
    box.rect(tailX - u, tailY + u, 2 * u, u).fill(OUTLINE);
    this.options.bubbles.addChild(box);
    text.position.set(left + pad, top + pad);
    this.options.bubbles.addChild(text);
  }
}
