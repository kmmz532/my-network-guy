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

// 起動時
const onInitialize = () => {
  // 端末のUIの大きさを反映する
  applyUiScale(loadSettings().uiScale);

  // 翻訳とすべての地図を読み込む
  const { cacheMap } = useGameStore.getState();
  const maps = Object.values(mapLoaders).map((load) => load().then((m) => cacheMap(m.default)));
  return Promise.all([loadLang('ja_jp'), ...maps, moveLegacySlots()]).then(() => undefined);
};

export const App = () => {
  const [ready, setReady] = useState(false);

  // 読み込みが失敗したときのエラー保存（エラー画面表示に利用する）
  const [loadError, setLoadError] = useState<unknown>(null);
  const scene = useSceneStore((s) => s.scene);

  useEffect(() => {
    onInitialize()
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
