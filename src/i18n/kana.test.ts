// 検索用のひらがな名。すべての機器と家具に読みがあること
import { describe, expect, it } from 'vitest';
import lang from '../assets/lang/ja_jp.json';
import furnitureJson from '../assets/data/furniture.json';
import pcJson from '../assets/data/devices/pc.json';
import serverJson from '../assets/data/devices/server.json';
import routerJson from '../assets/data/devices/router.json';
import switchJson from '../assets/data/devices/l2_switch.json';
import l3Json from '../assets/data/devices/l3_switch.json';
import routerSwitchJson from '../assets/data/devices/router_switch.json';
import firewallJson from '../assets/data/devices/firewall.json';
import firewallDmzJson from '../assets/data/devices/firewall_dmz.json';
import printerJson from '../assets/data/devices/printer.json';
import { matchesQuery } from '../ui/search';

const dict = lang as Record<string, string>;
const deviceIds = [pcJson, serverJson, routerJson, switchJson, l3Json, routerSwitchJson, firewallJson, firewallDmzJson, printerJson].flatMap((j) => j.devices.map((d) => d.id));
const furnitureIds = furnitureJson.furniture.map((f) => f.id);

describe('検索用のひらがな名', () => {
  it('すべての機器と家具に、ひらがなの読みがある', () => {
    for (const id of deviceIds) expect(dict[`device.${id}.kana`], `device.${id}.kana`).toMatch(/^[ぁ-ゖー ]+$/);
    for (const id of furnitureIds) expect(dict[`furniture.${id}.kana`], `furniture.${id}.kana`).toMatch(/^[ぁ-ゖー ]+$/);
  });

  it('ひらがなで探せる（カタカナの名前でも、ひらがなの読みで一致する）', () => {
    expect(matchesQuery('さーば', [dict['device.server_basic.kana'], dict['device.server_basic.name']])).toBe(true);
    expect(matchesQuery('こーひー', [dict['furniture.coffee.kana']])).toBe(true);
  });
});
