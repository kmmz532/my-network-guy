// タイトル画面。ゲーム中のオフィスを背景にして、新しく始めるか、保存データから続けるかを選ぶ
import { useEffect, useState } from 'react';
import pkg from '../../../package.json';
import { spriteOf, spriteUrl } from '../../game/sprites';
import { t } from '../../i18n/t';
import { listCompanies } from '../../services/db';
import { RADIUS } from '../../ui/theme';

interface Props {
  onNew: () => void;
  onContinue: () => void;
  // サンドボックス。その枠に保存があれば続きから、なければ新しく始める
  onSandbox: () => void;
  message: string;
}

// 32px のタイルを 3 倍で描く
const TILE = 96;

// 機器（24×40）と社員（16×24）を 3 倍で描く
const DEVICES = ['device/pc_basic', 'device/l2_switch_8p', 'device/router_basic', 'device/server_basic'];

// TileMap.ts と同じ式で床の板を選ぶ（継ぎ目が揃わないように）
const floorVariant = (x: number, y: number): number => (x * 7 + y * 13 + ((x * y) % 5)) % 3;

const CSS = `
.ts-root {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: #2f4f8f;
  color: #f4f1e6;
}
.ts-shade {
  position: absolute;
  inset: 0;
  background: rgba(27, 20, 32, 0.35);
  pointer-events: none;
}
.ts-content {
  position: relative;
  z-index: 1;
  box-sizing: border-box;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12vh 16px 64px;
}
.ts-display {
  font-family: 'DotGothic16', sans-serif;
  font-weight: 400;
}
.ts-title {
  margin: 0;
  font-size: 56px;
  line-height: 1.2;
  color: #ffffff;
  white-space: nowrap;
  text-shadow:
    3px 0 0 #3b2a33,
    -3px 0 0 #3b2a33,
    0 3px 0 #3b2a33,
    0 -3px 0 #3b2a33;
}
.ts-subtitle {
  margin: 12px 0 0;
  font-size: 14px;
  color: #ffeea8;
  text-shadow: 2px 2px 0 #3b2a33;
}
@media (max-width: 540px) {
  /* 「わたしのネットワーク屋」（11字。1字がちょうど 1em）を、左右の余白 16px と文字の影 3px に加え、字の幅の違い（フォントの代わり・端末の差）の余裕 0.5字ぶんを除いた幅に1行で収める */
  .ts-title {
    font-size: min(36px, calc((100vw - 56px) / 11.5));
    max-width: 100%;
  }
}
.ts-rack {
  position: relative;
  width: 100%;
  max-width: 360px;
  margin-top: 48px;
}
.ts-rack-devices {
  position: relative;
  z-index: 1;
  display: flex;
  justify-content: space-between;
}
.ts-rack-devices img,
.ts-staff img {
  display: block;
  image-rendering: pixelated;
}
.ts-rack-devices img {
  width: 72px;
  height: 120px;
}
.ts-cable {
  position: absolute;
  z-index: 0;
  left: 36px;
  right: 36px;
  top: 59px;
  height: 2px;
  background: #62d26f;
}
.ts-packet {
  position: absolute;
  z-index: 0;
  top: 58px;
  left: 36px;
  width: 4px;
  height: 4px;
  background: #ffffff;
  animation: ts-packet 2s linear infinite;
}
@keyframes ts-packet {
  from {
    left: 36px;
  }
  to {
    left: calc(100% - 40px);
  }
}
.ts-staff {
  position: relative;
  z-index: 1;
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
}
.ts-staff-slot {
  width: 72px;
  display: flex;
  justify-content: center;
}
.ts-typist {
  position: relative;
  width: 48px;
  height: 72px;
}
.ts-typist img {
  position: absolute;
  left: 0;
  top: 0;
  width: 48px;
  height: 72px;
}
.ts-frame-b {
  visibility: hidden;
}
.ts-frame-a {
  animation: ts-frame-a 1s step-end infinite;
}
.ts-frame-b {
  animation: ts-frame-b 1s step-end infinite;
}
@keyframes ts-frame-a {
  0% {
    visibility: visible;
  }
  50% {
    visibility: hidden;
  }
}
@keyframes ts-frame-b {
  0% {
    visibility: hidden;
  }
  50% {
    visibility: visible;
  }
}
.ts-menu {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  margin-top: 40px;
}
.ts-btn {
  position: relative;
  box-sizing: border-box;
  width: 240px;
  padding: 10px 12px 10px 36px;
  font-family: 'DotGothic16', inherit;
  font-size: 20px;
  text-align: left;
  color: #3b2a33;
  background: #f4f1e6;
  border: 2px solid #3b2a33;
  border-radius: ${RADIUS.none}px;
  box-shadow: inset -3px -3px 0 #cfc3aa, inset 3px 3px 0 #ffffff;
  cursor: pointer;
  transition: transform 60ms;
}
.ts-btn::before {
  content: '';
  position: absolute;
  left: 14px;
  top: 50%;
  margin-top: -6px;
  border-left: 9px solid transparent;
  border-top: 6px solid transparent;
  border-bottom: 6px solid transparent;
}
.ts-btn-selected {
  background: #ffd866;
  box-shadow: inset -3px -3px 0 #c9962e, inset 3px 3px 0 #fff3c4;
}
.ts-btn-selected::before {
  border-left-color: #3b2a33;
}
.ts-btn:active:not(:disabled) {
  transform: translateY(1px);
  box-shadow: inset -3px -3px 0 #c9962e, inset 3px 3px 0 #fff3c4;
}
.ts-btn:disabled {
  color: #8a7f86;
  background: #d9d2c3;
  cursor: not-allowed;
}
.ts-note {
  margin: 4px 0 0;
  font-size: 12px;
  text-align: center;
}
.ts-message {
  margin: 4px 0 0;
  font-size: 14px;
  color: #ffd866;
  text-align: center;
}
.ts-foot {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 12px;
  z-index: 1;
  text-align: center;
  font-size: 12px;
  line-height: 1.6;
  color: #f4f1e6;
  text-shadow: 1px 1px 0 #3b2a33;
}
@media (prefers-reduced-motion: reduce) {
  .ts-packet,
  .ts-frame-a,
  .ts-frame-b {
    animation: none;
  }
}
`;

// 床と奥の壁を 3 倍で画面全体に敷き詰める。上の 1 段が奥の壁（窓を 4 マスおきに入れる）
function Backdrop() {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const cols = Math.ceil(size.w / TILE);
  const rows = Math.ceil(size.h / TILE);
  const cells = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const name = y === 0 ? (x % 4 === 2 ? 'tile/window' : 'tile/wall_face') : `tile/floor_${floorVariant(x, y)}`;
      const url = spriteUrl(spriteOf(name));
      if (!url) continue;
      cells.push(
        <img
          key={`${x}-${y}`}
          src={url}
          alt=""
          draggable={false}
          style={{ display: 'block', width: TILE, height: TILE, imageRendering: 'pixelated' }}
        />,
      );
    }
  }
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, ${TILE}px)`,
        gridAutoRows: `${TILE}px`,
      }}
    >
      {cells}
    </div>
  );
}

// 社員が打鍵しているように、2コマを交互に出す
function Typist({ base }: { base: string }) {
  return (
    <div className="ts-typist">
      <img draggable={false} className="ts-frame-a" src={spriteUrl(spriteOf(`staff/${base}_0`))} alt="" />
      <img draggable={false} className="ts-frame-b" src={spriteUrl(spriteOf(`staff/${base}_1`))} alt="" />
    </div>
  );
}

// 機器をケーブルで結んだ列。パケットが左から右へ流れる
function Rack() {
  return (
    <div className="ts-rack" aria-hidden="true">
      <div className="ts-cable" />
      <div className="ts-packet" />
      <div className="ts-rack-devices">
        {DEVICES.map((name) => (
          <img key={name} src={spriteUrl(spriteOf(name))} alt="" draggable={false} />
        ))}
      </div>
      <div className="ts-staff">
        <div className="ts-staff-slot">
          <Typist base="blue_dark_short" />
        </div>
        <div className="ts-staff-slot" />
        <div className="ts-staff-slot" />
        <div className="ts-staff-slot">
          <Typist base="red_brown_long" />
        </div>
      </div>
    </div>
  );
}

// タイトル画面。新しく始めるか、保存データから続けるかを選ぶ
export function TitleScreen({ onNew, onContinue, onSandbox, message, locked = false }: Props & { locked?: boolean }) {
  // null は保存データを確認中
  const [hasSave, setHasSave] = useState<boolean | null>(null);
  // 矢印キーで選んだボタン。未操作のときは主のボタン（保存データがあれば「続きから」）
  const [picked, setPicked] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    listCompanies('career')
      .then((list) => alive && setHasSave(list.length > 0))
      .catch(() => alive && setHasSave(false));
    return () => {
      alive = false;
    };
  }, []);

  const items = [
    { label: t('ui.title.new'), enabled: true, run: onNew },
    { label: t('ui.title.continue'), enabled: hasSave === true, run: onContinue },
    { label: t('ui.title.sandbox'), enabled: true, run: onSandbox },
  ];
  const primary = hasSave === true ? 1 : 0;
  const selected = picked ?? primary;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 会社の画面を開いている間は、タイトルのキー操作を止める（Enter は会社の画面が受ける）
      if (locked) return;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const enabled = items.flatMap((item, i) => (item.enabled ? [i] : []));
        const pos = Math.max(0, enabled.indexOf(selected));
        const step = e.key === 'ArrowUp' ? -1 : 1;
        const next = (pos + step + enabled.length) % enabled.length;
        setPicked(enabled[next]);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        // 保存データを確認中は押させない（確認前に新しく始めて保存を上書きしないため）
        if (hasSave === null) return;
        const item = items[selected];
        if (item?.enabled) item.run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, hasSave, onNew, onContinue, onSandbox, locked]);

  return (
    <div className="ts-root">
      <style>{CSS}</style>
      <Backdrop />
      <div className="ts-shade" />
      <div className="ts-content">
        <h1 className="ts-title ts-display">{t('ui.title.name')}</h1>
        <p className="ts-subtitle ts-display">{t('ui.title.subtitle')}</p>

        <Rack />

        <div className="ts-menu" role="group" aria-label={t('ui.title.menu')}>
          {items.map((item, i) => (
            <button
              key={i}
              type="button"
              className={`ts-btn${i === selected ? ' ts-btn-selected' : ''}`}
              disabled={!item.enabled}
              onMouseEnter={() => item.enabled && setPicked(i)}
              onClick={item.run}
            >
              {item.label}
            </button>
          ))}
          {hasSave === false && <p className="ts-note">{t('ui.title.none')}</p>}
          {message && message !== t('ui.title.none') && <p className="ts-message">{message}</p>}
        </div>
      </div>

      <div className="ts-foot">
        <div>{t('ui.title.version', { version: pkg.version, build: __BUILD_ID__ })}</div>
      </div>
    </div>
  );
}
