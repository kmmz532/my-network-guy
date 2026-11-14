// VRRP の論点の命令。
import { vrrpStatusOf } from '../../query/vrrpStatus';
import { changed, err, out, shown } from '../../command/lines';
import type { CommandSpec } from '../../command/types';
import { isIp, port } from '../../terminalConfig';

// 口の番号と VRID（1〜255）。合わなければ null
const vrrpArgs = (w: readonly string[]) => {
  const p = port(w[0] ?? '');
  const vrid = /^[0-9]+$/.test(w[1] ?? '') ? Number(w[1]) : null;
  return p === null || vrid === null || vrid < 1 || vrid > 255 ? null : { p, vrid };
};

export const commands: readonly CommandSpec[] = [
  {
    id: 'vrrp.showVrrp',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'vrrp' }],
    help: '',
    writes: false,
    topic: 'vrrp',
    run: (_args, ctx, tr) => {
      const groups = vrrpStatusOf(ctx.state, ctx.node.uid);
      if (groups.length === 0) return shown([out(tr('ui.terminal.vrrpNone'))]);
      return shown(groups.map((g) => out(tr('ui.terminal.vrrpGroup', { iface: g.iface, vrid: g.vrid, state: g.state, ip: g.ip, priority: g.priority, preempt: tr(g.preempt ? 'ui.terminal.vrrpPreemptOn' : 'ui.terminal.vrrpPreemptOff') }))));
    },
  },
  {
    id: 'vrrp.vrrp',
    modes: ['exec'],
    tokens: [{ word: 'vrrp' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'vrrp',
    run: (args, ctx, tr) => {
      const words = args.args.split(' ').filter((w) => w !== '');
      const a = vrrpArgs(words);
      if (!a) return shown([err(tr('ui.terminal.usageVrrp'))]);
      // 口の番号からインターフェースの id を引く（今の legacyChange と同じ）
      const idOf = (p: number) => ctx.node.interfaces.find((i) => i.port === p)?.id ?? '';
      const [, , key, v1, kw, v2] = words;
      if (key === 'ip' && words.length === 4 && isIp(v1)) return changed(ctx, tr, { kind: 'vrrp', change: { op: 'ip', id: idOf(a.p), vrid: a.vrid, ip: v1 } });
      if (key === 'priority' && words.length === 4 && /^[0-9]+$/.test(v1)) return changed(ctx, tr, { kind: 'vrrp', change: { op: 'priority', id: idOf(a.p), vrid: a.vrid, value: Number(v1) } });
      if (key === 'preempt' && words.length === 3) return changed(ctx, tr, { kind: 'vrrp', change: { op: 'preempt', id: idOf(a.p), vrid: a.vrid, on: true } });
      if (key === 'track' && words.length === 6 && port(v1) !== null && kw === 'decrement' && /^[0-9]+$/.test(v2)) {
        return changed(ctx, tr, { kind: 'vrrp', change: { op: 'track', id: idOf(a.p), vrid: a.vrid, iface: idOf(Number(v1)), decrement: Number(v2) } });
      }
      return shown([err(tr('ui.terminal.usageVrrp'))]);
    },
  },
  {
    id: 'vrrp.noVrrp',
    modes: ['exec'],
    tokens: [{ word: 'no' }, { word: 'vrrp' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'vrrp',
    run: (args, ctx, tr) => {
      const words = args.args.split(' ').filter((w) => w !== '');
      const a = vrrpArgs(words);
      if (!a) return shown([err(tr('ui.terminal.usageVrrp'))]);
      const id = ctx.node.interfaces.find((i) => i.port === a.p)?.id ?? '';
      if (words.length === 2) return changed(ctx, tr, { kind: 'vrrp', change: { op: 'remove', id, vrid: a.vrid } });
      if (words.length === 3 && words[2] === 'preempt') return changed(ctx, tr, { kind: 'vrrp', change: { op: 'preempt', id, vrid: a.vrid, on: false } });
      return shown([err(tr('ui.terminal.usageVrrp'))]);
    },
  },
];
