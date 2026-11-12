# AGENTS.md

## JSON の編集

- 言語ファイル（`src/assets/lang/ja_jp.json`）と標準の書式の JSON は、エディタで直接書き換えず、`node scripts/json.mjs` でキーを追加・変更・削除する。直接の書き換えでは同じキーを2回書いても検出されないため。
  - 追加: `node scripts/json.mjs add lang <key> "<値>"`（既にあるキーなら失敗する）
  - 変更: `node scripts/json.mjs set lang <key> "<値>"`
  - そのほか: `get`・`has`・`del`・`rename`・`keys`。入れ子のキーは `/` で区切る（`node scripts/json.mjs get data/devices/router devices/0/id`）。使い方はスクリプトの冒頭のコメントに記載している。
- 独自の書式の JSON（`balance.json`・`guides.json`・`jobs.json`）は書き込みを拒否されるため、直接編集する。編集の後に `npm run check:json` で重複キーを確認する。
