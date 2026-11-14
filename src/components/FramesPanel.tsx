// パケットの中身の欄。通信（テストの結果・ターミナルの ping）を、区間ごとのフレーム（MAC・VLAN・IP・TTL・ポート）の表で出す。
// 前の区間から変わった欄は色を変える（MAC の付け替え・NAT の変換・TTL の減少）。失敗した通信は、止まった機器と理由を最後の行に出す
import { useEffect, useState } from 'react';
import { t, tDyn } from '../i18n/t';
import { framesOf, isL2Category, isRoutingCategory, type Frame, type FrameContext } from '../network/public';
import { focusedProject, useGameStore } from '../stores/useGameStore';
import { useUiStore } from '../stores/useUiStore';
import { labelOfUid } from './nodeLabel';
import { secondaryButton } from './Modal';
import { deviceCategory } from '../registry/query';

const CHANGED = '#ffd866';

const cell = (value: string | number, changed: boolean) => (
  <td style={{ padding: '2px 6px', whiteSpace: 'nowrap', color: changed ? CHANGED : undefined, fontWeight: changed ? 'bold' : undefined }}>{value}</td>
);

const portText = (f: Frame) => (f.l4 ? `${f.l4.srcPort}→${f.l4.dstPort}` : '-');

// goal が あれば、その達成条件の通信から開く（案件の欄の行から開いたとき）
export function FramesBody({ goal }: { goal?: number }) {
  const state = useGameStore();
  const traces = useGameStore((s) => s.traces);
  const [index, setIndex] = useState(() => Math.max(0, traces.findIndex((tr) => goal !== undefined && tr.goal === goal)));
  const [hop, setHop] = useState<number | null>(null);
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
  const links = netState.input.links;
  if (traces.length === 0) return <div style={{ fontSize: 13 }}>{t('ui.frames.none')}</div>;
  const trace = traces[Math.min(index, traces.length - 1)];

  const category = (uid: string) => deviceCategory(nodes.find((n) => n.uid === uid)?.device ?? '');
  const ctx: FrameContext = {
    nodes,
    links,
    categoryOf: deviceCategory,
    isSwitch: (uid) => isL2Category(category(uid)),
    isRouter: (uid) => isRoutingCategory(category(uid)),
  };
  const frames = framesOf(ctx, trace.result, trace.kind === 'http' ? { kind: 'http', port: 80 } : { kind: 'ping' });
  const failure = trace.result.ok ? null : trace.result.failure;
  const shown = hop === null ? frames.length : Math.min(hop + 1, frames.length);
  const name = (uid: string) => labelOfUid(state, uid, nodes);

  return (
    <div style={{ fontSize: 12 }}>
      {traces.length > 1 && (
        <select value={index} onChange={(e) => { setIndex(Number(e.target.value)); setHop(null); }} style={{ marginBottom: 6, maxWidth: '100%' }}>
          {traces.map((tr, i) => (
            <option key={i} value={i}>{`${tr.kind} ${name(tr.src)} → ${name(tr.dst)}`}</option>
          ))}
        </select>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', opacity: 0.8 }}>
              {['hop', 'dstMac', 'srcMac', 'vlan', 'srcIp', 'dstIp', 'ttl', 'port'].map((c) => (
                <th key={c} style={{ padding: '2px 6px', whiteSpace: 'nowrap' }}>{tDyn(`ui.frames.col.${c}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {frames.slice(0, shown).map((f, i) => {
              const p = i > 0 ? frames[i - 1] : null;
              return (
                <tr key={i} style={{ background: hop === i ? 'rgba(255,255,255,0.12)' : undefined }}>
                  {cell(`${name(f.from)} → ${name(f.to)}`, false)}
                  {cell(f.l2.dstMac, p !== null && p.l2.dstMac !== f.l2.dstMac)}
                  {cell(f.l2.srcMac, p !== null && p.l2.srcMac !== f.l2.srcMac)}
                  {cell(f.l2.vlan ?? '-', p !== null && p.l2.vlan !== f.l2.vlan)}
                  {cell(f.l3.srcIp, f.nat !== undefined || (p !== null && p.l3.srcIp !== f.l3.srcIp))}
                  {cell(f.l3.dstIp, f.nat !== undefined || (p !== null && p.l3.dstIp !== f.l3.dstIp))}
                  {cell(f.l3.ttl, p !== null && p.l3.ttl !== f.l3.ttl)}
                  {cell(portText(f), f.nat !== undefined)}
                </tr>
              );
            })}
            {failure && shown === frames.length && (
              <tr>
                <td colSpan={8} style={{ padding: '4px 6px', color: CHANGED }}>
                  {t('ui.frames.stopped', { from: name(failure.node), reason: tDyn(`error.${failure.reason}`) })}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button style={secondaryButton} disabled={frames.length === 0 || hop === 0} onClick={() => setHop(hop === null ? frames.length - 2 : hop - 1)}>{t('ui.frames.prev')}</button>
        <button style={secondaryButton} disabled={hop === null || hop >= frames.length - 1} onClick={() => setHop(hop === null || hop + 1 >= frames.length - 1 ? null : hop + 1)}>{t('ui.frames.next')}</button>
      </div>
    </div>
  );
}
