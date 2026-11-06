// 検索の欄へ移る（N67）。開いているウィンドウの検索の欄のうち、画面に見えていて、ほかの画面に隠れていないものを選ぶ。
// 見える欄がなければ false（何もしない）。
export function focusVisibleSearch(): boolean {
  const fields = [...document.querySelectorAll<HTMLInputElement>('[data-search]')];
  const visible = fields.find((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit !== null && el.contains(hit);
  });
  if (!visible) return false;
  visible.focus();
  visible.select();
  return true;
}
