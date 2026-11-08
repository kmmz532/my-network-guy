// 起動・読み込みの失敗・場面（タイトル・ゲーム）の切り替えだけを受け持つ。画面の中身は components/scene/ の場面が持つ。
import { useEffect, useState } from 'react';
import { balance } from 'virtual:game-data';
import { mapLoaders } from 'virtual:loaders';
import { loadLang } from './i18n/t';
import { moveLegacySlots } from './services/db';
import { saveSession } from './services/saveSession';
import { applyUiScale, loadSettings } from './settings/settings';
import { levelOf } from './sim/level';
import { isSpeedUnlocked } from './sim/speed';
import { useGameStore, type Speed } from './stores/useGameStore';
import { useUiStore } from './stores/useUiStore';
import { GameScene } from './components/scene/GameScene';
import { TitleScene } from './components/scene/TitleScene';

type Scene = { kind: 'title'; opening?: 'newCareer' } | { kind: 'game' };

// 起動時に、翻訳とすべての地図を読み込む。依頼の判定は地図の読み込みに依存するため、読み込み中に判定させない
function loadAssets(): Promise<unknown> {
  const { cacheMap } = useGameStore.getState();
  const maps = Object.values(mapLoaders).map((load) => load().then((m) => cacheMap(m.default)));
  return Promise.all([loadLang('ja_jp'), ...maps, moveLegacySlots()]);
}

export function App() {
  const [ready, setReady] = useState(false);
  // 翻訳や地図の読み込みが失敗したときの例外（エラー画面で再読み込みを促す。B9）
  const [loadError, setLoadError] = useState<unknown>(null);
  const [scene, setScene] = useState<Scene>({ kind: 'title' });

  useEffect(() => {
    // タイトル画面の間は時間を止める。端末の UI の大きさを反映する
    useGameStore.getState().setSpeed(0);
    applyUiScale(loadSettings().uiScale);
    loadAssets().then(() => setReady(true), (e: unknown) => setLoadError(e ?? new Error('読み込みに失敗')));
  }, []);

  if (loadError) throw loadError;
  if (!ready) return null;

  // ゲームの場面へ移る（タイトルで会社を決めたあと）
  const enterGame = () => {
    // 保存を、ブラウザが勝手に消さないように頼む（断られても遊べる・N133）
    void navigator.storage?.persist?.();
    // 時間を進める初期の速さは設定で決める
    // 解放されていない速さは、1倍にする（4倍は会社のレベル3で解放される・N99）
    const wanted = loadSettings().startSpeed;
    const game = useGameStore.getState();
    game.setSpeed(isSpeedUnlocked(wanted, levelOf(game.companyExp, balance), balance) ? (wanted as Speed) : 1);
    setScene({ kind: 'game' });
  };

  // タイトルへ戻る。倒産の「やり直す」は、新しく始める流れを開いて戻る
  const exitToTitle = (opening?: 'newCareer') => {
    useUiStore.getState().setPopup(null);
    useGameStore.getState().setSpeed(0);
    saveSession.open(null);
    setScene({ kind: 'title', opening });
  };

  return scene.kind === 'title' ? <TitleScene onEnter={enterGame} opening={scene.opening} /> : <GameScene onExit={exitToTitle} />;
}
