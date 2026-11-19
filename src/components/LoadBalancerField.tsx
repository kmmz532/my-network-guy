// 機器の画面の「負荷分散」の欄（能力 loadBalance を持つ機器だけ）。仮想サーバーの追加・削除と、振り分け先の追加・削除。
// 振り分け先の健全の印は、振り分けの計算と同じ判定（healthyMembers）で出す。
import { useState, type ReactNode } from 'react';
import { t } from '../i18n/t';
import { getComponent } from '../network/components';
import { reach } from '../network/engine/forward';
import type { NetworkState } from '../network/engine/state';
import { healthyMembers, type Member, type VirtualServer } from '../network/query/loadBalancer';
import type { NetNode } from '../network/types';
import { useGameStore } from '../stores/useGameStore';
import { isIpText } from './devicePorts';
import { Button } from './ui/Button';
import { Checkbox } from './ui/Checkbox';
import { Section } from './ui/Section';
import { Select } from './ui/Select';
import { Text } from './ui/Text';
import { TextInput } from './ui/TextInput';

const row = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', margin: '4px 0' } as const;

// 入力欄の前に、何を入れる欄かを書く
const Labeled = ({ text, children }: { text: string; children: ReactNode }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
    <Text as="span" tone="note">{text}</Text>
    {children}
  </span>
);

const METHOD_KEY = { round_robin: 'ui.lb.method.round_robin', source_ip: 'ui.lb.method.source_ip' } as const;
const CHECK_KEY = { none: 'ui.lb.check.none', ping: 'ui.lb.check.ping', http: 'ui.lb.check.http' } as const;

// 1〜65535 の整数のポート番号。範囲の外なら undefined
const portOf = (text: string): number | undefined => {
  const p = Number(text);
  return Number.isInteger(p) && p >= 1 && p <= 65535 ? p : undefined;
};

interface Props {
  node: NetNode;
  netState: NetworkState;
  disabled: boolean;
  onError: (reason: string | null) => void;
}

export function LoadBalancerField({ node, netState, disabled, onError }: Props) {
  const setLoadBalancer = useGameStore((s) => s.setLoadBalancer);
  const servers = getComponent(node, 'loadBalancer') ?? [];
  // 仮想の IP アドレスは、この機器の口のアドレスから選ぶ
  const addresses = node.interfaces.filter((i) => Boolean(i.ip)).map((i) => i.ip);
  const save = (next: VirtualServer[]) => onError(setLoadBalancer(node.uid, next));

  return (
    <Section layout={{ marginBottom: 10 }}>
      <div>
        <b>{t('ui.lb.title')}</b>
      </div>
      {servers.length === 0 && <Text tone="note">{t('ui.lb.none')}</Text>}
      {servers.map((vs, i) => {
        const healthy = healthyMembers(netState, node, vs, reach);
        return (
          <div key={`${vs.vip}-${vs.port}-${i}`} style={{ margin: '6px 0' }}>
            <div style={row}>
              <span>
                {t('ui.terminal.lbVirtual', {
                  vip: vs.vip,
                  port: vs.port,
                  method: t(METHOD_KEY[vs.method]),
                  check: t(CHECK_KEY[vs.healthCheck]),
                  snat: t(vs.snat ? 'ui.lb.snatOn' : 'ui.lb.snatOff'),
                })}
              </span>
              {!disabled && (
                <Button variant="danger" onClick={() => save(servers.filter((_, j) => j !== i))}>
                  {t('ui.lb.removeVs')}
                </Button>
              )}
            </div>
            {vs.members.map((m, j) => {
              const up = healthy.includes(m);
              return (
                <div key={`${m.ip}-${m.port}-${j}`} style={{ ...row, paddingLeft: 12 }}>
                  <span>{t('ui.lb.member', { ip: m.ip, port: m.port })}</span>
                  <Text as="span" tone={up ? 'normal' : 'error'}>
                    {t(up ? 'ui.lb.up' : 'ui.lb.down')}
                  </Text>
                  {!disabled && vs.members.length > 1 && (
                    <Button
                      variant="danger"
                      onClick={() => save(servers.map((v, k) => (k === i ? { ...v, members: v.members.filter((_, x) => x !== j) } : v)))}
                    >
                      {t('ui.config.remove')}
                    </Button>
                  )}
                </div>
              );
            })}
            {!disabled && vs.members.length === 1 && (
              <div style={{ paddingLeft: 12 }}>
                <Text tone="note">{t('ui.lb.lastMember')}</Text>
              </div>
            )}
            {!disabled && (
              <LbMemberAdd onAdd={(m) => save(servers.map((v, k) => (k === i ? { ...v, members: [...v.members, m] } : v)))} onError={onError} />
            )}
          </div>
        );
      })}
      {!disabled &&
        (addresses.length === 0 ? (
          <Text tone="note">{t('ui.lb.noVip')}</Text>
        ) : (
          <LbServerAdd addresses={addresses} onAdd={(vs) => save([...servers, vs])} onError={onError} />
        ))}
    </Section>
  );
}

// 振り分け先を1つ追加する（アドレスとポート番号）
function LbMemberAdd({ onAdd, onError }: { onAdd: (m: Member) => void; onError: (reason: string | null) => void }) {
  const [ip, setIp] = useState('');
  const [port, setPort] = useState('80');
  const add = () => {
    if (!isIpText(ip)) return onError('ip');
    const p = portOf(port);
    if (p === undefined) return onError('lbPort');
    onAdd({ ip, port: p });
    setIp('');
  };
  return (
    <div style={{ ...row, paddingLeft: 12 }}>
      <TextInput label={t('ui.lb.memberIp')} placeholder={t('ui.lb.memberIp')} value={ip} onChange={setIp} layout={{ width: 140 }} />
      <Labeled text={t('ui.lb.port')}><TextInput label={t('ui.lb.port')} value={port} onChange={setPort} layout={{ width: 56 }} /></Labeled>
      <Button variant="secondary" onClick={add}>
        {t('ui.lb.addMember')}
      </Button>
    </div>
  );
}

// 仮想サーバーを1つ追加する（仮想の IP・ポート・方式・ヘルスチェック・SNAT と、最初の振り分け先）
function LbServerAdd({ addresses, onAdd, onError }: { addresses: string[]; onAdd: (vs: VirtualServer) => void; onError: (reason: string | null) => void }) {
  const [vip, setVip] = useState(addresses[0]);
  const [port, setPort] = useState('80');
  const [method, setMethod] = useState<VirtualServer['method']>('round_robin');
  const [check, setCheck] = useState<VirtualServer['healthCheck']>('http');
  const [snat, setSnat] = useState(false);
  const [memberIp, setMemberIp] = useState('');
  const [memberPort, setMemberPort] = useState('80');
  const add = () => {
    const p = portOf(port);
    const mp = portOf(memberPort);
    if (p === undefined || mp === undefined) return onError('lbPort');
    if (!isIpText(memberIp)) return onError('ip');
    onAdd({ vip, port: p, method, healthCheck: check, snat, members: [{ ip: memberIp, port: mp }] });
    setMemberIp('');
  };
  return (
    <div style={{ ...row, flexWrap: 'wrap' }}>
      <Labeled text={t('ui.lb.vip')}><Select box="pixel" label={t('ui.lb.vip')} value={vip} options={addresses.map((a) => ({ value: a, label: a }))} onChange={setVip} /></Labeled>
      <Labeled text={t('ui.lb.port')}><TextInput label={t('ui.lb.port')} value={port} onChange={setPort} layout={{ width: 56 }} /></Labeled>
      <Labeled text={t('ui.lb.method')}>
      <Select
        box="pixel"
        label={t('ui.lb.method')}
        value={method}
        options={[
          { value: 'round_robin', label: t(METHOD_KEY.round_robin) },
          { value: 'source_ip', label: t(METHOD_KEY.source_ip) },
        ]}
        onChange={(v) => setMethod(v as VirtualServer['method'])}
      />
      </Labeled>
      <Labeled text={t('ui.lb.check')}>
      <Select
        box="pixel"
        label={t('ui.lb.check')}
        value={check}
        options={[
          { value: 'none', label: t(CHECK_KEY.none) },
          { value: 'ping', label: t(CHECK_KEY.ping) },
          { value: 'http', label: t(CHECK_KEY.http) },
        ]}
        onChange={(v) => setCheck(v as VirtualServer['healthCheck'])}
      />
      </Labeled>
      <Checkbox size="s" label={t('ui.lb.snat')} checked={snat} onChange={setSnat}>
        {t('ui.lb.snat')}
      </Checkbox>
      <TextInput label={t('ui.lb.memberIp')} placeholder={t('ui.lb.memberIp')} value={memberIp} onChange={setMemberIp} layout={{ width: 140 }} />
      <Labeled text={t('ui.lb.port')}><TextInput label={t('ui.lb.port')} value={memberPort} onChange={setMemberPort} layout={{ width: 56 }} /></Labeled>
      <Button variant="primary" onClick={add}>
        {t('ui.lb.addVs')}
      </Button>
    </div>
  );
}
