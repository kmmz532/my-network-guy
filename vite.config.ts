import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import gameData from './plugins/game-data';

// GitHub Pages のプロジェクトページ（https://<user>.github.io/my-network-guy/）で公開する
export default defineConfig({
  base: '/my-network-guy/',
  plugins: [gameData(), react()],
});
