// 操作を世界に当てる。引数の構成（Core）を変えず、結果（Outcome）を返す。呼ぶ側は結果を状態へ反映する（stores/gameOps.ts の apply）。
import type { GameMap } from '../data/schema';
import { deviceDef, furnitureDef, hasDevice, hasFurniture } from '../registry/query';
import { applyMoney, recordSaving } from '../sim/ledger';
import { connect, fail, officeUplinkOf, paidCable, type Core, type Env, type NetTarget, type Outcome } from '../sim/project';
import { moveFurniture, placeFurniture, removeFurniture, rotateFurniture } from '../sim/furniture';
import {
  moveNode,
  moveOfficeUplink,
  placeDevice,
  placeInOffice,
  placeOfficeUplink,
  removeFromOffice,
  removeLink,
  removeNode,
  replug,
  replugTo,
} from '../sim/placement';
import { buyDevice, sellDevice } from '../sim/shop';
import {
  addRoute, autoRegisterZone, removeHost, removeRoute, setBgp, setChannel, setDhcp, setDnsRole, setFirewallRules, setGateway, setHost,
  setHostname, setInterface, setIsp, setName, setNameServer, setNat, setOspf, setPlan, setPortMode, setPower, setRouting, setService,
  setStp, setSvi, setVrrp, setWireless,
} from '../sim/netEdit';
import type { ConfigChange, Operation } from './operation';
import type { GameMode } from './world';

// 操作を当てるときの周りの状況。target は設計の対象（自社オフィスか設計中の案件）、map は設計中の案件の地図（案件がなければ null）、hq は自社オフィスの地図
export interface OpContext {
  env: Env;
  target: NetTarget;
  map: GameMap | null;
  hq: GameMap;
  mode: GameMode;
}

// 機器の設定の変更を当てる。1つの変更は netEdit の関数1つに対応する
const applyConfig = (core: Core, uid: string, change: ConfigChange, ctx: OpContext): Outcome => {
  const { env, target } = ctx;
  switch (change.kind) {
    case 'iface': return setInterface(core, uid, change.port, change.ip, change.prefix ?? 24, env, target);
    case 'svi': return setSvi(core, uid, change.vlan, change.ip, change.prefix ?? 24, env, target);
    case 'portMode': return setPortMode(core, uid, change.port, change.mode, target);
    case 'gateway': return setGateway(core, uid, change.gateway, target);
    case 'routing': return setRouting(core, uid, change.change, target);
    case 'ospf': return setOspf(core, uid, change.change, target);
    case 'isp': return setIsp(core, uid, change.line, target);
    case 'stp': return setStp(core, uid, change.change, target);
    case 'channel': return setChannel(core, uid, change.change, target);
    case 'dhcp': return setDhcp(core, uid, change.change, target);
    case 'power': return setPower(core, uid, change.on, target);
    case 'vrrp': return setVrrp(core, uid, change.change, target);
    case 'bgp': return setBgp(core, uid, change.change, target);
    case 'nat': return setNat(core, uid, change.change, target);
    case 'wireless': return setWireless(core, uid, change.key, change.value, target);
    case 'firewallRules': return setFirewallRules(core, uid, change.rules, target);
    case 'plan': return setPlan(core, uid, change.port, change.network, change.prefix, env, target);
    case 'service': return setService(core, uid, change.protocol, change.on, target);
    case 'name': return setName(core, uid, change.name, target);
    case 'hostname': return setHostname(core, uid, change.hostname, target);
    case 'nameServer': return setNameServer(core, uid, change.ip, target);
    case 'dnsRole': return setDnsRole(core, uid, change.on, target);
    case 'autoRegisterZone': return autoRegisterZone(core, uid, target);
    case 'host': return setHost(core, uid, change.name, change.ip, target);
    case 'removeHost': return removeHost(core, uid, change.name, target);
    case 'addRoute': return addRoute(core, uid, change.route, target);
    case 'removeRoute': return removeRoute(core, uid, change.index, target);
    default: {
      const never: never = change;
      throw new Error(`未対応の設定の変更: ${JSON.stringify(never)}`);
    }
  }
};

// 機材または家具の定価
const listPriceOf = (id: string): number => {
  if (hasFurniture(id)) return furnitureDef(id).price;
  if (hasDevice(id)) return deviceDef(id).price;
  throw new Error(`定価の分かる機材・家具ではない: ${id}`);
};

// 操作1つを当てる。失敗は理由を持つ Outcome で返す（例外にしない）
export const applyOperation = (core: Core, op: Operation, ctx: OpContext): Outcome => {
  const { env, target, hq } = ctx;
  // 案件の設計中は、案件の地図が要る
  const designMap = ctx.map;
  const sandbox = ctx.mode === 'sandbox';
  switch (op.kind) {
    case 'config':
      return applyConfig(core, op.uid, op.change, ctx);
    case 'placeDevice': {
      if (target === 'office') {
        // 回線終端は在庫を持たない。まだなければ置き、置いてあれば有料で位置を変更する
        if (op.device === 'uplink') {
          const place = officeUplinkOf(core.office) ? moveOfficeUplink : placeOfficeUplink;
          return place(core, op.x, op.y, hq, env, env.balance);
        }
        return placeInOffice(core, op.device, op.x, op.y, hq, env, sandbox, sandbox);
      }
      if (!designMap) return fail('map');
      return placeDevice(core, op.device, op.x, op.y, designMap, env);
    }
    case 'moveNode': {
      const map = target === 'focus' ? designMap : hq;
      if (!map) return fail('map');
      return moveNode(core, op.uid, op.x, op.y, env, target, map, sandbox);
    }
    case 'removeNode':
      return target === 'office' ? removeFromOffice(core, op.uid, env, sandbox) : removeNode(core, op.uid, env);
    case 'connect':
      return connect(core, op.a, op.b, op.cable, env, target, op.ports ?? {});
    case 'removeLink':
      return removeLink(core, op.uid, target, env);
    case 'replug':
      return replug(core, op.link, op.end, op.port, env, target);
    case 'replugTo':
      return replugTo(core, op.link, op.end, op.node, op.port, env, target);
    case 'placeFurniture':
      return placeFurniture(core, op.id, op.x, op.y, hq, sandbox);
    case 'moveFurniture':
      return moveFurniture(core, op.uid, op.x, op.y, hq);
    case 'rotateFurniture':
      return rotateFurniture(core, op.uid);
    case 'removeFurniture':
      return removeFurniture(core, op.uid, sandbox);
    case 'buy': {
      // サンドボックスは購入の費用を 0 とする（在庫は増える）。割引で浮いた額は節約として帳簿に残す（資金は変えない）
      const list = listPriceOf(op.id);
      const price = sandbox ? 0 : paidCable(core, list);
      const r = buyDevice(core.clock.money, core.owned, op.id, price);
      if (!r.ok) return fail(r.reason);
      const clock = recordSaving(applyMoney(core.clock, r.money - core.clock.money, 'purchase'), sandbox ? 0 : list - price);
      return { ok: true, core: { ...core, clock, owned: r.owned } };
    }
    case 'sell': {
      if (sandbox) return fail('sandbox');
      const r = sellDevice(core.clock.money, core.owned, op.id, listPriceOf(op.id), env.balance.sellRate);
      if (!r.ok) return fail(r.reason);
      return { ok: true, core: { ...core, clock: applyMoney(core.clock, r.money - core.clock.money, 'sale'), owned: r.owned } };
    }
    default: {
      const never: never = op;
      throw new Error(`未対応の操作: ${JSON.stringify(never)}`);
    }
  }
};
