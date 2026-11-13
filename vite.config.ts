import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import gameData from './plugins/game-data';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
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
      // オフラインで遊べるよう、ビルドの出力のすべての資材（sw.js を除く）を、インストール時に保存する一覧にする
      const assets: string[] = [];
      const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
          const path = join(dir, name);
          if (statSync(path).isDirectory()) walk(path);
          else if (path !== file) assets.push(`./${relative(resolve(outDir), path).split(sep).join('/')}`);
        }
      };
      walk(resolve(outDir));
      writeFileSync(file, readFileSync(file, 'utf-8').replace('__BUILD__', buildId).replace('__ASSETS__', JSON.stringify(assets.sort())));
    },
  };
};

// GitHub Pages のプロジェクトページ（https://<user>.github.io/my-network-guy/）で公開する
export default defineConfig(({ command }) => ({
  define: { __BUILD_ID__: JSON.stringify(command === 'build' ? buildId : 'dev') },
  base: '/my-network-guy/',
  server: {
    headers: {
      'Cache-Control': 'no-store',
    },
  },
  plugins: [gameData(), react(), swVersion()],
}));
