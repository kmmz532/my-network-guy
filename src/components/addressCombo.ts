// IPアドレスの欄（AddressInput）の純粋な計算。候補の絞り込み、矢印での移動、確定する値、一覧を開く向きを求める。React には依存しない。

export interface ComboOption {
  value: string;
  // 使用中のときは、使っている機器の名前（選べない）。使っていなければ null
  usedBy: string | null;
}

// 選べる候補か（使用中でない）
export const isSelectable = (o: ComboOption): boolean => o.usedBy === null;

// 打った文字で始まる候補に絞る。空の文字なら全部の候補を返す
export const filterOptions = (options: ComboOption[], query: string): ComboOption[] => {
  const q = query.trim().toLowerCase();
  return q === '' ? options : options.filter((o) => o.value.toLowerCase().startsWith(q));
};

// 矢印キーで候補の強調を動かす。選べない候補は飛ばし、端では反対側へ回る。候補がなければ null
// active は今強調している候補の位置（強調がなければ null）。delta は +1（下）か -1（上）
export const moveActive = (options: ComboOption[], active: number | null, delta: 1 | -1): number | null => {
  const n = options.length;
  if (n === 0) return null;
  const start = active ?? (delta === 1 ? -1 : n);
  for (let step = 1; step <= n; step++) {
    const i = (((start + delta * step) % n) + n) % n;
    if (isSelectable(options[i])) return i;
  }
  return null;
};

// Enter・欄を離れたときに確定する値。強調している候補があればその値、なければ打った値（前後の空白を除く）
export const pickOnCommit = (typed: string, active: ComboOption | null): string => (active ? active.value : typed.trim());

// 一覧の高さ（行の高さ × 件数。上限を超えたら上限。件数が0でも枠の分の余白を含む）
export const listHeight = (count: number, rowPx: number, maxPx: number): number => Math.min(maxPx, count * rowPx + 2);

// 一覧を欄の上に開くか。下の空きが一覧の高さより小さく、かつ上の空きの方が大きいときだけ上に開く
export const placeAbove = (spaceBelow: number, spaceAbove: number, listPx: number): boolean => spaceBelow < listPx && spaceAbove > spaceBelow;
