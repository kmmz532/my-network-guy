// game-data プラグインが出力する仮想モジュールの型
declare module 'virtual:game-data' {
  import type { Balance, Cable, CertDef, ContractTemplate, Contract, Device, Drill, Furniture, Lesson, ShopItem, TrainingCourse } from './data/schema';
  import type { CableId, DeviceId, FurnitureId } from './generated/ids';
  export const balance: Balance;
  export const devices: Record<DeviceId, Device>;
  export const furniture: Record<FurnitureId, Furniture>;
  export const cables: Record<CableId, Cable>;
  export const shop: ShopItem[];
  export const contracts: Contract[];
  export const contractTemplates: ContractTemplate[];
  // 初めての概念の案内。固定案件のID → 手順の列（sim/guide.ts の GuideStep）
  export const guides: Record<string, import('./sim/guide').GuideStep[]>;
  // 初めての出会いの案内（N175）。案内の ID（first.<id>。手順は guides）と、出す条件
  export const guideFirsts: { id: string; when: string }[];
  // 教材（学習モード）
  export const lessons: Lesson[];
  // 演習（学習モード）
  export const drills: Drill[];
  export const training: Record<string, TrainingCourse>;
  export const certs: Record<string, CertDef>;
  // 会社のレベルの節目の報酬（N45。解放は書かない）
  export const levelMilestones: { level: number; reward: { devices: { device: string; count: number }[] } }[];
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
