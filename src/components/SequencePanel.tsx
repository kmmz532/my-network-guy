// シーケンス図の窓。制御のパケットの列（controlSequence）を、機器ごとの縦の線と、1行1本の矢印で描く（絵は ui/SequenceDiagram）。
// ARP・DHCP・OSPF・BPDU・VRRP・DNS は点線、ICMP・TCP・HTTP は実線。失敗した行は、矢印の先に × と理由を出す
import { t, tDyn } from '../i18n/t';
import { controlSequence, type ControlTrigger } from '../network/public';
import { focusedProject, useGameStore } from '../stores/useGameStore';
import { sequenceLayout } from '../ui/sequenceLayout';
import { labelOfUid } from './nodeLabel';
import { SequenceDiagram } from './ui/SequenceDiagram';
import { Text } from './ui/Text';

// 窓の ref（タブの文字列）に入れる、通信の指定
export const sequenceRef = (trace: { kind: 'ping' | 'http'; src: string; dst: string }): string =>
  trace.kind === 'http' ? `http|${trace.src}|${trace.dst}|80` : `ping|${trace.src}|${trace.dst}`;

const parseRef = (ref: string): ControlTrigger => {
  const [kind, from, to, port] = ref.split('|');
  if (kind === 'ping') return { kind, from, to };
  if (kind === 'http') return { kind, from, to, port: Number(port) };
  throw new Error(`シーケンス図: 通信の指定が不正 ${ref}`);
};

export function SequenceBody({ trigger: ref }: { trigger: string }) {
  const state = useGameStore();
  const target = focusedProject(state);
  const netState = target ? state.network.focus : state.network.office;
  if (netState === null) throw new Error('設計中の案件のネットワークの計算の結果がない');
  if (ref === '') return <Text size="sm">{t('ui.sequence.none')}</Text>;
  const nodes = netState.input.nodes;
  const { lanes, rows } = sequenceLayout(controlSequence(netState, parseRef(ref)));
  return (
    <SequenceDiagram
      title={t('ui.sequence.title')}
      lanes={lanes.map((uid) => labelOfUid(state, uid, nodes))}
      rows={rows.map((r) => ({
        label: tDyn(r.step.label, r.step.params),
        from: r.from,
        targets: r.targets,
        dashed: r.dashed,
        failure: r.step.failure ? tDyn(`error.${r.step.failure.reason}`) : undefined,
      }))}
    />
  );
}
