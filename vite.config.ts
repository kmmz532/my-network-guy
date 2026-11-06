import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import gameData from './plugins/game-data';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

// ビルド番号。コミットの短いハッシュ。タイトルとサービスワーカーで共有する（git がなければビルドを止める）
const buildId = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();

// サービスワーカーの保存の版を、ビルドごとに変える（古い保存を捨てるため）
const swVersion = (): Plugin => {
  let outDir = 'dist';
  return {
    name: 'sw-version',
    apply: 'build',
    configResolved: (c) => {
      outDir = c.build.outDir;
    },
    closeBundle: () => {
      const file = resolve(outDir, 'sw.js');
      if (!existsSync(file)) throw new Error(`sw.js がビルドの出力にない: ${file}`);
      writeFileSync(file, readFileSync(file, 'utf-8').replace('__BUILD__', buildId));
    },
  };
};

// GitHub Pages のプロジェクトページ（https://<user>.github.io/my-network-guy/）で公開する
export default defineConfig(({ command }) => ({
  define: { __BUILD_ID__: JSON.stringify(command === 'build' ? buildId : 'dev') },
  base: '/my-network-guy/',
  plugins: [gameData(), react(), swVersion()],
}));
