// 機器の画面の「VPN」の欄（能力 vpn を持つ機器だけ）。トンネルの一覧（相手・方式・守るネットワークの組・張れているか、失敗の理由）と、追加・削除。
// 張れているかは、転送と同じ判定（netState.vpn）の結果を出す。「シーケンス図を見る」は、相手の機器がわかるトンネルだけ出す。
import { useState, type ReactNode } from 'react';
import { t, tDyn } from '../i18n/t';
import { getComponent, type Components } from '../network/components';
import type { NetworkState } from '../network/engine/state';
import type { NetNode } from '../network/types';
import { useGameStore } from '../stores/useGameStore';
import { sequenceRefOf } from '../ui/sequenceRef';
import { isIpText } from './devicePorts';
import { Button } from './ui/Button';
import { Section } from './ui/Section';
import { Select } from './ui/Select';
import { Text } from './ui/Text';
import { TextInput } from './ui/TextInput';

type Tunnel = NonNullable<Components['vpn']>[number];

const row = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', margin: '4px 0' } as const;

// 入力欄の前に、何を入れる欄かを書く
const Labeled = ({ text, children }: { text: string; children: ReactNode }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
    <Text as="span" tone="note">{text}</Text>
    {children}
  </span>
);

const CIPHER_KEY = { aes: 'ui.vpn.cipher.aes', '3des': 'ui.vpn.cipher.3des' } as const;

// a.b.c.d/nn（0〜32）の形なら true
const isCidrText = (s: string): boolean => {
  const [ip, prefix, ...rest] = s.split('/');
  return rest.length === 0 && isIpText(ip) && /^\d{1,2}$/.test(prefix ?? '') && Number(prefix) <= 32;
};

interface Props {
  node: NetNode;
  netState: NetworkState;
  disabled: boolean;
  onError: (reason: string | null) => void;
}

export function VpnField({ node, netState, disabled, onError }: Props) {
  const setVpn = useGameStore((s) => s.setVpn);
  const openWindow = useGameStore((s) => s.openWindow);
  const tunnels = getComponent(node, 'vpn') ?? [];
  const save = (next: Tunnel[]) => onError(setVpn(node.uid, next));

  return (
    <Section layout={{ marginBottom: 10 }}>
      <div>
        <b>{t('ui.vpn.title')}</b>
      </div>
      {tunnels.length === 0 && <Text tone="note">{t('ui.vpn.none')}</Text>}
      {tunnels.map((tu, i) => {
        const status = netState.vpn.tunnels.find((s) => s.router === node.uid && s.index === i);
        // 相手の機器（シーケンス図の相手）: 張れていれば相手の uid、張れていなければ相手の WAN のアドレスを持つ機器
        const peerUid = status?.ok ? status.peer : netState.net.nodes.find((n) => n.uid !== node.uid && n.interfaces.some((x) => x.ip === tu.peer))?.uid;
        return (
          <div key={`${tu.peer}-${i}`} style={{ margin: '6px 0' }}>
            <div style={row}>
              <span>{t('ui.vpn.tunnel', { peer: tu.peer, cipher: t(CIPHER_KEY[tu.cipher]), local: tu.local, remote: tu.remote })}</span>
              {status?.ok ? (
                <Text as="span" tone="normal">{t('ui.vpn.up')}</Text>
              ) : (
                <Text as="span" tone="error">{status ? `${t('ui.vpn.down')}（${tDyn(`error.${status.reason}`)}）` : t('ui.vpn.down')}</Text>
              )}
              {peerUid !== undefined && (
                <Button variant="secondary" size="s" onClick={() => openWindow('sequence', sequenceRefOf({ kind: 'vpn', a: node.uid, b: peerUid }))}>
                  {t('ui.sequence.open')}
                </Button>
              )}
              {!disabled && (
                <Button variant="danger" onClick={() => save(tunnels.filter((_, j) => j !== i))}>
                  {t('ui.vpn.remove')}
                </Button>
              )}
            </div>
          </div>
        );
      })}
      {!disabled && <VpnAdd onAdd={(tu) => save([...tunnels, tu])} onError={onError} />}
    </Section>
  );
}

// トンネルを1つ追加する（相手の WAN のアドレス・事前共有鍵・方式・自拠点の LAN・相手の LAN）
function VpnAdd({ onAdd, onError }: { onAdd: (tu: Tunnel) => void; onError: (reason: string | null) => void }) {
  const [peer, setPeer] = useState('');
  const [psk, setPsk] = useState('');
  const [cipher, setCipher] = useState<Tunnel['cipher']>('aes');
  const [local, setLocal] = useState('');
  const [remote, setRemote] = useState('');
  const add = () => {
    if (!isIpText(peer)) return onError('ip');
    if (psk === '') return onError('vpnPsk');
    if (!isCidrText(local) || !isCidrText(remote)) return onError('vpnCidr');
    onAdd({ peer, psk, cipher, local, remote });
    setPeer('');
    setPsk('');
    setLocal('');
    setRemote('');
  };
  return (
    <div style={{ ...row, flexWrap: 'wrap' }}>
      <Labeled text={t('ui.vpn.peerIp')}>
        <TextInput label={t('ui.vpn.peerIp')} value={peer} onChange={setPeer} layout={{ width: 120 }} />
      </Labeled>
      <Labeled text={t('ui.vpn.psk')}>
        <TextInput label={t('ui.vpn.psk')} value={psk} onChange={setPsk} layout={{ width: 120 }} />
      </Labeled>
      <Labeled text={t('ui.vpn.cipher')}>
        <Select
          box="pixel"
          label={t('ui.vpn.cipher')}
          value={cipher}
          options={[
            { value: 'aes', label: t(CIPHER_KEY.aes) },
            { value: '3des', label: t(CIPHER_KEY['3des']) },
          ]}
          onChange={(v) => setCipher(v as Tunnel['cipher'])}
        />
      </Labeled>
      <Labeled text={t('ui.vpn.local')}>
        <TextInput label={t('ui.vpn.local')} placeholder="10.1.0.0/24" value={local} onChange={setLocal} layout={{ width: 130 }} />
      </Labeled>
      <Labeled text={t('ui.vpn.remote')}>
        <TextInput label={t('ui.vpn.remote')} placeholder="10.2.0.0/24" value={remote} onChange={setRemote} layout={{ width: 130 }} />
      </Labeled>
      <Button variant="primary" onClick={add}>
        {t('ui.vpn.add')}
      </Button>
    </div>
  );
}
