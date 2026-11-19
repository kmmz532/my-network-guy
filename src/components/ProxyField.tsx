// 機器の画面の「プロキシ」の欄（PC だけ）。HTTP を届けるプロキシのアドレスとポート、プロキシを通さず直接つなぐ名前の接尾辞（PAC の direct）。
// アドレスを空にすると、プロキシの設定を外す。ポートは、アドレスを設定してから入力できる。
import type { ReactNode } from 'react';
import { t } from '../i18n/t';
import { getComponent } from '../network/components';
import type { NetNode } from '../network/types';
import { useGameStore } from '../stores/useGameStore';
import { isIpText } from './devicePorts';
import { Section } from './ui/Section';
import { Text } from './ui/Text';
import { TextInput } from './ui/TextInput';

const DEFAULT_PORT = 8080;

const row = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', margin: '4px 0' } as const;

const Labeled = ({ text, children }: { text: string; children: ReactNode }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
    <Text as="span" tone="note">{text}</Text>
    {children}
  </span>
);

export function ProxyField({ node, disabled, onError }: { node: NetNode; disabled: boolean; onError: (reason: string | null) => void }) {
  const setProxy = useGameStore((s) => s.setProxy);
  const setPac = useGameStore((s) => s.setPac);
  const client = getComponent(node, 'proxyClient');
  const proxy = client?.proxy;
  const direct = client?.pac?.direct ?? [];
  const commitIp = (text: string) => {
    const v = text.trim();
    if (v === (proxy?.ip ?? '')) return;
    if (v === '') return onError(setProxy(node.uid, null));
    if (!isIpText(v)) return onError('ip');
    onError(setProxy(node.uid, { ip: v, port: proxy?.port ?? DEFAULT_PORT }));
  };
  const commitPort = (text: string) => {
    if (proxy === undefined) throw new Error('プロキシのアドレスがない状態でポートが確定された');
    const port = Number(text.trim());
    if (port === proxy.port) return;
    onError(setProxy(node.uid, { ip: proxy.ip, port }));
  };
  const commitPac = (text: string) => {
    const list = text.split(',').map((s) => s.trim()).filter((s) => s !== '');
    if (list.join(',') === direct.join(',')) return;
    onError(setPac(node.uid, list));
  };
  return (
    <Section layout={{ marginBottom: 10 }}>
      <div>
        <b>{t('ui.proxy.title')}</b>
      </div>
      <div style={row}>
        <Labeled text={t('ui.proxy.address')}>
          <TextInput label={t('ui.proxy.address')} value={proxy?.ip ?? ''} disabled={disabled} layout={{ width: 110 }} onCommit={commitIp} />
        </Labeled>
        <Labeled text={t('ui.proxy.port')}>
          <TextInput label={t('ui.proxy.port')} type="number" min={1} max={65535} value={proxy === undefined ? '' : String(proxy.port)} disabled={disabled || proxy === undefined} layout={{ width: 70 }} onCommit={commitPort} />
        </Labeled>
      </div>
      <div style={row}>
        <Labeled text={t('ui.proxy.pac')}>
          <TextInput label={t('ui.proxy.pac')} width="l" value={direct.join(', ')} disabled={disabled} onCommit={commitPac} />
        </Labeled>
      </div>
    </Section>
  );
}
