// 機器の画面の「背面」タブ。ポートを番号つきで並べ、各ポートのLED・相手の機器とポート・ケーブルの種類を出す。
// つながったポートを押すと「外す」「挿し替える」を出す。挿し替えでは、空いているポートを押すと、そこへ挿し替える。
import { useState } from 'react';
import { spriteUrl } from '../game/sprites';
import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';
import type { End } from '../sim/project';
import { gameEnv } from '../sim/env';
import type { NetLink, NetNode } from '../network/types';
import { useGameStore } from '../stores/useGameStore';
import { buttonStyle, greyColor, portLabel } from './devicePorts';

// 背面の部品のスプライトを拡大する倍率（ドット絵を整数倍で描く）
// 背面の部品の拡大率。ポートが多い機器は、板の幅に収まるよう2倍にする
const scaleFor = (ports: number): number => (ports > 4 ? 2 : 3);

interface Props {
  node: NetNode;
  // 表示する機器とケーブル（機器の画面で選んだ案件、または自社オフィス）
  nodes: NetNode[];
  links: NetLink[];
  readOnly: boolean;
  onError: (reason: string | null) => void;
}

export function RearTab({ node, nodes, links, readOnly, onError }: Props) {
  const removeLink = useGameStore((s) => s.removeLink);
  const replug = useGameStore((s) => s.replug);
  const [selected, setSelected] = useState<number | null>(null);
  const [replugging, setReplugging] = useState<{ linkUid: string; end: End } | null>(null);
  // マウスを乗せているポート（明るく描く）
  const [hover, setHover] = useState<number | null>(null);

  const category = gameEnv.devices[node.device]?.category;
  const portCount = gameEnv.devices[node.device]?.portCount ?? 0;
  const ports = Array.from({ length: portCount }, (_, p) => p);
  const SCALE = scaleFor(portCount);
  const byUid = new Map(nodes.map((n) => [n.uid, n]));
  const linkAt = (port: number) =>
    links.find((l) => (l.a.node === node.uid && l.a.port === port) || (l.b.node === node.uid && l.b.port === port));
  // 挿し替え中のケーブルが、まだあるか
  const active = replugging && links.some((l) => l.uid === replugging.linkUid) ? replugging : null;

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

  const selectedLink = selected === null ? undefined : linkAt(selected);
  const peerOf = (link: NetLink) => {
    const end = link.a.node === node.uid ? link.b : link.a;
    const peer = byUid.get(end.node);
    return { end, peer };
  };

  // 背面の板: 左から電源・ポート群・ファン（PC とサーバーだけ）。スプライトは3倍に拡大して、ドット絵のまま描く
  const fan = category === 'pc' || category === 'server';
  return (
    <div>
      <div
        style={{
          background: '#3d434b',
          border: '2px solid #3b2a33',
          borderRadius: 4,
          padding: '8px 6px',
          display: 'flex',
          alignItems: 'flex-end',
          gap: 10,
          marginBottom: 8,
          overflowX: 'auto',
        }}
      >
        <img src={spriteUrl('rear/power')} width={12 * SCALE} height={10 * SCALE} alt="" style={{ imageRendering: 'pixelated', display: 'block' }} />
        <div style={{ display: 'flex', gap: 4 }}>
          {ports.map((p) => {
            const link = linkAt(p);
            const slot = !link ? 'rear/port_empty' : link.cable.startsWith('fiber') ? 'rear/port_fiber' : 'rear/port_utp';
            return (
              <button
                key={p}
                aria-label={portLabel(category, p)}
                onClick={() => press(p)}
                onMouseEnter={() => setHover(p)}
                onMouseLeave={() => setHover(null)}
                style={{
                  background: 'none',
                  border: selected === p ? '2px solid #ffd866' : '2px solid transparent',
                  borderRadius: 2,
                  padding: 0,
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                  filter: hover === p ? 'brightness(1.35)' : undefined,
                }}
              >
                {/* LED（つながっていれば緑）。2×2 の点を3倍にする */}
                <span style={{ width: 2 * SCALE, height: 2 * SCALE, background: link ? '#62d26f' : '#2a2f36' }} />
                <img src={spriteUrl(slot)} width={12 * SCALE} height={10 * SCALE} alt="" style={{ imageRendering: 'pixelated', display: 'block' }} />
                <span style={{ color: '#f4f1e6', fontSize: 11, lineHeight: 1 }}>{portLabel(category, p)}</span>
              </button>
            );
          })}
        </div>
        {fan && <img src={spriteUrl('rear/fan')} width={16 * SCALE} height={16 * SCALE} alt="" style={{ imageRendering: 'pixelated', display: 'block' }} />}
      </div>

      {/* ポートの一覧: 相手の機器名とポート、ケーブルの種類 */}
      {ports.map((p) => {
        const link = linkAt(p);
        const peer = link ? peerOf(link) : undefined;
        const peerName = peer?.peer ? `${t(`device.${peer.peer.device}.name` as LangKey)} ${portLabel(gameEnv.devices[peer.peer.device]?.category, peer.end.port)}` : '';
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
              borderRadius: 3,
              fontSize: 12,
            }}
          >
            <span style={{ fontWeight: 'bold', marginRight: 6 }}>{portLabel(category, p)}</span>
            <span style={{ color: link ? '#62d26f' : greyColor }}>{link ? peerName : t('ui.rear.free')}</span>
            {link && <div style={{ color: greyColor, fontSize: 11 }}>{t(`cable.${link.cable}.name` as LangKey)}</div>}
          </button>
        );
      })}

      {active && (
        <div style={{ marginTop: 6 }}>
          <div>{t('ui.rear.replugHint')}</div>
          <button style={{ ...buttonStyle, marginTop: 4 }} onClick={() => setReplugging(null)}>
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
