// 初めての概念の案内（P7）。案件を初めて開いたとき、画面の下に社員の吹き出しで次にやることを1行出し、操作する場所を光らせる。
// 操作は縛らない。条件を満たしたら次の手順へ進み、最後まで行くと案件の案内を終える（guidesDone に入る）。「しまう」は終えず、案件の欄の札から戻せる（guidesHidden に入る）
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePhone } from '../ui/usePhone';
import { guideFirsts, guides } from 'virtual:game-data';
import { lessonEntryOf } from '../sim/lessonCatalog';
import { lessonCatalog } from '../stores/lessonCatalog';
import { deviceCategory } from '../registry/query';
import { t, tDyn } from '../i18n/t';
import { loadSettings } from '../settings/settings';
import { FIRST_PREFIX, guideProgress, nextFirstGuide, resolveRef, START_GUIDE, startGuideDue, type GuideState } from '../sim/guide';
import { MODE_TRAITS } from '../company/company';
import { focusedProject, useGameStore } from '../stores/useGameStore';
import { useUiStore } from '../stores/useUiStore';
import { staffSpriteName } from '../data/schema';
import { Icon } from './Icon';
import { Bubble } from './ui/Bubble';
import { Button } from './ui/Button';
import { TOOL_HINTS } from '../sim/toolHint';
import { termOfStep } from '../network/glossaryOf';
import { Glow } from './ui/Glow';
import { GuideFinger, type Point } from './GuideFinger';
import { mapCommands } from '../game/mapControl';

// 社員の吹き出しに出す用語の文（「名前: 説明」）。名前と説明を組み立てるのは、ここの1か所だけ
const termLine = (id: string): string => tDyn('ui.notice.term', { name: tDyn(`termName.${id}`), text: tDyn(`glossary.${id}`) });

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const sameBox = (a: Box | null, b: Box | null): boolean =>
  a === b || (a !== null && b !== null && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);

// 光らせる枠の、ボタンの外側への出っ張り（画面の px）
const GLOW_OUTSET_PX = 2;

// スマホの吹き出しの上端（HUD と案件の欄の下端の、下の px）。どちらも測れないときは、画面の上の余白を使う
const belowHud = (): number => {
  const bottoms = ['[data-hud]', '[data-task-panel]']
    .map((sel) => document.querySelector(sel))
    .filter((el): el is Element => el !== null)
    .map((el) => el.getBoundingClientRect().bottom);
  return bottoms.length > 0 ? Math.max(...bottoms) + 8 : 8;
};

// 案内（吹き出し・ボタンの強調枠）の重なり順。ウィンドウ（4）・案件の欄（4）・マップの操作（5）より下に置き、開いた画面の操作の邪魔をしない（スマホで吹き出しが窓の上に出ていた）
const GUIDE_Z = 6;

export function Guide() {
  const project = useGameStore(focusedProject);
  const mode = useGameStore((s) => s.mode);
  const activeProjects = useGameStore((s) => s.active);
  const completed = useGameStore((s) => s.completed);
  const officeNodes = useGameStore((s) => s.office.nodes);
  const officeLinks = useGameStore((s) => s.office.links);
  const tool = useGameStore((s) => s.tool);
  const owned = useGameStore((s) => s.owned);
  const check = useGameStore((s) => s.check);
  const windows = useGameStore((s) => s.windows);
  const guidesDone = useGameStore((s) => s.guidesDone);
  const deviceTabs = useUiStore((s) => s.deviceTabs);
  const guidesReplay = useGameStore((s) => s.guidesReplay);
  // 吹き出しの顔の絵の名前。社員の見た目は絵の名前に変換して使う。社員のいないサンドボックスでは既定の見た目で出す
  const staffLook = useGameStore((s) => staffSpriteName(s.staff[0]?.look ?? 'blue'));
  const setGuideTarget = useGameStore((s) => s.setGuideTarget);
  const markGuideDone = useGameStore((s) => s.markGuideDone);
  const guidesHidden = useGameStore((s) => s.guidesHidden);
  const setGuideHidden = useGameStore((s) => s.setGuideHidden);
  const setGuideShelved = useGameStore((s) => s.setGuideShelved);
  // 構成に残らない条件を満たした手順の記録（教材を開いている間だけ）
  const guideSeen = useGameStore((s) => s.guideSeen);
  const markGuideSeen = useGameStore((s) => s.markGuideSeen);
  // 吹き出しに出す用語（手順・設定の欄・失敗の理由で初めて出るもの）
  const termNotice = useGameStore((s) => s.termNotice);
  const introduceTerm = useGameStore((s) => s.introduceTerm);
  // 道具と合わない操作のあとの一言（案内の手順を出していないときだけ出す）
  const toolHint = useGameStore((s) => s.toolHint);
  const closeToolHint = useGameStore((s) => s.closeToolHint);
  const setGuideShowing = useGameStore((s) => s.setGuideShowing);
  const closeTermNotice = useGameStore((s) => s.closeTermNotice);
  // デバッグの「この手順から始める」（N54）: 指定の手順から出す。受け取ったら一度だけ使う
  const debugGuide = useGameStore((s) => s.debugGuide);
  const debugConsumeGuide = useGameStore((s) => s.debugConsumeGuide);
  // 光らせるツールバーのボタンの位置（画面の座標）
  const [glow, setGlow] = useState<Box | null>(null);
  // PC の吹き出しの下端（画面の下からの px）。ツールバーと、その上に浮いた欄の上端の8px上に置く（N106）
  const [desktopBottom, setDesktopBottom] = useState<number | null>(null);
  const measureDesktop = useCallback(() => {
    const scale = loadSettings().uiScale || 1;
    const tops = ['[data-toolbar]', '[data-toolbar-popup]']
      .flatMap((sel) => Array.from(document.querySelectorAll(sel)))
      .map((el) => el.getBoundingClientRect().top)
      .filter((top) => top > 0);
    // 画面の拡大（zoom）で、指定の px も拡大されるため、拡大率で割って指定する
    const next = (tops.length > 0 ? window.innerHeight - Math.min(...tops) + 8 : 8) / scale;
    setDesktopBottom((prev) => (prev === next ? prev : next));
  }, []);
  useLayoutEffect(() => {
    if (!phone) measureDesktop();
  });
  useEffect(() => {
    window.addEventListener('resize', measureDesktop);
    return () => window.removeEventListener('resize', measureDesktop);
  }, [measureDesktop]);
  const phone = usePhone();
  // 横にスクロールするツールバーで、光らせるボタンを見える位置へ寄せたときの対象（同じ手順で何度も寄せないため）
  const scrolledFor = useRef<string | null>(null);

  // 設計中の案件の、まだ終えていない案内だけを出す。案内を出さない設定のときは出さない
  // 教材を開いているとき（案件がない）は、教材の手順を出す。教材は何度でもやり直せるため guidesDone に入れず、sandboxLesson.done に覚える。しまった状態は教材も guidesHidden（lesson:<id>）
  const sandboxLesson = useGameStore((s) => s.sandboxLesson);
  const lessonCommands = useGameStore((s) => s.lessonCommands);
  const lessonAnswers = useGameStore((s) => s.lessonAnswers);
  const finishLessonGuide = useGameStore((s) => s.finishLessonGuide);
  const lesson = project === null && sandboxLesson !== null && !sandboxLesson.done ? lessonEntryOf(lessonCatalog, sandboxLesson.id) : undefined;
  // 新しく始めた直後の案内（案件に属さない）。自社オフィスにいて、受注中の案件がないときに出す。受注して設計に入ったら案件の案内に替わるが、終えたかの判定は続ける
  const settings = loadSettings();
  const startDue = settings.guide && startGuideDue({ offers: MODE_TRAITS[mode].offers, guidesDone, deviceDone: settings.startGuideDone, completed });
  const startSteps = startDue ? guides[START_GUIDE] : null;
  const showStart = startDue && lesson === undefined && project === null && activeProjects.length === 0;
  const contractId = lesson ? `lesson:${lesson.id}` : project?.phase === 'design' ? project.baseId : showStart ? START_GUIDE : null;
  const contractSteps = lesson
    ? loadSettings().guide
      ? lesson.guide.map((s, i) => ({ key: `lesson.${lesson.id}.step.${i + 1}`, target: s.target, done: s.done }))
      : null
    : contractId === START_GUIDE
      ? startSteps
      : contractId !== null && (!guidesDone.includes(contractId) || guidesReplay.includes(contractId)) && loadSettings().guide
        ? (guides[contractId] ?? null)
        : null;
  const lessonGoals = lesson && check !== null && check.projectId === 'hq' ? check.goals.map((g) => g.ok) : [];

  const nodes = project ? project.nodes : officeNodes;
  const links = project ? project.links : officeLinks;
  const state: GuideState = {
    tool,
    nodes,
    links,
    owned,
    testPassed: project !== null && check !== null && check.projectId === project.id && check.goals.length > 0 && check.goals.every((g) => g.ok),
    openRefs: windows.filter((w) => w.kind === 'device').flatMap((w) => w.tabs),
    deviceTabs,
    categoryOf: deviceCategory,
    commands: lessonCommands,
    framesOpened: windows.some((w) => w.kind === 'frames'),
    sequenceOpened: windows.some((w) => w.kind === 'sequence'),
    windowKinds: windows.map((w) => w.kind),
    acceptedIds: [...activeProjects.map((p) => p.baseId), ...completed],
    lessonGoals,
    answers: lessonAnswers,
  };

  // 初めての出会いの案内（N175）。依頼が届く遊び方で、案件・教材の案内を出していないときに、出す条件を初めて満たしたものを1つ出す。
  // 出し始めたら、条件が外れても終えるまで出す（窓を閉じても消えない）。終えたら guidesDone に入り、次に満たしたものを出す
  const [firstOn, setFirstOn] = useState<string | null>(null);
  const firstsAllowed = settings.guide && MODE_TRAITS[mode].offers && lesson === undefined && contractSteps === null;
  const firstDue = firstsAllowed && firstOn === null ? nextFirstGuide(guideFirsts, guidesDone, state) : null;
  useEffect(() => {
    if (firstDue !== null) setFirstOn(firstDue);
  }, [firstDue]);
  useEffect(() => {
    if (firstOn !== null && guidesDone.includes(firstOn)) setFirstOn(null);
  }, [firstOn, guidesDone]);
  const firstLive = firstsAllowed && firstOn !== null && !guidesDone.includes(firstOn) ? firstOn : null;
  const id = firstLive ?? contractId;
  const steps = firstLive !== null ? guides[firstLive] : contractSteps;

  // デバッグの指定の手順（N54）は、表示の計算に直接使う（効果で上書きすると、下の効果が古い値に戻すため）
  const debugStart = debugGuide !== null && debugGuide.id === id ? debugGuide.step - 1 : null;
  const seen = id === null ? [] : guideSeen.filter((k) => k.startsWith(`${id}:`)).map((k) => Number(k.slice(id.length + 1)));
  const startSeen = guideSeen.filter((k) => k.startsWith(`${START_GUIDE}:`)).map((k) => Number(k.slice(START_GUIDE.length + 1)));
  const startProgress = startSteps ? guideProgress(startSteps, state, startSeen) : null;
  const progress = id === START_GUIDE ? startProgress : steps ? guideProgress(steps, state, seen, debugStart ?? 0) : null;
  const current = progress ? progress.current : null;
  const finished = steps !== null && current === null;
  const latchKeys = id !== null && progress ? progress.latch.map((i) => `${id}:${i}`) : [];

  // 構成に残らない条件を満たした手順を記録する。すべて終えたら案件の案内を終える
  useEffect(() => {
    if (id === null || steps === null || id === START_GUIDE) return;
    if (latchKeys.length > 0) markGuideSeen(latchKeys);
    if (finished) {
      if (lesson) finishLessonGuide();
      else markGuideDone(id);
      // 案内を終えたら、デバッグの開始の指定も消す（別の案件の案内に残さない）
      if (debugGuide !== null && debugGuide.id === id) debugConsumeGuide();
    }
  }, [id, steps, finished, latchKeys.join(','), markGuideSeen, markGuideDone, lesson, finishLessonGuide, debugGuide, debugConsumeGuide]);

  // 新しく始めた直後の案内は、受注して案件の案内に替わっても、手順の記録と終えたかの判定を続ける（終えたら、この端末にも覚える）
  const startLatchKeys = startProgress ? startProgress.latch.map((i) => `${START_GUIDE}:${i}`) : [];
  const startFinished = startProgress !== null && startProgress.current === null;
  useEffect(() => {
    if (startProgress === null) return;
    if (startLatchKeys.length > 0) markGuideSeen(startLatchKeys);
    if (startFinished) markGuideDone(START_GUIDE);
  }, [startProgress === null, startFinished, startLatchKeys.join(','), markGuideSeen, markGuideDone]);

  const hidden = id !== null && guidesHidden.includes(id);
  // しまっている間は、吹き出し・光る枠・機器の強調を出さない（手順の進みは続く）
  const step = current && !hidden ? current.step : null;
  const shelvedKey = current && hidden ? current.step.key : null;
  const hint = step === null && toolHint !== null ? TOOL_HINTS[toolHint] : null;
  // 案内の手順を出している間は、道具の一言を出さず、出ていた一言も下げる
  useEffect(() => {
    setGuideShowing(step !== null);
    if (step !== null) closeToolHint();
  }, [step !== null, setGuideShowing, closeToolHint]);
  useEffect(() => () => setGuideShowing(false), [setGuideShowing]);
  useEffect(() => {
    setGuideShelved(id !== null && shelvedKey !== null ? { id, key: shelvedKey } : null);
  }, [id, shelvedKey, setGuideShelved]);
  useEffect(() => () => setGuideShelved(null), [setGuideShelved]);
  // 手順が変わったら、前の用語を下げ、その手順で初めて出る用語があれば出す
  const stepKey = step === null ? null : step.key;
  useEffect(() => {
    if (stepKey === null) return;
    closeTermNotice();
    const term = termOfStep(stepKey);
    if (term !== null) introduceTerm(term);
  }, [stepKey, closeTermNotice, introduceTerm]);
  // 対象が機器（案件の機器の ref）なら、マップの機器を光らせるため、ストアに置く（描画は行わない）
  // 対象の @<カテゴリ> は、そのカテゴリの最初の機器（プレイヤーが置く機器は ref が決まらないため）。まだなければ、そのまま返す
  const refOf = (target: string): string => resolveRef(target, nodes, deviceCategory);
  const stepRef = step === null ? null : refOf(step.target);
  // 詰まったときの手助け（N166）。テストで不合格になったら、止まった機器を先に指す。押したら、いまの手順の指に戻す
  const failCheck = step !== null && project !== null && check !== null && check.projectId === project.id && check.goals.some((g) => !g.ok) ? check : null;
  const failNode = failCheck === null ? null : (failCheck.goals.flatMap((g) => g.failures).find((f) => nodes.some((n) => n.uid === f.node))?.node ?? null);
  const [failAck, setFailAck] = useState<object | null>(null);
  const showFail = failNode !== null && failAck !== failCheck;
  // なぞる手順で、指した2台と違う機器どうしをつないだら、元に戻すのボタンを指す。押したら消す
  const [undoHint, setUndoHint] = useState(false);
  const dragStep = useRef<{ from: string; to: string } | null>(null);
  const linkCount = useRef(links.length);
  useEffect(() => {
    const prev = linkCount.current;
    linkCount.current = links.length;
    const drag = dragStep.current;
    if (drag === null || links.length <= prev) return;
    const added = links[links.length - 1];
    const ends = [added.a.node, added.b.node];
    if (!(ends.includes(drag.from) && ends.includes(drag.to))) setUndoHint(true);
  }, [links]);
  useEffect(() => {
    dragStep.current = step !== null && step.gesture === 'drag' && step.to !== undefined ? { from: refOf(step.target), to: refOf(step.to) } : null;
  });
  useEffect(() => {
    if (!showFail && !undoHint) return;
    const ack = () => {
      setFailAck(failCheck);
      setUndoHint(false);
    };
    window.addEventListener('pointerdown', ack, true);
    return () => window.removeEventListener('pointerdown', ack, true);
  }, [showFail, undoHint, failCheck]);
  const deviceTarget = showFail ? failNode : stepRef !== null && nodes.some((n) => n.uid === stepRef) ? stepRef : null;
  useEffect(() => {
    setGuideTarget(deviceTarget);
  }, [deviceTarget, setGuideTarget]);
  useEffect(() => () => setGuideTarget(null), [setGuideTarget]);

  // 対象がツールバーのボタン（data-guide の名前）なら、その位置を測って枠を重ねる。画面の大きさが変わったら測り直す
  const glowName = step !== null ? (deviceTarget === null ? (undoHint ? 'undo' : stepRef) : null) : hint !== null ? hint.target : null;
  // 対象のボタンの位置を測って枠に入れる（画面の px のまま。同じ位置なら状態を変えない）
  const measureGlow = useCallback(() => {
    if (glowName === null) return;
    const el = document.querySelector(`[data-guide="${glowName}"]`);
    const r = el ? el.getBoundingClientRect() : null;
    const next = r && r.width > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
    setGlow((prev) => (sameBox(prev, next) ? prev : next));
  }, [glowName]);

  useLayoutEffect(() => {
    if (glowName === null) {
      scrolledFor.current = null;
      setGlow(null);
      return;
    }
    // 狭い画面で、横にスクロールする外に対象があるときは、一度だけ見える位置へ寄せる
    if (phone && scrolledFor.current !== glowName) {
      const el = document.querySelector(`[data-guide="${glowName}"]`);
      if (el) {
        scrolledFor.current = glowName;
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }
    measureGlow();
  });

  // 枠の位置は、ツールバーの並びや大きさが変わったとき・画面の大きさやスクロールが変わったときに測り直す（描画の前に1回にまとめる）
  useEffect(() => {
    if (glowName === null) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measureGlow);
    };
    const target = document.querySelector(`[data-guide="${glowName}"]`);
    const bar = document.querySelector('[data-toolbar]');
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    if (target) observer?.observe(target);
    if (bar) observer?.observe(bar);
    window.addEventListener('resize', schedule);
    // 横にスクロールすると、枠の位置もずれるため、スクロールのたびに測り直す
    window.addEventListener('scroll', schedule, true);
    // 窓の中のボタン（受注など）は、窓の位置や中身の高さが変わっても枠が追えるように、一定の間隔でも測り直す
    const timer = window.setInterval(measureGlow, 200);
    return () => {
      window.clearInterval(timer);
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [glowName, measureGlow]);

  // 指を出す位置（画面の px）。機器（ポートの指定 pc_a:0 は機器の位置）はマップのマスの中心、ほかは data-guide の部品の中心
  const [finger, setFinger] = useState<{ of: string; from: Point; to: Point | null } | null>(null);
  const fingerFrom = step === null ? null : showFail ? failNode : undoHint ? 'undo' : step.target;
  const fingerTo = step === null || showFail || undoHint ? null : (step.to ?? null);
  const fingerGesture = showFail || undoHint ? 'tap' : (step?.gesture ?? 'tap');
  // 測った位置がいまの手順の対象のものか（手順が替わった直後の、前の手順の位置で描かないため）
  const fingerOf = `${fingerFrom}>${fingerTo ?? ''}`;
  useEffect(() => {
    if (fingerFrom === null) {
      setFinger(null);
      return;
    }
    const pointOf = (target: string): Point | null => {
      const node = nodes.find((n) => n.uid === refOf(target).split(':')[0]);
      const r = node ? mapCommands.tileRect(node.x, node.y) : (document.querySelector(`[data-guide="${refOf(target)}"]`)?.getBoundingClientRect() ?? null);
      return r && r.width > 0 ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null;
    };
    const same = (a: Point | null, b: Point | null) => a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y);
    const measure = () => {
      const from = pointOf(fingerFrom);
      const to = fingerTo === null ? null : pointOf(fingerTo);
      // 終点が測れない drag は、指を出さない
      const next = from === null || (fingerTo !== null && to === null) ? null : { of: `${fingerFrom}>${fingerTo ?? ''}`, from, to };
      setFinger((prev) => (prev === next || (prev !== null && next !== null && prev.of === next.of && same(prev.from, next.from) && same(prev.to, next.to)) ? prev : next));
    };
    measure();
    // マップを動かしたり窓を動かしたりしても追えるように、一定の間隔で測り直す
    const timer = window.setInterval(measure, 200);
    return () => window.clearInterval(timer);
  }, [fingerFrom, fingerTo, nodes]);

  if (step === null && termNotice === null && hint === null) return null;
  const skip = () => {
    closeTermNotice();
    closeToolHint();
    if (step === null || id === null) return;
    // 初めての出会いの案内は、閉じたら終えたものにする（戻す札を残さない）
    if (id.startsWith(FIRST_PREFIX)) markGuideDone(id);
    else setGuideHidden(id, true);
  };
  // スマホの吹き出しは、HUD と案件の欄の下に置く（ツールバー・インベントリ・シートの操作の欄とは重ならない）
  const topBelowHud = phone ? belowHud() : 0;

  return (
    <>
      {glow && (
        // ボタンの外側に GLOW_OUTSET_PX（画面の px。この枠は UI の大きさの zoom の外にあるので換算しない）。枠の内側がボタンの外形に接する
        <Glow
          box={{ left: glow.left - GLOW_OUTSET_PX, top: glow.top - GLOW_OUTSET_PX, width: glow.width + GLOW_OUTSET_PX * 2, height: glow.height + GLOW_OUTSET_PX * 2 }}
          zIndex={GUIDE_Z}
        />
      )}
      {step !== null && finger !== null && finger.of === fingerOf && (
        <GuideFinger playKey={`${id}:${step.key}:${fingerOf}`} gesture={fingerGesture} from={finger.from} to={finger.to} zIndex={GUIDE_Z} />
      )}
      <div
        role="status"
        // 外枠は指の操作を通す（下のインベントリ・ツールバー・マップを押せる）。押せる部品（「しまう」）だけが指の操作を受け取る（B2）
        style={
          phone
            ? {
                // HUD と案件の欄の下に置く。ツールバーやインベントリの欄とは重ならない
                position: 'fixed',
                left: '50%',
                top: topBelowHud,
                pointerEvents: 'none',
                transform: 'translateX(-50%)',
                // 幅は画面の左右に 12 px ずつ余白を残す（吹き出しの中の文字が細かく折り返さないため）
                width: 'calc((100vw - 24px) / var(--ui-scale, 1))',
                zIndex: GUIDE_Z,
                zoom: 'var(--ui-scale, 1)',
              }
            : {
                position: 'fixed',
                left: '50%',
                bottom: desktopBottom ?? 'calc(72px * var(--ui-scale, 1))',
                transform: 'translateX(-50%)',
                pointerEvents: 'none',
                zIndex: GUIDE_Z,
                zoom: 'var(--ui-scale, 1)',
              }
        }
      >
        <Bubble wrap={phone}>
          {/* 狭い画面では、社員の絵と「しまう」は縮めず、文字の欄が残りの幅を使う */}
          {phone ? (
            <span style={{ flexShrink: 0, display: 'flex' }}>
              <Icon name={`staff/${staffLook}_0`} scale={2} />
            </span>
          ) : (
            <Icon name={`staff/${staffLook}_0`} scale={2} />
          )}
          <span style={phone ? { flex: 1, minWidth: 0 } : undefined}>
            {step !== null && tDyn(step.key)}
            {hint !== null && tDyn(hint.key)}
            {/* 案内の文の後に、用語の短い説明を1つだけ出す */}
            {termNotice !== null && <div style={{ marginTop: 2 }}>{termLine(termNotice)}</div>}
          </span>
          {/* 外枠は指の操作を通すため、押せる部分だけ受け取る */}
          <span style={{ pointerEvents: 'auto', flexShrink: 0, display: 'flex', gap: 4 }}>
            {/* 見せるだけの手順（next:）は、「次へ」で進める */}
            {step !== null && id !== null && current !== null && step.done.startsWith('next:') && (
              <Button variant="primary" size="fit" onClick={() => markGuideSeen([`${id}:${current.index}`])}>
                {t('ui.guide.forward')}
              </Button>
            )}
            <Button variant="secondary" size="fit" onClick={skip}>
              {step !== null ? t('ui.guide.skip') : t('ui.notice.close')}
            </Button>
          </span>
        </Bubble>
      </div>
    </>
  );
}
