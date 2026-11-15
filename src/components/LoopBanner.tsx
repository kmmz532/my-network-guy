// 自社オフィスの配線が輪になっているときの表示。資金や評判には影響させず、社内の通信が止まっていることだけを知らせる
import { useMemo } from 'react';
import { t } from '../i18n/t';
import { loopNodeOf } from '../network/public';
import { useGameStore } from '../stores/useGameStore';
import { labelOfUid } from './nodeLabel';
import { Notice } from './ui/Notice';

export function LoopBanner() {
  const state = useGameStore();
  const sandbox = state.mode === 'sandbox';
  const office = state.office;
  // 自社オフィスの計算の結果は、ストアのものを読む
  const netState = state.network.office;
  const loopUid = useMemo(() => (sandbox ? null : loopNodeOf(netState)), [sandbox, netState]);
  if (loopUid === null) return null;
  return (
    <Notice tone="banner" role="alert">
      {t('ui.loop.banner', { name: labelOfUid(state, loopUid, office.nodes) })}
    </Notice>
  );
}
