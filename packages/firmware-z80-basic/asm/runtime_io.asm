; ============================================================================
; 入出力共通処理 (LCD表示中心)
; ----------------------------------------------------------------------------
; 役割:
;   - LCD への文字出力と改行処理を担当する。
;   - 数値(16bit符号付き)を10進文字列へ変換して表示する。
; ============================================================================

; ----------------------------------------------------------------------------
; ルーチン: OUT_LCD_CHAR
; 役割: A を LCD データポートへ出力する。
; 入力: A=表示文字コード
; 出力: なし
; 破壊レジスタ: なし
; 副作用: LCD 文字VRAMに1文字出力
; 異常時: なし
; ----------------------------------------------------------------------------
OUT_LCD_CHAR:
  OUT (LCD_PORT),A
  RET

; ----------------------------------------------------------------------------
; ルーチン: PRINT_CRLF
; 役割: LCDへ CR/LF を出力して改行する。
; 入力: なし
; 出力: なし
; 破壊レジスタ: A
; 副作用: カーソルを次行へ進める
; 異常時: なし
; ----------------------------------------------------------------------------
PRINT_CRLF:
  LD A,CHAR_CR
  CALL OUT_LCD_CHAR
  LD A,CHAR_LF
  CALL OUT_LCD_CHAR
  RET

; ----------------------------------------------------------------------------
; ルーチン: PRINT_SPACE
; 役割: 半角空白を1文字出力する。
; ----------------------------------------------------------------------------
PRINT_SPACE:
  LD A,CHAR_SPACE
  CALL OUT_LCD_CHAR
  RET

; ----------------------------------------------------------------------------
; ルーチン: PRINT_STRING_Z
; 役割: HL が指す NULL終端文字列をLCDへ出力する。
; 入力: HL=文字列先頭
; 出力: なし
; 破壊レジスタ: A,HL
; ----------------------------------------------------------------------------
PRINT_STRING_Z:
PRINT_STRING_Z_LOOP:
  LD A,(HL)
  OR A
  RET Z
  CALL OUT_LCD_CHAR
  INC HL
  JR PRINT_STRING_Z_LOOP

; ----------------------------------------------------------------------------
; ルーチン: PRINT_NUMBER_HL
; 役割: HL(16bit符号付き)を10進で表示する。
; 入力: HL=表示値
; 出力: なし
; 破壊レジスタ: A,B,C,D,E,H,L
; ----------------------------------------------------------------------------
PRINT_NUMBER_HL:
  LD A,H
  AND 0x80
  JR Z,PRINT_NUMBER_POSITIVE

  ; 負値なら '-' を出して2の補数を取る。
  LD A,'-'
  CALL OUT_LCD_CHAR
  LD A,H
  CPL
  LD H,A
  LD A,L
  CPL
  LD L,A
  INC HL

PRINT_NUMBER_POSITIVE:
  LD A,H
  OR L
  JR NZ,PRINT_NUMBER_NONZERO
  LD A,'0'
  CALL OUT_LCD_CHAR
  RET

PRINT_NUMBER_NONZERO:
  LD DE,RAM_PRINT_DIGITS
  LD B,0

PRINT_NUMBER_DIV_LOOP:
  PUSH DE
  CALL DIV10_HL
  POP DE
  ADD A,'0'
  LD (DE),A
  INC DE
  INC B
  LD A,H
  OR L
  JR NZ,PRINT_NUMBER_DIV_LOOP

  DEC DE
PRINT_NUMBER_OUT_LOOP:
  LD A,B
  OR A
  RET Z
  LD A,(DE)
  CALL OUT_LCD_CHAR
  DEC DE
  DEC B
  JR PRINT_NUMBER_OUT_LOOP

; ----------------------------------------------------------------------------
; ルーチン: DIV10_HL
; 役割: HL を 10 で除算する(商と剰余)。
; 入力: HL=被除数(0..65535)
; 出力: HL=商, A=剰余(0..9)
; 破壊レジスタ: A,D,E,H,L
; ----------------------------------------------------------------------------
DIV10_HL:
  LD DE,0

DIV10_LOOP:
  LD A,H
  OR A
  JR NZ,DIV10_SUBTRACT
  LD A,L
  CP 10
  JR C,DIV10_DONE

DIV10_SUBTRACT:
  LD A,L
  SUB 10
  LD L,A
  JR NC,DIV10_SUBTRACT_OK
  DEC H
DIV10_SUBTRACT_OK:
  INC DE
  JR DIV10_LOOP

DIV10_DONE:
  LD A,L
  EX DE,HL
  RET
