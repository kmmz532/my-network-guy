// 会社（セーブの枠）の画面（N132・N133）。一覧・社名の入力・上書きの確認・社名の変更・複製・書き出し・消す確認を1つの部品で出す
import { addKeyLayer } from '../../input/keyRouter';
import { useEffect, useState } from 'react';
import { usePhone } from '../../ui/usePhone';
import { Dialog } from '../ui/Dialog';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ListRow } from '../ui/ListRow';
import { FileButton } from '../ui/FileButton';
import { t } from '../../i18n/t';
import { balance } from 'virtual:game-data';
import { levelOf } from '../../sim/level';
import { toDate } from '../../sim/clock';
import { MAX_COMPANY_NAME, isValidCompanyName, sortByRecent, type CompanySave } from '../../services/companies';
import type { GameMode } from '../../company/company';
import type { SaveSlotView } from '../../ui/titleFlow';
import type { BrokenSlot } from '../../services/saveRecords';
import { Button } from '../ui/Button';

// 会社の要約（経営は Lv・年目・月・日。サンドボックスは広さ）。一覧と確認の文言で使う
export const companySummary = (save: CompanySave): string => {
  if (save.data.mode === 'sandbox') return `広さ ${save.data.office.size.w}×${save.data.office.size.h}`;
  const date = toDate(save.data.clock.minute, balance);
  return `Lv${levelOf(save.data.companyExp, balance)}・${date.year}年目${date.month}月${date.day}日`;
};

const savedAtText = (savedAt: number): string =>
  new Date(savedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

interface Props {
  view: SaveSlotView;
  mode: GameMode;
  saves: readonly CompanySave[];
  // 読めない枠（一覧に「読めない会社」として出す。選べず、消すだけできる）
  broken: readonly BrokenSlot[];
  suggested: string;
  notice: string;
  onView: (view: SaveSlotView | null) => void;
  onPlay: (save: CompanySave) => void;
  onStartIn: (slot: number, name: string) => void;
  onRename: (save: CompanySave, name: string) => void;
  onDuplicate: (save: CompanySave) => void;
  onExport: (save: CompanySave) => void;
  onDelete: (save: CompanySave) => void;
  onDeleteBroken: (slot: number) => void;
  onImport: (file: File) => void;
  onNewHere: () => void;
  // 読み込んだ会社を上書きする一覧か（上書きの確認のあとに、読み込んだ会社を入れる）
  importing: boolean;
  onOverwriteWith: (save: CompanySave) => void;
}

// 社名を入れる欄（新しく始める・名前を変える）。空や長すぎる名前は始められない
function NameForm({ initial, submitLabel, onSubmit, onCancel }: { initial: string; submitLabel: string; onSubmit: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial);
  const valid = isValidCompanyName(name);
  const submit = () => {
    if (valid) onSubmit(name.trim());
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 260 }}>
      <label style={{ fontSize: 13 }}>
        {t('ui.company.name.label')}
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, padding: '6px 8px', background: '#1e3260', color: '#f4f1e6', border: '1px solid #3b2a33', font: 'inherit' }}
        />
      </label>
      <div style={{ fontSize: 12, opacity: 0.8 }}>{t('ui.company.name.hint', { max: MAX_COMPANY_NAME })}</div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="secondary" onClick={onCancel}>
          {t('ui.company.cancel')}
        </Button>
        <Button variant="primary" disabled={!valid} onClick={submit}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

export function SaveSlotDialog(props: Props) {
  // スマホは、行を押すと操作を開く（一覧の行の下に並べる）。開いている行は1つだけ（N133）
  const phone = usePhone();
  const [openSlot, setOpenSlot] = useState<number | null>(null);
  // 一覧（続けて遊ぶ）を開いたときは、Enter で先頭（最後に遊んだ会社）を始める（PC・N157）
  useEffect(() => {
    if (props.view.kind !== 'list' || props.view.purpose !== 'play' || props.saves.length === 0) return;
    const first = sortByRecent(props.saves)[0];
    return addKeyLayer((e) => {
      if (e.key !== 'Enter' || phone) return false;
      props.onPlay(first);
      return true;
    });
  }, [props.view, props.saves, phone]);
  const { view, mode, saves, broken, suggested, notice, onView, onPlay, onStartIn, onRename, onDuplicate, onExport, onDelete, onDeleteBroken, onImport, onNewHere, importing, onOverwriteWith } = props;
  const close = () => onView(null);
  const toList = (purpose: 'play' | 'overwrite') => onView({ kind: 'list', purpose });

  if (view.kind === 'name') {
    const back = view.from === 'overwrite' ? () => toList('overwrite') : close;
    return (
      <Dialog onClose={back}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 15 }}>{mode === 'sandbox' ? t('ui.company.name.titleSandbox') : t('ui.company.name.title')}</div>
          <NameForm initial={view.suggested} submitLabel={t('ui.company.start')} onSubmit={(name) => onStartIn(view.slot, name)} onCancel={back} />
        </div>
      </Dialog>
    );
  }

  if (view.kind === 'rename') {
    return (
      <Dialog onClose={() => toList('play')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 15 }}>{t('ui.company.rename.title')}</div>
          <NameForm initial={view.save.data.name} submitLabel={t('ui.company.rename.ok')} onSubmit={(name) => onRename(view.save, name)} onCancel={() => toList('play')} />
        </div>
      </Dialog>
    );
  }

  // 「やめる」が主の操作（Enter と Esc）。上書きは危ないボタンの見た目
  if (view.kind === 'confirmOverwrite') {
    const save = view.save;
    return (
      <ConfirmDialog
        onCancel={() => toList('overwrite')}
        cancelLabel={t('ui.company.cancel')}
        action={{
          label: t('ui.company.overwrite.ok'),
          tone: 'danger',
          onClick: () => (importing ? onOverwriteWith(save) : onView({ kind: 'name', slot: save.slot, suggested, from: 'overwrite' })),
        }}
      >
        {t('ui.company.overwrite.confirm', { name: save.data.name, summary: companySummary(save) })}
      </ConfirmDialog>
    );
  }

  if (view.kind === 'delete') {
    const save = view.save;
    return (
      <ConfirmDialog onCancel={() => toList('play')} cancelLabel={t('ui.company.cancel')} action={{ label: t('ui.company.delete.ok'), tone: 'danger', onClick: () => onDelete(save) }}>
        {t('ui.company.delete.confirm', { name: save.data.name, summary: companySummary(save) })}
      </ConfirmDialog>
    );
  }

  if (view.kind === 'deleteBroken') {
    const slot = view.slot;
    return (
      <ConfirmDialog onCancel={() => toList('play')} cancelLabel={t('ui.company.cancel')} action={{ label: t('ui.company.delete.ok'), tone: 'danger', onClick: () => onDeleteBroken(slot) }}>
        {t('ui.company.broken.delete.confirm')}
      </ConfirmDialog>
    );
  }

  // 一覧（始める・社名を変える・複製・書き出す・消す。上書きの一覧では、上書きする枠を選ぶ）
  const purpose = view.purpose;
  return (
    <Dialog onClose={close}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 280, maxWidth: 380 }}>
        <div style={{ fontSize: 15 }}>{purpose === 'overwrite' ? t('ui.company.list.overwrite') : t('ui.company.list.title')}</div>
        {notice !== '' && <div style={{ color: '#ffd866', fontSize: 13 }}>{notice}</div>}
        {saves.length === 0 && broken.length === 0 && <div style={{ opacity: 0.8 }}>{t('ui.company.list.empty')}</div>}
        {sortByRecent(saves).map((save, index) => (
          <ListRow key={save.slot}>
            <div
              style={{ fontSize: 16, cursor: phone ? 'pointer' : 'default' }}
              // スマホは、先頭（最後に遊んだ会社）の行を押すとすぐ始める。ほかの行は押すと操作を開く（N157）
              onClick={phone ? () => (purpose === 'play' && index === 0 ? onPlay(save) : setOpenSlot(openSlot === save.slot ? null : save.slot)) : undefined}
            >
              {save.data.name}
              {purpose === 'play' && index === 0 && <span style={{ fontSize: 12, color: '#ffd866', marginLeft: 8 }}>{t('ui.company.last')}</span>}
            </div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>
              {companySummary(save)}・{t('ui.company.list.saved', { at: savedAtText(save.savedAt) })}
            </div>
            {(!phone || openSlot === save.slot) && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flexDirection: phone ? 'column' : 'row' }}>
              {purpose === 'play' ? (
                <>
                  <Button variant="primary" onClick={() => onPlay(save)}>
                    {t('ui.company.play')}
                  </Button>
                  <Button variant="secondary" onClick={() => onView({ kind: 'rename', save })}>
                    {t('ui.company.rename')}
                  </Button>
                  <Button variant="secondary" onClick={() => onDuplicate(save)}>
                    {t('ui.company.duplicate')}
                  </Button>
                  <Button variant="secondary" onClick={() => onExport(save)}>
                    {t('ui.company.export')}
                  </Button>
                  <Button variant="danger" onClick={() => onView({ kind: 'delete', save })}>
                    {t('ui.company.delete')}
                  </Button>
                </>
              ) : (
                <Button variant="danger" onClick={() => onView({ kind: 'confirmOverwrite', save })}>
                  {t('ui.company.overwrite')}
                </Button>
              )}
            </div>
            )}
          </ListRow>
        ))}
        {broken.map((b) => (
          <div key={`broken-${b.slot}`} style={{ border: '1px solid #3b2a33', padding: 8, display: 'flex', flexDirection: 'column', gap: 6, opacity: 0.8 }}>
            <div style={{ fontSize: 14 }}>{t('ui.company.list.broken')}</div>
            {purpose === 'play' && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Button variant="danger" onClick={() => onView({ kind: 'deleteBroken', slot: b.slot })}>
                  {t('ui.company.delete')}
                </Button>
              </div>
            )}
          </div>
        ))}
        {purpose === 'play' && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button variant="primary" onClick={onNewHere}>
              {mode === 'sandbox' ? t('ui.company.newSandbox') : t('ui.company.newCompany')}
            </Button>
            <FileButton variant="secondary" accept=".json,application/json" onFile={onImport}>
              {t('ui.company.import')}
            </FileButton>
          </div>
        )}
      </div>
    </Dialog>
  );
}
