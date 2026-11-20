// 口のポートセキュリティの欄（N153）。有効にした口は、登録した MAC アドレスの機器だけを通す。
// つながっている機器の MAC アドレスは、ボタン1つで登録できる。ほかの MAC アドレスは入力して登録する
import { t } from '../i18n/t';
import type { NetNode } from '../network/types';
import { useGameStore } from '../stores/useGameStore';
import { Button } from './ui/Button';
import { Checkbox } from './ui/Checkbox';
import { Text } from './ui/Text';
import { TextInput } from './ui/TextInput';

const row = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', margin: '4px 0' } as const;

// peerMac: その口の先につながっている機器の口の MAC アドレス（つながっていなければ null）
export function PortSecurityField({ node, port, peerMac, readOnly, onError }: { node: NetNode; port: number; peerMac: string | null; readOnly: boolean; onError: (reason: string | null) => void }) {
  const setPortSecurity = useGameStore((s) => s.setPortSecurity);
  const macs = node.ports.find((p) => p.port === port)?.macs;
  return (
    <Text size="s">
      <div style={row}>
        <Checkbox
          label={t('ui.config.portSecurity')}
          checked={macs !== undefined}
          disabled={readOnly}
          onChange={(on) => onError(setPortSecurity(node.uid, port, { op: on ? 'on' : 'off' }))}
        >
          {t('ui.config.portSecurity')}
        </Checkbox>
      </div>
      {macs !== undefined && (
        <>
          {macs.length === 0 && <Text tone="note" size="s">{t('ui.config.portSecurityEmpty')}</Text>}
          {macs.map((mac) => (
            <div key={mac} style={row}>
              <code>{mac}</code>
              <Button variant="danger" size="s" disabled={readOnly} onClick={() => onError(setPortSecurity(node.uid, port, { op: 'remove', mac }))}>{t('ui.config.portSecurityRemove')}</Button>
            </div>
          ))}
          <div style={row}>
            {peerMac !== null && !macs.includes(peerMac) && (
              <Button variant="secondary" size="s" disabled={readOnly} onClick={() => onError(setPortSecurity(node.uid, port, { op: 'add', mac: peerMac }))}>
                {t('ui.config.portSecurityAddPeer')}
              </Button>
            )}
            <TextInput
              layout={{ width: 150 }}
              value=""
              placeholder="xx:xx:xx:xx:xx:xx"
              disabled={readOnly}
              onCommit={(text) => {
                if (text.trim() !== '') onError(setPortSecurity(node.uid, port, { op: 'add', mac: text.trim() }));
              }}
            />
          </div>
        </>
      )}
    </Text>
  );
}
