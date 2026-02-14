# PC-G815 BASIC 実装仕様（現行実装）

この文書は、現在の `/Users/yappo/Projects/z80emu/packages/firmware-monitor/src` 実装を基準にした BASIC 言語仕様です。

- 対象ランタイム: `PcG815BasicRuntime`
- 方針: 実装されている挙動を先に明文化し、互換上の近似点も同一文書で管理する
- 参照データ: `/Users/yappo/Projects/z80emu/docs/basic-command-manifest.json`

## 1. 実行モデル

### 1.1 モード

- 即時モード（immediate）
  - 行頭に行番号がない入力を、その場で実行
- プログラムモード（program / RUN中）
  - 行番号付きで保存したプログラム行を `RUN` で順次実行

### 1.2 行入力ルール

- 行番号付き入力: `^<lineNumber>\s*(<statement>)$`
  - `<statement>` が空ならその行を削除
  - 空でなければ構文解析に成功した時だけ保存
- 行番号なし入力
  - 即時実行
- 改行確定
  - `CR` / `LF` で 1 行確定
- バックスペース
  - `0x08` / `0x7f` で行バッファを 1 文字削除

### 1.3 RUN 実行制約

- プログラム行は行番号昇順で実行
- `GOTO/GOSUB/IF THEN` は行番号→実行インデックスで解決
- `maxSteps` 既定値は `10_000`
  - 超過時は `RUNAWAY` エラー

## 2. 字句と式

### 2.1 トークン

- 数値: 10進整数（`[0-9]+`）
- 文字列: `"..."`（終端 `"` 必須）
- 識別子: 英字開始、後続は英数字（`[A-Z][A-Z0-9]*`）
- 演算子: `+ - * / = <> < <= > >=`
- 記号: `, ; ( )`

### 2.2 式

- 優先順位
  - 比較演算
  - 加減算
  - 乗除算
  - 単項 `+/-`
  - 括弧
- 比較演算の結果
  - 真: `1`
  - 偽: `0`
- 数値演算
  - すべて整数化（`Math.trunc`）
  - 0除算は `0`

### 2.3 配列と関数式

- `DIM` で配列宣言（下限 `0`、上限は指定値）
- 配列参照: `A(1)` / `A(1,2)`
- 式中関数
  - `INP(port)`
  - `PEEK(address[,bank])`（`bank` は受理するが現状は無視）

## 3. 実装済みコマンド（27件）

実装済み一覧:

`NEW, LIST, RUN, PRINT, LET, INPUT, GOTO, GOSUB, RETURN, IF, END, STOP, CLS, REM, FOR, NEXT, DIM, DATA, READ, RESTORE, PEEK, POKE, INP, OUT, BEEP, WAIT, LOCATE`

## 4. 命令仕様（主要）

### 4.1 制御

- `FOR v=s TO e [STEP d]`
  - `STEP` 省略時 `1`
  - `STEP 0` は `1` として扱う
- `NEXT [v]`
  - 対応する `FOR` が無い場合は `SYNTAX`
- `IF <expr> THEN <line>`
  - 条件が非0なら分岐

### 4.2 データ

- `DIM A(n[,m...])`
  - 要素数は各次元で `指定値+1`
- `DATA expr[,expr...]`
  - 実行時は no-op、`RUN` 前処理でデータプール化
- `READ target[,target...]`
  - データプールから順次読み出し
  - 枯渇時は `SYNTAX`
- `RESTORE [line]`
  - 無引数: 先頭へ戻す
  - 引数あり: 指定行以降の最初の `DATA` 位置へ

### 4.3 マシンI/O

- `OUT port,value`
  - `machineAdapter.out8` を使用
- `INP(port)`
  - `machineAdapter.in8` を使用、未接続時 `0xFF`
- `POKE address,value`
  - `machineAdapter.poke8` を使用
- `PEEK(address[,bank])`
  - `machineAdapter.peek8` を使用、未接続時 `0xFF`

### 4.4 画面・待機・音

- `LOCATE x[,y[,z]]`
  - `x,y` でカーソル移動（`machineAdapter.setTextCursor`）
  - `z` は受理するが現状は近似実装として無視
- `WAIT [n]`
  - `WAIT n`: `n/64` 秒待機（`n<=0` は即時）
  - `WAIT` 無引数: 1 秒待機（キー待ち代替）
- `BEEP [j[,k[,n]]]`
  - 音は出さない（サウンドデバイス未実装）
  - 待機秒数は `0.125*(n+1)*j` を計算し、`1..3` 秒に clamp して待機
  - `k` は受理のみ（現状は待機計算に未使用）

### 4.5 PRINT

- `PRINT`（引数なし）
  - 空行を出力
- `PRINT a;b`
  - `;` 区切りは詰めて出力
- `PRINT a,b`
  - `,` 区切りは 8 桁タブ位置へ空白を補完
- 行末 `;` / `,`
  - 改行しない

## 5. エラー表示

### 5.1 表示形式

- `ERR <message> (<numericCode>)`

### 5.2 ACTIVE コード

- `E01 SYNTAX`
- `E02 BAD LINE`
- `E03 BAD VAR`
- `E04 BAD LET`
- `E05 BAD IF`
- `E06 NO LINE`
- `E07 RUNAWAY`
- `E08 INPUT IN RUN`
- `E09 RETURN W/O GOSUB`
- `E10 BAD STMT`
- `E99 UNKNOWN`

### 5.3 RESERVED コード

実装済みとなったため、`E41..E53` は予約コードとして維持しつつ、現在は通常動作でこれらを出力しません。

## 6. 既知の近似仕様

- `WAIT` 無引数は実機のキー待ちではなく 1 秒待機
- `LOCATE` 第3引数 `z` は受理のみ
- `PEEK` 第2引数 `bank` は受理のみ
- `BEEP` は無音待機のみ
- 実機BASICとの差分はまだ残る（特に `PRINT` の完全互換を含む細部仕様）。現状は互換性を段階的に拡張し、今後も再現度を上げていく方針

## 7. 参照ファイル

- `/Users/yappo/Projects/z80emu/packages/firmware-monitor/src/ast.ts`
- `/Users/yappo/Projects/z80emu/packages/firmware-monitor/src/parser.ts`
- `/Users/yappo/Projects/z80emu/packages/firmware-monitor/src/semantics.ts`
- `/Users/yappo/Projects/z80emu/packages/firmware-monitor/src/runtime.ts`
- `/Users/yappo/Projects/z80emu/packages/firmware-monitor/src/types.ts`
- `/Users/yappo/Projects/z80emu/docs/basic-command-manifest.json`
