import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { staffSpriteName, STAFF_PLACEHOLDER_LOOKS } from '../data/schema';
import { seatedStaff, unseatedStaff } from '../sim/furniture';
import { isDesk } from './OfficeStaffMotion';
import { OfficeStaffMotion } from './OfficeStaffMotion';
import { deskStaffPos, deskTap, STAFF_FRAME_MS, STAFF_W, wanderStaffPos } from './staffHit';
import { spriteOf, texture } from './sprites';
import { tDyn } from '../i18n/t';
import { useGameStore } from '../stores/useGameStore';
import type { Facing } from '../sim/facing';

const STAFF_FOOT = 23;
const OUTLINE = 0x3b2a33;

type StaffRendererOptions = {
  sprites: Container;
  background: Graphics;
  bubbles: Container;
  elapsed: () => number;
  scale: () => number;
  staffMotion: OfficeStaffMotion;
  drawSpeech: (message: string, cx: number, headTop: number) => void;
};

export class StaffRenderer {
  constructor(private readonly options: StaffRendererOptions) {}

  drawDeskStaff(ts: number): void {
    const elapsed = this.options.elapsed();
    const s = useGameStore.getState();
    seatedStaff(s.office, s.staff, isDesk).forEach(({ member, desk }, k) => {
      const c = this.options.staffMotion.commuteOf(member.uid);
      if (c?.state === 'away') return;
      const b = this.options.staffMotion.breakOf(member.uid);
      if (c?.state === 'seated' && b && b.phase !== 'desk') {
        const at = wanderStaffPos(b.at.x, b.at.y, ts);
        this.drawStaff(at.x, at.y, member.look, member);
        return;
      }
      if (c && c.state !== 'seated') {
        const at = wanderStaffPos(c.at.x, c.at.y, ts);
        this.drawStaff(at.x, at.y, member.look, member);
        return;
      }
      const at = deskStaffPos(desk.x, desk.y, ts, deskTap(elapsed, k));
      this.drawStaff(at.x, at.y, member.look, member, desk.facing ?? 'up');
      const seconds = elapsed / 1000 + k * 23;
      if (seconds % 60 < 3) {
        this.options.drawSpeech(tDyn(`staff.quirk.${member.quirk}`), at.x + STAFF_W / 2, at.y);
      }
    });
  }

  drawWanderers(ts: number): void {
    const s = useGameStore.getState();
    const unseated = unseatedStaff(s.office, s.staff, isDesk);
    this.options.staffMotion.walkers.forEach((w, k) => {
      const at = wanderStaffPos(w.x, w.y, ts);
      const member = unseated[k];
      this.drawStaff(at.x, at.y, member?.look ?? STAFF_PLACEHOLDER_LOOKS[k % STAFF_PLACEHOLDER_LOOKS.length], member);
    });
  }

  drawStaff(x: number, y: number, shirt: string, tag?: { name: string; job: string }, facing?: Facing): void {
    const frame = Math.floor(this.options.elapsed() / (STAFF_FRAME_MS * 2)) % 2;
    const tex = texture(spriteOf(`staff/${staffSpriteName(shirt)}_${frame}`));
    if (!tex) return;
    const sprite = new Sprite(tex);
    const left = Math.round(x);
    const top = Math.round(y);
    sprite.position.set(left, top);
    if (facing === 'left' || facing === 'right') {
      sprite.scale.x = -1;
      sprite.position.x = left + STAFF_W;
    }
    sprite.zIndex = top + STAFF_FOOT;
    this.options.sprites.addChild(sprite);
    this.options.background.ellipse(left + 8, top + STAFF_FOOT, 6, 2).fill({ color: 0x000000, alpha: 0.25 });
    if (tag) this.drawNameTag(left + STAFF_W / 2, top, tag);
  }

  private drawNameTag(cx: number, headTop: number, tag: { name: string; job: string }): void {
    const scale = this.options.scale();
    const fontPx = 11 / scale;
    const text = new Text({
      text: `${tDyn(tag.name)} (${tDyn(`staff.job.${tag.job}`)})`,
      style: { fontFamily: 'monospace', fontSize: fontPx, fill: 0xf4f1e6, align: 'center', stroke: { color: OUTLINE, width: 2 / scale } },
      resolution: Math.max(2, scale * (window.devicePixelRatio || 1)),
    });
    text.anchor.set(0.5, 1);
    text.position.set(cx, headTop - 2 / scale);
    this.options.bubbles.addChild(text);
  }
}
