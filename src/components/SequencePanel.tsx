// シーケンス図の窓。制御のパケットの列（controlSequence）を、機器ごとの縦の線と、1行1本の矢印で描く（絵は ui/SequenceDiagram）。
// ARP・DHCP・OSPF・BPDU・VRRP・DNS は点線、ICMP・TCP・HTTP は実線。失敗した行は、矢印の先に × と理由を出す。
// 行を押すと、フレームのある行はパケットの中身の窓をその区間で開き、ない行はマップの上でその区間のパケットを流す。「再生」は上の行から順に、マップの上で流す
import { useMemo, useState, useEffect } from 'react';
import { balance } from 'virtual:game-data';
import { t, tDyn } from '../i18n/t';
import { controlSequence, http, ping, type ControlStep, type ControlTrigger, type Frame } from '../network/public';
import type { Trace } from '../sim/project';
import { focusedProject, useGameStore } from '../stores/useGameStore';
import { nextPlayIndex } from '../ui/sequencePlay';
import { parseRef, sequenceRef, sequenceRefOf } from '../ui/sequenceRef';
import { sequenceLayout } from '../ui/sequenceLayout';
import { framesOfTrace } from './FramesPanel';
import { labelOfUid } from './nodeLabel';
import { Button } from './ui/Button';
import { SequenceDiagram } from './ui/SequenceDiagram';
import { Text } from './ui/Text';

export { sequenceRef, sequenceRefOf };

// 行のパケットを流す経路（マップの上）。経路のない行は流さない
const pathTraceOf = (step: ControlStep, kind: 'ping' | 'http'): Trace | null => {
  const path = step.path;
  if (path.length === 0) return null;
  return { kind, src: path[0], dst: path[path.length - 1], result: { ok: true, path } };
};

export function SequenceBody({ trigger: ref }: { trigger: string }) {
  const state = useGameStore();
  const showTrace = useGameStore((s) => s.showTrace);
  const openWindow = useGameStore((s) => s.openWindow);
  const target = focusedProject(state);
  const netState = target ? state.network.focus : state.network.office;
  if (netState === null) throw new Error('設計中の案件のネットワークの計算の結果がない');
  const { trigger, steps } = useMemo((): { trigger: ControlTrigger | null; steps: ControlStep[] } => {
    if (ref === '') return { trigger: null, steps: [] };
    const parsed = parseRef(ref);
    return { trigger: parsed, steps: controlSequence(netState, parsed) };
  }, [netState, ref]);
  const [pick, setPick] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  // 再生の間隔（balance.json の sequence.stepMs）ごとに、次の行をマップに流す。最後の行を流したら止まる
  useEffect(() => {
    if (!playing) return;
    const id = window.setTimeout(() => {
      const next = nextPlayIndex(pick, steps.length);
      if (next === null) {
        setPlaying(false);
        return;
      }
      setPick(next);
      const trace = pathTraceOf(steps[next], trigger?.kind === 'http' ? 'http' : 'ping');
      if (trace) showTrace(trace);
    }, balance.sequence.stepMs);
    return () => window.clearTimeout(id);
  }, [playing, pick, steps, trigger, showTrace]);

  if (ref === '' || trigger === null) return <Text size="sm">{t('ui.sequence.none')}</Text>;
  const nodes = netState.input.nodes;
  const { lanes, rows } = sequenceLayout(steps);

  // フレームのある行は、その区間を選んだパケットの中身の窓を開く（マップのパケットも同じ区間に止まる）
  // 本体の通信（ping・HTTP）の区間でない行（HTTP の前の DNS の問い合わせなど）は false を返し、経路を流すだけにする
  const openFrame = (frame: Frame): boolean => {
    if (trigger.kind !== 'ping' && trigger.kind !== 'http') return false;
    const trace: Trace = trigger.kind === 'http'
      ? { kind: 'http', src: trigger.from, dst: trigger.to, result: http(netState, trigger.from, trigger.to, trigger.port) }
      : { kind: 'ping', src: trigger.from, dst: trigger.to, ...(trigger.size !== undefined ? { size: trigger.size } : {}), ...(trigger.df !== undefined ? { df: trigger.df } : {}), result: ping(netState, trigger.from, trigger.to, { size: trigger.size, df: trigger.df }) };
    // 区間は、通った配線と向きで同じものを探す（中身の値の並びには頼らない）
    const hop = framesOfTrace(netState, trace).findIndex((f) => f.link === frame.link && f.from === frame.from && f.to === frame.to);
    if (hop < 0) return false;
    showTrace(trace);
    openWindow('frames', `h${hop}`);
    return true;
  };

  const pickRow = (i: number) => {
    setPlaying(false);
    setPick(i);
    const step = steps[i];
    if (step.frame && openFrame(step.frame)) return;
    const trace = pathTraceOf(step, trigger.kind === 'http' ? 'http' : 'ping');
    if (trace) showTrace(trace);
  };

  const play = () => {
    if (steps.length === 0) return;
    setPlaying(true);
    setPick(0);
    const trace = pathTraceOf(steps[0], trigger.kind === 'http' ? 'http' : 'ping');
    if (trace) showTrace(trace);
  };

  return (
    <div>
      <Button variant="secondary" size="s" disabled={steps.length === 0} layout={{ marginBottom: 6 }} onClick={() => (playing ? setPlaying(false) : play())}>
        {playing ? t('ui.sequence.stop') : t('ui.sequence.play')}
      </Button>
      <SequenceDiagram
        title={t('ui.sequence.title')}
        lanes={lanes.map((uid) => labelOfUid(state, uid, nodes))}
        selected={pick}
        onPick={pickRow}
        rows={rows.map((r) => ({
          label: tDyn(r.step.label, r.step.params),
          from: r.from,
          targets: r.targets,
          dashed: r.dashed,
          failure: r.step.failure ? tDyn(`error.${r.step.failure.reason}`) : undefined,
        }))}
      />
    </div>
  );
}
