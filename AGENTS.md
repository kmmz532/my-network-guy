# AGENTS.md

## JSON の編集

- 標準の書式の JSON は、エディタで直接書き換えず、`node scripts/json.mjs` でキーを追加・変更・削除する。直接の書き換えでは同じキーを2回書いても検出されないため。
  - 追加: `node scripts/json.mjs add lang <key> "<値>"`（既にあるキーなら失敗する）
  - 変更: `node scripts/json.mjs set lang <key> "<値>"`
  - そのほか: `get`・`has`・`del`・`rename`・`keys`。入れ子のキーは `/` で区切る（`node scripts/json.mjs get data/devices/router devices/0/id`）。使い方はスクリプトの冒頭のコメントに記載している。
- 言語ファイルは下の「言語ファイル」の `scripts/lang.mjs` を使う。
- 独自の書式の JSON（`balance.json`・`guides.json`・`jobs.json`）は書き込みを拒否されるため、直接編集する。編集の後に `npm run check:json` で重複キーを確認する。

## 言語ファイル

- 文言のキーの追加・変更・改名・削除は `node scripts/lang.mjs` で行う。全言語のファイルをまとめて扱い、置換の名前（`{min}` など）が基準（`ja_jp`）と食い違う文言は拒否する。
  - 追加: `node scripts/lang.mjs add <key> "<日本語>" [--en_us "<英語>"]`（文言を渡さない言語は未訳として残る）
  - 変更: `node scripts/lang.mjs set <key> "<文言>" [--lang <言語>]`
  - 改名・削除: `rename <old> <new>`・`del <key>`
- 他の言語の過不足は `npm run check:lang`（言語ごとの足りない・余分・置換の食い違いの件数）、`node scripts/lang.mjs missing <言語>` で確認する。
- `node scripts/lang.mjs unused` は参照されていないらしいキーの目安を出す。組み立てたキーを拾い切れないため、消す前に grep で確認する。
## 検査

- 完了の条件は `npm run verify`（型・ESLint・全試験・JSON・言語ファイル・仕様との突き合わせ）の合格とする。
- コミットの前の hook（`.git/hooks/pre-commit`）は、ステージしたファイルだけを見る（`src/**/*.{ts,tsx}` の ESLint と、JSON の重複キーの検査）。作業ツリー全体は見ない。`npm install` の `prepare` が書き込む。`--no-verify` は使わない。
- `npm run check:spec` は、仕様（`memo/NET.md`）とコードの食い違いを調べる。今ある食い違いは `scripts/spec-baseline.json` に記録してあり、記録にない食い違いだけを誤りにする。食い違いを解消したら `node scripts/check-spec.mjs --update` で記録から消す。

## 試験

- 試験は、壊れうる振る舞い（シミュレーションの結果・依頼の合否・セーブの移行など）を守るものだけを追加する。
- 次の試験は作成しない。トークンと開発の時間を消費し、ファイルを増やすだけで、不具合を防がないため。
  - CSS やソースの文字列を正規表現で照合する試験
  - 型の検査（`tsc`）で保証される事を確かめる試験
  - 渡した props がそのまま HTML や属性に出ることだけを確かめる試験
- 見た目は、撮影の前後の比較で確認する。
- この方針は、これから追加する試験に当てはめる。既存の試験を洗い出して削除する作業は行わない。
