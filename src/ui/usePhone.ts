// 縦持ちのスマホの幅（640 px 以下）かどうか。PC の見た目を変えないため、この幅のときだけ狭い画面の配置を使う。
// matchMedia が使えないときは false（PC の配置）にする。
import { useEffect, useState } from 'react';

export const PHONE_QUERY = '(max-width: 640px)';

export function isPhoneNow(): boolean {
  try {
    return window.matchMedia(PHONE_QUERY).matches;
  } catch {
    return false;
  }
}

export function usePhone(): boolean {
  const [phone, setPhone] = useState(isPhoneNow);
  useEffect(() => {
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia(PHONE_QUERY);
    } catch {
      return;
    }
    const onChange = () => setPhone(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return phone;
}
