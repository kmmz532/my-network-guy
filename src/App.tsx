// 起動・読み込みの失敗・場面（タイトル・ゲーム）の切り替えだけを受け持つ。画面の中身は components/scene/ の場面が持つ。
import { useEffect, useState } from 'react';
import { mapLoaders } from 'virtual:loaders';
import { loadLang } from './i18n/t';
import { moveLegacySlots } from './services/db';
import { applyUiScale, loadSettings } from './settings/settings';
import { useGameStore } from './stores/useGameStore';
import { useSceneStore } from './stores/useSceneStore';
import GameScene from './components/scene/GameScene';
import TitleScene from './components/scene/TitleScene';

export const App = () => {
  const [ready, setReady] = useState(false);

  // 翻訳や地図の読み込みが失敗したときの例外（エラー画面で再読み込みを促す）
  const [loadError, setLoadError] = useState<unknown>(null);
  const scene = useSceneStore((s) => s.scene);

  // 起動時のみ実行
  useEffect(() => {
    // 端末のUIの大きさを反映する
    applyUiScale(loadSettings().uiScale);

    // 起動時に、翻訳とすべての地図を読み込む (依頼判定は地図の読み込みに依存するため、読み込み中に判定させない)
    const { cacheMap } = useGameStore.getState();
    const maps = Object.values(mapLoaders).map((load) => load().then((m) => cacheMap(m.default)));
    Promise.all([loadLang('ja_jp'), ...maps, moveLegacySlots()])
      .then(() => setReady(true))
      .catch((e: unknown) => setLoadError(e ?? new Error('読み込みに失敗')));
  }, []);

  if (loadError) throw loadError;
  if (!ready) return null;

  // 画面分岐
  switch (scene.kind) {
    case 'title':
      return <TitleScene opening={scene.opening} />;
    case 'game':
    default:
      return <GameScene />;
  }
};
