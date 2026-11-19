// ロードバランサーの論点の命令（show のみ。設定は画面で行う）。
import { out, shown } from '../../command/lines';
import type { CommandSpec } from '../../command/types';
import { reach } from '../../engine/forward';
import { getComponent } from '../../components';
import { healthyMembers } from '../../query/loadBalancer';

const METHOD_KEY = { round_robin: 'ui.lb.method.round_robin', source_ip: 'ui.lb.method.source_ip' } as const;
const CHECK_KEY = { none: 'ui.lb.check.none', ping: 'ui.lb.check.ping', http: 'ui.lb.check.http' } as const;

export const commands: readonly CommandSpec[] = [
  {
    id: 'load_balancer.showLoadBalancer',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'load-balancer' }],
    help: 'ui.cmd.load_balancer.showLoadBalancer',
    writes: false,
    topic: 'load_balancer',
    run: (_args, ctx, tr) => {
      const servers = getComponent(ctx.node, 'loadBalancer') ?? [];
      if (servers.length === 0) return shown([out(tr('ui.terminal.lbNone'))]);
      const lines = servers.flatMap((vs) => {
        const healthy = healthyMembers(ctx.state, ctx.node, vs, reach);
        const head = out(tr('ui.terminal.lbVirtual', { vip: vs.vip, port: vs.port, method: tr(METHOD_KEY[vs.method]), check: tr(CHECK_KEY[vs.healthCheck]), snat: tr(vs.snat ? 'ui.lb.snatOn' : 'ui.lb.snatOff') }));
        const members = vs.members.map((m) =>
          out(tr('ui.terminal.lbMember', { ip: m.ip, port: m.port, state: tr(healthy.includes(m) ? 'ui.lb.up' : 'ui.lb.down') })),
        );
        return [head, ...members];
      });
      return shown(lines);
    },
  },
];
