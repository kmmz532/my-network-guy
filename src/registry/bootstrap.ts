// ゲームのデータから登録表を作る。登録の後に凍結する。
import type { Cable, Device, Furniture } from '../data/schema';
import type { CableDef, DeviceDef, FurnitureDef } from './defs';
import { Registry } from './registry';

export interface GameData {
  devices: Record<string, Device>;
  cables: Record<string, Cable>;
  furniture: Record<string, Furniture>;
}

export interface Registries {
  devices: Registry<DeviceDef>;
  cables: Registry<CableDef>;
  furniture: Registry<FurnitureDef>;
}

const deviceDefOf = (d: Device): DeviceDef => ({
  id: d.id,
  category: d.category,
  price: d.price,
  ports: d.ports.flatMap((p) => Array.from({ length: p.count }, () => ({ type: p.type, speedMbps: p.speedMbps }))),
  capabilities: new Set(d.capabilities),
  deskable: d.deskable,
  defaultServices: d.defaultServices,
  ...(d.sviMax === undefined ? {} : { sviMax: d.sviMax }),
});

export const bootstrap = (data: GameData): Registries => {
  const devices = new Registry<DeviceDef>('機器');
  const cables = new Registry<CableDef>('ケーブル');
  const furniture = new Registry<FurnitureDef>('家具');
  for (const d of Object.values(data.devices)) devices.register(deviceDefOf(d));
  for (const c of Object.values(data.cables)) cables.register(c);
  for (const f of Object.values(data.furniture)) furniture.register(f);
  devices.freeze();
  cables.freeze();
  furniture.freeze();
  return { devices, cables, furniture };
};
