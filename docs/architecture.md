# アーキテクチャ

ゲームのルールと描画を分けて作っている。ルールは React と Pixi.js を読み込まない純粋関数で書き、画面を動かさずに試験できるようにしている。

| 場所 | 役割 |
| --- | --- |
| `src/registry/` | 機器・ケーブル・家具の定義の登録表 |
| `src/company/` | 操作の型（`operation.ts`）と、操作を世界に当てる処理（`apply.ts`）、タイルの判定 |
| `src/network/` | ネットワークの計算。`engine/` が計算のエンジン、`query/` が結果からの問い合わせ、`command/` がターミナルの命令、`topics/` が論点ごとの命令 |
| `src/sim/`・`src/contracts/` | 資金・時間・社員・施工のルールと、依頼の生成 |
| `src/stores/` | Zustand のストア |
| `src/services/` | セーブと移行、時間を進めるループ |
| `src/components/` | React の画面。`ui/` に共通の部品とトークンを置く |
| `src/game/` | Pixi.js によるマップの描画と入力 |
| `src/input/` | キー入力の受け口と割り当て |
| `src/data/` | ゲームデータの zod のスキーマ |
| `plugins/` | ゲームデータの検証と、`virtual:game-data` の生成 |
| `src/__golden__/` | 挙動の記録の試験 |

## データと登録

ゲームデータの JSON（`src/assets/data/`）は、Vite のプラグイン（`plugins/game-data.ts`）がビルドと開発サーバーの起動の時に `src/data/schema.ts` のスキーマで検証し、`virtual:game-data` として読み込ませる。検証に通らないデータがあれば、ファイル名と項目を示してビルドを止める。

機器・ケーブル・家具の定義は、起動時に `src/registry/bootstrap.ts` が登録表（`Registry`）に1回だけ登録して凍結する。機器の定義には、JSON の項目に加えて、能力の集合と口ごとの種類・速さを読み込みの時に導いて持たせる。定義は `src/registry/query.ts` の関数（`deviceDef`・`cableDef` など）で引き、未登録の ID を引くと `UnknownIdError` で止まる。`virtual:game-data` から機器・ケーブル・家具を読むのは `src/registry/game.ts` だけとする。

機器の違いは種類ではなく能力で判断する。能力は機器の定義の `capabilities` に持ち、`src/network/capabilities.ts` の `can` で引く。

## 操作

画面・ターミナル・自動の処理は、構成を直接書き換えず、操作（`Operation`。`src/company/operation.ts`）の値を作って `dispatch`（`src/stores/gameOps.ts`）へ渡す。機器の設定の変更は `config` の操作として、変更の内容（`ConfigChange`）を持つ。`applyOperation`（`src/company/apply.ts`）は構成を変えずに結果を返し、ストアがその結果を状態に反映する。費用・在庫の変化もここで扱う。

## ネットワークの計算

構成が変わった直後に1回だけ、`analyze`（`src/network/engine/analyze.ts`）が構成から計算の結果（`NetworkState`）を求める。ゲームの時間の進みには合わせない。段は次の順に進み、各段は前の段の結果だけを読む。

1. 配線の層（`stages/links.ts`）: 無線の結びつき、論理リンク、口の停止、配線の長さの超過
2. L2 の層（`stages/l2.ts`）: L2 ドメイン、スパニングツリー、MAC の表
3. アドレスの層（`stages/addressing.ts`）: 口のアドレス、ゲートウェイの補完、DHCP の割り当て、VRRP の持ち主、設計の不備
4. 経路の層（`stages/routing.ts`）: 機器ごとの経路表（静的・RIP・OSPF・BGP）、OSPF の隣接、BGP のセッション

例外は DHCP のリレーだけで、アドレスの層の中で、自動の口を除いた構成について経路の層を仮に求めて使う。反復はしない。DHCP で受け取ったアドレスは `dhcpWriteBack` で機器へ書き戻す。

描画・ターミナルの出力・依頼の判定・教材の案内は `NetworkState` を読むだけで、計算をやり直さない。そのため、同じ構成からは常に同じ結果が出る。画面が使う値は `src/network/query/` の関数で引く。ping・http のような1回の通信は、`forward.ts` の `deliver` が `NetworkState` の上で転送をたどって求め、届かなければ失敗の理由（`FAILURE_REASONS`）と止まった機器を返す。

## 論点と命令

論点（VLAN・OSPF・DHCP など）は `src/network/topics.ts` の `TOPICS` に1行ずつ持つ。行は、設定の命令の例、`show` の命令、失敗と警告の ID、用語集の ID、教材の ID を指す。`topics.test.ts` は、各行の命令が解釈でき、文言と教材がそろっていることを確かめる。まだ欠けている項目は `known` に書き、埋めたら外す。新しい論点は、行を追加して試験が落ちた箇所を埋める形で作る。

ターミナルの命令は、論点ごとに `src/network/topics/<論点>/commands.ts` に `CommandSpec` の配列として書き、`src/network/command/registry.ts` が起動時に登録して凍結する。解釈（`parse.ts`）・実行（`run.ts`）・候補（`complete.ts`）はこの登録表だけを読み、実行は操作を作って渡す。

## 依頼と教材

依頼（`src/assets/data/contracts/`）と教材（`src/assets/data/lessons/`）は JSON で定義する。依頼には、新しく作る依頼（`build`）と、最初から引かれた配線と設定（`links`・`setup`）を持つ修理の依頼（`repair`）がある。達成条件（`goals`）は種類ごとの判定の処理を `src/network/goals.ts` に登録し、`NetworkState` で評価する。

## ストア

ゲームの状態は `useGameStore` が持ち、操作は種類ごと（設計・社員・オフィス・案件・時間と資金など）の `slices/` に置く。毎ティックの処理は `tickSystems.ts` に順序を決めて並べる。画面で開いている物と一時の状態（配線の途中・ドラッグ）は `useUiStore` が、場面の切り替えは `useSceneStore` が持つ。

## セーブ

セーブは IndexedDB に保存し、`src/services/migrations.ts` の `SAVE_VERSION` と移行の関数で古い版を読み替える。読み込みの時、登録にない機器・ケーブル・家具は `dropUnknown.ts` が取り除いて知らせる。版ごとの fixture（`src/services/__fixtures__`）を最新版まで移行する試験がある。手順は[セーブデータ](save.md)に記載している。

## 検査

`src/__golden__` は、教材・依頼の正解の構成ごとに疎通の結果・失敗の理由・`show` の出力を記録し、外部仕様の変化を検出する。外部仕様を意図して変えたときだけ、`vitest -u` で記録を更新する。`npm run check:spec` は、コードの失敗・警告の ID と言語ファイルの文言の過不足を調べる。ESLint の独自の規則は[コードの書き方](coding.md)に記載している。

## 置き場所

| 置く物 | 置き場所 |
| --- | --- |
| 画面に出さない処理（セーブ、時間のループ、描画のループ） | React の外のモジュール（`src/services/`・`src/sim/`） |
| 画面に出す値と、開いている画面の状態 | ストア。部品は `use` で読み、スマホかパソコンかは表示のときだけ分ける |
| 押したときだけ使う関数 | ストアの `getState()` で呼ぶ |
| 場面だけが使う状態 | その場面の部品 |
| 時刻と設定 | ルールの関数の引数で渡す。ルールの中で `Date.now()` や `loadSettings()` を読まない |

## キー入力

`window` への `keydown` の登録は `src/input/keyRouter.ts` の1か所だけとし、部品は次の1か2に登録する。キーは次の順に受け、先に処理したものは次へ渡さない。

1. 横取り（`captureKeys`）は、ドラッグ中や一覧を開いている間に一時的にキーを奪う。後から登録したものが先に受け、DOM の要素より先に受ける。
2. 場面の層（`addKeyLayer`）は、場面が持つキー（タイトルの Enter、マップの R など）を受ける。
3. キーの表（`KEYMAP`）は、ゲームの場面だけで使う。

画面の部品のドラッグは `src/input/trackDrag.ts` の `trackDrag` で追い、動かさずに離したときは押したものとして扱う。Esc で戻す順序（配線、ポップアップ、失敗の直し方、ウィンドウ、道具）は `keymap.ts` の `ESCAPE_STEPS` に持つ。
