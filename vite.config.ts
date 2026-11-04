import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import gameData from './plugins/game-data';

// GitHub Pages のプロジェクトページ（https://<user>.github.io/network-ya/）で公開する
export default defineConfig({
  base: '/network-ya/',
  plugins: [gameData(), react()],
});
