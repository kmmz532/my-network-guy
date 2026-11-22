// サブインターフェース（router-on-a-stick）の論点の命令。サブインターフェースは interface g0/1.10 で入り、名前の VLAN をタグ付きで運ぶ。
import { err, out, shown } from '../../command/lines';
import type { CommandSpec } from '../../command/types';

export const commands: readonly CommandSpec[] = [
  {
    id: 'subif.encapsulationDot1q',
    modes: ['interface'],
    tokens: [{ word: 'encapsulation' }, { word: 'dot1q' }, { arg: 'vlan', name: 'vlan' }],
    help: 'ui.cmd.subif.encapsulationDot1q',
    writes: false,
    topic: 'subif',
    // 運ぶ VLAN は名前（g0/1.10 の 10）で決まる。指定が名前と同じなら受け付け、違えば誤りにする
    run: (args, ctx, tr) => {
      const { iface } = ctx.session;
      if (iface?.kind !== 'sub') return shown([err(tr('ui.terminal.errIfaceKind'))]);
      if (Number(args.vlan) !== iface.vlan) return shown([err(tr('ui.terminal.errEncapsulation', { vlan: iface.vlan }))]);
      return shown([out(tr('ui.terminal.done'))]);
    },
  },
];
