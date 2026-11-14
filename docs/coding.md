# コードの書き方

規則は、できるだけ ESLint の規則・試験・`check:*` の検査で守らせる。ここには、検査が守る規則と、検査で守れない書き方の両方を記載する。

## 置き場所

ロジックは純粋関数として `src/network`・`src/sim`・`src/contracts` に置き、React と Pixi.js を読み込まない。文言は言語ファイル（`src/assets/lang/*.json`）に、数値はゲームデータ（`src/assets/data/*.json`）に置き、コードに直接書かない。ルールの関数の中では `Date.now()` や設定を読まず、時刻と設定は引数で渡す。

## 想定外の入力

想定外の入力は既定値で埋めず、例外で止める。`local/no-unknown-fallback` は `?? 'unknown'` の書き方を禁じる。セーブの移行だけは、古いセーブを読めることを優先し、この規則の例外とする。

## 機器の種類と遊び方

機器の種類（`CATEGORY`・`categoryOf`）を比べて処理を分けず、機器が持つ能力を見る。この規則は `local/no-category` と `local/is-pc-in` が守る。同じように、経営・サンドボックス・教材の違いを遊び方の名前（`sandbox`・`career`）で分けることも、`local/no-mode-branch` が禁じる。

描画と画面からは、ネットワークの計算の関数を直接呼ばず、`NetworkState` と `src/network/query/` だけを読む（`local/no-engine-in-view`）。構成（機器・配線・設定）は、ストアの `set` で直接書き換えず、構成を変える操作を通して変える（`local/no-core-set`）。

## 画面の部品

ボタン・入力欄・選択・チェックボックスには、`src/components/ui/` の部品（`Button`・`IconButton`・`Link`・`FileButton`・`Select`・`ComboBox` など）を利用し、`<button>`・`<input>`・`<select>`・`<textarea>` を直接書かない（`local/no-native-control`）。

`ui/` の外では、色・地・枠・文字の大きさ・太さ・影・不透明度を指定しない（`local/no-look-props`）。見た目は、部品の種類（`variant`・`size` など）を選んで決める。`ui/` の外で `*Style`・`*Color` の名前の値を export・import することも禁じている（`local/no-look-export`）。

部品は `style`・`className` を受け取らず、余白・幅・`flex` などの配置は `layout` で渡す。色は `src/components/ui/tokens.css` のトークンだけを利用する。機器・ケーブル・職種の色のようなデータの色は、部品の `color` で受け取る。部品の種類で表せない見た目が必要になった場合は、画面の側に見た目を書かず、`ui/` に種類か小さな部品を追加する。

## 既存の違反

規則を追加した時点で既にある違反は、`eslint-suppressions.json` に記録し、件数を増やさない。違反を直したときは、`npx eslint src --prune-suppressions` で記録を減らし、同じコミットに含める。

## JSON と言語ファイル

標準の書式の JSON は `node scripts/json.mjs` で、言語ファイルは `node scripts/lang.mjs` で編集する。エディタで直接書き換えると、同じキーを2回書いても検出されないためである。独自の書式の JSON（`balance.json`・`guides.json`・`jobs.json`）は直接編集し、編集の後に `npm run check:json` で重複キーを確認する。詳細は [AGENTS.md](../AGENTS.md) と[ゲームデータ](game-data.md)に記載している。

## セーブ

セーブの形を変えるときは、`SAVE_VERSION` を1上げ、移行の関数と、架空の内容で作った fixture の試験を追加する。保存する値は zod のスキーマで検証する。

## 用語とコメント

用語には、「バックボーンエリア」「AS 番号」「ルーター ID」「指定ルーター（DR）」のように、ネットワークスペシャリスト試験と同じ正式なものを利用する。たとえは説明文の中だけで利用する。

コメントには、そのコードが何をしているかを、コードだけを読んで分かる形で書く。非公開の文書や作業の番号は参照しない。
