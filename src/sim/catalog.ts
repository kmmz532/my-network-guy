// 機材と家具の定義の一覧（インベントリの並べ方に使う）。定義は引数で受け取る（純粋関数のため）。
export interface Catalog {
  // 機材と家具の定義（ID がキー）
  devices: Readonly<Record<string, unknown>>;
  furniture: Readonly<Record<string, unknown>>;
  // 店の並び順（機材と家具の ID）
  shopOrder: readonly string[];
}

// 持ち物の ID を、機材と家具に分け、店の並び順にそろえる。定義にない ID は例外
export const inventoryCatalogOf = (ids: readonly string[], catalog: Catalog): { devices: string[]; furniture: string[] } => {
  const rank = (id: string): number => {
    const i = catalog.shopOrder.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const byRank = (a: string, b: string): number => rank(a) - rank(b) || a.localeCompare(b);
  const devices: string[] = [];
  const furniture: string[] = [];
  for (const id of ids) {
    if (id in catalog.devices) devices.push(id);
    else if (id in catalog.furniture) furniture.push(id);
    else throw new Error(`unknown inventory item: ${id}`);
  }
  return { devices: devices.sort(byRank), furniture: furniture.sort(byRank) };
};
