# PC-G815 BASIC 実装仕様（現行実装）

この文書は、現在の `packages/firmware-monitor/src` 実装を基準にした BASIC 言語仕様です。

- 対象ランタイム: `PcG815BasicRuntime`
- 方針: 実装されている挙動を先に明文化し、PC-G815 BASIC 由来の未実装項目を同一文書で管理する
- 参照データ: `docs/basic-command-manifest.json`

## 1. 実行モデル

### 1.1 モード

- 即時モード（immediate）
  - 行頭に行番号がない入力を、その場で実行する
- プログラムモード（program / RUN中）
  - 行番号付きで保存したプログラム行を `RUN` で順次実行する

### 1.2 行入力の基本ルール

- 行番号付き入力: `^<lineNumber>\s*(<statement>)$`
  - `<statement>` が空なら、その行番号を削除
  - 空でなければパースに成功したときだけ保存
- 行番号なし入力
  - その場でパース・実行
- 改行確定
  - `CR` / `LF` で 1 行確定
- バックスペース
  - `0x08` / `0x7f` で行バッファを 1 文字削除

### 1.3 RUN 実行制約

- プログラム行は行番号昇順で実行
- `GOTO/GOSUB/IF THEN` は行番号→実行インデックス表で解決
- `maxSteps` 既定値は `10_000`
  - 超過時は `RUNAWAY` エラー

## 2. 字句と文法

### 2.1 トークン

- 数値: 10進整数（`[0-9]+`）
- 文字列: `"..."`（終端 `"` 必須）
- 識別子: 英字開始、後続は英数字（`[A-Z][A-Z0-9]*`）
- 演算子: `+ - * / = <> < <= > >=`
- 記号: `, ( )`

### 2.2 識別子

- 内部では大文字に正規化
- 変数は数値変数のみ（文字列変数・配列は未実装）

### 2.3 式

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
  - 0除算は `0` を返す

## 3. 実装済みコマンド（14件）

実装済み一覧: `NEW, LIST, RUN, PRINT, LET, INPUT, GOTO, GOSUB, RETURN, IF, END, STOP, CLS, REM`

| コマンド | 構文 | 実行モード | 概要 |
|---|---|---|---|
| `NEW` | `NEW` | 即時のみ | 保存プログラムと変数をクリアし `OK` を返す |
| `LIST` | `LIST` | 即時のみ | 保存済み行を行番号昇順で表示 |
| `RUN` | `RUN` | 即時のみ | 保存プログラムを実行 |
| `PRINT` | `PRINT <expr>[, <expr> ...]` | 即時/プログラム | 式列を評価して空白区切りで出力 |
| `LET` | `LET <var>=<expr>` | 即時/プログラム | 数値変数へ代入 |
| `LET` 省略形 | `<var>=<expr>` | 即時/プログラム | `LET` と同じ |
| `INPUT` | `INPUT <var>` | 即時のみ | `? ` を表示して 1 行入力を数値代入 |
| `GOTO` | `GOTO <line>` | プログラムのみ | 指定行へ無条件分岐 |
| `GOSUB` | `GOSUB <line>` | プログラムのみ | 復帰先を積んで指定行へ分岐 |
| `RETURN` | `RETURN` | プログラムのみ | `GOSUB` の復帰先へ戻る |
| `IF` | `IF <expr> THEN <line>` | プログラムのみ | 条件が非0なら指定行へ分岐 |
| `END` | `END` | プログラムのみ | RUNを終了 |
| `STOP` | `STOP` | プログラムのみ | RUNを終了 |
| `CLS` | `CLS` | 即時/プログラム | マシンアダプタ経由で表示クリア |
| `REM` | `REM <text>` | 即時/プログラム | コメントとして無視 |

## 4. 実装上の重要仕様

### 4.1 `PRINT`

- カンマ区切りの各式を評価し、結果を空白 1 個で連結して出力
- 文字列式と数値式を混在可能

### 4.2 `INPUT`

- RUN中の `INPUT` は非対応（`INPUT IN RUN`）
- 入力行は `parseInt` で整数化
  - 数値でない場合は `0`

### 4.3 `IF`

- 構文は `IF <expr> THEN <line>` のみ
- THEN の後ろは行番号のみ受理

### 4.4 変数

- 未定義変数参照は `0`
- 変数スコープはランタイム全体（グローバル）

## 5. エラー表示

主な表示エラー:

- `SYNTAX`
- `BAD LINE`
- `BAD VAR`
- `BAD LET`
- `BAD IF`
- `NO LINE <line>`
- `RUNAWAY`
- `INPUT IN RUN`
- `RETURN W/O GOSUB`
- `BAD STMT`

## 6. PC-G815 BASIC 由来の未実装一覧（同一管理）

以下は `docs/basic-command-manifest.json` で `implemented=false` の項目です。

| コマンド | カテゴリ | 現状 |
|---|---|---|
| `FOR` | control | 未実装 |
| `NEXT` | control | 未実装 |
| `DIM` | data | 未実装 |
| `DATA` | data | 未実装 |
| `READ` | data | 未実装 |
| `RESTORE` | data | 未実装 |
| `PEEK` | machine | 未実装 |
| `POKE` | machine | 未実装 |
| `INP` | machine | 未実装 |
| `OUT` | machine | 未実装 |
| `BEEP` | audio | 未実装 |
| `WAIT` | machine | 未実装 |
| `LOCATE` | display | 未実装 |

## 7. 未実装に伴う言語制限

- ループ制御（`FOR/NEXT`）は使えない
- 配列・データ文（`DIM/DATA/READ/RESTORE`）は使えない
- 低レベル機械操作（`PEEK/POKE/INP/OUT/WAIT`）は使えない
- 音関連（`BEEP`）は使えない
- カーソル位置制御（`LOCATE`）は使えない

## 8. 参照ファイル

- `packages/firmware-monitor/src/command-registry.ts`
- `packages/firmware-monitor/src/parser.ts`
- `packages/firmware-monitor/src/lexer.ts`
- `packages/firmware-monitor/src/runtime.ts`
- `packages/firmware-monitor/src/semantics.ts`
- `docs/basic-command-manifest.json`
