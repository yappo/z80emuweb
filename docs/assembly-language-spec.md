# PC-G815 Z80 Assembler 仕様

この文書は `packages/assembler-z80` の実装仕様です。

## 1. 目的

- Web UI と CLI で共通の Z80 アセンブラを提供する
- `ORG/ENTRY` で実行開始位置を制御する
- 出力として `BIN + LST + SYM + DUMP` を生成する

## 2. ソース形式

- 1 行 1 文
- コメント: `;` 以降
- ラベル:
  - `LABEL:`
  - `LABEL EQU <expr>`
- 大文字/小文字は区別しない（シンボル解決は case-insensitive）

## 3. ディレクティブ

- `ORG <expr>`
  - 現在アドレスを変更する
  - 有効範囲は `0x0000-0x7FFF`（RAM 範囲）
- `ENTRY <expr>`
  - 実行開始アドレスを指定する
  - 未指定時は先頭 `ORG` を使用
- `EQU <expr>`
  - 定数シンボルを定義する
- `DB <item>[, <item>...]`
  - 8-bit データ列
  - 数値式または文字列リテラル
- `DW <expr>[, <expr>...]`
  - 16-bit little endian データ列
- `DS <count>[, <fill>]`
  - `count` バイトを確保（既定 fill=0）
- `END`
  - アセンブル終了
- `INCLUDE "path.asm"`
  - CLI では入力ファイル相対で解決
  - Web では includeResolver 未設定のためエラー

## 4. 式

対応演算子（優先順位順）:

1. unary: `+ - ~`
2. `* / %`
3. `+ -`
4. `<< >>`
5. `&`
6. `^`
7. `|`

対応リテラル:

- 10進: `123`
- 16進: `0x7B`, `7BH`
- 2進: `0b1010`, `1010B`
- 8進: `0o77`
- 文字: `'A'`, `'\n'`
- 現在アドレス: `$`

## 5. 出力

- `BIN`: ORG 起点の連続バイト列（穴は 0 埋め）
- `LST`: `AAAA: BBBBBBBB CCCCCCCC | source`
- `SYM`: `name = value (kind)`
- `DUMP`: `AAAA: BBBBBBBB CCCCCCCC`

## 6. CLI

```bash
npm run asm -- -i input.asm -o out.bin --lst out.lst --sym out.sym
```

- 既定出力先: `./dist/<input-base>.(bin|lst|sym|dump.txt)`
- `--format dump` で標準出力にダンプを出す
- エラー時は `stderr` に `file:line:column: message` を出力し、終了コード `1`

## 7. Web UI

- タブ: `BASIC` / `ASSEMBLER`（初期 `BASIC`）
- ASSEMBLER タブ:
  - `ASSEMBLE`: ソースをアセンブルしてダンプ表示
  - `RUN`: 直近成功ビルド（または自動アセンブル）を `ORG/ENTRY` で実行
  - `STOP CPU`: 実行停止
  - `NEW`, `Load Sample`: エディタ操作

## 8. エラー方針

- エラーは行・列つきで報告
- 主なエラー:
  - 未知シンボル
  - 無効オペランド
  - 相対ジャンプ範囲外
  - RAM 範囲外 `ORG` / プログラム配置
  - `INCLUDE` 解決失敗
