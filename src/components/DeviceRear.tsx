// 機器の画面の「背面」タブ。ポートを番号つきで並べ、各ポートのLED・相手の機器とポート・ケーブルの種類を出す。
// つながったポートを押すと「外す」「挿し替える」を出す。挿し替えでは、空いているポートを押すと、そこへ挿し替える。
// つながったポートのプラグをドラッグすると、同じ背面の空きポートへ挿し替える（4 px 未満の動きは押したものとして扱う）。
import { trackDrag } from '../input/trackDrag';
import { nodeLabel } from './nodeLabel';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { spriteOf, spriteUrl } from '../game/sprites';
import { t, tDyn } from '../i18n/t';
import { portTypeOf, type End } from '../sim/project';
import { gameEnv } from '../sim/env';
import type { NetLink, NetNode } from '../network/types';
import type { Network } from '../network/types';
import { colorOfLink, colorOfNetwork, networkColors, networkLabelOf, networksOfLink } from '../network/netColor';
import { withWireless } from '../network/netState';
import { loadSettings } from '../settings/settings';
import { useGameStore } from '../stores/useGameStore';
import { buttonStyle, greyColor, portLabel } from './devicePorts';
import { portHoverAt, replugTargetAt, type PortBox, type PortHover } from './rearDrag';
import { RADIUS } from '../ui/theme';
import { CATEGORY, isPcCategory } from '../data/categories';

// 背面の部品のスプライトを拡大する倍率（ドット絵を整数倍で描く）
// 背面の部品の拡大率。ポートが多い機器は、板の幅に収まるよう2倍にする
const scaleFor = (ports: number): number => (ports > 4 ? 2 : 3);
// 背面の板で1段に並べるポートの数（9口以上の機器は板の幅に収めるため6口ずつ）
const portsPerRowFor = (ports: number): number => (ports > 8 ? 6 : 8);

// プラグの絵（つながっていれば UTP か光、空いていれば空の差し込み口）
// 差し込み口の絵。SFP の口は、挿していなくても SFP の絵で描く（口の種類は定義どおり）
const plugSlot = (link: NetLink | undefined, sfp: boolean): string => (!link ? (sfp ? 'rear/port_sfp_empty' : 'rear/port_empty') : link.cable.startsWith('fiber') ? 'rear/port_sfp_empty' : 'rear/port_empty');

// 画面に出すドラッグの途中の状態（プラグの絵の位置・いま重なっているポート）
interface Carry {
  port: number;
  slot: string;
  networks: string[];
  fiber: boolean;
  x: number;
  y: number;
  over: PortHover;
}

interface Props {
  node: NetNode;
  // 表示する機器とケーブル（機器の画面で選んだ案件、または自社オフィス）
  nodes: NetNode[];
  links: NetLink[];
  net: Network;
  readOnly: boolean;
  onError: (reason: string | null) => void;
}

export function RearTab({ node, nodes, links, net, readOnly, onError }: Props) {
  const removeLink = useGameStore((s) => s.removeLink);
  const replug = useGameStore((s) => s.replug);
  const [selected, setSelected] = useState<number | null>(null);
  const [replugging, setReplugging] = useState<{ linkUid: string; end: End } | null>(null);
  // マウスを乗せているポート（明るく描く）
  const [hover, setHover] = useState<number | null>(null);
  // ドラッグ中の記録と、画面に出すプラグの状態
  // 進行中のドラッグを止める（画面を閉じたとき・別のプラグを押したとき）
  const stopDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => stopDrag.current?.(), []);
  const [carry, setCarry] = useState<Carry | null>(null);
  // ドラッグの直後に出る click は無視する（ドラッグしたのに「押した」扱いにしない）
  const ignoreClick = useRef(false);
  // 板の上の各ポートの要素（ドラッグの判定に使う位置を取る）
  const portRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const category = gameEnv.devices[node.device]?.category;
  const portCount = gameEnv.devices[node.device]?.portCount ?? 0;
  const ports = Array.from({ length: portCount }, (_, p) => p);
  const SCALE = scaleFor(portCount);
  const portsPerRow = portsPerRowFor(portCount);
  const byUid = new Map(nodes.map((n) => [n.uid, n]));
  const colors = networkColors(withWireless(net, gameEnv.engine), gameEnv.engine);
  const linkAt = (port: number) =>
    links.find((l) => (l.a.node === node.uid && l.a.port === port) || (l.b.node === node.uid && l.b.port === port));
  // 挿し替え中のケーブルが、まだあるか
  const active = replugging && links.some((l) => l.uid === replugging.linkUid) ? replugging : null;
  // 読み取り専用（施工中・案件の既設の機器など）や挿し替え中は、プラグをドラッグできない
  const grabbable = !readOnly && !active;
  const isUsedPort = (port: number) => linkAt(port) !== undefined;

  // ドラッグのあとに続く click を1回だけ無視する（click が来なかった場合に備えて、次の処理の後に戻す）
  const skipNextClick = () => {
    ignoreClick.current = true;
    window.setTimeout(() => {
      ignoreClick.current = false;
    }, 0);
  };

  const press = (port: number) => {
    if (active) {
      // 空いているポートへ挿し替える。埋まっていれば、理由を出して何もしない
      const reason = replug(active.linkUid, active.end, port);
      onError(reason);
      if (reason === null) {
        setReplugging(null);
        setSelected(port);
      }
      return;
    }
    onError(null);
    setSelected(selected === port ? null : port);
  };

  // 板の上の各ポートの枠（画面の座標）
  const portBoxes = (): PortBox[] =>
    ports.flatMap((p) => {
      const el = portRefs.current[p];
      if (!el) return [];
      const r = el.getBoundingClientRect();
      return [{ port: p, left: r.left, top: r.top, right: r.right, bottom: r.bottom }];
    });

  const onPlugDown = (p: number) => (e: PointerEvent<HTMLButtonElement>) => {
    const link = linkAt(p);
    if (!grabbable || !link) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const slot = plugSlot(link, portTypeOf(gameEnv, node.device, p) === 'sfp');
    const fiber = link.cable.startsWith('fiber');
    const networks = networksOfLink(colors, link.uid);
    const end: End = link.a.node === node.uid ? 'a' : 'b';
    stopDrag.current?.();
    stopDrag.current = trackDrag({
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      onMove: (x, y) => setCarry({ port: p, slot, networks, fiber, x, y, over: portHoverAt(x, y, portBoxes(), isUsedPort) }),
      // 空いているポートの上で離したときだけ挿し替える。それ以外は何もせず元に戻す
      onDrop: (x, y) => {
        const target = replugTargetAt(x, y, portBoxes(), isUsedPort);
        if (target === null) return;
        const reason = replug(link.uid, end, target);
        onError(reason);
        if (reason === null) setSelected(target);
      },
      // 動かさずに離したのは「押した」なので、click に任せる。動かしたあとの click は無視する
      onEnd: ({ dragged }) => {
        stopDrag.current = null;
        if (!dragged) return;
        skipNextClick();
        setCarry(null);
      },
    });
  };

  const selectedLink = selected === null ? undefined : linkAt(selected);
  const peerOf = (link: NetLink) => {
    const end = link.a.node === node.uid ? link.b : link.a;
    const peer = byUid.get(end.node);
    return { end, peer };
  };

  // 背面の板: 左から電源・ポート群・ファン（PC とサーバーだけ）。スプライトは3倍に拡大して、ドット絵のまま描く
  const fan = isPcCategory(category) || category === CATEGORY.server;
  // 画面の倍率（UI の大きさ）。位置は倍率で割って指定する（PortMenu と同じ考え方）
  const uiScale = loadSettings().uiScale;
  const plugW = 12 * SCALE;
  const plugH = 10 * SCALE;
  return (
    <div>
      <div
        style={{
          background: '#3d434b',
          border: '2px solid #3b2a33',
          borderRadius: RADIUS.none,
          padding: '8px 6px',
          display: 'flex',
          alignItems: 'flex-end',
          gap: 10,
          marginBottom: 8,
          overflowX: 'auto',
        }}
      >
        <img draggable={false} src={spriteUrl('rear/power')} width={12 * SCALE} height={10 * SCALE} alt="" style={{ imageRendering: 'pixelated', display: 'block' }} />
        {/* ポートは板の幅に収まるよう、1段の口数を決めて段を分ける（9口以上は1段6口） */}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(Math.max(portCount, 1), portsPerRow)}, auto)`, gap: 4 }}>
          {ports.map((p) => {
            const link = linkAt(p);
            // ドラッグ中のプラグは、元の差し込み口を空の絵で見せる（LED も消す）
            const lifted = carry?.port === p;
            const slot = lifted ? (portTypeOf(gameEnv, node.device, p) === 'sfp' ? 'rear/port_sfp_empty' : 'rear/port_empty') : plugSlot(link, portTypeOf(gameEnv, node.device, p) === 'sfp');
            const linkNetworks = link ? networksOfLink(colors, link.uid) : [];
            const stripeNetworks = linkNetworks.slice(0, 3);
            const stripeColors = stripeNetworks.map((network) => colorOfNetwork(colors, network) ?? colorOfLink(colors, link!.uid));
            const stripeBackground = stripeColors.length > 1
              ? `repeating-linear-gradient(90deg, ${stripeColors.map((color, i) => `#${color.toString(16).padStart(6, '0')} ${i * 100 / stripeColors.length}% ${(i + 1) * 100 / stripeColors.length}%`).join(', ')})`
              : `#${(stripeColors[0] ?? colorOfLink(colors, link?.uid ?? '')).toString(16).padStart(6, '0')}`;
            const fiber = link?.cable.startsWith('fiber') ?? false;
            const lit = !lifted && link !== undefined;
            // 挿し替え中は、空いているポートを光らせて挿し替え先を示す
            const replugFree = active !== null && link === undefined;
            // ドラッグ中は、重なっているポートを明るく（空き）・暗く（埋まり）示す。それ以外は押しているポートを明るくする
            const filter = carry
              ? carry.over?.port === p
                ? carry.over.state === 'free'
                  ? 'brightness(1.35)'
                  : 'brightness(0.55)'
                : undefined
              : replugFree
                ? 'brightness(1.35) drop-shadow(0 0 4px #ffd866)'
                : hover === p
                  ? 'brightness(1.35)'
                  : undefined;
            return (
              <button
                key={p}
                ref={(el) => {
                  portRefs.current[p] = el;
                }}
                aria-label={portLabel(category, p)}
                onClick={() => {
                  if (ignoreClick.current) return;
                  press(p);
                }}
                onPointerDown={onPlugDown(p)}
                onDragStart={(e) => e.preventDefault()}
                onMouseEnter={() => setHover(p)}
                onMouseLeave={() => setHover(null)}
                style={{
                  background: 'none',
                  border: selected === p ? '2px solid #ffd866' : replugFree ? '2px dashed #ffd866' : '2px solid transparent',
                  borderRadius: RADIUS.none,
                  padding: 0,
                  cursor: link && grabbable ? 'grab' : 'pointer',
                  // スマートフォンでもプラグをドラッグできるよう、ブラウザのスクロールに渡さない
                  touchAction: 'none',
                  userSelect: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                  filter,
                }}
              >
                {/* LED（つながっていれば緑）。2×2 の点を3倍にする */}
                <span style={{ width: 2 * SCALE, height: 2 * SCALE, background: lit ? '#62d26f' : '#2a2f36' }} />
                <span style={{ position: 'relative', width: (fiber ? 8 : 12) * SCALE, height: 10 * SCALE, display: 'block' }}>
                  <img src={spriteUrl(spriteOf(slot))} width={(fiber ? 8 : 12) * SCALE} height={10 * SCALE} alt="" draggable={false} style={{ imageRendering: 'pixelated', display: 'block' }} />
                  {!lifted && link && (
                    <span
                      style={{
                        position: 'absolute',
                        inset: 0,
                        background: stripeBackground,
                        maskImage: `url(${spriteUrl(spriteOf(fiber ? 'rear/sfp_mask' : 'rear/plug_mask'))})`,
                        WebkitMaskImage: `url(${spriteUrl(spriteOf(fiber ? 'rear/sfp_mask' : 'rear/plug_mask'))})`,
                        maskSize: '100% 100%',
                        WebkitMaskSize: '100% 100%',
                        maskRepeat: 'no-repeat',
                        WebkitMaskRepeat: 'no-repeat',
                        pointerEvents: 'none',
                      }}
                    />
                  )}
                  {!lifted && link && <img src={spriteUrl(spriteOf(fiber ? 'rear/sfp_shade' : 'rear/plug_shade'))} width={(fiber ? 8 : 12) * SCALE} height={10 * SCALE} alt="" draggable={false} style={{ position: 'absolute', inset: 0, imageRendering: 'pixelated', display: 'block', pointerEvents: 'none' }} />}
                  {!lifted && linkNetworks.length > 3 && <span style={{ position: 'absolute', right: 1, bottom: 0, color: '#f4f1e6', fontSize: Math.max(8, SCALE * 3), lineHeight: 1, textShadow: '1px 1px #3b2a33', pointerEvents: 'none' }}>…</span>}
                </span>
                <span style={{ color: '#f4f1e6', fontSize: 11, lineHeight: 1 }}>{portLabel(category, p)}</span>
              </button>
            );
          })}
        </div>
        {fan && <img draggable={false} src={spriteUrl('rear/fan')} width={16 * SCALE} height={16 * SCALE} alt="" style={{ imageRendering: 'pixelated', display: 'block' }} />}
      </div>

      {/* ドラッグ中のプラグ。指やカーソルに付いて動く（画面の上に出し、ポインターの動きを邪魔しない） */}
      {carry &&
        createPortal(
          <span style={{ position: 'fixed', left: carry.x / uiScale - plugW / 2, top: carry.y / uiScale - plugH / 2, width: (carry.fiber ? 8 : 12) * SCALE, height: plugH, pointerEvents: 'none', zIndex: 1000, zoom: 'var(--ui-scale, 1)' }}>
            <img src={spriteUrl(spriteOf(carry.fiber ? 'rear/port_sfp_empty' : 'rear/port_empty'))} alt="" draggable={false} style={{ imageRendering: 'pixelated', display: 'block', width: (carry.fiber ? 8 : 12) * SCALE, height: plugH }} />
            <span style={{ position: 'absolute', inset: 0, background: carry.networks.length > 1 ? `repeating-linear-gradient(90deg, ${carry.networks.slice(0, 3).map((network, i, shown) => `#${(colorOfNetwork(colors, network) ?? colorOfLink(colors, '')).toString(16).padStart(6, '0')} ${i * 100 / shown.length}% ${(i + 1) * 100 / shown.length}%`).join(', ')})` : `#${(colorOfNetwork(colors, carry.networks[0]) ?? colorOfLink(colors, '')).toString(16).padStart(6, '0')}`, maskImage: `url(${spriteUrl(spriteOf(carry.fiber ? 'rear/sfp_mask' : 'rear/plug_mask'))})`, WebkitMaskImage: `url(${spriteUrl(spriteOf(carry.fiber ? 'rear/sfp_mask' : 'rear/plug_mask'))})`, maskSize: '100% 100%', WebkitMaskSize: '100% 100%', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat' }} />
            {carry.networks.length > 3 && <span style={{ position: 'absolute', right: 1, bottom: 0, color: '#f4f1e6', fontSize: Math.max(8, SCALE * 3), lineHeight: 1, textShadow: '1px 1px #3b2a33' }}>…</span>}
            <img src={spriteUrl(spriteOf(carry.fiber ? 'rear/sfp_shade' : 'rear/plug_shade'))} alt="" draggable={false} style={{ position: 'absolute', inset: 0, imageRendering: 'pixelated', display: 'block', width: (carry.fiber ? 8 : 12) * SCALE, height: plugH }} />
          </span>,
          document.body,
        )}

      {/* ポートの一覧: 相手の機器名とポート、ケーブルの種類 */}
      {ports.map((p) => {
        const link = linkAt(p);
        const peer = link ? peerOf(link) : undefined;
        const peerName = peer?.peer ? `${nodeLabel(useGameStore.getState(), peer.peer, nodes)} ${portLabel(gameEnv.devices[peer.peer.device]?.category, peer.end.port)}` : '';
        return (
          <button
            key={p}
            onClick={() => press(p)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              cursor: 'pointer',
              padding: '4px 6px',
              marginBottom: 3,
              background: selected === p ? '#3a5fa8' : 'none',
              color: '#f4f1e6',
              border: '1px solid #3b2a33',
              borderRadius: RADIUS.none,
              fontSize: 12,
            }}
          >
            <span style={{ fontWeight: 'bold', marginRight: 6 }}>{portLabel(category, p)}</span>
            <span style={{ color: link ? '#62d26f' : greyColor }}>{link ? peerName : t('ui.rear.free')}</span>
            {link && <div style={{ color: greyColor, fontSize: 11 }}>{tDyn(`cable.${link.cable}.name`)} {networksOfLink(colors, link.uid).map((network) => <span key={network} style={{ marginLeft: 5 }}><span style={{ display: 'inline-block', width: 8, height: 8, background: `#${(colorOfNetwork(colors, network) ?? colorOfLink(colors, link.uid)).toString(16).padStart(6, '0')}` }} /> {networkLabelOf(colors, network)}</span>)}</div>}
          </button>
        );
      })}

      {active && (
        <div style={{ marginTop: 6 }}>
          <button style={buttonStyle} onClick={() => setReplugging(null)}>
            {t('ui.rear.cancel')}
          </button>
        </div>
      )}
      {!active && selected !== null && selectedLink && !readOnly && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <button
            style={buttonStyle}
            onClick={() => {
              onError(removeLink(selectedLink.uid));
              setSelected(null);
            }}
          >
            {t('ui.rear.unplug')}
          </button>
          <button
            style={buttonStyle}
            onClick={() => {
              onError(null);
              setReplugging({ linkUid: selectedLink.uid, end: selectedLink.a.node === node.uid ? 'a' : 'b' });
            }}
          >
            {t('ui.rear.replug')}
          </button>
        </div>
      )}
    </div>
  );
}
