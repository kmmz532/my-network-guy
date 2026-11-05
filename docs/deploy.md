# 公開

- `main` へ push すると、GitHub Actions がビルドして GitHub Pages に公開します（`.github/workflows/deploy.yml`）。
- 公開先は `https://<ユーザー名>.github.io/my-network-guy/` です。
- `vite.config.ts` の `base` は `/my-network-guy/` です。リポジトリ名を変えたら合わせて変えてください。
- サーバーは持ちません。すべての処理はブラウザで行います。
- 公開前に、`npm run build` が通ることを確かめてください。
