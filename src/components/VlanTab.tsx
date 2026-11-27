// 機器の画面の VLAN のタブ（NET.md §8）。VLAN ごとに、番号・名前・属するアクセスの口・通すトランクの口を表にする。
// VLAN の宣言と名前はターミナル（vlan・name）、口の設定は背面のタブで口を押して変える
import { t } from '../i18n/t';
import type { NetNode } from '../network/types';
import { vlanTableOf } from '../network/query/vlanTable';
import { portCountOf } from '../registry/query';
import { Cell, HeadCell, HeadRow, Row, Table } from './ui/Table';
import { Text } from './ui/Text';

const portsText = (ports: readonly number[]): string => (ports.length === 0 ? '-' : ports.join(', '));

export function VlanTab({ node }: { node: NetNode }) {
  const rows = vlanTableOf(node, portCountOf(node.device));
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
      <Text size="s" tone="soft" layout={{ marginTop: 6 }}>
        {t('ui.vlan.hint')}
      </Text>
    </div>
  );
}
