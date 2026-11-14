# コードの書き方

ロジックは純粋関数として `src/network`・`src/sim`・`src/contracts` に置く。文言は言語ファイルに、数値はゲームデータの JSON に置く。用語は、ネットワークスペシャリスト試験と同じ正式なものを使う。コメントには規則の中身を書く。

次の規則は、ESLint の独自の規則が検査する。規則を追加した時点の違反は `eslint-suppressions.json` に記録する。違反を直したら、`npx eslint src --prune-suppressions` で記録を減らす。

| 規則 | 守ること |
| --- | --- |
| `no-category`・`is-pc-in` | 機器は能力で判断する |
| `no-mode-branch` | 遊び方の違いは能力の値で判断する |
| `no-engine-in-view` | 画面は `NetworkState` と `src/network/query/` を読む |
| `no-core-set` | 構成は操作で変える |
| `no-unknown-fallback` | 想定外の値は例外で止める |
| `no-native-control` | ボタンと入力欄は `src/components/ui/` の部品を使う |
| `no-look-props`・`no-look-export` | 色・枠・文字の大きさは `ui/` の部品が決める |

画面の部品の配置は `layout` で渡す。部品で表せない見た目は、`ui/` に種類か部品を追加して作る。
