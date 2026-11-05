// 機器の画面の「背面」タブ。ポートを番号つきで並べ、各ポートのLED・相手の機器とポート・ケーブルの種類を出す。
// つながったポートを押すと「外す」「挿し替える」を出す。挿し替えでは、空いているポートを押すと、そこへ挿し替える。
import { useState } from 'react';
import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';
import type { End } from '../sim/project';
import { gameEnv } from '../sim/env';
import type { NetLink, NetNode } from '../network/types';
import { useGameStore } from '../stores/useGameStore';
import { buttonStyle, greyColor, portLabel } from './devicePorts';

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

  const category = gameEnv.devices[node.device]?.category;
  const portCount = gameEnv.devices[node.device]?.portCount ?? 0;
  const ports = Array.from({ length: portCount }, (_, p) => p);
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

  return (
    <div>
      {/* 背面の絵: 番号つきのポートを横に並べ、LED（つながっていれば緑）を付ける */}
      <div style={{ border: '2px solid #3b2a33', borderRadius: 4, background: '#2a4a80', padding: '8px 6px', display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
        {ports.map((p) => {
          const linked = linkAt(p) !== undefined;
          return (
            <button
              key={p}
              aria-label={portLabel(category, p)}
              onClick={() => press(p)}
              style={{
                width: 34,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                padding: 2,
                cursor: 'pointer',
                background: 'none',
                color: '#f4f1e6',
                border: selected === p ? '2px solid #ffd866' : '2px solid transparent',
                fontSize: 11,
              }}
            >
              <span>{portLabel(category, p)}</span>
              <span
                style={{
                  width: 16,
                  height: 10,
                  background: '#25406f',
                  border: '1px solid #3b2a33',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <span style={{ width: 5, height: 5, background: linked ? '#62d26f' : '#3b2a33' }} />
              </span>
            </button>
          );
        })}
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
