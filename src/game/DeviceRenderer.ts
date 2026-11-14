// ネットワーク機器を描く。機器本体・机・ポート・選択枠・LEDを受け持つ。
import { Container, Graphics, Sprite } from 'pixi.js';
import { spriteNameOf } from '../sim/facing';
import type { Facing } from '../sim/facing';
import type { Project } from '../sim/project';
import type { NetNode } from '../network/types';
import { useGameStore } from '../stores/useGameStore';
import { spriteOf, texture } from './sprites';
import { DESK_TOP, DEVICE_FOOT_INSET } from './deviceRules';
import { gameEnv } from '../sim/env';
import { tileSourceOf } from '../stores/gameHelpers';
import { needsDeskSprite, restsOnDesk } from '../world/tiles';
import { portCountOf, maybeDevice } from '../registry/query';

const OUTLINE = 0x3b2a33;
const SELECT = 0xffd866;
const WARN = 0xffcc33;
const REMOVE_TINT = 0xffb0b0;
const FACING_DEVICE_SPRITES = new Set(['device/pc_basic']);

type DeviceRendererOptions = {
  background: Graphics;
  foreground: Graphics;
  sprites: Container;
  elapsed: () => number;
  deskFacingAt: (x: number, y: number) => Facing;
};

export class DeviceRenderer {
  constructor(private readonly options: DeviceRendererOptions) {}

  drawNode(node: NetNode, ts: number, selected: boolean, dim: boolean, project: Project, hot: boolean): void {
    const g = this.options.foreground;
    const alpha = dim ? 0.5 : 1;
    const pad = ts * 0.18;
    const x = node.x * ts + pad;
    const y = node.y * ts + pad;
    const size = ts - pad * 2;
    if (selected) g.rect(x - 2, y - 2, size + 4, size + 4).stroke({ width: 2, color: SELECT, alpha });

    const deviceBase = maybeDevice(node.device)?.sprite ?? '';
    const deviceSprite = FACING_DEVICE_SPRITES.has(deviceBase) ? spriteNameOf(deviceBase, this.options.deskFacingAt(node.x, node.y)) : deviceBase;
    const tex = texture(spriteOf(deviceSprite));
    const foot = node.y * ts + ts - DEVICE_FOOT_INSET;
    if (!tex) return;
    const tiles = tileSourceOf(useGameStore.getState());
    const onDesk = restsOnDesk(tiles, node, gameEnv);
    const deskTex = needsDeskSprite(tiles, node, gameEnv) ? texture('furniture/desk') : undefined;
    if (deskTex) {
      const desk = new Sprite(deskTex);
      desk.position.set(node.x * ts, node.y * ts);
      desk.alpha = alpha;
      desk.zIndex = foot - 1;
      this.options.sprites.addChild(desk);
    }
    const base = onDesk ? node.y * ts + DESK_TOP : foot;
    const sprite = new Sprite(tex);
    sprite.position.set(node.x * ts + (ts - 24) / 2, base - 38);
    sprite.alpha = alpha;
    sprite.tint = hot ? REMOVE_TINT : 0xffffff;
    sprite.zIndex = foot;
    this.options.sprites.addChild(sprite);
    if (!onDesk) this.options.background.ellipse(node.x * ts + ts / 2, foot, 10, 3).fill({ color: 0x000000, alpha: 0.25 * alpha });

    const count = portCountOf(node.device);
    const used = new Set<number>();
    for (const link of project.links) {
      if (link.a.node === node.uid) used.add(link.a.port);
      if (link.b.node === node.uid) used.add(link.b.port);
    }
    for (let port = 0; port < count; port++) {
      const px = x + ((port + 0.5) * size) / count - 2;
      const py = foot + 1;
      if (used.has(port)) g.rect(px, py, 4, 3).fill({ color: OUTLINE, alpha });
      else g.rect(px, py, 4, 3).stroke({ width: 1, color: OUTLINE, alpha });
    }
  }

  drawLed(node: NetNode, ts: number, blinkOn: boolean, unset: boolean): void {
    const pad = ts * 0.18;
    const size = ts - pad * 2;
    const x = node.x * ts + pad + size - 5;
    const y = node.y * ts + pad + 3;
    if (unset) {
      const lit = Math.floor(this.options.elapsed() / 500) % 2 === 0;
      this.options.foreground.rect(x, y, 2, 2).fill({ color: lit ? 0xff8c2a : OUTLINE });
    } else if (node.interfaces.length > 0) {
      this.options.foreground.rect(x, y, 2, 2).fill({ color: 0x62d26f });
    } else {
      this.options.foreground.rect(x, y, 2, 2).fill({ color: blinkOn ? WARN : OUTLINE });
    }
  }
}
