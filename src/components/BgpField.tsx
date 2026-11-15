// BGP の設定欄（機器の画面）。自分の AS 番号・隣接（相手のアドレスと AS 番号・属性）・広告するネットワーク
import { useState } from 'react';
import { t } from '../i18n/t';
import { isIp } from '../network/command/args';
import { getComponent } from '../network/components';
import type { NetNode } from '../network/types';
import { useGameStore } from '../stores/useGameStore';
import { Button } from './ui/Button';
import { Checkbox } from './ui/Checkbox';
import { Section } from './ui/Section';
import { Text } from './ui/Text';
import { TextInput } from './ui/TextInput';

const row = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', margin: '4px 0' } as const;
const isPrivateAs = (asn: number): boolean => asn >= 64512 && asn <= 65534;

const NumberField = ({ label, value, min, disabled, onCommit }: { label: string; value: number; min: number; disabled: boolean; onCommit: (v: number) => void }) => (
  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
    <Text as="span" size="s">{label}</Text>
    <TextInput
      type="number"
      min={min}
      value={String(value)}
      disabled={disabled}
      layout={{ width: 60 }}
      onCommit={(text) => {
        const v = Number(text);
        if (Number.isInteger(v) && v >= min && v !== value) onCommit(v);
      }}
    />
  </label>
);

export function BgpField({ node, readOnly, onError }: { node: NetNode; readOnly: boolean; onError: (reason: string | null) => void }) {
  const setBgp = useGameStore((s) => s.setBgp);
  const [asn, setAsn] = useState('');
  const [ip, setIp] = useState('');
  const [remoteAs, setRemoteAs] = useState('');
  const [dest, setDest] = useState('');
  const [prefix, setPrefix] = useState('24');
  const bgp = getComponent(node, 'bgp');

  if (!bgp) {
    return (
      <Section layout={{ marginBottom: 10 }}>
        <b>{t('ui.config.bgp')}</b>
        <div style={row}>
          <TextInput label={t('ui.config.bgpAsn')} placeholder={t('ui.config.bgpAsn')} value={asn} disabled={readOnly} onChange={setAsn} layout={{ width: 80 }} />
          <Button variant="secondary" size="fit" disabled={readOnly || !/^[0-9]+$/.test(asn)} onClick={() => onError(setBgp(node.uid, { op: 'asn', asn: Number(asn) }))}>
            {t('ui.config.bgpStart')}
          </Button>
        </div>
      </Section>
    );
  }

  return (
    <Section layout={{ marginBottom: 10 }}>
      <b>{t('ui.config.bgp')}</b>
      <div style={row}>
        <NumberField label={t('ui.config.bgpAsn')} value={bgp.asn} min={1} disabled={readOnly} onCommit={(v) => onError(setBgp(node.uid, { op: 'asn', asn: v }))} />
        <Text as="span" tone="note" size="s">{t(isPrivateAs(bgp.asn) ? 'ui.config.bgpAsnPrivate' : 'ui.config.bgpAsnGlobal')}</Text>
        {!readOnly && (
          <Button variant="danger" onClick={() => onError(setBgp(node.uid, { op: 'off' }))}>
            {t('ui.config.bgpOff')}
          </Button>
        )}
      </div>
      {bgp.neighbors.map((nb) => (
        <Section key={nb.ip} edge="top">
          <div style={row}>
            <span>{`${nb.ip}（AS ${nb.remoteAs}）`}</span>
            <Text as="span" tone="note" size="s">{t(nb.remoteAs === bgp.asn ? 'ui.config.bgpKindIbgp' : 'ui.config.bgpKindEbgp')}</Text>
            <Checkbox size="s" checked={nb.nextHopSelf === true} disabled={readOnly} onChange={(on) => onError(setBgp(node.uid, { op: 'attr', ip: nb.ip, key: 'nextHopSelf', value: on }))}>
              {t('ui.config.bgpNextHopSelf')}
            </Checkbox>
            <NumberField label={t('ui.config.bgpLocalPref')} value={nb.localPref ?? 100} min={0} disabled={readOnly} onCommit={(v) => onError(setBgp(node.uid, { op: 'attr', ip: nb.ip, key: 'localPref', value: v }))} />
            <NumberField label={t('ui.config.bgpMed')} value={nb.med ?? 0} min={0} disabled={readOnly} onCommit={(v) => onError(setBgp(node.uid, { op: 'attr', ip: nb.ip, key: 'med', value: v }))} />
            <NumberField label={t('ui.config.bgpPrepend')} value={nb.prepend ?? 0} min={0} disabled={readOnly} onCommit={(v) => onError(setBgp(node.uid, { op: 'attr', ip: nb.ip, key: 'prepend', value: v }))} />
            {!readOnly && (
              <Button variant="danger" onClick={() => onError(setBgp(node.uid, { op: 'removeNeighbor', ip: nb.ip }))}>
                {t('ui.config.remove')}
              </Button>
            )}
          </div>
        </Section>
      ))}
      {!readOnly && (
        <div style={row}>
          <TextInput label={t('ui.config.bgpNeighborIp')} placeholder={t('ui.config.bgpNeighborIp')} value={ip} onChange={setIp} layout={{ width: 120 }} />
          <TextInput label={t('ui.config.bgpRemoteAs')} placeholder={t('ui.config.bgpRemoteAs')} value={remoteAs} onChange={setRemoteAs} layout={{ width: 70 }} />
          <Button
            variant="secondary"
            size="fit"
            disabled={!isIp(ip) || !/^[0-9]+$/.test(remoteAs)}
            onClick={() => {
              const reason = setBgp(node.uid, { op: 'neighbor', ip, remoteAs: Number(remoteAs) });
              onError(reason);
              if (reason === null) {
                setIp('');
                setRemoteAs('');
              }
            }}
          >
            {t('ui.config.bgpAddNeighbor')}
          </Button>
        </div>
      )}
      <div style={{ marginTop: 4 }}>{t('ui.config.bgpNetworks')}</div>
      {bgp.networks.map((n) => (
        <div key={`${n.dest}/${n.prefix}`} style={row}>
          <span>{`${n.dest}/${n.prefix}`}</span>
          {!readOnly && (
            <Button variant="danger" onClick={() => onError(setBgp(node.uid, { op: 'removeNetwork', dest: n.dest, prefix: n.prefix }))}>
              {t('ui.config.remove')}
            </Button>
          )}
        </div>
      ))}
      {!readOnly && (
        <div style={row}>
          <TextInput label={t('ui.config.bgpNetworks')} placeholder="203.0.113.0" value={dest} onChange={setDest} layout={{ width: 120 }} />
          <TextInput label="prefix" value={prefix} onChange={setPrefix} layout={{ width: 44 }} />
          <Button
            variant="secondary"
            size="fit"
            disabled={!isIp(dest) || !/^[0-9]+$/.test(prefix) || Number(prefix) > 32}
            onClick={() => {
              const reason = setBgp(node.uid, { op: 'network', dest, prefix: Number(prefix) });
              onError(reason);
              if (reason === null) setDest('');
            }}
          >
            {t('ui.config.bgpAddNetwork')}
          </Button>
        </div>
      )}
    </Section>
  );
}
