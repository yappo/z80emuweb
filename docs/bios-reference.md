# PC-G815互換 BIOS リファレンス

この文書は、現行実装の BIOS ROM 仕様をまとめたものです。  
BIOS は system ROM 窓 `0x8000-0xBFFF` に配置され、monitor / Z80 BASIC / 将来の ASM プログラムから共通利用されます。

## 1. ROM レイアウト

- `0x8000-0x8002`
  - 予約領域
  - 現在は `00 00 00` (`NOP`)
- `0x8003` 以降
  - 30 エントリ固定の jump table
  - 各エントリは `CALL body` の 3 byte
- jump table 後方
  - BIOS 本体
  - monitor cold boot
  - monitor main loop
  - 共通 5x7 glyph table

## 2. boot / vector

- CPU reset 後の `0x0000` は RAM 側の boot vector です。
- boot vector は `JP` で BIOS cold boot 本体へ直接分岐します。
- BIOS cold boot は最初に `SP=0x7FFF` を設定し、その後 BIOS ルーチンを用いて起動画面と prompt を描画します。
- monitor 復帰点は BIOS ROM 側にあります。`MONITOR_PROMPT_RESUME_ADDR` と `MONITOR_MAIN_LOOP_ADDR` は絶対アドレスです。

## 3. jump table

各アドレスは BIOS ROM の絶対アドレスです。

| Addr | Name | Role | Input | Return | Clobber | Users |
|---|---|---|---|---|---|---|
| `0x8003` | `BIOS_BOOT_ENTRY` | BIOS boot 入口 | なし | 通常は戻らない | BIOS 内部依存 | firmware |
| `0x8006` | `BIOS_MONITOR_MAIN_LOOP_ENTRY` | monitor main loop | なし | 通常は戻らない | BIOS 内部依存 | firmware |
| `0x8009` | `BIOS_CHAR_PUT_ENTRY` | 1文字出力 | `A=char` | なし | flags | BASIC / firmware / ASM |
| `0x800C` | `BIOS_CHAR_REPEAT_ENTRY` | 同一文字の連続出力 | `A=char`, `B=count` | なし | flags | BASIC / ASM |
| `0x800F` | `BIOS_STRING_PUT_Z_ENTRY` | 0終端文字列出力 | `HL=ptr` | なし | flags | BASIC / firmware / ASM |
| `0x8012` | `BIOS_GRAPHICS_WRITE_RAW_ENTRY` | raw LCD byte 書き込み | `A=value`, `B=rawX`, `C=page` | なし | flags | BASIC / ASM |
| `0x8015` | `BIOS_CRLF_ENTRY` | CR/LF 出力 | なし | なし | flags | BASIC / firmware / ASM |
| `0x8018` | `BIOS_CLEAR_SCREEN_ENTRY` | 画面クリア | なし | なし | flags | BASIC / firmware / ASM |
| `0x801B` | `BIOS_SET_CURSOR_ENTRY` | テキストカーソル設定 | `D=row`, `E=col` | なし | flags | BASIC / firmware / ASM |
| `0x801E` | `BIOS_GET_GLYPH_PTR_ENTRY` | 共通グリフ取得 | `A=char` | `HL=glyph ptr` | flags | BASIC / ASM |
| `0x8021` | `BIOS_INKEY_ENTRY` | 非ブロッキング入力取得 | なし | `A=char or 0` | flags | BASIC / ASM |
| `0x8024` | `BIOS_WAIT_KEY_ENTRY` | ブロッキング入力取得 | なし | `A=char` | flags | BASIC / ASM |
| `0x8027` | `BIOS_GET_DISPLAY_START_ENTRY` | 表示開始ライン取得 | なし | `A=line` | flags | firmware / ASM |
| `0x802A` | `BIOS_SET_DISPLAY_START_ENTRY` | 表示開始ライン設定 | `A=line` | なし | flags | firmware / ASM |
| `0x802D` | `BIOS_SHUTDOWN_ENTRY` | HALT 実行 | なし | 割り込み復帰時のみ戻る | flags | firmware / ASM |

### Reserved

- `0x8030` 以降の残り 15 エントリは `reserved` です。
- 現在は安全復帰スタブで、呼び出しても即座に戻るだけです。

## 4. 共通グリフ

- BIOS は共通 5x7 glyph table を内包します。
- glyph は 1 文字あたり 5 byte の縦列データです。
- `BIOS_GET_GLYPH_PTR_ENTRY` はこの BIOS 内 glyph table 先頭から対象文字の 5 byte を指す `HL` を返します。
- Z80 BASIC は直接フォント実体を持たず、BIOS 経由で同一 glyph table を参照します。

## 5. BASIC からの利用方針

- `PRINT`, `INPUT`, `LOCATE`, 行入力の表示系は BIOS を利用します。
- `runtime_io.asm` は BIOS 呼び出しの薄い中継に寄せ、LCD 直叩きやローカル font table を持ちません。
- キー入力は `BIOS_WAIT_KEY_ENTRY` / `BIOS_INKEY_ENTRY` を利用します。

## 6. 非対象

初版では次を考慮しません。

- 実機 BIOS ワークエリアの完全再現
- 実機 BIOS キー入力値対応表の完全互換
- ASM sample 全体の BIOS 利用化

## 7. 検証項目

- `0x8000-0x8002` が `00 00 00`
- `0x8003` から 30 本の `CALL` が並ぶ
- boot vector から BIOS cold boot へ到達できる
- monitor 起動表示と prompt が LCD に描かれる
- Z80 BASIC の文字 I/O が BIOS 経由でも既存回帰を維持する
