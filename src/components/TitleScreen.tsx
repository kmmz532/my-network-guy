import { t } from '../i18n/t';

interface Props {
  onNew: () => void;
  onContinue: () => void;
  message: string;
}

const buttonStyle = {
  padding: '10px 24px',
  fontSize: 16,
  cursor: 'pointer',
  minWidth: 220,
} as const;

// タイトル画面。新しく始めるか、保存データから続けるかを選ぶ
export function TitleScreen({ onNew, onContinue, message }: Props) {
  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        background: '#2f4f8f',
        color: '#f4f1e6',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
      }}
    >
      <h1 style={{ fontSize: 32, margin: 0 }}>{t('ui.title.name')}</h1>
      <button style={buttonStyle} onClick={onNew}>
        {t('ui.title.new')}
      </button>
      <button style={buttonStyle} onClick={onContinue}>
        {t('ui.title.continue')}
      </button>
      {message && <div style={{ color: '#ffd866' }}>{message}</div>}
    </div>
  );
}
