// 定型案件の予算は、最安の設計の費用に余裕の倍率を掛けた額になる。最安の設計の費用が、予算の 80% 以下（★3）に収まることを、台数の最小・最大で確かめる。
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
import { optimalCostOf } from './budget';
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

// 台数の最小・最大になる乱数の種を探し、そのときの案件を返す
const withCount = (template: ContractTemplate, map: GameMap, want: number) => {
  for (let seed = 1; seed <= 5000; seed++) {
    const { offer } = instantiateTemplate(template, map, 0, seed);
    if (offer.params.pcCount === want) return offer.contract;
  }
  throw new Error(`${template.id}: 台数 ${want} になる乱数が見つからない`);
};

describe.each(contractTemplates.map((t) => [t.id, t] as const))('最安の設計と予算 %s', (_id, template) => {
  const map = maps[template.map];
  it.each(['min', 'max'] as const)('台数の%s で、最安の設計の費用が予算の 80% 以下に収まる', (which) => {
    const range = pcCountRangeOf(template);
    const contract = withCount(template, map, which === 'min' ? range.min : range.max);
    const cost = optimalCostOf(template, map, contract.placed, contract.furniture ?? []);
    expect(cost / contract.budget).toBeLessThanOrEqual(0.8);
  });
});
