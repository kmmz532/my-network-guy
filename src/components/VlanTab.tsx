// 機器の画面の VLAN のタブ（NET.md §8）。VLAN ごとに、番号・名前・属するアクセスの口・通すトランクの口を表にする。
// VLAN を足す・名前を付ける・消すのは、この表の下の欄で行う（ターミナルの vlan・name・no vlan と同じ）。口の設定は背面のタブで口を押して変える
import { useState } from 'react';
import { t } from '../i18n/t';
import type { NetNode } from '../network/types';
import { vlanTableOf } from '../network/query/vlanTable';
import { portCountOf } from '../registry/query';
import { useGameStore } from '../stores/useGameStore';
import { Button } from './ui/Button';
import { Cell, HeadCell, HeadRow, Row, Table } from './ui/Table';
import { Text } from './ui/Text';
import { TextInput } from './ui/TextInput';

const portsText = (ports: readonly number[]): string => (ports.length === 0 ? '-' : ports.join(', '));
const row = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 8 } as const;

export function VlanTab({ node, readOnly, onError }: { node: NetNode; readOnly: boolean; onError: (reason: string | null) => void }) {
  const rows = vlanTableOf(node, portCountOf(node.device));
  const setVlanDef = useGameStore((s) => s.setVlanDef);
  const [vlan, setVlan] = useState('');
  const [name, setName] = useState('');
  const locked = readOnly || node.configLocked === true;
  const id = Number(vlan);
  const valid = /^\d+$/.test(vlan) && id >= 2 && id <= 4094 && /^[A-Za-z0-9_-]*$/.test(name);
  // 足す（まだなければ）・名前を付ける（入れたとき）。名前だけを変えるときも、同じ番号で押す
  const apply = () => {
    const declared = rows.some((r) => r.id === id);
    const added = declared ? null : setVlanDef(node.uid, id, { op: 'add' });
    const reason = added ?? (name === '' ? null : setVlanDef(node.uid, id, { op: 'name', name }));
    onError(reason);
    if (reason === null) {
      setVlan('');
      setName('');
    }
  };
  const remove = () => {
    const reason = setVlanDef(node.uid, id, { op: 'remove' });
    onError(reason);
    if (reason === null) {
      setVlan('');
      setName('');
    }
  };
  return (
    <div>
      <Table>
        <HeadRow>
          <HeadCell>{t('ui.vlan.id')}</HeadCell>
          <HeadCell>{t('ui.vlan.name')}</HeadCell>
          <HeadCell>{t('ui.vlan.access')}</HeadCell>
          <HeadCell>{t('ui.vlan.trunk')}</HeadCell>
        </HeadRow>
        <tbody>
          {rows.map((r) => (
            <Row key={r.id}>
              <Cell>{r.id}</Cell>
              <Cell>{r.name ?? (r.id === 1 ? t('ui.vlan.default') : '-')}</Cell>
              <Cell>{portsText(r.access)}</Cell>
              <Cell>{portsText(r.trunk)}</Cell>
            </Row>
          ))}
        </tbody>
      </Table>
      <div style={row}>
        <TextInput label={t('ui.vlan.id')} placeholder={t('ui.vlan.id')} value={vlan} disabled={locked} onChange={setVlan} layout={{ width: 56 }} />
        <TextInput label={t('ui.vlan.name')} placeholder={t('ui.vlan.name')} value={name} disabled={locked} onChange={setName} layout={{ width: 120 }} />
        <Button variant="secondary" size="fit" disabled={locked || !valid} onClick={apply}>
          {t('ui.vlan.apply')}
        </Button>
        {/* 入れた番号の VLAN を消す。VLAN 1 は既定のため消せない */}
        <Button variant="secondary" size="fit" disabled={locked || !valid || !rows.some((r) => r.id === id)} onClick={remove}>
          {t('ui.vlan.remove')}
        </Button>
      </div>
      <Text size="s" tone="soft" layout={{ marginTop: 6 }}>
        {t('ui.vlan.hint')}
      </Text>
    </div>
  );
}
