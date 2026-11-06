// なじみの依頼（N70）。同じ依頼の組（固定の案件は案件の ID、テンプレートはひな形と地図の組）を、★2以上で納品した回数と、納品した設計（型紙）を覚える。
// 3回納品した組は、4回目から社員に任せられる。型紙は組ごとに1つ（★が同じか多ければ上書き）。
import type { NetLink, NetNode, SegmentConfig } from '../network/types';

// 任せられるようになる納品の回数（★2以上）
export const DELEGATE_MIN_COUNT = 3;
// 任せた依頼の★の上限と、経験値の割合
export const DELEGATED_STAR_CAP = 2;
export const DELEGATED_EXP_DIVISOR = 2;

export interface Blueprint {
  nodes: NetNode[];
  links: NetLink[];
  segments: Record<string, SegmentConfig>;
}

export interface Familiarity {
  // 組の鍵 → ★2以上で納品した回数
  counts: Record<string, number>;
  // 組の鍵 → 型紙（納品した設計と、その★）
  blueprints: Record<string, { stars: number; design: Blueprint }>;
}

export const EMPTY_FAMILIARITY: Familiarity = { counts: {}, blueprints: {} };

// 依頼の組の鍵。固定の案件は ID、テンプレートは「ひな形 | 地図」
export const familiarKeyOf = (kind: 'fixed' | 'template', baseId: string, map: string): string =>
  kind === 'fixed' ? `fixed:${baseId}` : `${baseId}|${map}`;

// ★2以上の納品を数え、型紙を更新する（★が同じか多ければ上書き。★1の納品は数えない）
export const recordDelivery = (f: Familiarity, key: string, stars: number, design: Blueprint): Familiarity => {
  if (stars < DELEGATED_STAR_CAP) return f;
  const current = f.blueprints[key];
  return {
    counts: { ...f.counts, [key]: (f.counts[key] ?? 0) + 1 },
    blueprints: current && current.stars > stars ? f.blueprints : { ...f.blueprints, [key]: { stars, design } },
  };
};

// 型紙の機器がすべて、今回の依頼の機器（固定の配置）と同じ uid・種類・位置にあるか
export const fitsBlueprint = (design: Blueprint, fixed: readonly NetNode[]): boolean =>
  fixed.every((f) => design.nodes.some((n) => n.uid === f.uid && n.device === f.device && n.x === f.x && n.y === f.y));
