// ポートの一覧の吹き出し。配線の道具で機器を押したときに、機器の横に出す。先頭は「おまかせ」、続けて各ポート（埋まったポートは選べない）
import { labelOfUid } from './nodeLabel';
import { t } from '../i18n/t';
import { editNetOf, useGameStore } from '../stores/useGameStore';
import type { NetLink, NetNode } from '../network/types';
import { buttonStyle, panelStyle, portLabel } from './devicePorts';
import { loadSettings } from '../settings/settings';
import { deviceCategory, portCountOf } from '../registry/query';

// 吹き出しの高さの見積もり（行の数で画面からはみ出さないように置く）
const ROW_PX = 24;

// 機器のポートの一覧（番号・名前・つながっている相手）
interface PortRow {
  port: number;
  label: string;
  partner: NetNode | undefined;
  used: boolean;
}

const rowsOf = (node: NetNode, nodes: readonly NetNode[], links: readonly NetLink[]): PortRow[] => {
  const category = deviceCategory(node.device);
  return Array.from({ length: portCountOf(node.device) }, (_, port) => {
    const link = links.find(
      (l) => (l.a.node === node.uid && l.a.port === port) || (l.b.node === node.uid && l.b.port === port),
    );
    const partnerUid = link ? (link.a.node === node.uid && link.a.port === port ? link.b.node : link.a.node) : undefined;
    return {
      port,
      label: portLabel(category, port),
      partner: partnerUid ? nodes.find((n) => n.uid === partnerUid) : undefined,
      used: link !== undefined,
    };
  });
};

export function PortMenu() {
  const state = useGameStore();
  const menu = state.portMenu;
  const net = editNetOf(state);
  if (!menu || !net) return null;
  const node = net.nodes.find((n) => n.uid === menu.uid);
  if (!node) return null;
  const rows = rowsOf(node, net.nodes, net.links);
  // 画面からはみ出さないよう、右端と下端に寄せる。中身は UI の大きさの倍率で拡大されるため、位置は倍率で割って指定する
  const k = loadSettings().uiScale;
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - 280 * k)) / k;
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - ((rows.length + 1) * ROW_PX + 24) * k)) / k;
  const rowStyle = {
    ...buttonStyle,
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    width: '100%',
    textAlign: 'left',
    padding: '3px 8px',
    marginTop: 2,
    fontSize: 12,
  } as const;
  return (
    <div style={{ ...panelStyle, position: 'fixed', top, left, right: 'auto', width: 260, maxHeight: 'none', padding: 4, fontSize: 12, zIndex: 6, zoom: 'var(--ui-scale, 1)' }}>
      <button style={rowStyle} onClick={() => state.pickPort(null)}>
        {t('ui.wire.auto')}
      </button>
      {rows.map((row) => (
        <button
          key={row.port}
          style={{ ...rowStyle, opacity: row.used ? 0.45 : 1, cursor: row.used ? 'default' : 'pointer' }}
          disabled={row.used}
          onClick={() => state.pickPort(row.port)}
        >
          <span>{row.label}</span>
          <span>
            {row.partner ? labelOfUid(state, row.partner.uid, net.nodes) : t('ui.port.free')}
          </span>
        </button>
      ))}
    </div>
  );
}
