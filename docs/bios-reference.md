# PC-G815互換 BIOS リファレンス

この文書は、`0x8000-0xBFFF` に配置した BIOS ROM の仕様です。  
参考の主軸は [akiyan の PC-G850 BIOS 解析](https://www.akiyan.com/pc-g850_technical_data#bios) で、入口を jump table 化したうえで、このリポジトリの monitor / Z80 BASIC / 将来の ASM から共通利用できる形に寄せています。

## 1. ROM レイアウト

- `0x8000-0x8002`
  - 予約領域
  - `00 00 00` (`NOP`)
- `0x8003` 以降
  - 30 エントリ固定 jump table
  - 各エントリは `CALL body`
- 後方領域
  - BIOS 本体
  - cold boot
  - monitor main loop
  - 共通 5x7 glyph table

## 2. boot / vector

- CPU reset 後の `0x0000` は RAM 側の boot vector です。
- boot vector は `JP BIOS_COLD_BOOT_ADDR` を持つだけの薄い入口です。
- cold boot は先頭で `SP=0x7FFF` を設定し、BIOS の文字列出力ルーチンを使って起動画面と prompt を描画します。
- monitor 復帰点は BIOS ROM 側です。
  - `MONITOR_PROMPT_RESUME_ADDR`
  - `MONITOR_MAIN_LOOP_ADDR`

## 3. jump table

各アドレスは BIOS ROM の絶対アドレスです。  
`参考 BIOS 対応` 列は、参考資料で近い役割を持つ分類を示します。

| Addr | Name | 参考 BIOS 対応 | 入力 | 戻り値 | フラグ/破壊 | 備考 |
|---|---|---|---|---|---|---|
| `0x8003` | `BIOS_BOOT_ENTRY` | boot | なし | 通常は戻らない | BIOS 内部依存 | jump table から cold boot を呼ぶ入口 |
| `0x8006` | `BIOS_MONITOR_MAIN_LOOP_ENTRY` | monitor loop | なし | 通常は戻らない | BIOS 内部依存 | monitor ポーリングループ |
| `0x8009` | `BIOS_CHAR_PUT_ENTRY` | 文字1文字出力 | `A=char`, `D=row`, `E=col` | `D/E=次カーソル位置` | `CF=scroll発生`, `AF/HL` 破壊 | `CR/LF/BS` を含む |
| `0x800C` | `BIOS_CHAR_REPEAT_ENTRY` | 文字連続出力 | `A=char`, `B=count`, `D=row`, `E=col` | `D/E=次カーソル位置` | `CF=最後の出力でscroll`, `AF/BC/HL` 破壊 | 同一文字を連続描画 |
| `0x800F` | `BIOS_STRING_PUT_ENTRY` | 文字列出力 | `B=len`, `HL=ptr`, `D=row`, `E=col` | `C=scroll回数`, `HL=最後に読み出した文字アドレス`, `D/E=次カーソル位置` | `AF/BC` 破壊 | 長さ付き文字列出力 |
| `0x8012` | `BIOS_GRAPHICS_WRITE_RAW_ENTRY` | グラフィック出力 | `B=len`, `HL=ptr`, `D=rawX`, `E=page` | `HL=最後に読み出した byte アドレス`, `D=次rawX` | `AF/BC` 破壊 | 生の LCD byte 列を連続出力 |
| `0x8015` | `BIOS_CRLF_ENTRY` | 改行 | `D=row`, `E=col` | `D/E=次カーソル位置` | `CF=scroll発生`, `AF/HL` 破壊 | `CR` と `LF` を順に処理 |
| `0x8018` | `BIOS_CLEAR_SCREEN_ENTRY` | 画面クリア | なし | `D=0`, `E=0` | `AF/BC` 破壊 | 画面全消去後、カーソル原点 |
| `0x801B` | `BIOS_SET_CURSOR_ENTRY` | カーソル設定 | `D=row`, `E=col` | `D/E=補正後位置` | `AF` 破壊 | 範囲外は画面内に丸める |
| `0x801E` | `BIOS_GET_GLYPH_PTR_ENTRY` | グリフ取得 | `A=char` | `HL=glyph ptr` | `DE/HL` 破壊 | 共通 5x7 glyph table を返す |
| `0x8021` | `BIOS_INKEY_ENTRY` | リアルタイムキー入力 | なし | `A=key`, 未入力時 `A=0` | `CF=入力あり`, `ZF=未入力なら1` | 現実装の key code は firmware byte queue 準拠 |
| `0x8024` | `BIOS_WAIT_KEY_ENTRY` | ウェイトキー入力 | なし | `A=key` | `CF=1` | 入力が来るまで待機 |
| `0x8027` | `BIOS_GET_DISPLAY_START_ENTRY` | 表示開始位置取得 | なし | `A=line` | `AF` 破壊 | `0x790D` の low 5bit |
| `0x802A` | `BIOS_SET_DISPLAY_START_ENTRY` | 表示開始位置設定 | `A=line` | `A=設定値(low 5bit)` | `AF` 破壊 | LCD start-line command も同時更新 |
| `0x802D` | `BIOS_SHUTDOWN_ENTRY` | shutdown | なし | 割り込み復帰時のみ | `HALT` | 現実装は `HALT` のみ |

### Reserved

- `0x8030` 以降の残り 15 エントリは `reserved`
- 現在は安全復帰スタブ

## 4. 文字系 ABI の詳細

### 4.1 文字1文字出力

- 入口: `BIOS_CHAR_PUT_ENTRY`
- 入力:
  - `A=文字コード`
  - `D=行`
  - `E=列`
- 戻り:
  - `D/E=次のカーソル位置`
- 振る舞い:
  - 通常文字は現在位置に描画し、次位置へ進む
  - `CR` は列を 0 に戻す
  - `LF` は次行へ進む
  - 最下行で `LF` の場合はスクロールし、`CF=1`
  - `BS` は 1 文字戻ってセルを消す

### 4.2 文字連続出力

- 入口: `BIOS_CHAR_REPEAT_ENTRY`
- 入力:
  - `A=文字コード`
  - `B=回数`
  - `D/E=開始位置`
- 戻り:
  - `D/E=終了後位置`

### 4.3 文字列出力

- 入口: `BIOS_STRING_PUT_ENTRY`
- 入力:
  - `B=文字数`
  - `HL=文字列先頭`
  - `D/E=開始位置`
- 戻り:
  - `C=スクロール回数`
  - `HL=最後に読み出した文字アドレス`
  - `D/E=終了後位置`

## 5. graphics ABI の詳細

- 入口: `BIOS_GRAPHICS_WRITE_RAW_ENTRY`
- 入力:
  - `B=byte数`
  - `HL=raw byte 列先頭`
  - `D=rawX`
  - `E=page`
- 戻り:
  - `HL=最後に読み出した byte アドレス`
  - `D=終了後の rawX`
- 用途:
  - raw LCD byte をそのまま横方向へ連続転送する

## 6. キー入力 ABI の詳細

### 6.1 realtime key

- 入口: `BIOS_INKEY_ENTRY`
- 戻り:
  - 入力あり: `A=key`, `CF=1`
  - 入力なし: `A=0`, `CF=0`, `ZF=1`

### 6.2 wait key

- 入口: `BIOS_WAIT_KEY_ENTRY`
- 戻り:
  - `A=key`, `CF=1`
- 補足:
  - 現実装は firmware input queue を読む
  - 実機 BIOS のキー値完全互換は初版スコープ外

## 7. 共通グリフ

- BIOS は共通 5x7 glyph table を内包します
- 1 文字 = 5 byte の縦列データ
- `BIOS_GET_GLYPH_PTR_ENTRY` は BIOS 内 glyph table の先頭位置を返します
- Z80 BASIC はローカル font table を持たず、BIOS 経由で参照します

## 8. BASIC からの利用方針

- `runtime_io.asm` は BIOS ABI を BASIC 内部カーソル状態へ橋渡しする薄いラッパです
- `PRINT`, `INPUT`, `LOCATE`, 行入力の表示系は BIOS を利用します
- `LCD_WRITE_RAW_BYTE` は BASIC 内部の `A/B/C` 形式を、BIOS の `B/HL/D/E` 形式へ変換して呼び出します

## 9. 非対象

初版では次を考慮しません。

- 実機 BIOS ワークエリアの完全再現
- 実機 BIOS キー入力値対応表の完全互換
- ASM sample 全体の BIOS 利用化

## 10. 検証項目

- `0x8000-0x8002 == 00 00 00`
- `0x8003` から 30 本の `CALL` が並ぶ
- boot vector から BIOS cold boot へ到達できる
- monitor 起動表示と prompt が LCD に描画される
- Z80 BASIC の文字 I/O と line input が BIOS ABI 経由でも回帰しない
