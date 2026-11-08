import { RefObject, useEffect, useState } from "react";
import { useSaveSession } from "../services/saveSession";
import { useUiStore } from "../stores/useUiStore";
import { Icon } from "./Icon";
import { ExpGauge, LevelMark } from "./CompanyPanel";
import { Speed, useGameStore } from "../stores/useGameStore";
import { usePhone } from "../ui/usePhone";
import { t } from "../i18n/t";
import { levelOf } from "../sim/level";
import { balance } from "virtual:game-data";
import { toDate } from "../sim/clock";
import { RADIUS } from '../ui/theme';
import { nextFastSpeed, unlockedSpeedsOf } from "../sim/speed";
import { Tooltip, hideTip } from "./Tooltip";
import { tipText } from "../input/keymap";

// 速さのボタン: 停止・1倍のあとに、早送り（2倍・4倍・8倍。解放済みを押すたびに切り替える・N99）
const SPEEDS: Speed[] = [0, 1];

// 上部の操作（速さ・メニュー・社員）の大きさ。指で押すため、スマホでも 44 px の高さを確保する（M4）
// 上部の操作の見た目。パソコンは文字の幅に合わせた横長で低いボタン。スマホは指で押すため 44 px 以上にする（M4・B11）
const hudButton = (on: boolean, phone: boolean) => ({
    padding: '4px 8px',
    ...(phone ? { minHeight: 28, minWidth: 28 } : {}),
    cursor: 'pointer',
    background: on ? '#ffd866' : '#25406f',
    color: on ? '#3b2a33' : '#f4f1e6',
    border: '1px solid #3b2a33',
    borderRadius: RADIUS.chrome,
  }) as const;

// 自動保存の印（ヘッダーの小さなアイコン）は、この時間で消す
const SAVE_MARK_MS = 1000;

const Header = ({ headerRef }: { headerRef: RefObject<HTMLElement> }) => {

    // 自動保存が終わった時刻から、印を出している間だけ値を持つ
    const savedAt = useSaveSession((s) => s.savedAt);
    const [saveMark, setSaveMark] = useState<number | null>(null);
    useEffect(() => {
        if (savedAt === null) return;
        setSaveMark(savedAt);
        const timer = window.setTimeout(() => setSaveMark(null), SAVE_MARK_MS);
        return () => window.clearTimeout(timer);
    }, [savedAt]);

    const openWindow = useGameStore((s) => s.openWindow);
    const sandbox = useGameStore((s) => s.mode === 'sandbox');
    const phone = usePhone();
    const clock = useGameStore((s) => s.clock);
    const companyExp = useGameStore((s) => s.companyExp);
    const levelNow = levelOf(companyExp, balance);
    const speed = useGameStore((s) => s.speed);
    const setSpeed = useGameStore((s) => s.setSpeed);
    const date = toDate(clock.minute, balance);

      // 勤務時間外に自動で早送りしている間の、元の速さ（「夜は早送り」と出す）
    const nightSpeed = useGameStore((s) => s.nightSpeed);

    return (
        <header
        ref={headerRef}
        data-hud
        style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            padding: phone ? '2px 4px' : '4px 8px',
            background: 'rgba(47, 79, 143, 0.75)',
            color: '#f4f1e6',
            display: 'flex',
            flexWrap: 'nowrap',
            alignItems: 'center',
            gap: phone ? '2px 4px' : 8,
            zoom: 'var(--ui-scale, 1)',
        }}
        >
        {/* 左側: 資金・会社・日付・速度。狭いときは左側の中で折り返し、右側（設定の入口）は上の段に残す */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: phone ? '2px 4px' : 8, flex: '1 1 auto', minWidth: 0 }}>
        {/* お金を押すと、資金の画面を開く（サンドボックスは資金がないため、開かない） */}
        {sandbox ? (
            <span>
            <Icon name="icon/money" scale={1.5} /> ∞
            </span>
        ) : (
            <button
            aria-label={t('ui.funds.open')}
            onClick={() => openWindow('funds', '')}
            style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', font: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
            >
            <Icon name="icon/money" scale={1.5} /> {clock.money.toLocaleString('ja-JP')}
            </button>
        )}
        {!sandbox && (
        <button aria-label={t('ui.company.title')} onClick={() => openWindow('company', '')} style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', font: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* 会社のレベルの印と、今のレベルの中の経験値のゲージ（N66）。押すと自社の情報の画面を開く */}
            <LevelMark level={levelNow} />
            <ExpGauge companyExp={companyExp} width={phone ? 56 : 96} />
        </button>
        )}
        {!sandbox && (
        <span style={{ marginLeft: '8px' }}>
            {/* <Icon name="icon/calendar" scale={1.5} />  */}
            {t('ui.hud.date', { year: date.year, month: date.month, day: date.day })}
        </span>
        )}
        {!sandbox && (
        <span style={{ display: 'flex', gap: 4 }}>
            {SPEEDS.map((s) => (
            <Tooltip text={s === 0 ? tipText('ui.speed.0', 'pause', !phone) : t(`ui.speed.${s}` as const)} key={s}>
                <button aria-label={t(`ui.speed.${s}` as const)} style={{ ...hudButton(speed === s, phone), display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => { hideTip(); setSpeed(s); }}>
                {s === 0 ? (
                <Icon name="icon/pause" scale={1} />
                ) : (
                Array.from({ length: s === 4 ? 3 : s }, (_, i) => <Icon key={i} name="icon/play" scale={1} />)
                )}
                </button>
            </Tooltip>
            ))}
            {/* 早送りは、解放済みの 2倍・4倍・8倍を押すたびに切り替え、今の倍率を出す。1倍のボタンで戻る（N99） */}
            {(() => {
            const unlockedSpeeds = unlockedSpeedsOf(levelNow, balance);
            const shown: Speed = speed >= 2 ? speed : ((unlockedSpeeds.find((x) => x >= 2) ?? 2) as Speed);
            // 押すと変わる倍率（押すたびに解放済みの 2倍・4倍・8倍を回る）。ツールチップに今と次を出す（N130）
            const next = nextFastSpeed(speed, unlockedSpeeds) as Speed;
            const hint = speed >= 2 ? t('ui.speed.hint.next', { now: t(`ui.speed.${speed}` as const), next: t(`ui.speed.${next}` as const) }) : t('ui.speed.hint.up', { next: t(`ui.speed.${shown}` as const) });
            return (
                <Tooltip text={hint}>
                <button aria-label={hint} style={{ ...hudButton(speed >= 2, phone), display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => { hideTip(); setSpeed(next); }}>
                    {Array.from({ length: shown === 2 ? 2 : 3 }, (_, i) => <Icon key={i} name="icon/play" scale={1} />)}
                </button>
                </Tooltip>
            );
            })()}
            <span style={{ fontSize: 12, alignSelf: 'center' }}>{nightSpeed === null ? t(`ui.speed.${speed}`) : t('ui.night.fast')}</span>
        </span>
        )}
        </div>
        {/* 右側: 自動保存の印と、設定（メニュー）の入口。いつも右上に出す */}
        <div style={{ display: 'flex', alignItems: 'center', gap: phone ? '2px 4px' : 8, flexShrink: 0, marginLeft: 'auto', alignSelf: 'flex-start' }}>
        {/* 自動保存の印。文字は出さず、ツールチップだけ */}
        {/* 印を出していないときも場所を空けておく（出し入れでメニューボタンが動かないように） */}
        <Tooltip text={t('ui.autosave.mark')}>
            <span
            role={saveMark !== null ? 'status' : undefined}
            aria-label={saveMark !== null ? t('ui.autosave.mark') : undefined}
            aria-hidden={saveMark === null}
            style={{ display: 'inline-flex', visibility: saveMark !== null ? 'visible' : 'hidden' }}
            >
            <Icon name="icon/save" scale={1} />
            </span>
        </Tooltip>
        <button style={{ ...hudButton(false, phone), display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => useUiStore.getState().setPopup('menu')}>
            <Icon name="icon/menu" scale={1} />
        </button>
        </div>
        </header>
    );
};

export default Header;