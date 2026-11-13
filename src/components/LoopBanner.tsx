// 自社オフィスの配線が輪になっているときの表示。資金や評判には影響させず、社内の通信が止まっていることだけを知らせる
import { useMemo } from 'react';
import { t } from '../i18n/t';
import { loopNodeOf } from '../network/public';
import { useGameStore } from '../stores/useGameStore';
import { labelOfUid } from './nodeLabel';

export function LoopBanner() {
  const state = useGameStore();
  const sandbox = state.mode === 'sandbox';
  const office = state.office;
  // 自社オフィスの計算の結果は、ストアのものを読む
  const netState = state.network.office;
  const loopUid = useMemo(() => (sandbox ? null : loopNodeOf(netState)), [sandbox, netState]);
  if (loopUid === null) return null;
  return (
    <div
      role="alert"
      style={{
        padding: '6px 12px',
        background: '#8a2b2b',
        color: '#f4f1e6',
        fontSize: 13,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
      }}
    >
      {t('ui.loop.banner', { name: labelOfUid(state, loopUid, office.nodes) })}
    </div>
  );
}
