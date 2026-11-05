# 開発の手順

## 環境

- Node.js 22（CI と同じ版）
- npm

## コマンド

```bash
npm ci            # 依存パッケージのインストール（package-lock.json どおりに入れる）
npm run dev       # 開発サーバーの起動（Vite）
npm run build     # ビルドと型チェック（tsc --noEmit）
npm run preview   # ビルド結果の確認
npm test          # テスト（vitest run）
```

## 変更を入れる前後

1. `npm test` を通す。
2. `npm run build` を通す。CI（`.github/workflows/ci.yml`）も同じ確認をします。
3. 画面に関わる変更は、`npm run dev` で動かして確かめる。

## 関連する文書

- [アーキテクチャ](architecture.md): 層の分け方とディレクトリ
- [ゲームデータ](game-data.md): JSON と言語ファイル
- [セーブデータ](save.md): 保存と形式の移行
- [開発用のツール](tools.md): `scripts/` の使い方
- [公開](deploy.md): GitHub Pages への公開
