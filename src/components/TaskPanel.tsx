// 受注中の案件の内容（タイトル・依頼文・達成条件・ヒント・最初の案件の手順）。左上に重ねて表示し、折りたためる。
// 達成条件は最後のテスト（または検収）の結果で ✓／× を出す。× は失敗した機器を選んで機器の画面を開く
import { labelOfUid } from './nodeLabel';
import { guides } from 'virtual:game-data';
import { deviceCategory } from '../registry/query';
import { guideProgress, type GuideState } from '../sim/guide';
import { hasKey, t, tDyn } from '../i18n/t';
import { goalText } from './goalText';
import { focusedProject, useGameStore } from '../stores/useGameStore';
import { Icon } from './Icon';
import { familiarKeyOf } from '../sim/familiar';
import { usePhone } from '../ui/usePhone';
import { useEffect, useRef, useState } from 'react';
import { GLOSSARY_OF_FAILURE, termOfGoal } from '../network/glossaryOf';
import { lessonEntryOf } from '../sim/lessonCatalog';
import { lessonCatalog } from '../stores/lessonCatalog';
import { DrillPanel, QuestionFlow } from './DrillPanel';
import { sequenceRef } from './SequencePanel';
import { Button } from './ui/Button';
import { GuideRestore } from './GuideRestore';
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
  // 案内の一覧（手順の進みは Guide と同じ判定で求める）
  const guidesDone = useGameStore((s) => s.guidesDone);
  const guidesReplay = useGameStore((s) => s.guidesReplay);
  const guideSeen = useGameStore((s) => s.guideSeen);
  const restartGuide = useGameStore((s) => s.restartGuide);
  const tool = useGameStore((s) => s.tool);
  const owned = useGameStore((s) => s.owned);
  const windows = useGameStore((s) => s.windows);
  const debugGuide = useGameStore((s) => s.debugGuide);
  const lessonCommands = useGameStore((s) => s.lessonCommands);
  const lessonAnswers = useGameStore((s) => s.lessonAnswers);
  const [guideOpen, setGuideOpen] = useState(false);
  // 用語集の行で開いている用語
  const [openGlossary, setOpenGlossary] = useState<string | null>(null);
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
        return { text: goalText(goal, (id) => labelOfUid(useGameStore.getState(), id, active.nodes)), ok: g ? g.ok : null, node: g?.failures[0]?.node ?? null, term: (g?.failures[0] ? GLOSSARY_OF_FAILURE[g.failures[0].reason] : undefined) ?? termOfGoal(goal.type) };
      })
    : [];
  // 用語: 初めて出すときは説明を出し、記録する。2回目からは「用語の説明を見る」で開く
  const termsShown = useGameStore((s) => s.termsShown);
  const introduceTerm = useGameStore((s) => s.introduceTerm);
  const markTermShown = useGameStore((s) => s.markTermShown);
  const [openTerm, setOpenTerm] = useState<string | null>(null);
  const firstShownHere = useRef(new Set<string>());
  const failingTerms = goals.filter((g) => g.ok === false && g.term).map((g) => g.term as string);
  // 用語集の行: 失敗の用語と、吹き出しで一度出した用語（重複は出さない）
  const glossaryTerms = [...new Set([...failingTerms, ...termsShown])];
  // 案内の手順の数と、今の手順の位置（終えた案件は手順の数。満たしていない最初の手順が今の手順）
  const guideSteps = active ? (guides[active.baseId] ?? null) : null;
  const guideCurrent = ((): number | null => {
    if (!active || !guideSteps) return null;
    if (guidesDone.includes(active.baseId) && !guidesReplay.includes(active.baseId)) return guideSteps.length;
    const seen = guideSeen.filter((k) => k.startsWith(`${active.baseId}:`)).map((k) => Number(k.slice(active.baseId.length + 1)));
    const from = debugGuide !== null && debugGuide.id === active.baseId ? debugGuide.step - 1 : 0;
    const state: GuideState = {
      tool,
      nodes: active.nodes,
      links: active.links,
      owned,
      testPassed: result !== null && result.length > 0 && result.every((g) => g.ok),
      openRefs: windows.filter((w) => w.kind === 'device').flatMap((w) => w.tabs),
      categoryOf: deviceCategory,
      commands: lessonCommands,
      framesOpened: windows.some((w) => w.kind === 'frames'),
      sequenceOpened: windows.some((w) => w.kind === 'sequence'),
      lessonGoals: [],
      answers: lessonAnswers,
    };
    const { current } = guideProgress(guideSteps, state, seen, from);
    return current ? current.index : guideSteps.length;
  })();
  useEffect(() => {
    // 吹き出しには、まだ出していない最初の用語だけを出す（残りは案件の欄だけで説明し、記録する）
    let noticed = false;
    for (const term of failingTerms) {
      if (!termsShown.includes(term)) {
        if (noticed) markTermShown(term);
        else introduceTerm(term);
        noticed = true;
      }
      firstShownHere.current.add(term);
    }
    // failingTerms は描画のたびに作り直すため、用語の並びだけで判定する
  }, [failingTerms.join(','), termsShown, introduceTerm, markTermShown]);

  if (!active) {
    const lesson = lessonId === null ? undefined : lessonEntryOf(lessonCatalog, lessonId);
    if (!lesson) return null;
    if (lesson.drill) return <DrillPanel drill={lesson.drill} />;
    // 教材: 案件と同じ欄に、題名・依頼文・達成条件（最後のテストの結果）を出す
    const lessonResult = check && check.projectId === 'hq' ? check.goals : null;
    return (
      <HudBar as="aside" variant="panel" marker="task-panel" arrange={{ width: open ? 260 : 'auto', zIndex: 4, zoom: 'var(--ui-scale, 1)' }}>
        {/* 案件の欄と同じ折りたたみの見出し（教材の題名を出す） */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', minWidth: 0 }}>
          <Button variant="plain" size="row" layout={{ flex: '1 1 auto', minWidth: 0 }} onClick={() => setOpen(!open)}>
            <span style={{ width: 10 }}>{open ? '▾' : '▸'}</span>
            <Icon name="icon/mail" scale={1} />
            {(open || phone) && <span style={phone && !open ? { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : undefined}>{tDyn(lesson.titleKey)}</span>}
          </Button>
          <GuideRestore />
        </div>
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
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', minWidth: 0 }}>
        <Button variant="plain" size="row" layout={{ flex: '1 1 auto', minWidth: 0 }} onClick={() => setOpen(!open)}>
          <span style={{ width: 10 }}>{open ? '▾' : '▸'}</span>
          <Icon name="icon/mail" scale={1} />
          {/* 畳んだときは、狭い画面だけ件名を出す（PC は従来どおり開いたときだけ） */}
          {(open || phone) && (
            <span style={phone && !open ? { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : undefined}>
              {tDyn(`contract.${active.baseId}.title`, active.params)}
            </span>
          )}
        </Button>
        <GuideRestore />
      </div>
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
              const goalTrace = traces.find((tr) => tr.goal === i);
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
                  {goalTrace && (
                    <Button variant="secondary" size="s" layout={{ flexShrink: 0 }} onClick={() => openWindow('sequence', sequenceRef(goalTrace))}>
                      {t('ui.sequence.open')}
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
          {guideSteps !== null && active && (
            <div style={{ marginTop: 8 }}>
              <Button variant="plain" size="row" layout={{ width: '100%' }} onClick={() => setGuideOpen(!guideOpen)}>
                <span style={{ width: 10 }}>{guideOpen ? '▾' : '▸'}</span>
                <Text as="span" size="sm" bold>{t('ui.task.guide')}</Text>
              </Button>
              {guideOpen && (
                <>
                  <ul style={{ listStyle: 'none', margin: '2px 0 0', padding: 0 }}>
                    {guideSteps.map((step, i) => {
                      const doneStep = guideCurrent !== null && i < guideCurrent;
                      const now = guideCurrent === i;
                      return (
                        <li key={step.key} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 4 }}>
                          <Text as="span" tone={doneStep ? 'normal' : 'faint'} size="sm" layout={{ flexShrink: 0 }}>
                            <Icon name="icon/ok" scale={1} />
                          </Text>
                          <Text as="span" tone={doneStep ? 'sub' : 'normal'} size="sm" bold={now}>{tDyn(step.key)}</Text>
                          {now && <Text as="span" tone="warn" size="xs" layout={{ flexShrink: 0 }}>{t('ui.task.guide.now')}</Text>}
                        </li>
                      );
                    })}
                  </ul>
                  <Button variant="secondary" size="s" layout={{ marginTop: 6 }} onClick={() => restartGuide(active.baseId)}>
                    {t('ui.guide.restart')}
                  </Button>
                </>
              )}
            </div>
          )}
          {glossaryTerms.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <Text size="sm" bold>{t('ui.glossary.title')}</Text>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                {glossaryTerms.map((term) => (
                  <Button
                    key={term}
                    variant="secondary"
                    size="s"
                    pressed={openGlossary === term}
                    onClick={() => setOpenGlossary(openGlossary === term ? null : term)}
                  >
                    {tDyn(`termName.${term}`)}
                  </Button>
                ))}
              </div>
              {openGlossary !== null && (
                <div style={{ marginTop: 4, lineHeight: 1.5 }}>
                  <Text tone="soft" size="s">{tDyn(`glossary.${openGlossary}`)}</Text>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </HudBar>
  );
}
