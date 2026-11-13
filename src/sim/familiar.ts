// なじみの依頼（N70）。同じ依頼の組（固定の案件は案件の ID、テンプレートはひな形と地図の組）を、★2以上で納品した回数と、納品した設計（型紙）を覚える。
// 3回納品した組は、4回目から社員に任せられる。型紙は組ごとに1つ（★が同じか多ければ上書き）。
import type { NetLink, NetNode, NetworkPlan } from '../network/types';

// 任せられるようになる納品の回数（★2以上）
export const DELEGATE_MIN_COUNT = 3;
// 任せた依頼の★の上限と、経験値の割合
export const DELEGATED_STAR_CAP = 2;
export const DELEGATED_EXP_DIVISOR = 2;

export interface Blueprint {
  nodes: NetNode[];
  links: NetLink[];
  plans: Record<string, NetworkPlan>;
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

// 型紙にある固定の機器が、今回の依頼と同じ種類・位置にあるか（型紙にない固定の機器は、あとで足せるので数えない）
export const positionsMatch = (design: Blueprint, fixed: readonly NetNode[]): boolean =>
  fixed.every((f) => {
    const n = design.nodes.find((x) => x.uid === f.uid);
    return n === undefined || (n.device === f.device && n.x === f.x && n.y === f.y);
  });

// 型紙にない固定の機器（今回の依頼で増えた機器）。同じ種類で置き、近くの機器につなぐ
export const missingFixed = (design: Blueprint, fixed: readonly NetNode[]): NetNode[] =>
  fixed.filter((f) => !design.nodes.some((n) => n.uid === f.uid));
