// 挑戦の依頼のスイッチの台数の上限は、最安の設計が使うスイッチの台数以上になる。台数の最小・最大のそれぞれで、上限が最安の設計の台数を下回らないことを確かめる
import { describe, expect, it } from 'vitest';
import { contractTemplates } from 'virtual:game-data';
import type { ContractTemplate, GameMap } from '../data/schema';
import officeSmall from '../../resources/data/maps/office_small.json';
import officeTwoRooms from '../../resources/data/maps/office_two_rooms.json';
import officeTwoSites from '../../resources/data/maps/office_two_sites.json';
import schoolLab from '../../resources/data/maps/school_lab.json';
import longHall from '../../resources/data/maps/long_hall.json';
import factory from '../../resources/data/maps/factory.json';
import cafeMap from '../../resources/data/maps/cafe.json';
import clinicMap from '../../resources/data/maps/clinic.json';
import libraryMap from '../../resources/data/maps/library.json';
import coworkingMap from '../../resources/data/maps/coworking.json';
import hotelFloorMap from '../../resources/data/maps/hotel_floor.json';
import warehouseMap from '../../resources/data/maps/warehouse.json';
import bankBranchMap from '../../resources/data/maps/bank_branch.json';
import studioMap from '../../resources/data/maps/studio.json';
import campusMap from '../../resources/data/maps/campus.json';
import campusWideMap from '../../resources/data/maps/campus_wide.json';
import hospitalWardMap from '../../resources/data/maps/hospital_ward.json';
import { optimalSwitchCountOf } from './budget';
import { switchLimitOf } from './challenge';
import { instantiateTemplate, pcCountRangeOf } from './template';

const maps: Record<string, GameMap> = {
  office_small: officeSmall as unknown as GameMap,
  office_two_rooms: officeTwoRooms as unknown as GameMap,
  office_two_sites: officeTwoSites as unknown as GameMap,
  school_lab: schoolLab as unknown as GameMap,
  long_hall: longHall as unknown as GameMap,
  factory: factory as unknown as GameMap,
  cafe: cafeMap as unknown as GameMap,
  clinic: clinicMap as unknown as GameMap,
  library: libraryMap as unknown as GameMap,
  coworking: coworkingMap as unknown as GameMap,
  hotel_floor: hotelFloorMap as unknown as GameMap,
  warehouse: warehouseMap as unknown as GameMap,
  bank_branch: bankBranchMap as unknown as GameMap,
  studio: studioMap as unknown as GameMap,
  campus: campusMap as unknown as GameMap,
  campus_wide: campusWideMap as unknown as GameMap,
  hospital_ward: hospitalWardMap as unknown as GameMap,
};

// 台数の最小・最大になる乱数の種を探し、そのときの依頼を返す
const withCount = (template: ContractTemplate, map: GameMap, want: number) => {
  for (let seed = 1; seed <= 5000; seed++) {
    const { offer } = instantiateTemplate(template, map, 0, seed);
    if (offer.params.pcCount === want) return offer;
  }
  throw new Error(`${template.id}: 台数 ${want} になる乱数が見つからない`);
};

describe.each(contractTemplates.map((t) => [t.id, t] as const))('スイッチの台数の上限 %s', (_id, template) => {
  const map = maps[template.map];
  it.each(['min', 'max'] as const)('台数の%s で、上限は最安の設計のスイッチの台数以上になる', (which) => {
    const range = pcCountRangeOf(template);
    const offer = withCount(template, map, which === 'min' ? range.min : range.max);
    const contract = offer.contract;
    // 固定の機器は予算に含めず、PC だけを渡す（instantiateTemplate と同じ）
    const pcs = contract.placed.filter((p) => p.device === 'pc_basic');
    const need = optimalSwitchCountOf(template, map, pcs, contract.furniture ?? []);
    expect(switchLimitOf(offer, template)).toBeGreaterThanOrEqual(need);
  });
});
