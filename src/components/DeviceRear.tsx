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
import type { NetLink, NetNode } from '../network/types';
import { colorOfLink, colorOfNetwork, networkLabelOf, networksOfLink } from '../network/netColor';
import { networkColors, portStatesOf } from '../network/public';
import { stpOf } from '../network/public';
import { loadSettings } from '../settings/settings';
import { netOfDevice, useGameStore } from '../stores/useGameStore';
import { isWanPort, plugSlot, portLabel } from './devicePorts';
import { sequenceRefOf } from './SequencePanel';
import { Button } from './ui/Button';
import { ListRow } from './ui/ListRow';
import { Plate } from './ui/Plate';
import { PlugMore, PlugStripe } from './ui/PlugStripe';
import { PortButton } from './ui/PortButton';
import { Swatch } from './ui/Swatch';
import { Led } from './ui/Led';
import { Text } from './ui/Text';
import { MacListField } from './MacListField';
import { can } from '../network/capabilities';
import { macOf } from '../network/mac';
import { portHoverAt, replugTargetAt, swapTargetAt, type PortBox, type PortHover } from './rearDrag';
import { CATEGORY, isPcCategory } from '../data/categories';
import { portCountOf, deviceCategory } from '../registry/query';
import { portSpeedOf } from '../network/query/portSpeedOf';
import { hideTip, showTipLater } from './Tooltip';
import { isPhoneNow } from '../ui/usePhone';

// 背面の部品のスプライトを拡大する倍率（ドット絵を整数倍で描く）
// 背面の部品の拡大率。ポートが多い機器は、板の幅に収まるよう2倍にする
const scaleFor = (ports: number): number => (ports > 4 ? 2 : 3);
// 背面の板で1段に並べるポートの数（9口以上の機器は板の幅に収めるため6口ずつ）
const portsPerRowFor = (ports: number): number => (ports > 8 ? 6 : 8);

// プラグの絵（つながっていれば UTP か光、空いていれば空の差し込み口）
// 差し込み口の絵。SFP の口は、挿していなくても SFP の絵で描く（口の種類は定義どおり）

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
  readOnly: boolean;
  onError: (reason: string | null) => void;
}

export function RearTab({ node, nodes, links, readOnly, onError }: Props) {
  // 画面の計算は、ストアの計算の結果を読む
  const state = useGameStore((s) => netOfDevice(s, node.uid));
  const removeLink = useGameStore((s) => s.removeLink);
  const replug = useGameStore((s) => s.replug);
  const swapPlugs = useGameStore((s) => s.swapPlugs);
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

  const category = deviceCategory(node.device);
  const portCount = portCountOf(node.device);
  const ports = Array.from({ length: portCount }, (_, p) => p);
  const SCALE = scaleFor(portCount);
  const portsPerRow = portsPerRowFor(portCount);
  const byUid = new Map(nodes.map((n) => [n.uid, n]));
  const states = new Map(portStatesOf(state, node.uid).map((s) => [s.port, s]));
  const isRootBridge = stpOf(state).root === node.uid;
  // STP が動いている（どの口にも STP の役割がある）ときだけ、シーケンス図の入口を出す
  const stpOn = [...states.values()].some((s) => s.stp !== undefined);
  const openWindow = useGameStore((s) => s.openWindow);
  const colors = networkColors(state);
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
    const slot = plugSlot(link, portTypeOf(node.device, p) === 'sfp');
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
      // 差してある口の上で離したときは、2本の配線の口を入れ替える（同じ機器の中だけ）
      onDrop: (x, y) => {
        const boxes = portBoxes();
        const target = replugTargetAt(x, y, boxes, isUsedPort);
        if (target !== null) {
          const reason = replug(link.uid, end, target);
          onError(reason);
          if (reason === null) setSelected(target);
          return;
        }
        const swap = swapTargetAt(x, y, boxes, isUsedPort, p);
        if (swap === null) return;
        const reason = swapPlugs(node.uid, p, swap);
        onError(reason);
        if (reason === null) setSelected(swap);
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
  // 選んだ口の先の機器の口の MAC アドレス（ポートセキュリティの登録に使う。連番のない機器は null）
  const selectedPeer = selectedLink ? peerOf(selectedLink) : undefined;
  const selectedPeerMac = selectedPeer?.peer?.macSerial === undefined ? null : macOf(deviceCategory(selectedPeer.peer.device) as string, selectedPeer.peer.macSerial, selectedPeer.end.port);
  const setPortSecurity = useGameStore((s) => s.setPortSecurity);

  // 背面の板: 左から電源・ポート群・ファン（PC とサーバーだけ）。スプライトは3倍に拡大して、ドット絵のまま描く
  const fan = isPcCategory(category) || category === CATEGORY.server;
  // 画面の倍率（UI の大きさ）。位置は倍率で割って指定する（PortMenu と同じ考え方）
  const uiScale = loadSettings().uiScale;
  const plugW = 12 * SCALE;
  const plugH = 10 * SCALE;
  const carryColors = carry
    ? carry.networks.length > 0
      ? carry.networks.slice(0, 3).map((network) => colorOfNetwork(colors, network) ?? colorOfLink(colors, ''))
      : [colorOfLink(colors, '')]
    : [];
  return (
    <div>
      <Plate layout={{ marginBottom: 8 }}>
        <img draggable={false} src={spriteUrl('rear/power')} width={12 * SCALE} height={10 * SCALE} alt="" style={{ imageRendering: 'pixelated', display: 'block' }} />
        {/* ポートは板の幅に収まるよう、1段の口数を決めて段を分ける（9口以上は1段6口） */}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(Math.max(portCount, 1), portsPerRow)}, auto)`, gap: 4 }}>
          {ports.map((p) => {
            const link = linkAt(p);
            // ドラッグ中のプラグは、元の差し込み口を空の絵で見せる（LED も消す）
            const lifted = carry?.port === p;
            const slot = lifted ? (portTypeOf(node.device, p) === 'sfp' ? 'rear/port_sfp_empty' : 'rear/port_empty') : plugSlot(link, portTypeOf(node.device, p) === 'sfp');
            const linkNetworks = link ? networksOfLink(colors, link.uid) : [];
            const stripeNetworks = linkNetworks.slice(0, 3);
            const stripeColors = stripeNetworks.length > 0 ? stripeNetworks.map((network) => colorOfNetwork(colors, network) ?? colorOfLink(colors, link!.uid)) : [colorOfLink(colors, link?.uid ?? '')];
            const maskOf = (isFiber: boolean) => spriteUrl(spriteOf(isFiber ? 'rear/sfp_mask' : 'rear/plug_mask'));
            const fiber = link?.cable.startsWith('fiber') ?? false;
            const lit = !lifted && link !== undefined;
            // LED: 緑＝つながっている・橙＝スパニングツリーで止めている・灰＝停止・消灯＝配線なし（NET.md §5.1）
            const portState = states.get(p);
            const led = !lit ? '#2a2f36' : portState?.shutdown ? '#8a8f98' : portState?.stp === 'blocking' ? '#f0a030' : '#62d26f';
            // 挿し替え中は、空いているポートを光らせて挿し替え先を示す
            const replugFree = active !== null && link === undefined;
            // ドラッグ中は、重なっているポートを明るく（空き）・暗く（埋まり）示す。それ以外は押しているポートを明るくする
            const tone = carry
              ? carry.over?.port === p
                ? carry.over.state === 'free'
                  ? 'lift'
                  : carry.over.port === carry.port
                    ? 'dim'
                    : 'glow'
                : undefined
              : replugFree
                ? 'glow'
                : hover === p
                  ? 'lift'
                  : undefined;
            // WAN の口は LAN の口と間を空けて分ける
            return (
              <div key={p} style={{ marginRight: isWanPort(category, p) ? 10 : 0 }}>
              <PortButton
                buttonRef={(el) => {
                  portRefs.current[p] = el;
                }}
                label={portLabel(category, p)}
                mark={selected === p ? 'selected' : replugFree ? 'target' : undefined}
                tone={tone}
                grab={link !== undefined && grabbable}
                onClick={() => {
                  if (ignoreClick.current) return;
                  press(p);
                }}
                onPointerDown={onPlugDown(p)}
                onDragStart={(e) => e.preventDefault()}
                onMouseEnter={() => {
                  setHover(p);
                  // 口の速さは、つながっていれば配線の速さ、なければ口の定義の速さ
                  const speed = portSpeedOf(state, links, node.uid, node.device, p);
                  if (!isPhoneNow()) {
                    const rest = speed === undefined ? undefined : t('ui.rear.portSpeed', { speed: `${speed}Mb/s` });
                    const anchor = () => {
                      const r = portRefs.current[p]?.getBoundingClientRect();
                      return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
                    };
                    showTipLater(anchor, rest === undefined ? portLabel(category, p) : `${portLabel(category, p)}
${rest}`);
                  }
                }}
                onMouseLeave={() => {
                  setHover(null);
                  hideTip();
                }}
              >
                {/* LED（緑・橙・灰・消灯）。2×2 の点を3倍にする */}
                <Led color={led} size={2 * SCALE} />
                <span style={{ position: 'relative', width: (fiber ? 8 : 12) * SCALE, height: 10 * SCALE, display: 'block' }}>
                  <img src={spriteUrl(spriteOf(slot))} width={(fiber ? 8 : 12) * SCALE} height={10 * SCALE} alt="" draggable={false} style={{ imageRendering: 'pixelated', display: 'block' }} />
                  {!lifted && link && <PlugStripe colors={stripeColors} mask={maskOf(fiber)} />}
                  {!lifted && link && <img src={spriteUrl(spriteOf(fiber ? 'rear/sfp_shade' : 'rear/plug_shade'))} width={(fiber ? 8 : 12) * SCALE} height={10 * SCALE} alt="" draggable={false} style={{ position: 'absolute', inset: 0, imageRendering: 'pixelated', display: 'block', pointerEvents: 'none' }} />}
                  {!lifted && linkNetworks.length > 3 && <PlugMore scale={SCALE} />}
                </span>
                <Text as="span" size="xs">{portLabel(category, p)}</Text>
              </PortButton>
              </div>
            );
          })}
        </div>
        {fan && <img draggable={false} src={spriteUrl('rear/fan')} width={16 * SCALE} height={16 * SCALE} alt="" style={{ imageRendering: 'pixelated', display: 'block' }} />}
      </Plate>

      {/* ドラッグ中のプラグ。指やカーソルに付いて動く（画面の上に出し、ポインターの動きを邪魔しない） */}
      {carry &&
        createPortal(
          <span style={{ position: 'fixed', left: carry.x / uiScale - plugW / 2, top: carry.y / uiScale - plugH / 2, width: (carry.fiber ? 8 : 12) * SCALE, height: plugH, pointerEvents: 'none', zIndex: 1000, zoom: 'var(--ui-scale, 1)' }}>
            <img src={spriteUrl(spriteOf(carry.fiber ? 'rear/port_sfp_empty' : 'rear/port_empty'))} alt="" draggable={false} style={{ imageRendering: 'pixelated', display: 'block', width: (carry.fiber ? 8 : 12) * SCALE, height: plugH }} />
            <PlugStripe colors={carryColors} mask={spriteUrl(spriteOf(carry.fiber ? 'rear/sfp_mask' : 'rear/plug_mask'))} />
            {carry.networks.length > 3 && <PlugMore scale={SCALE} />}
            <img src={spriteUrl(spriteOf(carry.fiber ? 'rear/sfp_shade' : 'rear/plug_shade'))} alt="" draggable={false} style={{ position: 'absolute', inset: 0, imageRendering: 'pixelated', display: 'block', width: (carry.fiber ? 8 : 12) * SCALE, height: plugH }} />
          </span>,
          document.body,
        )}

      {isRootBridge && <Text tone="warn" size="s" layout={{ marginBottom: 6 }}>{t('ui.rear.stpRootBridge')}</Text>}
      {stpOn && <Button variant="secondary" size="s" layout={{ marginBottom: 6 }} onClick={() => openWindow('sequence', sequenceRefOf({ kind: 'stp' }))}>{t('ui.sequence.open')}</Button>}

      {/* ポートの一覧: 相手の機器名とポート、ケーブルの種類 */}
      {ports.map((p) => {
        const link = linkAt(p);
        const peer = link ? peerOf(link) : undefined;
        const peerName = peer?.peer ? `${nodeLabel(useGameStore.getState(), peer.peer, nodes)} ${portLabel(deviceCategory(peer.peer.device), peer.end.port)}` : '';
        return (
          <ListRow key={p} layout={{ marginBottom: 3 }} active={selected === p} onClick={() => press(p)}>
            <div>
              <Text as="span" bold layout={{ marginRight: 6 }}>{portLabel(category, p)}</Text>
              <Text as="span" tone={link ? 'ok' : 'note'}>{link ? peerName : t('ui.rear.free')}</Text>
            </div>
            {node.macSerial !== undefined && <Text tone="note" size="xs">MAC {macOf(category, node.macSerial, p)}</Text>}
            {link && states.get(p)?.shutdown && <Text tone="note" size="xs">{t('ui.rear.shutdown')}</Text>}
            {link && states.get(p)?.stp && <Text tone={states.get(p)?.stp === 'blocking' ? 'halt' : 'note'} size="xs">{t(states.get(p)?.stp === 'blocking' ? 'ui.rear.stpBlocking' : states.get(p)?.stp === 'root' ? 'ui.rear.stpRootPort' : 'ui.rear.stpDesignated')}</Text>}
            {link && states.get(p)?.channel && <Text tone={states.get(p)?.channel?.bundled ? 'ok' : 'halt'} size="xs">{t(states.get(p)?.channel?.bundled ? 'ui.rear.channelBundled' : 'ui.rear.channelSplit', { group: states.get(p)?.channel?.group ?? 0 })}</Text>}
            {link && (
              <Text tone="note" size="xs">
                {tDyn(`cable.${link.cable}.name`)}{' '}
                {networksOfLink(colors, link.uid).map((network) => (
                  <span key={network} style={{ marginLeft: 5 }}>
                    <Swatch color={colorOfNetwork(colors, network) ?? colorOfLink(colors, link.uid)} /> {networkLabelOf(colors, network)}
                  </span>
                ))}
              </Text>
            )}
          </ListRow>
        );
      })}

      {active && (
        <div style={{ marginTop: 6 }}>
          <Button variant="secondary" size="fit" onClick={() => setReplugging(null)}>
            {t('ui.rear.cancel')}
          </Button>
        </div>
      )}
      {!active && selected !== null && selectedLink && !readOnly && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <Button
            variant="secondary"
            size="fit"
            onClick={() => {
              onError(removeLink(selectedLink.uid));
              setSelected(null);
            }}
          >
            {t('ui.rear.unplug')}
          </Button>
          <Button
            variant="secondary"
            size="fit"
            onClick={() => {
              onError(null);
              setReplugging({ linkUid: selectedLink.uid, end: selectedLink.a.node === node.uid ? 'a' : 'b' });
            }}
          >
            {t('ui.rear.replug')}
          </Button>
        </div>
      )}
      {!active && selected !== null && can(node.device, 'switchport') && (
        <div style={{ marginTop: 6 }}>
          <MacListField
            label={t('ui.config.portSecurity')}
            macs={node.ports.find((c) => c.port === selected)?.macs}
            candidates={selectedPeer?.peer && selectedPeerMac !== null ? [{ name: nodeLabel(useGameStore.getState(), selectedPeer.peer, nodes), mac: selectedPeerMac }] : []}
            readOnly={readOnly || node.configLocked}
            apply={(op) => setPortSecurity(node.uid, selected, op)}
            onError={onError}
          />
        </div>
      )}
    </div>
  );
}
