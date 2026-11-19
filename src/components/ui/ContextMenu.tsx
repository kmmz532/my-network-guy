// 右クリック（長押し）のメニュー。押した位置に出し、画面の端ではみ出さない位置に寄せる。外を押す・Esc で閉じる。項目は操作の名前だけ。
// 見た目は口の一覧（Popover の port・Button の port）と同じ。
import { useEffect } from 'react';
import { captureKeys } from '../../input/keyRouter';
import { loadSettings } from '../../settings/settings';
import { Button } from './Button';
import { Popover } from './Popover';

// 箱の幅と、1行の高さの見積もり（位置を画面の中に収めるため）
const WIDTH_PX = 160;
const ROW_PX = 24;
const PAD_PX = 12;
const EDGE_PX = 8;

export interface ContextMenuEntry {
  id: string;
  label: string;
  onSelect: () => void;
}

interface Props {
  // 押した位置（画面の座標）
  x: number;
  y: number;
  items: readonly ContextMenuEntry[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest('[data-context-menu]')) return;
      onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    const release = captureKeys((e) => {
      if (e.key !== 'Escape') return false;
      onClose();
      return true;
    });
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      release();
    };
  }, [onClose]);
  // 中身は UI の大きさの倍率で拡大されるため、はみ出しの判定は倍率をかけた大きさで行い、位置は倍率で割って指定する
  const k = loadSettings().uiScale;
  const height = (items.length * ROW_PX + PAD_PX) * k;
  const left = Math.max(EDGE_PX, Math.min(x, window.innerWidth - WIDTH_PX * k - EDGE_PX)) / k;
  const top = Math.max(EDGE_PX, Math.min(y, window.innerHeight - height - EDGE_PX)) / k;
  return (
    <div data-context-menu>
      <Popover variant="port" layout={{ position: 'fixed', top, left, width: WIDTH_PX, zIndex: 7 }}>
        {items.map((item) => (
          <Button
            key={item.id}
            variant="secondary"
            size="port"
            layout={{ marginTop: 2 }}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.label}
          </Button>
        ))}
      </Popover>
    </div>
  );
}
