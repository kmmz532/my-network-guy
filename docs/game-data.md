# ゲームデータ

## 場所

ゲームの数値と定義は `src/assets/data/` の JSON にあります。文言は `src/assets/lang/ja_jp.json` にあります。

| ファイル | 備考 |
| --- | --- |
| `balance.json` | 時間の換算、初期資金、初期の在庫、社員、給与、施工の時間、★評価の基準 |
| `devices/` | 機材の定義 |
| `contracts/` | 案件の定義（1ファイル1案件） |
| `shop.json` | ショップの陳列と解禁の条件 |
| `furniture.json` | 家具の定義 |
| `cables.json` | ケーブルの種類 |
| `training.json`、`certs.json` | 研修と資格 |
| `guides.json` | 案内の文言 |
| `maps/` | オフィスの配置 |

## 検証

`plugins/game-data.ts` がビルド時と開発サーバーの起動時に JSON を検証します。項目が違うと、ファイル名と項目を示してビルドを止めます。検証の定義は `src/data/schema.ts` にあります。

## 文言（言語ファイル）

- 文言は `src/assets/lang/ja_jp.json` に置き、コードには翻訳キーだけを書きます。
- キーは `<ドメイン>.<ID>.<項目>` の形式です。例: `device.pc_basic.name`
- 置き換えは名前付きで書きます。例: `"資金 {amount} 円"`
- 翻訳キーの型はビルド時に生成されます。存在しないキーを `t()` に渡すと型エラーになります。

## 数値を変えるとき

- `balance.json` を編集したら、`node scripts/simulate-balance.mjs` で資金の推移を確かめる（[開発用のツール](tools.md)）。
- 案件を足すときは `contracts/` に1ファイル追加し、ショップの解禁条件（`shop.json`）と合わせる。
