// 演習の欄（学習モード）。教材の欄と同じ場所・同じ折りたたみで、問いの文と候補・正解・直す条件を出す。案内の吹き出しは出さない
import { useState } from 'react';
import type { Drill, QuestionSet } from '../data/schema';
import type { FailureReason } from '../network/types';
import { questionOf } from '../sim/drillRun';
import { t, tDyn } from '../i18n/t';
import { usePhone } from '../ui/usePhone';
import { useGameStore } from '../stores/useGameStore';
import { goalText } from './goalText';
import { Icon } from './Icon';
import { labelOfUid } from './nodeLabel';
import { Button } from './ui/Button';
import { Choice } from './ui/Choice';
import { HudBar } from './ui/HudBar';
import { Select } from './ui/Select';
import { Text } from './ui/Text';

function DiagnoseForm({ nodes, reasons }: { nodes: string[]; reasons: FailureReason[] }) {
  const answer = useGameStore((s) => s.answerDiagnose);
  const officeNodes = useGameStore((s) => s.office.nodes);
  const [node, setNode] = useState('');
  const [reason, setReason] = useState('');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
      <Select label={t('ui.drill.node')} value={node} onChange={setNode} options={nodes.map((uid) => ({ value: uid, label: labelOfUid(useGameStore.getState(), uid, officeNodes) }))} />
      <Select label={t('ui.drill.reason')} value={reason} onChange={setReason} options={reasons.map((r) => ({ value: r, label: tDyn(`error.${r}`) }))} />
      <div>
        <Button variant="secondary" disabled={node === '' || reason === ''} onClick={() => answer(node, reason as FailureReason)}>{t('ui.drill.answer')}</Button>
      </div>
    </div>
  );
}

// 問いの本体（今の問いの文・候補・正解・直す条件）。演習の欄と、教材の発展の問いで同じものを使う
export function QuestionFlow({ drill }: { drill: QuestionSet }) {
  const run = useGameStore((s) => s.sandboxDrill);
  const view = useGameStore((s) => s.drillView);
  const shown = useGameStore((s) => s.drillAnswer);
  const broken = useGameStore((s) => s.drillBroken);
  const check = useGameStore((s) => s.check);
  const officeNodes = useGameStore((s) => s.office.nodes);
  const answerInspect = useGameStore((s) => s.answerInspect);
  const proceedDrill = useGameStore((s) => s.proceedDrill);
  if (!run) throw new Error('演習の進行がない');
  const label = (uid: string) => labelOfUid(useGameStore.getState(), uid, officeNodes);
  const q = run.stage === 'done' ? null : questionOf(drill, run);
  // 直す条件。設定する問いは達成条件、原因の問いはその通信が届くこと
  const conditions =
    q?.kind === 'build'
      ? q.goals.map((g) => goalText(g, label))
      : q?.kind === 'diagnose'
        ? [t('ui.drill.reach', { from: label(q.from), to: label(q.to) })]
        : [];
  const result = check && check.projectId === 'hq' ? check.goals : null;
  const answerText =
    shown === null ? '' : typeof shown === 'string' ? shown : `${label(shown.node)} / ${tDyn(`error.${shown.reason}`)}`;

  return (
    <>
      {q === null ? (
        <Text size="sm">{t('ui.drill.done')}</Text>
      ) : (
        <>
          <Text tone="faint" size="sm">{t('ui.drill.progress', { n: run.index + 1, total: drill.questions.length })}</Text>
          <div style={{ lineHeight: 1.5 }}><Text tone="soft" size="sm">{tDyn(`drill.${drill.id}.q.${q.id}`)}</Text></div>
          {run.stage === 'answer' && q.kind === 'inspect' && view && <div style={{ marginTop: 6 }}><Choice options={view.choices.map((c) => ({ value: c, label: c }))} value="" onChange={answerInspect} /></div>}
          {run.stage === 'answer' && q.kind === 'diagnose' && view && <DiagnoseForm key={q.id} nodes={view.nodes} reasons={view.reasons} />}
          {run.stage === 'answer' && run.misses === 1 && (
            <Text tone="warn" size="sm" layout={{ marginTop: 6 }}>{tDyn(q.kind === 'inspect' ? `drill.hint.${q.ask.what}` : 'drill.hint.diagnose')}</Text>
          )}
          {broken && <Text tone="warn" size="sm" layout={{ marginTop: 6 }}>{t('ui.drill.broken')}</Text>}
          {run.stage === 'revealed' && (
            <>
              <Text size="sm" layout={{ marginTop: 6 }}>{t('ui.drill.reveal', { answer: answerText })}</Text>
              <Text tone="soft" size="sm" layout={{ marginTop: 4 }}>{tDyn(q.kind === 'inspect' ? `drill.hint.${q.ask.what}` : 'drill.hint.diagnose')}</Text>
              <Button variant="secondary" layout={{ marginTop: 6, marginRight: 6 }} onClick={proceedDrill}>{t('ui.drill.next')}</Button>
            </>
          )}
          {run.stage === 'fix' && (
            <>
              <Text size="sm" layout={{ marginTop: 6 }}>{t('ui.drill.fix')}</Text>
              <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0 }}>
                {conditions.map((text, i) => {
                  const ok = result?.[i] ? result[i].ok : null;
                  return (
                    <li key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 4 }}>
                      <Text as="span" tone={ok === null ? 'faint' : 'normal'} size="sm" layout={{ flexShrink: 0 }}>
                        <Icon name={ok === false ? 'icon/close' : 'icon/ok'} scale={1} />
                      </Text>
                      <Text as="span" tone={ok === true ? 'sub' : 'normal'} size="sm">{text}</Text>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}
    </>
  );
}

export function DrillPanel({ drill }: { drill: Drill }) {
  const open = useGameStore((s) => s.taskOpen);
  const setOpen = useGameStore((s) => s.setTaskOpen);
  const phone = usePhone();
  const closeLesson = useGameStore((s) => s.closeLesson);
  const openWindow = useGameStore((s) => s.openWindow);
  const hasTraces = useGameStore((s) => s.traces.length > 0);
  const title = tDyn(`drill.${drill.id}.title`);

  return (
    <HudBar as="aside" variant="panel" marker="task-panel" arrange={{ width: open ? 260 : 'auto', zIndex: 4, zoom: 'var(--ui-scale, 1)' }}>
      <Button variant="plain" size="row" layout={{ width: '100%' }} onClick={() => setOpen(!open)}>
        <span style={{ width: 10 }}>{open ? '▾' : '▸'}</span>
        <Icon name="icon/mail" scale={1} />
        {(open || phone) && <span style={phone && !open ? { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : undefined}>{title}</span>}
      </Button>
      {open && (
        <div style={{ padding: '0 8px 8px' }}>
          <QuestionFlow drill={drill} />
          {hasTraces && <Button variant="secondary" layout={{ marginTop: 8, marginRight: 6 }} onClick={() => openWindow('frames', '')}>{t('ui.frames.open')}</Button>}
          <Button variant="secondary" layout={{ marginTop: 8 }} onClick={closeLesson}>{t('ui.drill.quit')}</Button>
        </div>
      )}
    </HudBar>
  );
}
