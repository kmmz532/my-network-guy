# コードの書き方

ロジックは純粋関数として `src/network`・`src/sim`・`src/contracts` に置く。文言は言語ファイルに、数値はゲームデータの JSON に置く。想定外の入力は既定値で埋めず例外で止め、セーブの移行だけを例外とする。

次の規則は ESLint の独自の規則（`eslint/local-rules/`）が検査する。規則を追加した時点の違反は `eslint-suppressions.json` に記録してあり、直したときは `npx eslint src --prune-suppressions` で減らす。

| 規則 | 禁じること |
| --- | --- |
| `no-category`・`is-pc-in` | 機器の種類を比べて処理を分けること。機器の能力を見る |
| `no-mode-branch` | 遊び方の名前（`sandbox`・`career`）で処理を分けること |
| `no-engine-in-view` | 画面から計算の関数を呼ぶこと。`NetworkState` と `src/network/query/` だけを読む |
| `no-core-set` | 構成をストアの `set` で直接書き換えること |
| `no-unknown-fallback` | `?? 'unknown'` で埋めること |
| `no-native-control` | `<button>`・`<input>`・`<select>`・`<textarea>` を直接書くこと。`src/components/ui/` の部品を使う |
| `no-look-props`・`no-look-export` | `ui/` の外で色・枠・文字の大きさなどの見た目を書くこと |

画面の部品は `style` を受け取らず、配置は `layout` で渡す。部品の種類で表せない見た目が必要な場合は、`ui/` に種類か部品を追加する。
