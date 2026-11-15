// 回線終端の回線の情報の欄（ISP の名前・回線のネットワーク・ISP 側のアドレス・ISP の AS 番号）。空欄にした項目は既定の ISP に戻る
import { useState } from 'react';
import { t } from '../i18n/t';
import { INTERNET_IP, INTERNET_PREFIX } from '../network/external';
import { isIp } from '../network/command/args';
import { getComponent } from '../network/components';
import type { IspLine, NetNode } from '../network/types';
import { useGameStore } from '../stores/useGameStore';
import { Button } from './ui/Button';
import { Section } from './ui/Section';
import { Text } from './ui/Text';
import { TextInput } from './ui/TextInput';

const row = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', margin: '4px 0' } as const;

export function IspField({ node, readOnly, onError }: { node: NetNode; readOnly: boolean; onError: (reason: string | null) => void }) {
  const setIsp = useGameStore((s) => s.setIsp);
  const cur = getComponent(node, 'isp');
  const [name, setName] = useState(cur?.name ?? '');
  const [ispIp, setIspIp] = useState(cur?.ispIp ?? INTERNET_IP);
  const [prefix, setPrefix] = useState(String(cur?.prefix ?? INTERNET_PREFIX));
  const [asn, setAsn] = useState(cur?.asn === undefined ? '' : String(cur.asn));
  const [dns, setDns] = useState(cur?.dns ?? '');
  const valid = isIp(ispIp) && /^[0-9]+$/.test(prefix) && Number(prefix) >= 8 && Number(prefix) <= 30 && (asn === '' || /^[0-9]+$/.test(asn)) && (dns === '' || isIp(dns));

  const apply = () => {
    const line: IspLine = { name, network: ispIp, prefix: Number(prefix), ispIp, ...(asn === '' ? {} : { asn: Number(asn) }), ...(dns === '' ? {} : { dns }) };
    onError(setIsp(node.uid, line));
  };
  const field = (label: string, value: string, set: (v: string) => void, width: number) => (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {label}
      <TextInput value={value} disabled={readOnly} onChange={set} layout={{ width }} />
    </label>
  );

  return (
    <Section layout={{ marginBottom: 10 }}>
      <b>{t('ui.config.isp')}</b>
      <Text size="s">
        <div style={row}>
          {field(t('ui.config.ispName'), name, setName, 100)}
          {field(t('ui.config.ispIp'), ispIp, setIspIp, 110)}
          {field(t('ui.config.ispPrefix'), prefix, setPrefix, 40)}
          {field(t('ui.config.ispAsn'), asn, setAsn, 70)}
          {field(t('ui.config.ispDns'), dns, setDns, 110)}
        </div>
        <Text tone="note" size="s">{t('ui.config.ispNote')}</Text>
      </Text>
      {!readOnly && (
        <Button variant="secondary" size="fit" disabled={!valid} onClick={apply}>
          {t('ui.config.ispApply')}
        </Button>
      )}
    </Section>
  );
}
