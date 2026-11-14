# 職種の定義

職種は [jobs.json](../src/assets/data/jobs.json) に定義する。職種 ID はセーブデータと互換性を保つため変更しない。

## 項目

- `id`: 職種 ID。言語ファイルの `staff.job.<id>` と対応する。
- `group`: `field`（現場のエンジニア）、`dev`（社内のエンジニア）、`backOffice`（内勤）。
- `unlockLevel`: 採用候補に出る会社レベル。
- `pc`: `required`（机の PC が必要）、`bonus`（PC があると効果が上がる）、`none`。
- `pcBonus`: `pc` が `bonus` の職種に適用する係数。現場は `buildRate` と `idleExpRate`、営業は `effectRate` を使う。
- `salaryRate`: 給与計算の係数。
- `effect`: 内勤・開発の効果の種類。
- `dailyExp`: 担当していない日の経験値の種類。
- `buildsOnSite`: 施工担当になれるか。

## 職種を追加する手順

1. `schema.ts` の `JOB_IDS` に ID を追加する。
2. `jobs.json` に定義を追加する。
3. `ja_jp.json` に `staff.job.<id>` の名前・説明を追加する。
4. 新しい効果の種類が必要なら、`backOffice.ts` に計算式とテストを追加する。
5. 職種の解放、PC 条件、内勤の効果、施工・退職の判定をテストする。
