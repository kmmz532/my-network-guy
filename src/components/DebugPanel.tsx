// デバッグのパネル（N54）。?debug=1 のときだけ、App が遅延読み込みで出す。操作は既存の操作（ストアと update.ts）を呼ぶ
import { useState, type CSSProperties } from 'react';
import { balance } from 'virtual:game-data';
import { SAVE_VERSION } from '../services/migrations';
import { exportSave, importSave } from '../services/saveFile';
import { showUpdateNotice } from '../pwa/update';
import { isPhoneNow } from '../ui/usePhone';
import { levelOf } from '../sim/level';
import { useGameStore } from '../stores/useGameStore';
import { RADIUS } from '../ui/theme';

const MINUTES_PER_DAY = 1440;

const buttonStyle: CSSProperties = {
  padding: '4px 8px',
  minHeight: 32,
  background: '#25406f',
  color: '#f4f1e6',
  border: '2px solid #3b2a33',
  borderRadius: RADIUS.chrome,
  cursor: 'pointer',
  fontSize: 12,
  textAlign: 'left',
};

export default function DebugPanel() {
  const [open, setOpen] = useState(false);
  // パネルを開いたときに控える今のセーブ（「控えに戻す」で戻す）
  const [backup, setBackup] = useState<ReturnType<ReturnType<typeof useGameStore.getState>['snapshot']> | null>(null);
  const [message, setMessage] = useState('');
  const [saveText, setSaveText] = useState('');
  const companyExp = useGameStore((s) => s.companyExp);
  const minute = useGameStore((s) => s.clock.minute);
  const level = levelOf(companyExp, balance);

  const toggle = () => {
    if (!open) setBackup(useGameStore.getState().snapshot());
    setOpen(!open);
  };
  const say = (text: string) => setMessage(text);
  const act = (fn: () => void, text: string) => () => {
    fn();
    say(text);
  };
  const store = useGameStore.getState;

  // 次の夜勤の開始・翌日の0時（今より後）
  const day = Math.floor(minute / MINUTES_PER_DAY);
  const nightStart = day * MINUTES_PER_DAY + balance.build.nightStartHour * 60;
  const nextNight = nightStart > minute ? nightStart : nightStart + MINUTES_PER_DAY;
  const nextDay = (day + 1) * MINUTES_PER_DAY;

  if (!open) {
    return (
      <button type="button" onClick={toggle} style={{ ...buttonStyle, position: 'fixed', top: 4, right: 4, zIndex: 2000, background: '#8a2b2b' }}>
        DEBUG
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="DEBUG"
      style={{
        position: 'fixed',
        top: 4,
        right: 4,
        bottom: 4,
        width: 260,
        overflowY: 'auto',
        zIndex: 2000,
        padding: 8,
        background: '#1f3560',
        color: '#f4f1e6',
        border: '3px solid #3b2a33',
        borderRadius: RADIUS.chrome,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        fontSize: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>DEBUG</strong>
        <button type="button" onClick={() => setOpen(false)} style={buttonStyle}>
          閉じる
        </button>
      </div>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div>ビルド: {__BUILD_ID__}</div>
        <div>セーブの版: {SAVE_VERSION}</div>
        <div>スマホの配置: {isPhoneNow() ? 'はい' : 'いいえ'}</div>
        <div>指で操作: {window.matchMedia('(pointer: coarse)').matches ? 'はい' : 'いいえ'}</div>
        <div>会社のレベル: {level}（経験値 {companyExp}）</div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div>更新</div>
        <button type="button" style={buttonStyle} onClick={act(showUpdateNotice, '更新の通知を出しました')}>
          更新の通知を出す
        </button>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div>時刻（今: {minute}分）</div>
        <button type="button" style={buttonStyle} onClick={act(() => store().debugSetMinute(nextNight), '夜勤の開始へ進めました')}>
          夜勤の開始へ
        </button>
        <button type="button" style={buttonStyle} onClick={act(() => store().debugSetMinute(nextDay), '翌日の0時へ進めました')}>
          翌日の0時へ
        </button>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div>お金・経験値・レベル</div>
        <button type="button" style={buttonStyle} onClick={act(() => store().debugAddMoney(1000000), 'お金を 100 万円足しました')}>
          お金を 100 万円足す
        </button>
        <button
          type="button"
          style={buttonStyle}
          onClick={() => {
            const next = level + 1;
            store().debugSetCompanyLevel(next);
            say(`Lv${next} にしました（報酬は受け取った分だけ足しています）`);
          }}
        >
          レベルを 1 上げる
        </button>
        <button type="button" style={buttonStyle} onClick={act(() => store().debugAddOwned('l2_switch_4p', 1), '4ポートスイッチを倉庫に加えました')}>
          4ポートスイッチを倉庫に加える
        </button>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div>控えとセーブ</div>
        <button
          type="button"
          style={buttonStyle}
          disabled={backup === null}
          onClick={() => {
            if (backup) {
              store().load(backup);
              say('控えに戻しました');
            }
          }}
        >
          控えに戻す
        </button>
        <button
          type="button"
          style={buttonStyle}
          onClick={() => {
            setSaveText(exportSave(store().snapshot()));
            say('今のセーブを下の欄に書き出しました');
          }}
        >
          今のセーブを書き出す
        </button>
        <button
          type="button"
          style={buttonStyle}
          onClick={() => {
            // 欄の JSON を読み込む（形式が違えば、理由を出して何もしない）
            try {
              store().load(importSave(saveText));
              say('読み込みました');
            } catch (e) {
              say(e instanceof Error ? e.message : '読み込めませんでした');
            }
          }}
        >
          欄のセーブを読み込む
        </button>
        <button type="button" style={buttonStyle} onClick={act(() => store().debugFinishBuild(), '施工を最後まで進めました')}>
          施工を今すぐ終える
        </button>
        <button type="button" style={buttonStyle} onClick={act(() => store().debugRefreshOffers(), '依頼を引き直しました')}>
          依頼を今すぐ引き直す
        </button>
        <button type="button" style={buttonStyle} onClick={act(() => store().debugResetGuides(), '案内を最初から出し直します')}>
          案内を最初から
        </button>
        <textarea
          aria-label="セーブの JSON"
          value={saveText}
          rows={4}
          onChange={(e) => setSaveText(e.target.value)}
          style={{ fontSize: 10, background: '#25406f', color: '#f4f1e6', border: '1px solid #3b2a33' }}
        />
      </section>

      {message && <div role="status">{message}</div>}
    </div>
  );
}
