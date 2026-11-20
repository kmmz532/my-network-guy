// MAC アドレスの登録の欄（N153）。ポートセキュリティ（スイッチの口）と無線の MAC フィルター（アクセスポイント）が使う。
// 有効にすると、登録した MAC アドレスの機器だけを通す。候補（つながっている機器）はボタン1つで登録でき、ほかは入力して登録する
import { t } from '../i18n/t';
import type { MacListOp } from '../sim/project';
import { Button } from './ui/Button';
import { Checkbox } from './ui/Checkbox';
import { Text } from './ui/Text';
import { TextInput } from './ui/TextInput';

const row = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', margin: '4px 0' } as const;

interface Props {
  label: string;
  // 登録の一覧。undefined は無効（制限しない）
  macs: string[] | undefined;
  // 登録のボタンを出す候補（名前と MAC アドレス）。登録済みのものは出さない
  candidates: { name: string; mac: string }[];
  readOnly: boolean;
  apply: (op: MacListOp) => string | null;
  onError: (reason: string | null) => void;
}

export function MacListField({ label, macs, candidates, readOnly, apply, onError }: Props) {
  const run = (op: MacListOp) => onError(apply(op));
  return (
    <Text size="s">
      <div style={row}>
        <Checkbox label={label} checked={macs !== undefined} disabled={readOnly} onChange={(on) => run({ op: on ? 'on' : 'off' })}>
          {label}
        </Checkbox>
      </div>
      {macs !== undefined && (
        <>
          {macs.length === 0 && <Text tone="note" size="s">{t('ui.config.macListEmpty')}</Text>}
          {macs.map((mac) => (
            <div key={mac} style={row}>
              <code>{mac}</code>
              <Button variant="danger" size="s" disabled={readOnly} onClick={() => run({ op: 'remove', mac })}>{t('ui.config.macListRemove')}</Button>
            </div>
          ))}
          {candidates.filter((c) => !macs.includes(c.mac)).map((c) => (
            <div key={c.mac} style={row}>
              <Button variant="secondary" size="s" disabled={readOnly} onClick={() => run({ op: 'add', mac: c.mac })}>
                {t('ui.config.macListAdd', { name: c.name })}
              </Button>
            </div>
          ))}
          <div style={row}>
            <TextInput
              layout={{ width: 150 }}
              value=""
              placeholder="xx:xx:xx:xx:xx:xx"
              disabled={readOnly}
              onCommit={(text) => {
                if (text.trim() !== '') run({ op: 'add', mac: text.trim() });
              }}
            />
          </div>
        </>
      )}
    </Text>
  );
}
