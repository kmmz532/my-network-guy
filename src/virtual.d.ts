// game-data プラグインが出力する仮想モジュールの型
declare module 'virtual:game-data' {
  import type { Balance, Cable, ContractTemplate, Contract, Device, Furniture, ShopItem } from './data/schema';
  import type { CableId, DeviceId, FurnitureId } from './generated/ids';
  export const balance: Balance;
  export const devices: Record<DeviceId, Device>;
  export const furniture: Record<FurnitureId, Furniture>;
  export const cables: Record<CableId, Cable>;
  export const shop: ShopItem[];
  export const contracts: Contract[];
  export const contractTemplates: ContractTemplate[];
}

declare module 'virtual:lang/*' {
  const dict: Record<string, string>;
  export default dict;
}

declare module 'virtual:map/*' {
  import type { GameMap } from './data/schema';
  const map: GameMap;
  export default map;
}

declare module 'virtual:loaders' {
  export const langLoaders: Record<string, () => Promise<{ default: Record<string, string> }>>;
  export const mapLoaders: Record<string, () => Promise<{ default: import('./data/schema').GameMap }>>;
}
