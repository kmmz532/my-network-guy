// 画面下のツールバー。道具（選択・配線・撤去）・依頼・機材・施工をアイコンで操作する。キーは input/keymap.ts の表から受け取る
import { Fragment, useEffect, useState } from 'react';
import { balance, shop } from 'virtual:game-data';
import type { LangKey } from '../generated/lang-keys';
import { t, tDyn } from '../i18n/t';
import { minutesPerDay } from '../sim/clock';
import { isOnShift } from '../sim/shift';
import { isUnlocked, type ItemDefs } from '../sim/shop';
import { levelOf } from '../sim/level';

// 店の解放の判定に使う定義（品目の解放のレベル）
const shopItemDefs: ItemDefs = { devices: devicesById, furniture: furnitureById, cables: cablesById };
import { historyKeyOf } from '../sim/history';
import { inventoryItems, inventoryMode, type InventoryItem } from '../sim/inventory';
import { balance as catalogBalance } from 'virtual:game-data';
import { cablesById, devicesById, furnitureById } from '../registry/query';
import { projectCostOf } from '../sim/project';

import { focusedProject, useGameStore, type Tool } from '../stores/useGameStore';
import { tipText } from '../input/keymap';
import { Icon } from './Icon';
import { Tooltip } from './Tooltip';
import { IconButton } from './ui/IconButton';
import { Divider } from './ui/Divider';
import { Button } from './ui/Button';
import { HudBar } from './ui/HudBar';
import { GuideRestore } from './GuideRestore';
import { START_GUIDE } from '../sim/guide';
import { ProgressBar } from './ui/ProgressBar';
import { Text } from './ui/Text';
import { Inventory, inventoryCatalog } from './Inventory';
import { usePhone } from '../ui/usePhone';
import { useUiStore } from '../stores/useUiStore';
import { setInventoryOpen, useInventoryOpen } from '../ui/inventoryOpen';
import { cableDef } from '../registry/query';

const bar = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  padding: '6px 12px',
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
  zoom: 'var(--ui-scale, 1)',
} as const;

// 狭い画面（スマホの縦持ち）では、ツールバーを1段のまま横にスクロールする。ケーブルの種類の欄は、スクロールで切れないように行の上に出す
const barPhone = {
  ...bar,
  flexWrap: 'nowrap',
  flexDirection: 'column',
  alignItems: 'stretch',
  padding: '6px 8px',
  gap: 0,
} as const;

const scrollerPhone = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  overflowX: 'auto',
  overflowY: 'hidden',
  flexWrap: 'nowrap',
  scrollbarWidth: 'thin',
} as const;

// PC では行を作らず、子の部品を従来どおり footer の並びに置く
const scrollerDesktop = { display: 'contents' } as const;

// 道具の一覧（左端に並べる順）。action は input/keymap.ts の動作の識別子（押すキーの表示に使う）
const TOOLS: { id: Tool; name: LangKey; action: string; icon: string }[] = [
  { id: 'select', name: 'ui.tool.select', action: 'tool.select', icon: 'icon/cursor' },
  { id: 'wire', name: 'ui.tool.wire', action: 'tool.wire', icon: 'icon/wire' },
  { id: 'remove', name: 'ui.tool.remove', action: 'tool.remove', icon: 'icon/trash' },
];

export function Toolbar() {
  // 依頼とショップは、マップの操作を止めないウィンドウで開く（N40）
  const onOffers = () => useGameStore.getState().toggleWindow('offers', '');
  const onShop = () => useGameStore.getState().toggleWindow('shop', '');
  // 雇用の画面を開く（閉じる）。候補がいなくても開ける（社員のタブがあるため）
  const onHire = () => useUiStore.getState().toggleHiring();
  const hiringOpen = useUiStore((s) => s.hiring !== null);
  const inventoryOpen = useInventoryOpen();
  const offers = useGameStore((s) => s.offers);
  // サンドボックスは案件・依頼がなく、テストと設計の操作だけを出す
  const sandbox = useGameStore((s) => s.mode) === 'sandbox';
  const active = useGameStore(focusedProject);
  // 施工は勤務時間内にしか進まない。勤務時間外は棒を灰色にして、再開の時刻を出す
  const clockMinute = useGameStore((s) => s.clock.minute);
  // 勤務中の社員がいるか（夜勤を含む）。いなければ施工は進まない（N48）
  const staffList = useGameStore((s) => s.staff);
  const workingNow = staffList.some((m) => isOnShift(clockMinute % minutesPerDay, m.shift, balance));
  const companyExpNow = useGameStore((s) => s.companyExp);
  const owned = useGameStore((s) => s.owned);
  const placing = useGameStore((s) => s.placing);
  const tool = useGameStore((s) => s.tool);
  const wireCable = useGameStore((s) => s.wireCable);
  const setTool = useGameStore((s) => s.setTool);
  const setPlacing = useGameStore((s) => s.setPlacing);
  const setWireCable = useGameStore((s) => s.setWireCable);
  const requestBuild = useGameStore((s) => s.requestBuild);
  const abandon = useGameStore((s) => s.abandon);
  const showIp = useGameStore((s) => s.showIp);
  const setShowIp = useGameStore((s) => s.setShowIp);
  const test = useGameStore((s) => s.test);
  const testNudge = useGameStore((s) => s.testNudge);
  const undo = useGameStore((s) => s.undo);
  const redo = useGameStore((s) => s.redo);
  // 戻せる・やり直せる操作があるか（ないときは薄く出す）
  const canUndo = useGameStore((s) => (s.histories[historyKeyOf(focusedProject(s))]?.past.length ?? 0) > 0);
  const canRedo = useGameStore((s) => (s.histories[historyKeyOf(focusedProject(s))]?.future.length ?? 0) > 0);
  // 資金か在庫が足りず戻せなかったときの理由（次に成功する操作まで出す）
  const historyError = useGameStore((s) => s.historyError);
  // テストのボタンは、施工を断られたときに1秒光らせる
  const [testLit, setTestLit] = useState(false);
  useEffect(() => {
    if (!testNudge) return;
    setTestLit(true);
    const id = window.setTimeout(() => setTestLit(false), 1000);
    return () => window.clearTimeout(id);
  }, [testNudge]);

  const showcase = useGameStore((s) => s.showcase);
  const unlocked = shop.filter((item) => isUnlocked(item, levelOf(companyExpNow, catalogBalance), shopItemDefs, sandbox));
  const cableIds = unlocked.filter((i) => i.cable).map((i) => i.cable!);
  const design = active?.phase === 'design';
  const yen = (n: number) => n.toLocaleString('ja-JP');
  const phone = usePhone();
  // スマホの横スクロールの行では、ボタンが縮まないようにする
  const shrink0 = phone ? ({ flexShrink: 0 } as const) : undefined;
  // IPアドレスの表示の切り替え。設計中は施工のボタンの左、それ以外は右端に出す
  const ipButton = (
    <IconButton label={t('ui.showIp')} tip={tipText('ui.showIp', 'showIp', !phone)} selected={showIp} layout={shrink0} onClick={() => setShowIp(!showIp)}>
      <Text as="span" size="sm" bold>IP</Text>
    </IconButton>
  );
  // 元に戻す・やり直す。設計中は施工のボタンの左、自社オフィスでは IP の表示の左に出す
  const historyButtons = (
    <>
      {historyError && (
        <Text as="span" size="sm" tone="error" layout={{ maxWidth: 320 }}>{tDyn(`ui.error.${historyError}`)}</Text>
      )}
      <IconButton label={t('keys.undo')} tip={tipText('keys.undo', 'undo', !phone)} disabled={!canUndo} onClick={() => undo()}>
        <Icon name="icon/undo" />
      </IconButton>
      <IconButton label={t('keys.redo')} tip={tipText('keys.redo', 'redo', !phone)} disabled={!canRedo} onClick={() => redo()}>
        <Icon name="icon/redo" />
      </IconButton>
    </>
  );
  // インベントリの在庫の合計（機材と家具の個数の和）
  const stockTotal = Object.values(owned).reduce((sum, n) => sum + n, 0);
  const mode = inventoryMode(active?.phase ?? null, showcase !== null);
  const inventoryItemList = inventoryItems(mode, owned, inventoryCatalog, sandbox);
  const inventoryOpenable = mode !== 'closed';

  // 品目を選ぶと配置に入る。同じ品目をもう一度押すと配置を終えて欄を閉じる
  const pickInventoryItem = (item: InventoryItem) => {
    setTool('select');
    if (placing === item.id) {
      setPlacing(null);
      setInventoryOpen(false);
    } else {
      setPlacing(item.id);
    }
  };

  // スマホのインベントリの帯を閉じる（配置の途中では閉じない。置き終わるまで帯を開けておく）。パソコンのウィンドウは、ほかのボタンを押しても閉じない
  const closeInventory = () => {
    if (phone && placing === null) setInventoryOpen(false);
  };

  // ケーブルの種類の欄。PC は配線のボタンの上に浮かせ、狭い画面は行の上に出す（スクロールで切れないように）
  const cablePopup = (
    <HudBar
      as="div"
      variant="tray"
      // ツールバーの上に浮く欄の印（案内の吹き出しの位置を測るため・N106）
      marker="toolbar-popup"
      arrange={{
        position: phone ? 'static' : 'absolute',
        left: 0,
        bottom: phone ? undefined : '100%',
        marginBottom: 6,
        alignSelf: 'flex-start',
        display: 'flex',
        gap: 4,
        padding: 4,
        whiteSpace: 'nowrap',
      }}
    >
      {cableIds.map((id) => {
        const cable = cableDef(id);
        const name = tDyn(`cable.${id}.name`);
        // 値段は、ボタンの文字には出さず、ツールチップの2行目に出す
        const price = t('ui.cable.price', { link: yen(cable.pricePerLink), tile: yen(cable.pricePerTile) });
        return (
          <IconButton key={id} label={name} tip={sandbox ? name : `${name}\n${price}`} selected={wireCable === id} layout={{ width: 36, maxHeight: 36, ...shrink0 }} onClick={() => setWireCable(id)}>
            <Icon name={`icon/cable_${id}`} scale={1} />
          </IconButton>
        );
      })}
    </HudBar>
  );
  const showCables = tool === 'wire' && cableIds.length > 0;
  // 新しく始めた直後の案内を閉じているとき、依頼のボタンの上に戻す札を出す（案件の欄がないため）。PC はボタンの上に浮かせ、狭い画面は行の上に出す
  const startShelved = useGameStore((s) => s.guideShelved?.id === START_GUIDE);
  const startRestore = startShelved && (
    <HudBar
      as="div"
      variant="tray"
      arrange={{ position: phone ? 'static' : 'absolute', left: 0, bottom: phone ? undefined : '100%', marginBottom: 6, alignSelf: 'flex-start', display: 'flex', alignItems: 'center', paddingRight: 4, whiteSpace: 'nowrap' }}
    >
      <GuideRestore />
    </HudBar>
  );

  // スマホは場面ごとに中身を替え、1段に収める（横スクロールしない）。
  // IP の表示は設定画面で切り替える。戻す・やり直すは、地図の右下の拡大・縮小のボタンの上に置く（MapZoomButtons.tsx）。予算・やめる・施工の進み具合はバーの上の帯に出す
  if (phone) {
    const strip = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } as const;
    const gap = <span style={{ width: 6, flexShrink: 0 }} />;
    return (
      <>
      <HudBar as="footer" variant="bottom" arrange={barPhone} marker="toolbar">
        {showCables && cablePopup}
        {startRestore}
        {design && (
          <div style={strip}>
            <Icon name="icon/budget" /> <Text as="span" size="sm">{yen(projectCostOf(active).total)} / {yen(active.contract.budget)}</Text>
            <span style={{ marginLeft: 'auto', display: 'flex' }}>
              <IconButton label={t('ui.project.abandon')} layout={{ width: 32, maxHeight: 32, ...shrink0 }} onClick={() => { closeInventory(); abandon(); }}>
                <Icon name="icon/close" />
              </IconButton>
            </span>
          </div>
        )}
        {active?.phase === 'build' && (
          <div style={strip}>
            <Icon name="icon/hammer" />
            <ProgressBar size="m" fraction={active.total ? Math.min(1, active.progress / active.total) : 0} color={workingNow ? 'var(--accent)' : 'var(--fg-disabled)'} layout={{ flex: 1 }} />
            {!workingNow && <span style={{ whiteSpace: 'nowrap' }}><Text as="span" size="sm">{t('ui.build.offHours', { hour: balance.build.workStartHour })}</Text></span>}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {TOOLS.map((item) => (
            <IconButton key={item.id} label={t(item.name)} guide={`tool.${item.id}`} selected={tool === item.id} layout={{ flexShrink: 0 }} onClick={() => { setTool(item.id); closeInventory(); }}>
              <Icon name={item.icon} />
            </IconButton>
          ))}
          {gap}
          {!sandbox && !design && (
            <IconButton label={t('ui.offer.title')} guide="offers" count={offers.length} layout={shrink0} onClick={() => { closeInventory(); onOffers(); }}>
              <Icon name="icon/mail" />
            </IconButton>
          )}
          <IconButton label={t('ui.shop.title')} guide="shop" layout={{ flexShrink: 0 }} onClick={() => { closeInventory(); onShop(); }}>
            <Icon name="icon/cart" />
          </IconButton>
          {!sandbox && !design && (
            <IconButton label={t('ui.staff.hire')} selected={hiringOpen} layout={shrink0} onClick={() => { closeInventory(); onHire(); }}>
              <Icon name="icon/person" />
            </IconButton>
          )}
          <IconButton label={t('ui.inventory.title')} guide="inventory" selected={inventoryOpen && inventoryOpenable} stock={stockTotal} disabled={!inventoryOpenable} layout={shrink0} onClick={() => setInventoryOpen(!inventoryOpen)}>
            <Icon name="icon/inventory" />
          </IconButton>
          {(design || sandbox) && (
            <>
              {gap}
              <IconButton label={t('ui.test')} guide="test" variant={testLit ? 'primary' : 'accent'} layout={shrink0} onClick={() => { closeInventory(); test(); }}>
                <Icon name="icon/test" />
              </IconButton>
              {design && (
                <IconButton label={t('ui.build')} variant="confirm" unavailable={!active.testedOk} layout={shrink0} onClick={() => { closeInventory(); requestBuild(); }}>
                  <Icon name="icon/hammer" />
                </IconButton>
              )}
            </>
          )}
        </div>
      </HudBar>
      {inventoryOpen && inventoryOpenable && (
        <Inventory items={inventoryItemList} owned={owned} sandbox={sandbox} placing={placing} onPick={pickInventoryItem} onShop={onShop} />
      )}
      </>
    );
  }

  return (
    <>
    <HudBar as="footer" variant="bottom" arrange={bar} marker="toolbar">
      {/* 狭い画面では、ケーブルの欄を行の上に出す */}
      {phone && showCables && cablePopup}
      <div style={phone ? scrollerPhone : scrollerDesktop}>
      {/* 道具は自社オフィスでも案件の設計中でも常に出す。配線の道具を選んだときだけ、ケーブルの種類を配線のボタンの上に浮かせて出す（並びには場所を取らない） */}
      {TOOLS.map((item) => (
        <Fragment key={item.id}>
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <IconButton label={t(item.name)} tip={tipText(item.name, item.action, !phone)} guide={`tool.${item.id}`} selected={tool === item.id} onClick={() => { setTool(item.id); closeInventory(); }}>
              <Icon name={item.icon} />
            </IconButton>
            {item.id === 'wire' && !phone && showCables && cablePopup}
          </span>
        </Fragment>
      ))}
      <Divider layout={{ margin: '0 4px' }} />
      {!sandbox && (
      <span style={{ position: 'relative', display: 'inline-flex' }}>
        <IconButton label={t('ui.offer.title')} tip={tipText('ui.offer.title', 'offers', !phone)} guide="offers" count={offers.length} onClick={() => { closeInventory(); onOffers(); }}>
          <Icon name="icon/mail" />
        </IconButton>
        {!phone && startRestore}
      </span>
      )}
      <IconButton label={t('ui.shop.title')} tip={tipText('ui.shop.title', 'shop', !phone)} guide="shop" onClick={() => { closeInventory(); onShop(); }}>
        <Icon name="icon/cart" />
      </IconButton>
      {!sandbox && (
        <IconButton label={t('ui.staff.hire')} selected={hiringOpen} onClick={() => { closeInventory(); onHire(); }}>
          <Icon name="icon/person" />
        </IconButton>
      )}
      {/* 在庫はインベントリのアイコンにまとめる。品目の一覧はインベントリの欄で開く */}
      <Divider layout={{ margin: '0 4px' }} />
      <IconButton label={t('ui.inventory.title')} tip={tipText('ui.inventory.title', 'inventory', !phone)} guide="inventory" selected={inventoryOpen && inventoryOpenable} stock={stockTotal} disabled={!inventoryOpenable} onClick={() => setInventoryOpen(!inventoryOpen)}>
        <Icon name="icon/inventory" />
      </IconButton>
      {(design || sandbox) && (
        <>
          <Divider layout={{ margin: '0 4px' }} />
          {ipButton}
          <Divider layout={{ margin: '0 4px' }} />
          {/* テストは何度でも押せ、時間も費用もかからない。施工は、テストに合格してからだけ依頼できる（押すと案内を出す） */}
          <Tooltip text={tipText('ui.test', 'test', !phone)}>
            <Button variant="accent" size="wide" pressed={testLit} label={t('ui.test')} guide="test" onClick={() => { closeInventory(); test(); }}>
              <Icon name="icon/test" /> {t('ui.test')}
            </Button>
          </Tooltip>
          {historyButtons}
          {design && (
          <>
          <Tooltip text={tipText('ui.build', 'build', !phone)}>
            <Button variant="confirm" size="wide" unavailable={!active.testedOk} label={t('ui.build')} onClick={() => { closeInventory(); requestBuild(); }}>
              <Icon name="icon/hammer" /> {t('ui.build')}
            </Button>
          </Tooltip>
          <span style={{ marginLeft: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Icon name="icon/budget" /> <Text as="span" size="l">{yen(projectCostOf(active).total)} / {yen(active.contract.budget)}</Text>
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex' }}>
            <IconButton label={t('ui.project.abandon')} layout={{ width: 32 }} onClick={() => { closeInventory(); abandon(); }}>
              <Icon name="icon/close" />
            </IconButton>
          </span>
          </>
          )}
        </>
      )}
      {!design && !sandbox && (
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          {historyButtons}
          {ipButton}
        </span>
      )}
      {active?.phase === 'build' && (
        <>
          <Divider layout={{ margin: '0 4px' }} />
          <Icon name="icon/hammer" />
          <ProgressBar size="m" fraction={active.total ? Math.min(1, active.progress / active.total) : 0} color={workingNow ? 'var(--accent)' : 'var(--fg-disabled)'} layout={{ width: 200 }} />
          {!workingNow && (
            <span style={{ whiteSpace: 'nowrap' }}>
              <Text as="span" size="sm">{t('ui.build.offHours', { hour: balance.build.workStartHour })}</Text>
            </span>
          )}
        </>
      )}
      </div>
    </HudBar>
    {/* パソコンのインベントリはウィンドウ（Windows.tsx の InventoryBody）で出す */}
    </>
  );
}
