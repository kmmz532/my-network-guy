// 画面下のツールバー。道具（選択・配線・撤去）・依頼・機材・施工をアイコンで操作する。キーは input/keymap.ts の表から受け取る
import { Fragment, useEffect, useState } from 'react';
import { balance, cables, shop } from 'virtual:game-data';
import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';
import { isWorkingHour, toDate } from '../sim/clock';
import { isUnlocked } from '../sim/shop';
import { historyKeyOf } from '../sim/history';
import { warehouseItems, warehouseMode, type WarehouseItem } from '../sim/warehouse';
import { focusedProject, useGameStore, type Tool } from '../stores/useGameStore';
import { tipText } from '../input/keymap';
import { Icon } from './Icon';
import { Tooltip } from './Tooltip';
import { Warehouse } from './Warehouse';
import { RADIUS } from '../ui/theme';
import { usePhone } from '../ui/usePhone';

const bar = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  padding: '6px 12px',
  background: 'rgba(47, 79, 143, 0.92)',
  color: '#f4f1e6',
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
  padding: '6px 8px 18px',
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

const slot = (active: boolean) =>
  ({
    width: 44,
    height: 44,
    padding: 2,
    border: `2px solid ${active ? '#ffd866' : '#3b2a33'}`,
    background: active ? '#3a5fa8' : '#25406f',
    borderRadius: RADIUS.chrome,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#f4f1e6',
    fontSize: 18,
    position: 'relative',
  }) as const;

const sep = <span style={{ width: 1, height: 36, background: '#3b2a33', margin: '0 4px' }} />;

// 道具のボタン。選んでいる道具は押し込んだ見た目（内側に影を付け、少し暗くする）
const toolSlot = (active: boolean) =>
  ({
    ...slot(active),
    background: active ? '#1d3664' : '#25406f',
    boxShadow: active ? 'inset 2px 2px 0 rgba(20, 30, 50, 0.7)' : 'none',
  }) as const;

// 道具の一覧（左端に並べる順）。action は input/keymap.ts の動作の識別子（押すキーの表示に使う）
const TOOLS: { id: Tool; name: LangKey; action: string; icon: string }[] = [
  { id: 'select', name: 'ui.tool.select', action: 'tool.select', icon: 'icon/cursor' },
  { id: 'wire', name: 'ui.tool.wire', action: 'tool.wire', icon: 'icon/wire' },
  { id: 'remove', name: 'ui.tool.remove', action: 'tool.remove', icon: 'icon/trash' },
];

export function Toolbar({
  onOffers,
  onShop,
  warehouseOpen,
  setWarehouseOpen,
}: {
  onOffers: () => void;
  onShop: () => void;
  warehouseOpen: boolean;
  setWarehouseOpen: (open: boolean) => void;
}) {
  const offers = useGameStore((s) => s.offers);
  // サンドボックスは案件・依頼がなく、テストと設計の操作だけを出す
  const sandbox = useGameStore((s) => s.mode) === 'sandbox';
  const active = useGameStore(focusedProject);
  // 施工は勤務時間内にしか進まない。勤務時間外は棒を灰色にして、再開の時刻を出す
  const clockMinute = useGameStore((s) => s.clock.minute);
  const workingNow = isWorkingHour(toDate(clockMinute, balance).hour, balance);
  const completed = useGameStore((s) => s.completed);
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
  const unlocked = shop.filter((item) => isUnlocked(item, completed, sandbox));
  const cableIds = unlocked.filter((i) => i.cable).map((i) => i.cable!);
  const design = active?.phase === 'design';
  const yen = (n: number) => n.toLocaleString('ja-JP');
  // IPアドレスの表示の切り替え。設計中は施工のボタンの左、それ以外は右端に出す
  const ipButton = (
    <Tooltip text={tipText('ui.showIp', 'showIp')}><button aria-label={t('ui.showIp')} style={{ ...slot(showIp), width: 'auto', padding: '0 8px', fontSize: 13, fontWeight: 'bold' }}
      
      onClick={() => setShowIp(!showIp)}
    >
      IP
    </button></Tooltip>
  );
  // 元に戻す・やり直す。設計中は施工のボタンの左、自社オフィスでは IP の表示の左に出す
  const historyButtons = (
    <>
      {historyError && (
        <span style={{ fontSize: 13, color: '#ffd3c9', maxWidth: 320 }}>{t(`ui.error.${historyError}` as LangKey)}</span>
      )}
      <Tooltip text={tipText('keys.undo', 'undo')}>
        <button aria-label={t('keys.undo')} style={{ ...slot(false), opacity: canUndo ? 1 : 0.35 }} disabled={!canUndo} onClick={() => undo()}>
          <Icon name="icon/undo" />
        </button>
      </Tooltip>
      <Tooltip text={tipText('keys.redo', 'redo')}>
        <button aria-label={t('keys.redo')} style={{ ...slot(false), opacity: canRedo ? 1 : 0.35 }} disabled={!canRedo} onClick={() => redo()}>
          <Icon name="icon/redo" />
        </button>
      </Tooltip>
    </>
  );
  // 倉庫の在庫の合計（機材と家具の個数の和）
  const stockTotal = Object.values(owned).reduce((sum, n) => sum + n, 0);
  const mode = warehouseMode(active?.phase ?? null, showcase !== null);
  const warehouseItemList = warehouseItems(mode, shop, completed, owned, sandbox);
  const warehouseOpenable = mode !== 'closed';
  const phone = usePhone();

  // 品目を選ぶと配置に入る。同じ品目をもう一度押すと配置を終えて欄を閉じる
  const pickWarehouseItem = (item: WarehouseItem) => {
    setTool('select');
    if (placing === item.id) {
      setPlacing(null);
      setWarehouseOpen(false);
    } else {
      setPlacing(item.id);
    }
  };

  // 倉庫の欄を閉じる（配置の途中では閉じない。置き終わるまで欄を開けておく）
  const closeWarehouse = () => {
    if (placing === null) setWarehouseOpen(false);
  };

  // ケーブルの種類の欄。PC は配線のボタンの上に浮かせ、狭い画面は行の上に出す（スクロールで切れないように）
  const cablePopup = (
    <div
      style={{
        position: phone ? 'static' : 'absolute',
        left: 0,
        bottom: phone ? undefined : '100%',
        marginBottom: 6,
        alignSelf: 'flex-start',
        display: 'flex',
        gap: 4,
        padding: 4,
        background: 'rgba(47, 79, 143, 0.92)',
        border: '1px solid #3b2a33',
        borderRadius: RADIUS.chrome,
        whiteSpace: 'nowrap',
      }}
    >
      {cableIds.map((id) => {
        const cable = cables[id as keyof typeof cables];
        const name = t(`cable.${id}.name` as LangKey);
        // 値段は、ボタンの文字には出さず、ツールチップの2行目に出す
        const price = t('ui.cable.price', { link: yen(cable.pricePerLink), tile: yen(cable.pricePerTile) });
        return (
          <Tooltip text={sandbox ? name : `${name}\n${price}`} key={id}>
            <button aria-label={name} style={{ ...slot(wireCable === id), width: 36, height: 36 }} onClick={() => setWireCable(id)}>
              <Icon name={`icon/cable_${id}`} scale={1} />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
  const showCables = tool === 'wire' && cableIds.length > 0;

  return (
    <>
    <footer style={phone ? barPhone : bar} data-toolbar>
      {/* 狭い画面では、ケーブルの欄を行の上に出す */}
      {phone && showCables && cablePopup}
      <div style={phone ? scrollerPhone : scrollerDesktop}>
      {/* 道具は自社オフィスでも案件の設計中でも常に出す。配線の道具を選んだときだけ、ケーブルの種類を配線のボタンの上に浮かせて出す（並びには場所を取らない） */}
      {TOOLS.map((item) => (
        <Fragment key={item.id}>
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <Tooltip text={tipText(item.name, item.action)}>
              <button aria-label={t(item.name)} data-guide={`tool.${item.id}`} style={toolSlot(tool === item.id)} onClick={() => { setTool(item.id); closeWarehouse(); }}>
                <Icon name={item.icon} />
              </button>
            </Tooltip>
            {item.id === 'wire' && !phone && showCables && cablePopup}
          </span>
        </Fragment>
      ))}
      {sep}
      {!sandbox && (
      <Tooltip text={tipText('ui.offer.title', 'offers')}><button aria-label={t('ui.offer.title')} style={{ ...slot(false), position: 'relative' }}  onClick={() => { closeWarehouse(); onOffers(); }}>
        <Icon name="icon/mail" />
        {offers.length > 0 && (
          <span style={{ position: 'absolute', top: -6, right: -6, background: '#e84a4a', borderRadius: RADIUS.chrome, fontSize: 11, padding: '0 5px' }}>
            {offers.length}
          </span>
        )}
      </button></Tooltip>
      )}
      <Tooltip text={tipText('ui.shop.title', 'shop')}><button aria-label={t('ui.shop.title')} data-guide="shop" style={slot(false)}  onClick={() => { closeWarehouse(); onShop(); }}>
        <Icon name="icon/cart" />
      </button></Tooltip>
      {/* 在庫は倉庫のアイコンにまとめる。品目の一覧は倉庫の欄で開く */}
      {sep}
      <Tooltip text={tipText('ui.warehouse.title', 'warehouse')}><button aria-label={t('ui.warehouse.title')} data-guide="warehouse" style={{ ...slot(warehouseOpen && warehouseOpenable), opacity: warehouseOpenable ? 1 : 0.35 }}
        
        disabled={!warehouseOpenable}
        onClick={() => setWarehouseOpen(!warehouseOpen)}
      >
        <Icon name="icon/warehouse" scale={1} />
        <span style={{ position: 'absolute', right: 2, bottom: 0, fontSize: 11, fontWeight: 'bold', textShadow: '0 0 2px #3b2a33' }}>
          {stockTotal}
        </span>
      </button></Tooltip>
      {(design || sandbox) && (
        <>
          {sep}
          {ipButton}
          {sep}
          {/* テストは何度でも押せ、時間も費用もかからない。施工は、テストに合格してからだけ依頼できる（押すと案内を出す） */}
          <Tooltip text={tipText('ui.test', 'test')}>
            <button
              aria-label={t('ui.test')}
              data-guide="test"
              style={{
                ...slot(false),
                width: 'auto',
                padding: '0 14px',
                background: testLit ? '#ffd866' : '#3a7bd0',
                color: testLit ? '#1d3664' : '#f4f1e6',
                fontSize: 16,
              }}
              onClick={() => { closeWarehouse(); test(); }}
            >
              <Icon name="icon/test" /> {t('ui.test')}
            </button>
          </Tooltip>
          {historyButtons}
          {design && (
          <>
          <Tooltip text={tipText('ui.build', 'build')}>
            <button
              aria-label={t('ui.build')}
              style={{
                ...slot(false),
                width: 'auto',
                padding: '0 14px',
                background: '#5aa860',
                fontSize: 16,
                opacity: active.testedOk ? 1 : 0.55,
              }}
              onClick={() => { closeWarehouse(); requestBuild(); }}
            >
              <Icon name="icon/hammer" /> {t('ui.build')}
            </button>
          </Tooltip>
          <span style={{ marginLeft: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Icon name="icon/budget" /> {yen(active.cost)} / {yen(active.contract.budget)}
          </span>
          <Tooltip text={t('ui.project.abandon')} style={{ marginLeft: 'auto' }}><button aria-label={t('ui.project.abandon')} style={{ ...slot(false), width: 32 }}  onClick={() => { closeWarehouse(); abandon(); }}>
            <Icon name="icon/close" />
          </button></Tooltip>
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
          {sep}
          <Icon name="icon/hammer" />
          <div style={{ width: 200, height: 10, background: '#3b2a33', borderRadius: RADIUS.none }}>
            <div
              style={{
                width: `${active.total ? Math.min(100, (active.progress / active.total) * 100) : 0}%`,
                height: '100%',
                background: workingNow ? '#ffd866' : '#8a8a8a',
              }}
            />
          </div>
          {!workingNow && (
            <span style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
              {t('ui.build.offHours', { hour: balance.build.workStartHour })}
            </span>
          )}
        </>
      )}
      </div>
    </footer>
    {warehouseOpen && warehouseOpenable && (
      <Warehouse
        items={warehouseItemList}
        owned={owned}
        placing={placing}
        onPick={pickWarehouseItem}
        onShop={onShop}
      />
    )}
    </>
  );
}
