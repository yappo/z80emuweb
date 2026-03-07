; ============================================================================
; 入出力共通処理 (BIOS 呼び出し中心)
; ----------------------------------------------------------------------------
; 役割:
;   - BIOS の文字/入力/描画ルーチンを BASIC から呼びやすい形で中継する。
;   - 数値(16bit符号付き)を10進文字列へ変換して表示する。
; ============================================================================

; ----------------------------------------------------------------------------
; ルーチン: OUT_LCD_CHAR
; ----------------------------------------------------------------------------
OUT_LCD_CHAR:
  CALL BIOS_CHAR_PUT_ENTRY
  RET

; ----------------------------------------------------------------------------
; ルーチン: PRINT_CRLF
; ----------------------------------------------------------------------------
PRINT_CRLF:
  CALL BIOS_CRLF_ENTRY
  RET

; ----------------------------------------------------------------------------
; ルーチン: PRINT_SPACE
; ----------------------------------------------------------------------------
PRINT_SPACE:
  LD A,CHAR_SPACE
  CALL BIOS_CHAR_PUT_ENTRY
  RET

; ----------------------------------------------------------------------------
; ルーチン: PRINT_STRING_Z
; ----------------------------------------------------------------------------
PRINT_STRING_Z:
  CALL BIOS_STRING_PUT_Z_ENTRY
  RET

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

LCD_SET_CURSOR_HOME:
  XOR A
  LD D,A
  LD E,A
  CALL BIOS_SET_CURSOR_ENTRY
  RET

; 入力: D=row, E=col
LCD_SET_CURSOR_DE:
  CALL BIOS_SET_CURSOR_ENTRY
  RET

LCD_CLEAR_SCREEN:
  CALL BIOS_CLEAR_SCREEN_ENTRY
  RET

; 入力: A=char, 出力: HL=glyph ptr
LCD_GET_GLYPH_PTR:
  CALL BIOS_GET_GLYPH_PTR_ENTRY
  RET

; 入力: B=rawX(0..71), C=page(0..7), 出力: A=raw byte
LCD_READ_RAW_BYTE:
  XOR A
  RET

; 入力: A=value, B=rawX(0..71), C=page(0..7)
LCD_WRITE_RAW_BYTE:
  CALL BIOS_GRAPHICS_WRITE_RAW_ENTRY
  RET
