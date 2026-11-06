import { it } from 'vitest';
import { contractTemplates } from 'virtual:game-data';
import m from '../../assets/data/maps/hospital_ward.json';
import type { GameMap, ContractTemplate } from '../../data/schema';
import { instantiateTemplate } from '../template';
it('dbg', () => {
  const map = m as unknown as GameMap;
  const t = contractTemplates.find((x) => x.id === 't_hospital_station') as ContractTemplate;
  let fails = 0;
  for (let seed = 1; seed < 300; seed++) {
    try { instantiateTemplate(t, map, 0, seed); } catch (e) { fails++; if (fails < 4) console.log('seed', seed, String(e)); }
  }
  console.log('fails', fails);
});
