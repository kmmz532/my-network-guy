import { RefObject, useEffect, useState } from "react";
import { useSaveSession } from "../services/saveSession";
import { useUiStore } from "../stores/useUiStore";
import { Icon } from "./Icon";
import { ExpGauge, LevelMark } from "./CompanyPanel";
import { Speed, useGameStore } from "../stores/useGameStore";
import { usePhone } from "../ui/usePhone";
import { t, tDyn } from "../i18n/t";
import { levelOf } from "../sim/level";
import { balance } from "virtual:game-data";
import { toDate } from "../sim/clock";
import { nextFastSpeed, unlockedSpeedsOf } from "../sim/speed";
import { Tooltip } from "./Tooltip";
import { tipText } from "../input/keymap";
import { Text } from "./ui/Text";
import { ToolbarButton } from "./ui/ToolbarButton";
import { Button } from "./ui/Button";
import { HudBar } from "./ui/HudBar";

// 速さのボタン: 停止・1倍のあとに、早送り（2倍・4倍・8倍。解放済みを押すたびに切り替える・N99）
const SPEEDS: Speed[] = [0, 1];

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
        <HudBar
        as="header"
        variant="top"
        innerRef={headerRef}
        marker="hud"
        arrange={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            padding: phone ? '2px 4px' : '4px 8px',
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
            <Button variant="plain" size="bare" label={t('ui.funds.open')} onClick={() => openWindow('funds', '')}>
            <Icon name="icon/money" scale={1.5} /> <Text as="span">{clock.money.toLocaleString('ja-JP')}</Text>
            </Button>
        )}
        {!sandbox && (
        <Button variant="plain" size="bare" label={t('ui.company.title')} onClick={() => openWindow('company', '')}>
            {/* 会社のレベルの印と、今のレベルの中の経験値のゲージ（N66）。押すと自社の情報の画面を開く */}
            <LevelMark level={levelNow} />
            <ExpGauge companyExp={companyExp} width={phone ? 56 : 96} />
        </Button>
        )}
        {!sandbox && (
        <Text as="span" size="l" layout={{ marginLeft: '8px' }}>
            {/* <Icon name="icon/calendar" scale={1.5} />  */}
            {t('ui.hud.date', { year: date.year, month: date.month, day: date.day })}
        </Text>
        )}
        {!sandbox && (
        <span style={{ display: 'flex', gap: 4 }}>
            {SPEEDS.map((s) => (
            <ToolbarButton key={s} label={tDyn(`ui.speed.${s}`)} tip={s === 0 ? tipText('ui.speed.0', 'pause', !phone) : tDyn(`ui.speed.${s}`)} on={speed === s} onClick={() => setSpeed(s)}>
                {s === 0 ? (
                <Icon name="icon/pause" scale={1} />
                ) : (
                Array.from({ length: s === 4 ? 3 : s }, (_, i) => <Icon key={i} name="icon/play" scale={1} />)
                )}
            </ToolbarButton>
            ))}
            {/* 早送りは、解放済みの 2倍・4倍・8倍を押すたびに切り替え、今の倍率を出す。1倍のボタンで戻る（N99） */}
            {(() => {
            const unlockedSpeeds = unlockedSpeedsOf(levelNow, balance);
            const shown: Speed = speed >= 2 ? speed : ((unlockedSpeeds.find((x) => x >= 2) ?? 2) as Speed);
            // 押すと変わる倍率（押すたびに解放済みの 2倍・4倍・8倍を回る）。ツールチップに今と次を出す（N130）
            const next = nextFastSpeed(speed, unlockedSpeeds) as Speed;
            const hint = speed >= 2 ? t('ui.speed.hint.next', { now: tDyn(`ui.speed.${speed}`), next: tDyn(`ui.speed.${next}`) }) : t('ui.speed.hint.up', { next: tDyn(`ui.speed.${shown}`) });
            return (
                <ToolbarButton label={hint} on={speed >= 2} onClick={() => setSpeed(next)}>
                    {Array.from({ length: shown === 2 ? 2 : 3 }, (_, i) => <Icon key={i} name="icon/play" scale={1} />)}
                </ToolbarButton>
            );
            })()}
            <Text as="span" size="s" layout={{ alignSelf: 'center' }}>{nightSpeed === null ? tDyn(`ui.speed.${speed}`) : t('ui.night.fast')}</Text>
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
        <ToolbarButton label={t('ui.menu.settings')} onClick={() => useUiStore.getState().setPopup('menu')}>
            <Icon name="icon/menu" scale={1} />
        </ToolbarButton>
        </div>
        </HudBar>
    );
};

export default Header;