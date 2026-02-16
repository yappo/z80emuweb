# PC-G815 BASIC 実装仕様（Task1-7 同期版）

この文書は `packages/firmware-monitor/src` の現行実装を基準にした仕様です。

- 対象ランタイム: `PcG815BasicRuntime`
- 参照マニフェスト: `docs/basic-command-manifest.json`
- 参照コーパス: `docs/basic-observation-corpus/*.yaml`

## 1. 実行モデル

- 即時モード
  - 行番号なし入力をその場で実行します。
- プログラムモード
  - 行番号付き入力を保持し、`RUN` で昇順実行します。
- 行ラベル
  - `*LABEL:` を行頭ラベルとして扱います。
- 行内複文
  - `:` 区切りで複数文を同一行に記述できます。
- コメント
  - `REM` と `'`（アポストロフィ）をサポートします。
- 停止/再開
  - `STOP` で中断し、`CONT` で再開します。

## 2. 字句と式

### 2.1 トークン

- 数値: 10進整数・小数入力（内部は整数化）
- 16進: `&Hxxxx`
- 文字列: `"..."`（終端必須）
- 識別子: `A..Z` で開始、`$` 接尾辞対応
- 演算子: `+ - * / \ ^ = <> < <= > >= AND OR XOR MOD NOT`

### 2.2 優先順位

`OR/XOR/AND < 比較 < +,- < *,/,\,MOD < ^ < unary(+,-,NOT)`

### 2.3 真理値

- 真: `-1`
- 偽: `0`

### 2.4 組み込み関数

- 数値系: `ABS, INT, SGN, SQR, SIN, COS, TAN, ATN, RND, LOG, LN, EXP, ASC, VAL, LEN`
- 文字列系: `CHR$, STR$, HEX$, LEFT$, MID$, RIGHT$, INKEY$`
- マシン系: `INP(port)`, `PEEK(address[,bank])`

## 3. 制御・データ

- 分岐: `IF ... THEN ... [ELSE ...]`, `GOTO`, `GOSUB`, `RETURN`
- ループ:
  - `FOR ... NEXT`
  - `REPEAT ... UNTIL`
  - `WHILE ... WEND`
- データ: `DIM`, `DATA`, `READ`, `RESTORE`, `ERASE`, `CLEAR`
- 行編集: `NEW`, `LIST/LLIST`, `DELETE`, `AUTO`, `RENUM`

## 4. I/O・ファイル・機械操作

- 入出力: `PRINT/LPRINT`, `INPUT`, `LNINPUT`, `USING`, `WAIT`, `BEEP`, `LOCATE`
- ファイル: `OPEN`, `CLOSE`, `LOAD`, `SAVE`, `LFILES`, `FILES`, `KILL`, `LCOPY`, `BLOAD`, `BSAVE`
- 機械: `OUT`, `POKE`, `CALL`, `MON`, `PASS`, `PIOSET`, `PIOPUT`, `SPINP`, `SPOUT`, `HDCOPY`

## 5. 描画

- `GCURSOR`, `GPRINT`, `LINE`, `PSET`, `PRESET`
- `CIRCLE` は midpoint 近似で描画
- `PAINT` は adapter の `paintArea` があれば委譲、なければ点描フォールバック

## 6. 互換近似/制限

- 機種依存命令の一部（特に `PIO*`, `SP*`, `HDCOPY`）は簡易ポートモデル/擬似出力です。
- `AUTO` は実行系での簡易自動採番モード（`.` で終了）です。
- `BLOAD/BSAVE/FILES` は adapter がない場合、ランタイム内 virtual binary file へフォールバックします。
- `LNINPUT` はカンマ分割せず、生行文字列をそのまま受け取ります。

## 7. エラー

- 主要表示: `ERR <message> (<numericCode>)`
- 現行で主に使用するコード:
  - `E01 SYNTAX`
  - `E02 BAD LINE`
  - `E04 BAD LET`
  - `E05 BAD IF`
  - `E06 NO LINE`
  - `E07 RUNAWAY`
  - `E09 RETURN W/O GOSUB`
  - `E10 BAD STMT`

## 8. 参照実装

- `packages/firmware-monitor/src/lexer.ts`
- `packages/firmware-monitor/src/parser.ts`
- `packages/firmware-monitor/src/semantics.ts`
- `packages/firmware-monitor/src/runtime.ts`
- `packages/firmware-monitor/src/types.ts`
