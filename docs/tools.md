# 開発用のツール

`scripts/` にあるツールです。

| コマンド | 備考 |
| --- | --- |
| `npm run simulate:company` | 会社の釣り合いを2年ぶん進めて確かめる（内勤・任せる依頼・定型案件の予算を含む） |
| `node scripts/shoot.mjs <場面> ...` | 開発サーバーを起動し、指定した場面の画面を `shots/` に保存する。`all` ですべての場面、`--phone` でスマホの大きさ。初回は `npx playwright install chromium` が必要 |
| `python scripts/gen-sprites.py` | ドット絵のスプライトを `resources/sprites/` に生成する。Pillow が必要 |
| `python scripts/gen-favicon.py` | ファビコンを生成する |

`shots/` と `dist-shoot/` は Git の管理対象外です。
