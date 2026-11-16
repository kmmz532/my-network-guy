// 受注中の案件の内容（タイトル・依頼文・達成条件・ヒント・最初の案件の手順）。左上に重ねて表示し、折りたためる。
// 達成条件は最後のテスト（または検収）の結果で ✓／× を出す。× は失敗した機器を選んで機器の画面を開く
import { labelOfUid } from './nodeLabel';
import { hasKey, t, tDyn } from '../i18n/t';
import { goalText } from './goalText';
import { focusedProject, useGameStore } from '../stores/useGameStore';
import { Icon } from './Icon';
import { familiarKeyOf } from '../sim/familiar';
import { usePhone } from '../ui/usePhone';
import { useEffect, useRef, useState } from 'react';
import { GLOSSARY_OF_FAILURE } from '../network/glossaryOf';
import { lessonEntryOf } from '../sim/lessonCatalog';
import { lessonCatalog } from '../stores/lessonCatalog';
import { DrillPanel, QuestionFlow } from './DrillPanel';
import { Button } from './ui/Button';
import { HudBar } from './ui/HudBar';
import { Text } from './ui/Text';

// 最初の案件（c001）の手順。配線・疎通・施工依頼の順に、済んだものに印を付ける
const FIRST_CONTRACT = 'c001_direct_link';

// top は札の上端（ヘッダーの下）。狭い画面では、案件を受けたときに畳んだ状態（件名だけ）で出す
// 案件の欄の折りたたみの見出し（案件と教材で同じ）
export function TaskPanel() {
  const active = useGameStore(focusedProject);
  const open = useGameStore((s) => s.taskOpen);
  const setOpen = useGameStore((s) => s.setTaskOpen);
  const check = useGameStore((s) => s.check);
  const openWindow = useGameStore((s) => s.openWindow);
  const setTool = useGameStore((s) => s.setTool);
  const phone = usePhone();
  const lessonId = useGameStore((s) => s.sandboxLesson?.id ?? null);
  const closeLesson = useGameStore((s) => s.closeLesson);
  // 達成の後に出す発展の問い（始まっていて、閉じていないとき）
  const followUpsRun = useGameStore((s) => s.sandboxDrill);
  const followUpsClosed = useGameStore((s) => s.followUpsClosed);
  const closeFollowUps = useGameStore((s) => s.closeFollowUps);
  const officeNodes = useGameStore((s) => s.office.nodes);
  const traces = useGameStore((s) => s.traces);
  const hasTraces = traces.length > 0;
  const activeId = active?.id ?? null;
  // 同じ依頼の型紙があるか（「型紙を使う」を出す。N70）
  const hasBlueprint = useGameStore((s) => (active ? s.familiarity.blueprints[familiarKeyOf(active.kind, active.baseId, active.contract.map)] !== undefined : false));
  const useBlueprint = useGameStore((s) => s.useBlueprint);
  // 「型紙を使う」が失敗したときの理由（ui.error.* のキー）。案件が変わったら消す
  const [blueprintError, setBlueprintError] = useState<string | null>(null);
  useEffect(() => {
    if (phone && activeId !== null) setOpen(false);
  }, [phone, activeId, setOpen]);
  useEffect(() => {
    setBlueprintError(null);
  }, [activeId]);

  // 最後のテスト
  // 最後のテスト（または検収）の結果。この案件のものだけを使う。結果がなければ ok は null（未判定）
  const result = active && check && check.projectId === active.id ? check.goals : null;
  const warnings = active && check && check.projectId === active.id ? (check.warnings ?? []) : [];
  const goals = active
    ? active.contract.goals.map((goal, i) => {
        const g = result?.[i];
        return { text: goalText(goal, (id) => labelOfUid(useGameStore.getState(), id, active.nodes)), ok: g ? g.ok : null, node: g?.failures[0]?.node ?? null, term: g?.failures[0] ? (GLOSSARY_OF_FAILURE[g.failures[0].reason] ?? null) : null };
      })
    : [];
  // 用語: 初めて出すときは説明を出し、記録する。2回目からは「用語の説明を見る」で開く
  const termsShown = useGameStore((s) => s.termsShown);
  const markTermShown = useGameStore((s) => s.markTermShown);
  const [openTerm, setOpenTerm] = useState<string | null>(null);
  const firstShownHere = useRef(new Set<string>());
  const failingTerms = goals.filter((g) => g.ok === false && g.term).map((g) => g.term as string);
  useEffect(() => {
    for (const term of failingTerms) {
      if (!termsShown.includes(term)) markTermShown(term);
      firstShownHere.current.add(term);
    }
    // failingTerms は描画のたびに作り直すため、用語の並びだけで判定する
  }, [failingTerms.join(','), termsShown, markTermShown]);

  if (!active) {
    const lesson = lessonId === null ? undefined : lessonEntryOf(lessonCatalog, lessonId);
    if (!lesson) return null;
    if (lesson.drill) return <DrillPanel drill={lesson.drill} />;
    // 教材: 案件と同じ欄に、題名・依頼文・達成条件（最後のテストの結果）を出す
    const lessonResult = check && check.projectId === 'hq' ? check.goals : null;
    return (
      <HudBar as="aside" variant="panel" marker="task-panel" arrange={{ width: open ? 260 : 'auto', zIndex: 4, zoom: 'var(--ui-scale, 1)' }}>
        {/* 案件の欄と同じ折りたたみの見出し（教材の題名を出す） */}
        <Button variant="plain" size="row" layout={{ width: '100%' }} onClick={() => setOpen(!open)}>
          <span style={{ width: 10 }}>{open ? '▾' : '▸'}</span>
          <Icon name="icon/mail" scale={1} />
          {(open || phone) && <span style={phone && !open ? { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : undefined}>{tDyn(lesson.titleKey)}</span>}
        </Button>
        {open && (
          <div style={{ padding: '0 8px 8px' }}>
            <div style={{ lineHeight: 1.5 }}><Text tone="soft" size="sm">{tDyn(lesson.briefKey)}</Text></div>
            <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0 }}>
              {lesson.goals.map((goal, i) => {
                const ok = lessonResult?.[i] ? lessonResult[i].ok : null;
                return (
                  <li key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 4 }}>
                    <Text as="span" tone={ok === null ? 'faint' : 'normal'} size="sm" layout={{ flexShrink: 0 }}>
                      <Icon name={ok === false ? 'icon/close' : 'icon/ok'} scale={1} />
                    </Text>
                    <Text as="span" tone={ok === true ? 'sub' : 'normal'} size="sm">{goalText(goal, (id) => labelOfUid(useGameStore.getState(), id, officeNodes))}</Text>
                  </li>
                );
              })}
            </ul>
            {lesson.followUps && followUpsRun !== null && !followUpsClosed && (
              <div style={{ marginTop: 10 }}>
                <Text size="sm" bold>{t('ui.followup.title')}</Text>
                <QuestionFlow drill={lesson.followUps} />
                <Button variant="secondary" layout={{ marginTop: 8 }} onClick={closeFollowUps}>{t('ui.followup.close')}</Button>
              </div>
            )}
            {hasTraces && <Button variant="secondary" layout={{ marginTop: 8, marginRight: 6 }} onClick={() => openWindow('frames', '')}>{t('ui.frames.open')}</Button>}
            <Button variant="secondary" layout={{ marginTop: 8 }} onClick={closeLesson}>{t('ui.lesson.end')}</Button>
          </div>
        )}
      </HudBar>
    );
  }

  const hintKey = `contract.${active.baseId}.hint`;
  const hasHint = hasKey(hintKey);
  const steps =
    active.baseId === FIRST_CONTRACT
      ? [
          { text: t('ui.task.step.wire'), done: active.links.length > 0 },
          { text: t('ui.task.step.test'), done: active.testedOk },
          { text: t('ui.task.step.build'), done: active.phase === 'build' },
        ]
      : [];

  return (
    <HudBar
      as="aside"
      variant="panel"
      // 案内の吹き出しを、スマホで案件の欄の下に置くために測る（B2）
      marker="task-panel"
      arrange={{
        width: open ? 260 : 'auto',
        maxWidth: phone ? 'calc((100vw - 16px) / var(--ui-scale, 1))' : undefined,
        zIndex: 4,
        zoom: 'var(--ui-scale, 1)',
      }}
    >
      <Button variant="plain" size="row" layout={{ width: '100%' }} onClick={() => setOpen(!open)}>
        <span style={{ width: 10 }}>{open ? '▾' : '▸'}</span>
        <Icon name="icon/mail" scale={1} />
        {/* 畳んだときは、狭い画面だけ件名を出す（PC は従来どおり開いたときだけ） */}
        {(open || phone) && (
          <span style={phone && !open ? { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : undefined}>
            {tDyn(`contract.${active.baseId}.title`, active.params)}
          </span>
        )}
      </Button>
      {open && (
        <div style={{ padding: '0 8px 8px' }}>
          <div style={{ lineHeight: 1.5 }}>
            <Text tone="soft" size="sm">{tDyn(`contract.${active.baseId}.story`, active.params)}</Text>
          </div>
          {hasHint && (
            <Text tone="warn" size="sm" layout={{ marginTop: 4 }}>
              {t('ui.task.hint', { text: tDyn(hintKey) })}
            </Text>
          )}
          {active.phase === 'design' && hasBlueprint && (
            <>
              <Button variant="secondary" layout={{ marginTop: 6 }} onClick={() => setBlueprintError(useBlueprint())}>
                {t('ui.blueprint.use')}
              </Button>
              {blueprintError && <Text tone="warn" size="sm" layout={{ marginTop: 4 }}>{tDyn(`ui.error.${blueprintError}`)}</Text>}
            </>
          )}
          <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0 }}>
            {goals.map((g, i) => {
              // × は失敗した機器を選び、機器の画面を開く（失敗の機器がないものは押せない）
              const icon = <Icon name={g.ok === false ? 'icon/close' : 'icon/ok'} scale={1} />;
              return (
                <li key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'flex-start', marginTop: 4 }}>
                  {g.ok === false && g.node ? (
                    <Button
                      variant="plain"
                      size="bare"
                      label={t('ui.check.open')}
                      title={t('ui.check.open')}
                      layout={{ flexShrink: 0 }}
                      onClick={() => {
                        setTool('select');
                        if (g.node) openWindow('device', g.node);
                      }}
                    >
                      {icon}
                    </Button>
                  ) : (
                    <Text as="span" tone={g.ok === null ? 'faint' : 'normal'} size="sm" layout={{ flexShrink: 0 }}>{icon}</Text>
                  )}
                  <Text as="span" tone={g.ok === true ? 'sub' : 'normal'} size="sm">{g.text}</Text>
                  {traces.some((tr) => tr.goal === i) && (
                    <Button variant="secondary" size="s" layout={{ flexShrink: 0 }} onClick={() => openWindow('frames', String(i))}>
                      {t('ui.frames.goal')}
                    </Button>
                  )}
                  {g.ok === false && g.term && (
                    // 初めて出すとき（この表示の中でも）と、開いたときだけ説明を出す。それ以外は「説明を見る」で開く
                    termsShown.includes(g.term) && !firstShownHere.current.has(g.term) && openTerm !== g.term ? (
                      <Button variant="secondary" size="s" layout={{ flexShrink: 0 }} onClick={() => setOpenTerm(g.term)}>
                        {t('ui.glossary.open')}
                      </Button>
                    ) : (
                      <div style={{ flexBasis: '100%', paddingLeft: 22 }}><Text tone="soft" size="s">{tDyn(`glossary.${g.term}`)}</Text></div>
                    )
                  )}
                </li>
              );
            })}
          </ul>
          {hasTraces && (
            <Button variant="secondary" layout={{ marginTop: 8 }} onClick={() => openWindow('frames', '')}>
              {t('ui.frames.open')}
            </Button>
          )}
          {warnings.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <Text tone="warn" size="sm" bold>{t('ui.check.warnings')}</Text>
              <ul style={{ listStyle: 'none', margin: '2px 0 0', padding: 0 }}>
                {warnings.map((warning, i) => (
                  <li key={`${warning.id}-${warning.a}-${warning.b}-${i}`} style={{ marginTop: 4 }}>
                    <Text as="span" tone="warn" size="sm">{tDyn(`warn.${warning.id}`)}</Text>
                    <Text tone="warn" size="xs">
                      {labelOfUid(useGameStore.getState(), warning.a, active.nodes)} / {labelOfUid(useGameStore.getState(), warning.b, active.nodes)}
                    </Text>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {steps.length > 0 && (
            <>
              <Text size="sm" bold layout={{ marginTop: 8 }}>{t('ui.task.steps')}</Text>
              <ul style={{ listStyle: 'none', margin: '2px 0 0', padding: 0 }}>
                {steps.map((s, i) => (
                  <li key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 4 }}>
                    <Text as="span" tone={s.done ? 'normal' : 'faint'} size="sm" layout={{ flexShrink: 0 }}>
                      <Icon name="icon/ok" scale={1} />
                    </Text>
                    <Text as="span" tone={s.done ? 'sub' : 'normal'} size="sm">{s.text}</Text>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </HudBar>
  );
}
