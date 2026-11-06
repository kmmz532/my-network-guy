# 開発用のツール

`scripts/` にあるツールです。

| コマンド | 備考 |
| --- | --- |
| `node scripts/simulate-balance.mjs [設計時間の倍率]` | 案件を順に処理したときの資金の推移を概算する。倍率を渡すと、設計に時間をかけた場合の推移を見られる |
| `node scripts/shoot.mjs <場面> ...` | 開発サーバーを起動し、指定した場面の画面を `shots/` に保存する。`all` ですべての場面、`--phone` でスマホの大きさ。初回は `npx playwright install chromium` が必要 |
| `python scripts/gen-sprites.py` | ドット絵のスプライトを `src/assets/sprites/` に生成する。Pillow が必要 |
| `python scripts/gen-favicon.py` | ファビコンを生成する |

`shots/` と `dist-shoot/` は Git の管理対象外です。
