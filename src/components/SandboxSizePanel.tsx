// サンドボックスの広さを選ぶ小さな画面。新しく始めるときと、後で広さを変えるときに使う。
// submit が理由を返したら、その理由を出して閉じない。成功したら閉じる。
import { useState } from 'react';
import { t } from '../i18n/t';
import type { OfficeSize } from '../sim/project';
import { SANDBOX_DEFAULT_SIZE, SANDBOX_SIZES } from '../sim/sandbox';
import { Modal } from './Modal';
import { Button } from './ui/Button';

const sizeLabel = (size: OfficeSize) => `${size.w}×${size.h}`;

export function SandboxSizePanel({
  title,
  start,
  current,
  submit,
  onClose,
}: {
  title: string;
  // 押したボタンの文言
  start: string;
  // 選んでいる大きさの初期値（省くと既定）
  current?: OfficeSize;
  // 選んだ大きさで実行する。失敗したら理由の文言を返す
  submit: (size: OfficeSize) => string | null;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<OfficeSize>(current ?? SANDBOX_DEFAULT_SIZE);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    const reason = submit(picked);
    if (reason) setError(reason);
    else onClose();
  };

  const isPicked = (size: OfficeSize) => size.w === picked.w && size.h === picked.h;

  return (
    <Modal onClose={onClose} primary={run} boxStyle={{ width: 'min(320px, calc(100% - 32px))' }}>
      <div style={{ fontWeight: 'bold' }}>{title}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {SANDBOX_SIZES.map((size) => (
          <Button
            key={sizeLabel(size)}
            variant="outline"
            pressed={isPicked(size)}
            onClick={() => {
              setPicked(size);
              setError(null);
            }}
          >
            {sizeLabel(size)}
          </Button>
        ))}
      </div>
      {error && <div style={{ marginTop: 8, color: '#ffb4a8', fontSize: 13 }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
        <Button variant="outline" onClick={onClose}>
          {t('ui.sandbox.size.cancel')}
        </Button>
        <Button variant="primary" onClick={run}>
          {start}
        </Button>
      </div>
    </Modal>
  );
}
