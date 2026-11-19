// 機器の画面の「メール」の欄（PC だけ）。送信を預けるメールサーバーのアドレス（メールソフトの設定）。空にすると外す。
import { t } from '../i18n/t';
import { getComponent } from '../network/components';
import type { NetNode } from '../network/types';
import { useGameStore } from '../stores/useGameStore';
import { isIpText } from './devicePorts';
import { Section } from './ui/Section';
import { Text } from './ui/Text';
import { TextInput } from './ui/TextInput';

export function MailField({ node, disabled, onError }: { node: NetNode; disabled: boolean; onError: (reason: string | null) => void }) {
  const setMailServer = useGameStore((s) => s.setMailServer);
  const server = getComponent(node, 'mailClient')?.server ?? '';
  const commit = (text: string) => {
    const v = text.trim();
    if (v === server) return;
    if (v === '') return onError(setMailServer(node.uid, null));
    if (!isIpText(v)) return onError('ip');
    onError(setMailServer(node.uid, v));
  };
  return (
    <Section layout={{ marginBottom: 10 }}>
      <div>
        <b>{t('ui.mail.title')}</b>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', margin: '4px 0' }}>
        <Text as="span" tone="note">{t('ui.mail.server')}</Text>
        <TextInput label={t('ui.mail.server')} value={server} disabled={disabled} layout={{ width: 110 }} onCommit={commit} />
      </div>
    </Section>
  );
}
