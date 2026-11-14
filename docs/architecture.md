# アーキテクチャ

ゲームのルールと描画を分ける。ルールは純粋関数で書き、画面を動かさずに試験する。

| 場所 | 役割 |
| --- | --- |
| `src/registry/` | 機器・ケーブル・家具の定義の登録表 |
| `src/company/` | 操作の型と、操作を世界に当てる処理、タイルの判定 |
| `src/network/engine/` | ネットワークの計算のエンジン |
| `src/network/query/` | 計算の結果からの問い合わせ |
| `src/network/command/` | ターミナルの命令の解釈と実行 |
| `src/network/topics/` | 論点ごとの命令 |
| `src/sim/`・`src/contracts/` | 資金・時間・社員・施工のルールと、依頼の生成 |
| `src/stores/` | Zustand のストア |
| `src/services/` | セーブ、移行、時間を進めるループ |
| `src/components/` | React の画面。共通の部品とトークンは `ui/` に置く |
| `src/game/` | Pixi.js によるマップの描画と入力 |
| `src/input/` | キー入力の受け口と割り当て |
| `src/data/` | ゲームデータの zod のスキーマ |
| `plugins/` | ゲームデータの検証と、`virtual:game-data` の生成 |
| `src/__golden__/` | 挙動の記録の試験 |

## データと登録

ゲームデータの JSON は、`plugins/game-data.ts` がビルドと開発サーバーの起動時に検証する。スキーマは `src/data/schema.ts` に置く。検証に通らない場合は、ファイル名と項目を示してビルドを止める。

機器・ケーブル・家具の定義は、起動時に `src/registry/bootstrap.ts` が登録表に登録して凍結する。機器の定義には、能力の集合と口ごとの種類・速さを読み込み時に導いて持たせる。定義は `src/registry/query.ts` の `deviceDef`・`cableDef` などで引く。未登録の ID を引くと `UnknownIdError` で止まる。`virtual:game-data` から定義を読むのは `src/registry/game.ts` だけとする。

機器の違いは能力で判断する。能力は定義の `capabilities` に持ち、`src/network/capabilities.ts` の `can` で引く。

## 操作

画面・ターミナル・自動の処理は、操作（`Operation`）を作って `dispatch` に渡す。構成を直接書き換える処理は置かない。機器の設定の変更は、`config` の操作に変更の内容（`ConfigChange`）を持たせる。`applyOperation` は新しい構成と費用・在庫の変化を結果として返し、ストアがその結果を状態に反映する。

## ネットワークの計算

構成が変わった直後に、`analyze` が計算の結果（`NetworkState`）を1回求める。段は次の順に進み、各段は前の段の結果だけを読む。

1. 配線の層は、無線の結びつき・論理リンク・口の停止・配線の長さの超過を求める。
2. L2 の層は、L2 ドメイン・スパニングツリー・MAC の表を求める。
3. アドレスの層は、口のアドレス・ゲートウェイ・DHCP の割り当て・VRRP の持ち主・設計の不備を求める。
4. 経路の層は、経路表・OSPF の隣接・BGP のセッションを求める。

DHCP のリレーだけは例外とする。アドレスの層の中で、自動の口を除いた構成の経路を仮に求めて使う。受け取ったアドレスは `dhcpWriteBack` で機器へ書き戻す。

描画・ターミナル・依頼の判定・教材の案内は、`NetworkState` を読んで結果を出す。そのため、同じ構成からは常に同じ結果が出る。画面が使う値は `src/network/query/` の関数で引く。ping と http は、`forward.ts` の `deliver` が転送をたどって求める。届かない場合は、失敗の理由と止まった機器を返す。

## 論点と命令

論点は `src/network/topics.ts` の `TOPICS` に1行ずつ持つ。行には、設定の命令の例、`show` の命令、失敗と警告の ID、用語集の ID、教材の ID を書く。`topics.test.ts` が、命令の解釈と文言・教材の存在を確かめる。欠けている項目は `known` に書き、埋めたら外す。新しい論点は、行を追加し、試験が落ちた箇所を埋めて作る。

ターミナルの命令は、論点ごとに `topics/<論点>/commands.ts` へ `CommandSpec` の配列で書く。`command/registry.ts` が起動時に登録して凍結する。解釈・実行・候補はこの登録表を読み、実行は操作を作って渡す。

## 依頼と教材

依頼は `src/assets/data/contracts/` に、教材は `lessons/` に JSON で定義する。依頼の種類は、新しく作る `build` と、修理する `repair` の2つとする。修理の依頼は、最初の配線を `links` に、最初の設定を `setup` に持つ。達成条件は、種類ごとの判定を `src/network/goals.ts` に登録し、`NetworkState` で評価する。

## ストア

ゲームの状態は `useGameStore` が持つ。操作は、設計・社員・オフィス・案件・時間と資金などの種類ごとに `slices/` へ置く。毎ティックの処理は `tickSystems.ts` に順に並べる。開いている画面と、配線の途中・ドラッグなどの一時の状態は `useUiStore` が持つ。場面の切り替えは `useSceneStore` が持つ。

## セーブ

セーブは IndexedDB に保存する。古い版は、`src/services/migrations.ts` の `SAVE_VERSION` と移行の関数で読み替える。登録にない機器・ケーブル・家具は、読み込み時に `dropUnknown.ts` が取り除いて知らせる。`src/services/__fixtures__` の版ごとのセーブを、最新版まで移行する試験がある。手順は[セーブデータ](save.md)に書く。

## 検査

`src/__golden__` は、教材と依頼の正解の構成ごとに、疎通の結果・失敗の理由・`show` の出力を記録する。外部仕様が変わると、この試験が落ちる。意図して変えた場合だけ、`vitest -u` で記録を更新する。`npm run check:spec` は、失敗・警告の ID と言語ファイルの文言の過不足を調べる。ESLint の独自の規則は[コードの書き方](coding.md)に書く。

## 置き場所

| 置く物 | 置き場所 |
| --- | --- |
| セーブ・時間のループ・描画のループ | `src/services/`・`src/sim/` |
| 画面に出す値と、開いている画面の状態 | ストア。部品は `use` で読む |
| 押したときだけ使う関数 | ストアの `getState()` で呼ぶ |
| 場面だけが使う状態 | その場面の部品 |
| 時刻と設定 | ルールの関数の引数で渡す |

スマホとパソコンの違いは、表示のときだけ分ける。ルールの中で `Date.now()` と `loadSettings()` を読むことは禁じる。

## キー入力

`keydown` は `src/input/keyRouter.ts` の1か所で受ける。部品は次の1か2に登録する。キーは次の順に渡り、処理したところで止まる。

1. `captureKeys` は、ドラッグ中や一覧を開いている間にキーを横取りする。後から登録したものが先に受ける。
2. `addKeyLayer` は、タイトルの Enter やマップの R など、場面のキーを受ける。
3. `KEYMAP` は、ゲームの場面のキーを受ける。

部品のドラッグは `src/input/trackDrag.ts` の `trackDrag` で追う。動かさずに離したときは、押したものとして扱う。Esc で戻す順序は `keymap.ts` の `ESCAPE_STEPS` に表で持つ。
