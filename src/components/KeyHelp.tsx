// キー操作の一覧。キーの表（input/keymap.ts）から作る。Enter と Esc で閉じる
import { KEYMAP } from '../input/keymap';
import { t } from '../i18n/t';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Cell, HeadCell, HeadRow, Row, Table } from './ui/Table';
import { Text } from './ui/Text';

export function KeyHelp({ onClose }: { onClose: () => void }) {
  return (
    <Dialog onClose={onClose} primary={onClose} layout={{ width: 'min(420px, calc(100% - 32px))' }}>
      <Text bold size="l" layout={{ marginBottom: 8 }}>{t('ui.help.title')}</Text>
      <div style={{ maxHeight: 'min(60vh, 480px)', overflowY: 'auto' }}>
        <Text size="sm">
          <Table>
            <HeadRow>
              <HeadCell>{t('ui.help.key')}</HeadCell>
              <HeadCell>{t('ui.help.action')}</HeadCell>
            </HeadRow>
            <tbody>
              {KEYMAP.map((b, i) => (
                <Row key={i}>
                  <Cell>
                    <kbd>{b.key}</kbd>
                  </Cell>
                  <Cell>{t(b.name)}</Cell>
                </Row>
              ))}
            </tbody>
          </Table>
        </Text>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
        <Button variant="primary" onClick={onClose}>
          {t('ui.panel.close')}
        </Button>
      </div>
    </Dialog>
  );
}
