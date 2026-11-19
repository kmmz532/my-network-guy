// パケットの中身の欄。通信（テストの結果・ターミナルの ping）を、区間ごとのフレーム（MAC・VLAN・IP・TTL・ポート）の表で出す。
// 前の区間から変わった欄は色を変える（MAC の付け替え・NAT の変換・TTL の減少）。失敗した通信は、止まった機器と理由を最後の行に出す
import { useEffect, useState } from 'react';
import { t, tDyn } from '../i18n/t';
import { framesOf, isL2Category, isRoutingCategory, type Frame, type FrameContext, type NetworkState } from '../network/public';
import type { Trace } from '../sim/project';
import { focusedProject, useGameStore } from '../stores/useGameStore';
import { useUiStore } from '../stores/useUiStore';
import { labelOfUid } from './nodeLabel';
import { Button } from './ui/Button';
import { Select } from './ui/Select';
import { Cell, HeadCell, HeadRow, Row, Table } from './ui/Table';
import { Text } from './ui/Text';
import { deviceCategory } from '../registry/query';

const cell = (value: string | number, changed: boolean) => <Cell mark={changed ? 'changed' : undefined}>{value}</Cell>;

const portText = (f: Frame) => (f.l4 ? `${f.l4.srcPort}→${f.l4.dstPort}` : '-');

// 通信の結果のフレームの列（欄とシーケンス図で同じ列を使う）
export const framesOfTrace = (netState: NetworkState, trace: Trace): Frame[] => {
  const nodes = netState.input.nodes;
  const category = (uid: string) => deviceCategory(nodes.find((n) => n.uid === uid)?.device ?? '');
  const ctx: FrameContext = {
    nodes,
    links: netState.input.links,
    categoryOf: deviceCategory,
    isSwitch: (uid) => isL2Category(category(uid)),
    isRouter: (uid) => isRoutingCategory(category(uid)),
  };
  return framesOf(ctx, trace.result, trace.kind === 'http' ? { kind: 'http', port: 80 } : { kind: 'ping' });
};

// goal が あれば、その達成条件の通信から開く（案件の欄の行から開いたとき）。hop が あれば、その区間を選んだ状態で開く（シーケンス図の行から開いたとき）
export function FramesBody({ goal, hop: initialHop }: { goal?: number; hop?: number }) {
  const state = useGameStore();
  const traces = useGameStore((s) => s.traces);
  const [index, setIndex] = useState(() => Math.max(0, traces.findIndex((tr) => goal !== undefined && tr.goal === goal)));
  const [hop, setHop] = useState<number | null>(initialHop ?? null);
  // 選んだ区間を、マップのパケットの位置に反映する。欄を閉じたら元に戻す
  const setFrameView = useUiStore((s) => s.setFrameView);
  useEffect(() => {
    setFrameView(hop === null ? null : { trace: index, hop });
  }, [hop, index, setFrameView]);
  useEffect(() => () => setFrameView(null), [setFrameView]);
  const target = focusedProject(state);
  // 表示する構成の計算の結果は、ストアのものを読む（設計中の案件、なければ自社オフィス）
  const netState = target ? state.network.focus : state.network.office;
  if (netState === null) throw new Error('設計中の案件のネットワークの計算の結果がない');
  const nodes = netState.input.nodes;
  if (traces.length === 0) return <Text size="sm">{t('ui.frames.none')}</Text>;
  const trace = traces[Math.min(index, traces.length - 1)];

  const frames = framesOfTrace(netState, trace);
  const failure = trace.result.ok ? null : trace.result.failure;
  const shown = hop === null ? frames.length : Math.min(hop + 1, frames.length);
  const name = (uid: string) => labelOfUid(state, uid, nodes);

  return (
    <Text size="s">
      {traces.length > 1 && (
        <Select
          label={t('ui.frames.title')}
          value={String(index)}
          options={traces.map((tr, i) => ({ value: String(i), label: `${tr.kind} ${name(tr.src)} → ${name(tr.dst)}` }))}
          onChange={(v) => { setIndex(Number(v)); setHop(null); }}
          layout={{ marginBottom: 6, maxWidth: '100%' }}
        />
      )}
      <div style={{ overflowX: 'auto' }}>
        <Table>
          <HeadRow>
            {['hop', 'dstMac', 'srcMac', 'vlan', 'srcIp', 'dstIp', 'ttl', 'port'].map((c) => (
              <HeadCell key={c}>{tDyn(`ui.frames.col.${c}`)}</HeadCell>
            ))}
          </HeadRow>
          <tbody>
            {frames.slice(0, shown).map((f, i) => {
              const p = i > 0 ? frames[i - 1] : null;
              return (
                <Row key={i} selected={hop === i}>
                  {cell(`${name(f.from)} → ${name(f.to)}`, false)}
                  {cell(f.l2.dstMac, p !== null && p.l2.dstMac !== f.l2.dstMac)}
                  {cell(f.l2.srcMac, p !== null && p.l2.srcMac !== f.l2.srcMac)}
                  {cell(f.l2.vlan ?? '-', p !== null && p.l2.vlan !== f.l2.vlan)}
                  {cell(f.l3.srcIp, f.nat !== undefined || (p !== null && p.l3.srcIp !== f.l3.srcIp))}
                  {cell(f.l3.dstIp, f.nat !== undefined || (p !== null && p.l3.dstIp !== f.l3.dstIp))}
                  {cell(f.l3.ttl, p !== null && p.l3.ttl !== f.l3.ttl)}
                  {cell(portText(f), f.nat !== undefined)}
                </Row>
              );
            })}
            {failure && shown === frames.length && (
              <Row>
                <Cell colSpan={8} mark="warn">
                  {t('ui.frames.stopped', { from: name(failure.node), reason: tDyn(`error.${failure.reason}`) })}
                </Cell>
              </Row>
            )}
          </tbody>
        </Table>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <Button variant="secondary" disabled={frames.length === 0 || hop === 0} onClick={() => setHop(hop === null ? frames.length - 2 : hop - 1)}>{t('ui.frames.prev')}</Button>
        <Button variant="secondary" disabled={hop === null || hop >= frames.length - 1} onClick={() => setHop(hop === null || hop + 1 >= frames.length - 1 ? null : hop + 1)}>{t('ui.frames.next')}</Button>
      </div>
    </Text>
  );
}
