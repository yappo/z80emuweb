; ============================================================================
; 入出力共通処理 (LCD表示中心)
; ----------------------------------------------------------------------------
; 役割:
;   - LCD への文字出力と改行処理を担当する。
;   - 数値(16bit符号付き)を10進文字列へ変換して表示する。
;   - 文字表示は raw LCD byte 書き込みで直接描画する。
; ============================================================================

LCD_VISIBLE_COLS EQU 24
LCD_VISIBLE_ROWS EQU 4
LCD_HALF_COLS    EQU 12
LCD_PAGE_COLS    EQU 72

; ----------------------------------------------------------------------------
; ルーチン: OUT_LCD_CHAR
; 役割: A の文字を raw LCD へ描画する。
; 入力: A=表示文字コード
; 出力: なし
; 破壊レジスタ: なし
; ----------------------------------------------------------------------------
OUT_LCD_CHAR:
  PUSH AF
  PUSH BC
  PUSH DE
  PUSH HL
  LD B,A
  CP CHAR_CR
  JR Z,OUT_LCD_CHAR_CR
  CP CHAR_LF
  JR Z,OUT_LCD_CHAR_LF
  CP 0x08
  JR Z,OUT_LCD_CHAR_BS

  LD A,(RAM_TEXT_WRAP)
  OR A
  CALL NZ,LCD_APPLY_PENDING_WRAP

  LD A,B
  CALL LCD_DRAW_CHAR_AT_CURSOR
  CALL LCD_ADVANCE_CURSOR
  JR OUT_LCD_CHAR_DONE

OUT_LCD_CHAR_CR:
  XOR A
  LD (RAM_TEXT_COL),A
  LD (RAM_TEXT_WRAP),A
  JR OUT_LCD_CHAR_DONE

OUT_LCD_CHAR_LF:
  LD A,(RAM_TEXT_ROW)
  CP LCD_VISIBLE_ROWS - 1
  JR C,OUT_LCD_CHAR_LF_NEXT
  CALL LCD_SCROLL_UP_ONE_ROW
  XOR A
  LD (RAM_TEXT_WRAP),A
  JR OUT_LCD_CHAR_DONE
OUT_LCD_CHAR_LF_NEXT:
  INC A
  LD (RAM_TEXT_ROW),A
  XOR A
  LD (RAM_TEXT_WRAP),A
  JR OUT_LCD_CHAR_DONE

OUT_LCD_CHAR_BS:
  LD A,(RAM_TEXT_WRAP)
  OR A
  JR NZ,OUT_LCD_CHAR_BS_CANCEL_WRAP
  LD A,(RAM_TEXT_COL)
  OR A
  JR Z,OUT_LCD_CHAR_BS_CLEAR
  DEC A
  LD (RAM_TEXT_COL),A
OUT_LCD_CHAR_BS_CLEAR:
  XOR A
  LD (RAM_TEXT_WRAP),A
  CALL LCD_CLEAR_CELL_AT_CURSOR
  JR OUT_LCD_CHAR_DONE
OUT_LCD_CHAR_BS_CANCEL_WRAP:
  XOR A
  LD (RAM_TEXT_WRAP),A

OUT_LCD_CHAR_DONE:
  POP HL
  POP DE
  POP BC
  POP AF
  RET

; ----------------------------------------------------------------------------
; ルーチン: PRINT_CRLF
; ----------------------------------------------------------------------------
PRINT_CRLF:
  LD A,CHAR_CR
  CALL OUT_LCD_CHAR
  LD A,CHAR_LF
  CALL OUT_LCD_CHAR
  RET

; ----------------------------------------------------------------------------
; ルーチン: PRINT_SPACE
; ----------------------------------------------------------------------------
PRINT_SPACE:
  LD A,CHAR_SPACE
  CALL OUT_LCD_CHAR
  RET

; ----------------------------------------------------------------------------
; ルーチン: PRINT_STRING_Z
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
; ----------------------------------------------------------------------------
PRINT_NUMBER_HL:
  LD A,H
  AND 0x80
  JR Z,PRINT_NUMBER_POSITIVE

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

; ----------------------------------------------------------------------------
; ルーチン群: LCD text/raw helpers
; ----------------------------------------------------------------------------
LCD_SET_CURSOR_HOME:
  XOR A
  LD (RAM_TEXT_COL),A
  LD (RAM_TEXT_ROW),A
  LD (RAM_TEXT_WRAP),A
  RET

; 入力: D=row, E=col
LCD_SET_CURSOR_DE:
  LD A,E
  LD (RAM_TEXT_COL),A
  LD A,D
  LD (RAM_TEXT_ROW),A
  XOR A
  LD (RAM_TEXT_WRAP),A
  RET

LCD_ADVANCE_CURSOR:
  LD A,(RAM_TEXT_COL)
  CP LCD_VISIBLE_COLS - 1
  JR C,LCD_ADVANCE_CURSOR_INC
  LD A,1
  LD (RAM_TEXT_WRAP),A
  RET
LCD_ADVANCE_CURSOR_INC:
  INC A
  LD (RAM_TEXT_COL),A
  RET

LCD_APPLY_PENDING_WRAP:
  XOR A
  LD (RAM_TEXT_COL),A
  LD (RAM_TEXT_WRAP),A
  LD A,(RAM_TEXT_ROW)
  CP LCD_VISIBLE_ROWS - 1
  JR C,LCD_APPLY_PENDING_WRAP_NEXT
  CALL LCD_SCROLL_UP_ONE_ROW
  RET
LCD_APPLY_PENDING_WRAP_NEXT:
  INC A
  LD (RAM_TEXT_ROW),A
  RET

LCD_CLEAR_SCREEN:
  LD C,0
LCD_CLEAR_SCREEN_PAGE_LOOP:
  LD B,0
LCD_CLEAR_SCREEN_COL_LOOP:
  XOR A
  PUSH BC
  CALL LCD_WRITE_RAW_BYTE
  POP BC
  INC B
  LD A,B
  CP LCD_PAGE_COLS
  JR C,LCD_CLEAR_SCREEN_COL_LOOP
  INC C
  LD A,C
  CP 8
  JR C,LCD_CLEAR_SCREEN_PAGE_LOOP
  JP LCD_SET_CURSOR_HOME

LCD_CLEAR_CELL_AT_CURSOR:
  LD B,0
LCD_CLEAR_CELL_AT_CURSOR_LOOP:
  XOR A
  PUSH BC
  CALL LCD_WRITE_GLYPH_COLUMN_FROM_CURSOR
  POP BC
  INC B
  LD A,B
  CP 6
  JR C,LCD_CLEAR_CELL_AT_CURSOR_LOOP
  RET

; 入力: A=char
LCD_DRAW_CHAR_AT_CURSOR:
  PUSH AF
  CALL LCD_GET_GLYPH_PTR
  LD B,0
LCD_DRAW_CHAR_LOOP:
  LD A,(HL)
  PUSH HL
  PUSH BC
  CALL LCD_WRITE_GLYPH_COLUMN_FROM_CURSOR
  POP BC
  POP HL
  INC HL
  INC B
  LD A,B
  CP 5
  JR C,LCD_DRAW_CHAR_LOOP
  XOR A
  CALL LCD_WRITE_GLYPH_COLUMN_FROM_CURSOR
  POP AF
  RET

; 入力: A=byte, B=columnOffset(0..5)
LCD_WRITE_GLYPH_COLUMN_FROM_CURSOR:
  PUSH AF
  LD D,B
  LD A,(RAM_TEXT_COL)
  CP LCD_HALF_COLS
  JR C,LCD_WRITE_GLYPH_COLUMN_LEFT

  ADD A,A
  LD B,A
  ADD A,A
  ADD A,B
  LD B,A
  LD A,143
  SUB B
  SUB D
  LD B,A
  LD A,(RAM_TEXT_ROW)
  ADD A,4
  LD C,A
  POP AF
  JP LCD_WRITE_RAW_BYTE

LCD_WRITE_GLYPH_COLUMN_LEFT:
  ADD A,A
  LD B,A
  ADD A,A
  ADD A,B
  ADD A,D
  LD B,A
  LD A,(RAM_TEXT_ROW)
  LD C,A
  POP AF
  JP LCD_WRITE_RAW_BYTE

; 入力: A=char, 出力: HL=glyph ptr
LCD_GET_GLYPH_PTR:
  LD E,A
  LD D,0
  LD L,A
  LD H,0
  ADD HL,HL
  ADD HL,HL
  ADD HL,DE
  LD DE,FONT5X7_TABLE
  ADD HL,DE
  RET

; 入力: B=rawX(0..71), C=page(0..7), 出力: A=raw byte
LCD_READ_RAW_BYTE:
  PUSH BC
  LD A,B
  CP 60
  JR C,LCD_READ_RAW_BYTE_SECONDARY
  SUB 60
  OR 0x40
  OUT (LCD_CMD_PORT),A
  LD A,C
  OR 0x80
  OUT (LCD_CMD_PORT),A
  IN A,(LCD_READ_PORT)
  IN A,(LCD_READ_PORT)
  POP BC
  RET
LCD_READ_RAW_BYTE_SECONDARY:
  OR 0x40
  OUT (LCD_CMD2_PORT),A
  LD A,C
  OR 0x80
  OUT (LCD_CMD2_PORT),A
  IN A,(LCD_READ2_PORT)
  IN A,(LCD_READ2_PORT)
  POP BC
  RET

; 入力: A=value, B=rawX(0..71), C=page(0..7)
LCD_WRITE_RAW_BYTE:
  PUSH AF
  LD A,B
  CP 60
  JR C,LCD_WRITE_RAW_BYTE_SECONDARY
  SUB 60
  OR 0x40
  OUT (LCD_CMD_PORT),A
  LD A,C
  OR 0x80
  OUT (LCD_CMD_PORT),A
  POP AF
  OUT (LCD_PORT),A
  RET
LCD_WRITE_RAW_BYTE_SECONDARY:
  OR 0x40
  OUT (LCD_CMD2_PORT),A
  LD A,C
  OR 0x80
  OUT (LCD_CMD2_PORT),A
  POP AF
  OUT (LCD_PORT2),A
  RET

; 入力: D=destPage, E=srcPage
LCD_COPY_PAGE:
  LD B,0
LCD_COPY_PAGE_LOOP:
  PUSH BC
  LD C,E
  CALL LCD_READ_RAW_BYTE
  LD C,D
  CALL LCD_WRITE_RAW_BYTE
  POP BC
  INC B
  LD A,B
  CP LCD_PAGE_COLS
  JR C,LCD_COPY_PAGE_LOOP
  RET

; 入力: C=page
LCD_CLEAR_PAGE:
  LD B,0
LCD_CLEAR_PAGE_LOOP:
  XOR A
  PUSH BC
  CALL LCD_WRITE_RAW_BYTE
  POP BC
  INC B
  LD A,B
  CP LCD_PAGE_COLS
  JR C,LCD_CLEAR_PAGE_LOOP
  RET

LCD_SCROLL_UP_ONE_ROW:
  LD D,0
  LD E,1
  CALL LCD_COPY_PAGE
  LD D,1
  LD E,2
  CALL LCD_COPY_PAGE
  LD D,2
  LD E,3
  CALL LCD_COPY_PAGE
  LD C,3
  CALL LCD_CLEAR_PAGE
  LD D,4
  LD E,5
  CALL LCD_COPY_PAGE
  LD D,5
  LD E,6
  CALL LCD_COPY_PAGE
  LD D,6
  LD E,7
  CALL LCD_COPY_PAGE
  LD C,7
  CALL LCD_CLEAR_PAGE
  LD A,LCD_VISIBLE_ROWS - 1
  LD (RAM_TEXT_ROW),A
  XOR A
  LD (RAM_TEXT_WRAP),A
  RET
