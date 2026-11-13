// 機器に重ねる情報を描く。IPアドレス・ポート名・不備の印を受け持つ。
import { Container, Text } from 'pixi.js';
import { devices as deviceData } from 'virtual:game-data';
import { portLabel } from '../components/devicePorts';
import { t } from '../i18n/t';
import type { Compiled } from '../network/compile';
import type { FailureReason, NetNode } from '../network/types';
import { cumulativeLengths, pointAt, type Point } from './animation';
import type { Project } from '../sim/project';
import { visibleTopOfSprite } from './sprites';
import { portCountOf, deviceCategory } from '../registry/query';

const OUTLINE = 0x3b2a33;
const BUBBLE_FILL = 0xf4f1e6;

type DeviceLabelRendererOptions = {
  bubbles: Container;
  scale: () => number;
  textResolution: () => number;
  compiled: () => Compiled | null;
  spriteTopOf: (node: NetNode, ts: number) => number;
  tool: () => string;
  hoverLink: () => string | null;
  hoverNode: () => string | null;
  // 機器の名前（手で付けた名前を優先する。nodeLabel の結果）
  nameOf: (node: NetNode) => string;
  // 案内が光らせている機器の uid（その名前の札を強調色にする）
  guideTarget: () => string | null;
};

export class DeviceLabelRenderer {
  constructor(private readonly options: DeviceLabelRendererOptions) {}

  drawAddresses(ts: number, failing: ReadonlyMap<string, FailureReason>): void {
    const compiled = this.options.compiled();
    if (!compiled) return;
    const scale = this.options.scale();
    const fontPx = 11 / scale;
    const dpr = window.devicePixelRatio || 1;
    const nodes = [...compiled.net.nodes].sort((a, b) => b.y - a.y);
    for (const node of nodes) {
      const category = deviceCategory(node.device);
      const ips = node.interfaces.map((i) => node.interfaces.length > 1
        ? `${portLabel(category, i.port)} ${i.ip}/${i.prefix}`
        : `${i.ip}/${i.prefix}`);
      const unset = ips.length === 0 && compiled.issues[node.uid]?.reason === 'ip.unset';
      if (ips.length === 0 && !unset) continue;
      if (failing.has(node.uid)) continue;
      const lines = unset
        ? [t('ui.ip.blank')]
        : ips.length > 3
          ? [...ips.slice(0, 2), t('ui.ip.more', { count: ips.length - 2 })]
          : ips;
      const text = new Text({
        text: lines.join('\n'),
        style: {
          fontFamily: 'monospace',
          fontSize: fontPx,
          lineHeight: fontPx * 1.3,
          fill: unset ? 0x9a9a9a : BUBBLE_FILL,
          align: 'center',
          stroke: { color: OUTLINE, width: 2 / scale },
        },
        resolution: Math.max(2, scale * dpr),
      });
      text.anchor.set(0.5, 1);
      const visibleTop = visibleTopOfSprite(deviceData[node.device as keyof typeof deviceData]?.sprite ?? '');
      text.position.set(node.x * ts + ts / 2, this.options.spriteTopOf(node, ts) + visibleTop + 4);
      this.options.bubbles.addChild(text);
    }
  }

  // 機器の名前を、機器の上に出す。IP の表示があるときは、アドレスの行の上に置く（重ならないように、アドレスの行数の分だけ上げる）
  drawNames(ts: number, failing: ReadonlyMap<string, FailureReason>, withAddress: boolean): void {
    const compiled = this.options.compiled();
    if (!compiled) return;
    const scale = this.options.scale();
    const fontPx = 12 / scale;
    const guide = this.options.guideTarget();
    for (const node of compiled.net.nodes) {
      if (failing.has(node.uid)) continue;
      // アドレスの行数（drawAddresses と同じ数え方）。IP の表示が出ないときは 0
      const addressLines = withAddress ? (node.interfaces.length > 3 ? 3 : node.interfaces.length > 0 ? node.interfaces.length : compiled.issues[node.uid]?.reason === 'ip.unset' ? 1 : 0) : 0;
      const highlighted = node.uid === guide;
      const text = new Text({
        text: this.options.nameOf(node),
        style: {
          fontFamily: 'sans-serif',
          fontSize: fontPx,
          fontWeight: highlighted ? 'bold' : 'normal',
          fill: highlighted ? 0xffd866 : BUBBLE_FILL,
          stroke: { color: OUTLINE, width: 2 / scale },
        },
        resolution: this.options.textResolution(),
      });
      text.anchor.set(0.5, 1);
      const visibleTop = visibleTopOfSprite(deviceData[node.device as keyof typeof deviceData]?.sprite ?? '');
      const addressTop = this.options.spriteTopOf(node, ts) + visibleTop + 4;
      const addressHeight = addressLines * fontPx * 1.3;
      text.position.set(node.x * ts + ts / 2, addressTop - addressHeight - 2 / scale);
      this.options.bubbles.addChild(text);
    }
  }

  drawBubble(node: NetNode, ts: number, mark: string, color: number): void {
    const scale = this.options.scale();
    const text = new Text({
      text: mark,
      style: { fontFamily: 'sans-serif', fontSize: 12 / scale, fontWeight: 'bold', fill: color, stroke: { color: OUTLINE, width: 3 / scale } },
      resolution: this.options.textResolution(),
    });
    text.anchor.set(0.5, 1);
    text.position.set(node.x * ts + ts / 2, node.y * ts - 2);
    this.options.bubbles.addChild(text);
  }

  drawPortNames(project: Project, ts: number): void {
    const nodes = new Map(project.nodes.map((node) => [node.uid, node] as const));
    for (const link of project.links) {
      const relevant = this.options.tool() === 'wire'
        || link.uid === this.options.hoverLink()
        || link.a.node === this.options.hoverNode()
        || link.b.node === this.options.hoverNode();
      if (!relevant) continue;
      const pts: Point[] = link.path.map(([x, y]) => ({ x: x * ts + ts / 2, y: y * ts + ts / 2 }));
      this.portName(nodes.get(link.a.node), link.a.port, pts, ts);
      this.portName(nodes.get(link.b.node), link.b.port, [...pts].reverse(), ts);
    }
  }

  private portName(node: NetNode | undefined, port: number, pts: readonly Point[], ts: number): void {
    if (!node || pts.length < 2) return;
    const category = deviceCategory(node.device);
    const scale = this.options.scale();
    if ((portCountOf(node.device)) <= 1) return;
    const at = pointAt(pts, cumulativeLengths(pts), ts);
    const text = new Text({
      text: portLabel(category, port),
      style: { fontFamily: 'sans-serif', fontSize: 11 / scale, fill: BUBBLE_FILL, stroke: { color: OUTLINE, width: 2 / scale } },
      resolution: this.options.textResolution(),
    });
    text.anchor.set(0.5);
    text.position.set(at.x, at.y);
    this.options.bubbles.addChild(text);
  }
}
