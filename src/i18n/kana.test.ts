// 検索用のひらがな名。すべての機器と家具に読みがあること
import { describe, expect, it } from 'vitest';
import lang from '../../resources/lang/ja_jp.json';
import furnitureJson from '../../resources/data/furniture.json';
import pcJson from '../../resources/data/devices/pc.json';
import serverJson from '../../resources/data/devices/server.json';
import routerJson from '../../resources/data/devices/router.json';
import switchJson from '../../resources/data/devices/l2_switch.json';
import l3Json from '../../resources/data/devices/l3_switch.json';
import routerSwitchJson from '../../resources/data/devices/router_switch.json';
import firewallJson from '../../resources/data/devices/firewall.json';
import firewallDmzJson from '../../resources/data/devices/firewall_dmz.json';
import printerJson from '../../resources/data/devices/printer.json';
import accessPointJson from '../../resources/data/devices/access_point.json';
import uplinkJson from '../../resources/data/devices/uplink.json';
import homeRouterJson from '../../resources/data/devices/home_router.json';
import loadBalancerJson from '../../resources/data/devices/load_balancer.json';
import { matchesQuery } from '../ui/search';

const dict = lang as Record<string, string>;
const deviceIds = [pcJson, serverJson, routerJson, switchJson, l3Json, routerSwitchJson, firewallJson, firewallDmzJson, printerJson, accessPointJson, uplinkJson, homeRouterJson, loadBalancerJson].flatMap((j) => j.devices.map((d) => d.id));
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
