// 配線に関する表示を描く。接続時の光・無線範囲・無線の点線・検収パケットを受け持つ。
import { Graphics } from 'pixi.js';
import { useGameStore, type Trace } from '../stores/useGameStore';
import { gameEnv } from '../sim/env';
import { CATEGORY } from '../data/categories';
import { WALL_LOSS, WIRELESS_RADIUS, wallsBetween, wirelessAssociations } from '../network/engine';
import type { EngineData } from '../network/types';
import { cumulativeLengths, pointAt, type Point } from './animation';
import type { Project } from '../sim/project';

// つながった瞬間に、ケーブルの上を光が走る時間（ms）。
const PULSE_MS = 450;
// パケットの速さ（タイル/秒）と、粒の間隔（タイル）。粒の数は3つまで。
export const PACKET_TILES_PER_SEC = 3;
export const PACKET_SPACING_TILES = 0.5;
export const PACKET_COUNT = 3;
// プロトコルごとのパケットの色（ART.md）。
const PACKET_COLOR: Record<string, number> = { ping: 0xffffff, http: 0xff8fb0 };

type NetworkRendererOptions = {
  graphics: Graphics;
  map: () => { width: number; height: number } | null;
  wireEngine: () => EngineData | null;
  tracePath: (trace: Trace) => { pts: Point[]; nodeAt: number[] } | null;
};

export class NetworkRenderer {
  constructor(private readonly options: NetworkRendererOptions) {}

  pulseActive(): boolean {
    const pulse = useGameStore.getState().linkPulse;
    return pulse !== null && Date.now() - pulse.at < PULSE_MS;
  }

  drawLinkPulse(project: Project, ts: number): void {
    const pulse = useGameStore.getState().linkPulse;
    if (!pulse || !this.pulseActive()) return;
    const link = project.links.find((l) => (l.a.node === pulse.a && l.b.node === pulse.b) || (l.a.node === pulse.b && l.b.node === pulse.a));
    if (!link || link.path.length < 2) return;
    const pts = link.path.map(([x, y]) => ({ x: x * ts + ts / 2, y: y * ts + ts / 2 }));
    const lengths = cumulativeLengths(pts);
    const total = lengths[lengths.length - 1];
    const k = Math.min(1, (Date.now() - pulse.at) / PULSE_MS);
    const p = pointAt(pts, lengths, total * k);
    this.options.graphics.circle(p.x, p.y, ts / 5).fill({ color: 0xffd866, alpha: 0.9 });
    this.options.graphics.circle(p.x, p.y, ts / 5 + 3).stroke({ width: 2, color: 0xffd866, alpha: 0.5 });
    for (const end of [pts[0], pts[pts.length - 1]]) {
      this.options.graphics.circle(end.x, end.y, ts * (0.4 + 0.4 * k)).stroke({ width: 2, color: 0xffd866, alpha: 1 - k });
    }
  }

  drawWireless(project: Project, ts: number, selectedUid: string | null): void {
    const engine = this.options.wireEngine();
    const map = this.options.map();
    if (!selectedUid || !engine || !map) return;
    const ap = project.nodes.find((n) => n.uid === selectedUid);
    const category = gameEnv.devices[ap?.device ?? '']?.category;
    if (!ap || (category !== CATEGORY.accessPoint && category !== CATEGORY.homeRouter)) return;
    for (let dy = -WIRELESS_RADIUS; dy <= WIRELESS_RADIUS; dy++) {
      for (let dx = -WIRELESS_RADIUS; dx <= WIRELESS_RADIUS; dx++) {
        const tx = ap.x + dx;
        const ty = ap.y + dy;
        if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
        const distance = Math.abs(dx) + Math.abs(dy);
        const walls = engine.wallAt ? wallsBetween(engine.wallAt, ap.x, ap.y, tx, ty) : 0;
        if (distance + walls * WALL_LOSS <= WIRELESS_RADIUS) {
          this.options.graphics.rect(tx * ts, ty * ts, ts, ts).fill({ color: 0x62d26f, alpha: 0.12 });
        }
      }
    }
    const pairs = wirelessAssociations({ nodes: project.nodes, links: project.links, segments: project.segments }, engine);
    for (const { ap: source, client } of pairs) {
      if (source.uid !== ap.uid) continue;
      const x0 = source.x * ts + ts / 2;
      const y0 = source.y * ts + ts / 2;
      const x1 = client.x * ts + ts / 2;
      const y1 = client.y * ts + ts / 2;
      const steps = Math.max(1, Math.floor(Math.hypot(x1 - x0, y1 - y0) / 6));
      for (let i = 0; i < steps; i += 2) {
        const start = i / steps;
        const end = Math.min(1, (i + 1) / steps);
        this.options.graphics.moveTo(x0 + (x1 - x0) * start, y0 + (y1 - y0) * start)
          .lineTo(x0 + (x1 - x0) * end, y0 + (y1 - y0) * end)
          .stroke({ width: 2, color: 0x62d26f, alpha: 0.8 });
      }
    }
  }

  // frozenHop があれば（パケットの中身の欄で区間を選んでいるとき）、流さずに、その区間の宛先の機器へ着いた位置に止める
  drawTrace(trace: Trace, ts: number, realElapsed: number, traceStart: number, frozenHop?: number): void {
    const route = this.options.tracePath(trace);
    if (!route) return;
    const cumulative = cumulativeLengths(route.pts);
    const total = cumulative[cumulative.length - 1];
    if (frozenHop !== undefined) {
      const at = route.nodeAt[Math.min(frozenHop + 1, route.nodeAt.length - 1)];
      const p = pointAt(route.pts, cumulative, cumulative[at]);
      this.options.graphics.rect(p.x - 2, p.y - 2, 4, 4).fill({ color: PACKET_COLOR[trace.kind] ?? 0xffffff });
      return;
    }
    const failure = trace.result.failure;
    let stop = total;
    if (failure) {
      const idx = failure.reason === 'return.failed'
        ? trace.result.path.length - 1
        : trace.result.path.indexOf(failure.node);
      stop = idx >= 0 && idx < route.nodeAt.length ? cumulative[cumulative.length > route.nodeAt[idx] ? route.nodeAt[idx] : 0] : 0;
    }
    const travelled = ((realElapsed - traceStart) / 1000) * PACKET_TILES_PER_SEC * ts;
    const color = PACKET_COLOR[trace.kind] ?? 0xffffff;
    for (let i = 0; i < PACKET_COUNT; i++) {
      const distance = travelled - i * PACKET_SPACING_TILES * ts;
      if (distance < 0) continue;
      const p = pointAt(route.pts, cumulative, Math.min(distance, stop));
      this.options.graphics.rect(p.x - 1.5, p.y - 1.5, 3, 3).fill({ color });
    }
  }
}
