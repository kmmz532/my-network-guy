// 配置された家具を描く。向き・椅子・撤去時のホバー表示を受け持つ。
import { Container, Sprite } from 'pixi.js';
import { spriteNameOf } from '../sim/facing';
import type { Facing } from '../sim/facing';
import { spriteOf, texture } from './sprites';
import type { PlacedFurniture } from '../sim/project';
import { maybeFurniture } from '../registry/query';

const FACING_SPRITES = new Set(['furniture/desk', 'furniture/chair']);
// 椅子つきの机の ID と、椅子の絵・マスの下端からの位置
const CHAIR_FURNITURE = new Set(['desk']);
const CHAIR_SPRITE = 'furniture/chair';
const CHAIR_TOP_INSET = 4;
// 向きごとの椅子の位置のずれ（マス単位）。社員の背中側に椅子を置く
const CHAIR_OFFSET: Record<Facing, [number, number]> = {
  up: [0, 0],
  down: [0, -0.6],
  left: [0.3, 0],
  right: [-0.3, 0],
};
const DEVICE_FOOT_INSET = 4;
const REMOVE_TINT = 0xffb0b0;

type FurnitureRendererOptions = {
  sprites: Container;
  hoverFurnitureUid: () => string | null;
};

export class FurnitureRenderer {
  constructor(private readonly options: FurnitureRendererOptions) {}

  draw(furniture: PlacedFurniture[], ts: number): void {
    for (const f of furniture) {
      const base = maybeFurniture(f.id)?.sprite ?? '';
      const tex = texture(spriteOf(FACING_SPRITES.has(base) ? spriteNameOf(base, f.facing ?? 'up') : base));
      if (!tex) continue;
      const sprite = new Sprite(tex);
      sprite.position.set(f.x * ts + Math.round((ts - tex.width) / 2), (f.y + 1) * ts - tex.height);
      sprite.zIndex = (f.y + 1) * ts - DEVICE_FOOT_INSET - 1;
      sprite.tint = f.uid === this.options.hoverFurnitureUid() ? REMOVE_TINT : 0xffffff;
      this.options.sprites.addChild(sprite);
      if (CHAIR_FURNITURE.has(f.id)) this.drawChair(f, ts);
    }
  }

  private drawChair(f: PlacedFurniture, ts: number): void {
    const tex = texture(spriteOf(spriteNameOf(CHAIR_SPRITE, f.facing ?? 'up')));
    if (!tex) return;
    const sprite = new Sprite(tex);
    const [ox, oy] = CHAIR_OFFSET[f.facing ?? 'up'];
    sprite.position.set(
      f.x * ts + Math.round((ts - tex.width) / 2) + Math.round(ox * ts),
      (f.y + 1) * ts - CHAIR_TOP_INSET + Math.round(oy * ts),
    );
    sprite.zIndex = (f.y + 1) * ts - DEVICE_FOOT_INSET;
    this.options.sprites.addChild(sprite);
  }
}
