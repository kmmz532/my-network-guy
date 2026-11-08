import { create } from 'zustand';

type Scene = { kind: 'title', opening?: 'newCareer' } | { kind: 'game' };

type SceneState = {
  scene: Scene;
  setScene: (scene: Scene) => void;
};

export const useSceneStore = create<SceneState>(set => ({
  scene: { kind: 'title' },
  setScene: (scene) => set({ scene }),
}));
