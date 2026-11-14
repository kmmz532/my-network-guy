// 命令の登録表。論点のない命令（core.ts）と、論点ごとの命令（topics/<論点>/commands.ts）を起動の時に登録して凍結する。
import { Registry } from '../../registry/registry';
import { commands as bgp } from '../topics/bgp/commands';
import { commands as dhcp } from '../topics/dhcp/commands';
import { commands as dns } from '../topics/dns/commands';
import { commands as lag } from '../topics/lag/commands';
import { commands as nat } from '../topics/nat/commands';
import { commands as ospf } from '../topics/ospf/commands';
import { commands as rip } from '../topics/rip/commands';
import { commands as staticRoute } from '../topics/static_route/commands';
import { commands as stp } from '../topics/stp/commands';
import { commands as vlan } from '../topics/vlan/commands';
import { commands as vrrp } from '../topics/vrrp/commands';
import { commands as wireless } from '../topics/wireless/commands';
import { commands as core } from './core';
import type { CommandSpec } from './types';

const registry = new Registry<CommandSpec>('命令');
for (const spec of [...core, ...vlan, ...staticRoute, ...rip, ...ospf, ...bgp, ...vrrp, ...lag, ...nat, ...dhcp, ...stp, ...dns, ...wireless]) 
  registry.register(spec);

registry.freeze();

export const COMMANDS = registry;
