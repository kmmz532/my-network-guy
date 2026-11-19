import { Fragment } from 'react';
// ポートの一覧の吹き出し。配線の道具で機器を押したときに、機器の横に出す。先頭は「おまかせ」、続けて各ポート（埋まったポートは選べない）
import { labelOfUid } from './nodeLabel';
import { t } from '../i18n/t';
import { editNetOf, useGameStore } from '../stores/useGameStore';
import { useUiStore } from '../stores/useUiStore';
import type { NetLink, NetNode } from '../network/types';
import { isWanPort, plugSlot, portLabel } from './devicePorts';
import { spriteOf, spriteUrl } from '../game/sprites';
import { portTypeOf } from '../sim/project';
import { Button } from './ui/Button';
import { Popover } from './ui/Popover';
import type { PickBox } from '../game/portPick';
import { loadSettings } from '../settings/settings';
import { deviceCategory, portCountOf } from '../registry/query';
import { applyOperation } from '../company/apply';
import { coreOf } from '../stores/useGameStore';
import { opContextOf } from '../stores/gameHelpers';

// 吹き出しの高さの見積もり（行の数で画面からはみ出さないように置く）
const ROW_PX = 24;

// 機器のポートの一覧（番号・名前・つながっている相手）
interface PortRow {
  port: number;
  label: string;
  partner: NetNode | undefined;
  used: boolean;
  // つながっているケーブルの uid（空きの口は undefined）
  link: string | undefined;
  // WAN の口（先頭にまとめる）
  wan: boolean;
  // 背面と同じ口の絵と、光ファイバーの口（絵の幅が狭い）
  slot: string;
  fiber: boolean;
}

const rowsOf = (node: NetNode, nodes: readonly NetNode[], links: readonly NetLink[]): PortRow[] => {
  const category = deviceCategory(node.device);
  const rows = Array.from({ length: portCountOf(node.device) }, (_, port) => {
    const link = links.find(
      (l) => (l.a.node === node.uid && l.a.port === port) || (l.b.node === node.uid && l.b.port === port),
    );
    const partnerUid = link ? (link.a.node === node.uid && link.a.port === port ? link.b.node : link.a.node) : undefined;
    return {
      port,
      label: portLabel(category, port),
      partner: partnerUid ? nodes.find((n) => n.uid === partnerUid) : undefined,
      used: link !== undefined,
      link: link?.uid,
      wan: isWanPort(category, port),
      slot: plugSlot(link, portTypeOf(node.device, port) === 'sfp'),
      fiber: link ? link.cable.startsWith('fiber') : portTypeOf(node.device, port) === 'sfp',
    };
  });
  // WAN の口を先頭にまとめ、残りは口の番号の順
  return rows.sort((a, b) => Number(b.wan) - Number(a.wan) || a.port - b.port);
};

// 配線を外せるか（store の撤去と同じ判定）
const canUnplug = (state: ReturnType<typeof useGameStore.getState>, uid: string): boolean =>
  applyOperation(coreOf(state), { kind: 'removeLink', uid }, opContextOf(state)).ok;

export function PortMenu() {
  const state = useGameStore();
  const menu = useUiStore((s) => s.portMenu);
  const net = editNetOf(state);
  if (!menu || !net) return null;
  const node = net.nodes.find((n) => n.uid === menu.uid);
  if (!node) return null;
  const rows = rowsOf(node, net.nodes, net.links);
  // 画面からはみ出さないよう、右端と下端に寄せる。中身は UI の大きさの倍率で拡大されるため、位置は倍率で割って指定する
  const k = loadSettings().uiScale;
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - 280 * k)) / k;
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - ((rows.length + 1) * ROW_PX + 24) * k)) / k;
  // ケーブルの端を持っている間の一覧（drag）は、離した位置で決めるため、ポインタを通さない。行の枠は data-port-row から読む
  const drag = menu.role === 'drag';
  return (
    <div style={drag ? { pointerEvents: 'none' } : undefined}>
      <Popover variant="port" layout={{ position: 'fixed', top, left, width: 'max-content', zIndex: 6 }}>
        <div data-port-row="auto">
          <Button variant="secondary" size="port" layout={{ marginTop: 2 }} pressed={drag ? menu.hot === 'auto' : undefined} onClick={() => state.pickPort(null)}>
            {t('ui.wire.auto')}
          </Button>
        </div>
        {rows.map((row) => (
          <Fragment key={row.port}>
            <div data-port-row={row.port}>
              <Button
                variant="secondary"
                size="port"
                layout={{ marginTop: 2 }}
                disabled={row.used || (drag && menu.blocked.includes(row.port))}
                pressed={drag ? menu.hot === row.port : undefined}
                onClick={() => state.pickPort(row.port)}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {/* 背面と同じ口の絵（2倍）。差してある口はプラグの影を重ねる */}
                  <span style={{ position: 'relative', width: (row.fiber ? 8 : 12) * 2, height: 20, display: 'inline-block', flexShrink: 0 }}>
                    <img src={spriteUrl(spriteOf(row.slot))} width={(row.fiber ? 8 : 12) * 2} height={20} alt="" draggable={false} style={{ imageRendering: 'pixelated', display: 'block' }} />
                    {row.used && <img src={spriteUrl(spriteOf(row.fiber ? 'rear/sfp_shade' : 'rear/plug_shade'))} width={(row.fiber ? 8 : 12) * 2} height={20} alt="" draggable={false} style={{ position: 'absolute', inset: 0, imageRendering: 'pixelated', display: 'block' }} />}
                  </span>
                  <span>{row.label}</span>
                </span>
                <span>
                  {row.partner ? labelOfUid(state, row.partner.uid, net.nodes) : t('ui.port.free')}
                </span>
              </Button>
            </div>
            {!drag && row.link && canUnplug(state, row.link) && (
              <Button variant="secondary" size="port" layout={{ marginTop: 2 }} onClick={() => state.removeLink(row.link as string)}>
                {t('ui.cmenu.unplug')}
              </Button>
            )}
          </Fragment>
        ))}
      </Popover>
    </div>
  );
}

// 開いている一覧（drag）の各行の枠（画面の座標）。差せない口は blocked。一覧が開いていなければ空
export const portPickBoxes = (blocked: readonly number[]): PickBox[] =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-port-row]'), (el) => {
    const raw = el.dataset.portRow;
    const port = raw === 'auto' ? 'auto' : Number(raw);
    const r = el.getBoundingClientRect();
    return { port, left: r.left, top: r.top, right: r.right, bottom: r.bottom, blocked: port !== 'auto' && blocked.includes(port) };
  });
