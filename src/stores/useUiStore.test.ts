import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from './useUiStore';

describe('useUiStore（開いている画面）', () => {
  beforeEach(() => useUiStore.setState({ hiring: null, popup: null, inventoryStrip: false }));

  it('採用のボタンは、閉じていれば採用のタブで開き、開いていれば閉じる', () => {
    useUiStore.getState().toggleHiring();
    expect(useUiStore.getState().hiring).toBe('hiring');
    useUiStore.getState().toggleHiring();
    expect(useUiStore.getState().hiring).toBeNull();
  });

  it('社員のタブで開き、タブを切り替えられる', () => {
    useUiStore.getState().openHiring('staff');
    expect(useUiStore.getState().hiring).toBe('staff');
    useUiStore.getState().setHiringTab('hiring');
    expect(useUiStore.getState().hiring).toBe('hiring');
    useUiStore.getState().closeHiring();
    expect(useUiStore.getState().hiring).toBeNull();
  });

  it('同じポップアップをもう一度開くと閉じ、別のものは入れ替える', () => {
    useUiStore.getState().togglePopup('help');
    expect(useUiStore.getState().popup).toBe('help');
    useUiStore.getState().togglePopup('settings');
    expect(useUiStore.getState().popup).toBe('settings');
    useUiStore.getState().togglePopup('settings');
    expect(useUiStore.getState().popup).toBeNull();
  });
});
