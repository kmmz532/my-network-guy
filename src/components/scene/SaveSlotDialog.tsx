// 会社（セーブの枠）の画面（N132・N133）。一覧・社名の入力・上書きの確認・社名の変更・複製・書き出し・消す確認を1つの部品で出す
import { addKeyLayer } from '../../input/keyRouter';
import { useEffect, useState } from 'react';
import { usePhone } from '../../ui/usePhone';
import { Dialog } from '../ui/Dialog';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ListRow } from '../ui/ListRow';
import { FileButton } from '../ui/FileButton';
import { t, tDyn } from '../../i18n/t';
import { balance } from 'virtual:game-data';
import { levelOf } from '../../sim/level';
import { toDate } from '../../sim/clock';
import { MAX_COMPANY_NAME, isValidCompanyName, sortByRecent, type CompanySave } from '../../services/companies';
import type { GameMode } from '../../company/company';
import type { SaveSlotView } from '../../ui/titleFlow';
import type { BrokenSlot } from '../../services/saveRecords';
import { Button } from '../ui/Button';
import { Text } from '../ui/Text';
import { TextInput } from '../ui/TextInput';

// 一覧に一度に出す会社の高さ（1行は約48px と行の間 4px。5件ぶんを上限にし、画面が低いときは画面に収まる高さにする。残りは一覧の中で縦にスクロールする）
const SAVE_LIST_MAX = 'min(260px, calc(100vh - 260px))';

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
      <div>
        <Text size="sm">{t('ui.company.name.label')}</Text>
        <TextInput autoFocus tone="inset" width="full" label={t('ui.company.name.label')} value={name} onChange={setName} onEnter={submit} layout={{ marginTop: 4 }} />
      </div>
      <Text size="s" tone="soft">
        {t('ui.company.name.hint', { max: MAX_COMPANY_NAME })}
      </Text>
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
  const phone = usePhone();
  // 選んでいる枠。最初は、最後に遊んだ会社を選んでおく（Enter・「始める」ですぐ続きを遊べる）
  const [selected, setSelected] = useState<number | null>(() => sortByRecent(props.saves)[0]?.slot ?? null);
  // 一覧（続けて遊ぶ）を開いたときは、Enter で選んでいる会社を始める（PC・N157）
  useEffect(() => {
    if (props.view.kind !== 'list' || props.view.purpose !== 'play') return;
    const save = props.saves.find((s) => s.slot === selected);
    if (!save) return;
    return addKeyLayer((e) => {
      if (e.key !== 'Enter' || phone) return false;
      props.onPlay(save);
      return true;
    });
  }, [props.view, props.saves, phone, selected]);
  const { view, mode, saves, broken, suggested, notice, onView, onPlay, onStartIn, onRename, onDuplicate, onExport, onDelete, onDeleteBroken, onImport, onNewHere, importing, onOverwriteWith } = props;
  const close = () => onView(null);
  const toList = (purpose: 'play' | 'overwrite') => onView({ kind: 'list', purpose });

  if (view.kind === 'name') {
    const back = view.from === 'overwrite' ? () => toList('overwrite') : close;
    return (
      <Dialog onClose={back}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Text size="l">{mode === 'sandbox' ? t('ui.company.name.titleSandbox') : t('ui.company.name.title')}</Text>
          <NameForm initial={view.suggested} submitLabel={t('ui.company.start')} onSubmit={(name) => onStartIn(view.slot, name)} onCancel={back} />
        </div>
      </Dialog>
    );
  }

  if (view.kind === 'rename') {
    return (
      <Dialog onClose={() => toList('play')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Text size="l">{t('ui.company.rename.title')}</Text>
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

  // 一覧（保存枠の選択の形。2026-11-16 の設計）。1件を1行（社名・遊び方・Lv・最後に遊んだ日時）にし、行を押すと選び、選んだ行をもう一度押すと始める。
  // 操作は一覧の下に2段で固定する。上段: 始める（上書きの一覧では上書きする）・新しく作る・ファイルから読み込む。下段: 名前を変える・複製・書き出す・削除・戻る。
  // 会社を選んでいない間は、始めると会社の操作は押せない。読めない会社は選べるが、削除だけができる
  const purpose = view.purpose;
  const sorted = sortByRecent(saves);
  const chosen = sorted.find((s) => s.slot === selected) ?? null;
  const chosenBroken = broken.find((b) => b.slot === selected) ?? null;
  const start = (save: CompanySave) => (purpose === 'play' ? onPlay(save) : onView({ kind: 'confirmOverwrite', save }));
  const modeLabel = (save: CompanySave) => tDyn(`ui.company.mode.${save.data.mode}`);
  return (
    <Dialog onClose={close}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: phone ? undefined : 560, maxWidth: '100%' }}>
        <Text size="l">{purpose === 'overwrite' ? t('ui.company.list.overwrite') : t('ui.company.list.title')}</Text>
        {notice !== '' && (
          <Text size="sm" tone="warn">
            {notice}
          </Text>
        )}
        {saves.length === 0 && broken.length === 0 && <Text tone="soft">{t('ui.company.list.empty')}</Text>}
        <div role="listbox" aria-label={t('ui.company.list.title')} style={{ maxHeight: SAVE_LIST_MAX, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, paddingRight: 4 }}>
          {sorted.map((save, index) => (
            <ListRow key={save.slot} active={save.slot === selected} onClick={() => (save.slot === selected ? start(save) : setSelected(save.slot))}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                <Text as="span" size="l" layout={{ flex: 1, minWidth: 0 }}>
                  {save.data.name}
                  {purpose === 'play' && index === 0 && (
                    <Text as="span" size="s" tone="warn" layout={{ marginLeft: 8 }}>
                      {t('ui.company.last')}
                    </Text>
                  )}
                </Text>
                <Text as="span" size="s" tone="soft">
                  {modeLabel(save)}・{companySummary(save)}・{savedAtText(save.savedAt)}
                </Text>
              </div>
            </ListRow>
          ))}
          {broken.map((b) => (
            <ListRow key={`broken-${b.slot}`} active={b.slot === selected} onClick={() => setSelected(b.slot)}>
              <Text tone="soft">{t('ui.company.list.broken')}</Text>
            </ListRow>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="primary" disabled={chosen === null} onClick={() => chosen && start(chosen)}>
            {purpose === 'play' ? t('ui.company.play') : t('ui.company.overwrite')}
          </Button>
          {purpose === 'play' && (
            <>
              <Button variant="secondary" onClick={onNewHere}>
                {mode === 'sandbox' ? t('ui.company.newSandbox') : t('ui.company.newCompany')}
              </Button>
              <FileButton variant="secondary" accept=".json,application/json" onFile={onImport}>
                {t('ui.company.import')}
              </FileButton>
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {purpose === 'play' && (
            <>
              <Button variant="secondary" disabled={chosen === null} onClick={() => chosen && onView({ kind: 'rename', save: chosen })}>
                {t('ui.company.rename')}
              </Button>
              <Button variant="secondary" disabled={chosen === null} onClick={() => chosen && onDuplicate(chosen)}>
                {t('ui.company.duplicate')}
              </Button>
              <Button variant="secondary" disabled={chosen === null} onClick={() => chosen && onExport(chosen)}>
                {t('ui.company.export')}
              </Button>
              <Button
                variant="danger"
                disabled={chosen === null && chosenBroken === null}
                onClick={() => (chosen ? onView({ kind: 'delete', save: chosen }) : chosenBroken && onView({ kind: 'deleteBroken', slot: chosenBroken.slot }))}
              >
                {t('ui.company.delete')}
              </Button>
            </>
          )}
          <Button variant="secondary" onClick={close}>
            {t('ui.company.back')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
