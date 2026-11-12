// スマホの配置かどうか（M1）。判定はこの1か所だけ。ウィンドウ・ツールバー・マップの配置はすべてこの値で切り替える。
// 幅 768 px 未満（縦持ちも横持ちの小さいスマホも含む）、または指で操作する端末で、短い辺が 500 px 未満（横持ちのスマホ）。
import { useEffect, useState } from 'react';

export const PHONE_QUERY = '(max-width: 767px), (pointer: coarse) and (max-height: 499px)';

export function isPhoneNow(): boolean {
  return window.matchMedia(PHONE_QUERY).matches;
}

export function usePhone(): boolean {
  const [phone, setPhone] = useState(isPhoneNow);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const onChange = () => setPhone(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return phone;
}

// 指で操作する端末か（画面の大きさに関係なく、タッチの端末。iPad など）。キーボードを開くかどうかの判定に使う
export const COARSE_QUERY = '(pointer: coarse)';

export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() => window.matchMedia(COARSE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(COARSE_QUERY);
    const onChange = () => setCoarse(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return coarse;
}
