# セーブデータ

## 保存先

セーブは、ブラウザの IndexedDB（Dexie.js）に、スロットごとに保存します（`src/services/db.ts`）。JSON ファイルに書き出せば、別の端末や別のブラウザへ移せます（`src/services/saveFile.ts`）。サーバーには送りません。データは、その端末のブラウザの中だけにあります。

## 形式の移行

セーブの形式を変えるときは、次の手順で行います。

1. `src/services/migrations.ts` の `SAVE_VERSION` を 1 上げる。
2. 旧い版から新しい版へ変換する関数を `migrations` に追加する。
3. 移行のテストを `src/services/save.test.ts` に書く。

古いセーブを読み込むと、順に移行してから使います。移行の関数は、旧い形式の値を変換するだけにしてください。
