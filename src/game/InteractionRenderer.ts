// 配置・移動・配線中の操作表示を描く。置けるマス、接続先、プラグ印、配線費用を受け持つ。
import { Graphics, Container, Text } from 'pixi.js';
import { useGameStore } from '../stores/useGameStore';
import { gameEnv } from '../sim/env';
import type { NetNode } from '../network/types';
import { balance } from 'virtual:game-data';
import { metersOf } from '../sim/cableLength';
import { plugPoints } from './linkHit';
import { MapHit } from './MapHit';
import { MapInput } from './MapInput';
import { t } from '../i18n/t';

const OUTLINE = 0x3b2a33;
const SELECT = 0xffd866;
const FAIL = 0xe84a4a;

type InteractionRendererOptions = {
  graphics: Graphics;
  bubbles: Container;
  input: MapInput;
  hit: MapHit;
  scale: () => number;
};

export class InteractionRenderer {
  constructor(private readonly options: InteractionRendererOptions) {}

  drawPlacePreview(ts: number): void {
    const s = useGameStore.getState();
    const id = s.itemDrag?.id ?? s.placing;
    if (!id) return;
    const tile = s.itemDrag
      ? this.options.hit.tileAtClient(s.itemDrag.x, s.itemDrag.y)
      : this.options.input.cursorTile;
    if (!tile) return;
    this.drawTileState(tile.tx, tile.ty, ts, this.options.input.canPlace(id, tile.tx, tile.ty));
  }

  drawDrag(ts: number): void {
    const press = this.options.input.press;
    if (!press?.dragging || !press.at) return;
    const at = press.at;
    const target = press.target;
    if (target.kind === 'node' || target.kind === 'furniture') {
      const tile = this.options.hit.tileOf(at);
      if (!tile) return;
      const ok = target.kind === 'node'
        ? this.options.input.canMoveNode(target.uid, tile.tx, tile.ty)
        : this.options.input.canMoveFurniture(target.uid, tile.tx, tile.ty);
      this.drawTileState(tile.tx, tile.ty, ts, ok);
      return;
    }
    const link = this.options.hit.editLinks()?.find((l) => l.uid === target.linkUid);
    if (!link) return;
    const other = this.options.hit.editNodes()?.find((n) => n.uid === (target.end === 'a' ? link.b.node : link.a.node));
    const node = this.options.hit.nodeNear(at, this.options.hit.editNodes() ?? []);
    const ok = node !== undefined && this.options.input.canReplug(target.linkUid, target.end, node.uid);
    if (node) this.drawTileState(node.x, node.y, ts, ok);
    if (other) {
      this.options.graphics.moveTo(other.x * ts + ts / 2, other.y * ts + ts / 2)
        .lineTo(at.x, at.y)
        .stroke({ width: 2, color: ok ? SELECT : FAIL });
    }
  }

  drawPlugMarks(ts: number): void {
    const s = useGameStore.getState();
    if (this.options.input.press || s.placing || (s.tool !== 'select' && s.tool !== 'wire')) return;
    const link = this.options.hit.editLinks()?.find((l) => l.uid === this.options.input.hoverAnyLink);
    if (!link) return;
    const size = 6 / this.options.scale();
    for (const plug of [plugPoints(link, ts).a, plugPoints(link, ts).b]) {
      this.options.graphics.rect(plug.x - size / 2, plug.y - size / 2, size, size).fill({ color: SELECT });
      this.options.graphics.rect(plug.x - size / 2, plug.y - size / 2, size, size)
        .stroke({ width: 1 / this.options.scale(), color: OUTLINE });
    }
  }

  drawWireCost(from: NetNode, ts: number): void {
    const store = useGameStore.getState();
    const cable = gameEnv.cables[store.wireCable];
    const nodes = this.options.hit.editNodes();
    const tile = this.options.hit.tileOf(this.options.input.wireTo);
    if (!cable || !tile || !nodes) return;
    const end = this.options.hit.nodeNear(this.options.input.wireTo, nodes);
    const length = Math.abs(from.x - (end?.x ?? tile.tx)) + Math.abs(from.y - (end?.y ?? tile.ty));
    if (length < 1) return;
    const cost = cable.pricePerLink + cable.pricePerTile * length;
    const scale = this.options.scale();
    const meters = metersOf(length, balance.metersPerTile);
    const limit = metersOf(cable.maxLengthTiles, balance.metersPerTile);
    const over = length > cable.maxLengthTiles;
    const text = new Text({
      text: t('ui.wire.cost', { length: meters, limit, cost: cost.toLocaleString('ja-JP') }),
      style: { fontFamily: 'sans-serif', fontSize: 12 / scale, fill: over ? 0xff8a7a : 0xf4f1e6, stroke: { color: OUTLINE, width: 2 / scale } },
      resolution: Math.max(2, scale * (window.devicePixelRatio || 1)),
    });
    text.anchor.set(0, 1);
    text.position.set(this.options.input.wireTo.x + ts * 0.25, this.options.input.wireTo.y - ts * 0.25);
    this.options.bubbles.addChild(text);
  }

  private drawTileState(tx: number, ty: number, ts: number, ok: boolean): void {
    const x = tx * ts;
    const y = ty * ts;
    this.options.graphics.rect(x, y, ts, ts).fill({ color: ok ? 0xffffff : 0x000000, alpha: ok ? 0.3 : 0.45 });
    this.options.graphics.rect(x + 1, y + 1, ts - 2, ts - 2).stroke({ width: 2, color: ok ? 0x62d26f : FAIL });
  }
}
