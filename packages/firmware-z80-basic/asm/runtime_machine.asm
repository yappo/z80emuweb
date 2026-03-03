; ============================================================================
; マシン制御系命令
; ----------------------------------------------------------------------------
; 役割:
;   - CLS / LOCATE / OUT / POKE / WAIT / BEEP などの機械依存命令を処理する。
; ============================================================================

; ----------------------------------------------------------------------------
; ルーチン: CMD_CLS_HANDLER
; 役割: 画面クリアを実行する。
; ----------------------------------------------------------------------------
CMD_CLS_HANDLER:
  CALL ASSERT_END_AFTER_CMD
  LD A,(RAM_LAST_ERROR)
  OR A
  RET NZ
  LD A,0x01
  OUT (LCD_CMD_PORT),A
  RET

; ----------------------------------------------------------------------------
; ルーチン: CMD_LOCATE_HANDLER
; 役割: LOCATE x,y でテキストカーソル位置を設定する。
; ----------------------------------------------------------------------------
CMD_LOCATE_HANDLER:
  CALL LOAD_AFTER_CMD_HL
  CALL SKIP_SPACES
  LD A,(HL)
  OR A
  JP Z,SET_SYNTAX_ERROR
  CALL EXPR_SET_PTR_HL
  CALL EVAL_EXPRESSION
  LD E,L

  CALL EXPR_SKIP_SPACES
  CALL EXPR_GET_PTR_HL
  LD A,(HL)
  CP ','
  JP NZ,SET_SYNTAX_ERROR
  INC HL
  PUSH DE
  CALL EXPR_SET_PTR_HL
  CALL EVAL_EXPRESSION
  LD A,L
  POP DE
  LD D,A

  ; cursor = y*24 + x
  LD A,D
  LD B,A
  ADD A,A
  ADD A,A
  ADD A,A
  LD C,A            ; y*8
  LD A,B
  ADD A,A
  ADD A,A
  ADD A,A
  ADD A,A
  ADD A,C           ; y*24
  ADD A,E
  OR 0x80
  OUT (LCD_CMD_PORT),A
  CALL ASSERT_END_FROM_EXPRPTR
  RET

; ----------------------------------------------------------------------------
; ルーチン: CMD_OUT_HANDLER
; 役割: OUT port,value を実行する。
; ----------------------------------------------------------------------------
CMD_OUT_HANDLER:
  CALL LOAD_AFTER_CMD_HL
  CALL SKIP_SPACES
  LD A,(HL)
  OR A
  JP Z,SET_SYNTAX_ERROR
  CALL EXPR_SET_PTR_HL
  CALL EVAL_EXPRESSION
  LD B,L

  CALL EXPR_SKIP_SPACES
  CALL EXPR_GET_PTR_HL
  LD A,(HL)
  CP ','
  JP NZ,SET_SYNTAX_ERROR
  INC HL
  PUSH BC
  CALL EXPR_SET_PTR_HL
  CALL EVAL_EXPRESSION
  LD A,L
  POP BC
  CALL OUT_PORT_LITERAL_A
  CALL ASSERT_END_FROM_EXPRPTR
  RET

; ----------------------------------------------------------------------------
; ルーチン: CMD_POKE_HANDLER
; 役割: POKE address,value を実行する。
; ----------------------------------------------------------------------------
CMD_POKE_HANDLER:
  CALL LOAD_AFTER_CMD_HL
  CALL SKIP_SPACES
  LD A,(HL)
  OR A
  JP Z,SET_SYNTAX_ERROR
  CALL EXPR_SET_PTR_HL
  CALL EVAL_EXPRESSION
  PUSH HL

  CALL EXPR_SKIP_SPACES
  CALL EXPR_GET_PTR_HL
  LD A,(HL)
  CP ','
  JR NZ,CMD_POKE_ABORT
  INC HL
  CALL EXPR_SET_PTR_HL
  CALL EVAL_EXPRESSION
  LD A,L
  POP HL
  LD (HL),A
  RET

CMD_POKE_ABORT:
  POP HL
  JP SET_SYNTAX_ERROR

; ----------------------------------------------------------------------------
; ルーチン: CMD_WAIT_HANDLER
; 役割:
;   - WAIT n を n に比例した遅延で処理する。
;   - n は 1..255 を想定し、255 を上限として扱う。
; ----------------------------------------------------------------------------
CMD_WAIT_HANDLER:
  CALL LOAD_AFTER_CMD_HL
  CALL SKIP_SPACES
  LD A,(HL)
  OR A
  JR Z,CMD_WAIT_NO_ARG
  CALL EXPR_SET_PTR_HL
  CALL EVAL_EXPRESSION
  PUSH HL
  CALL EXPR_SKIP_SPACES
  CALL EXPR_GET_PTR_HL
  LD A,(HL)
  OR A
  JR Z,CMD_WAIT_ARG_END_OK
  POP HL
  JP SET_SYNTAX_ERROR
CMD_WAIT_ARG_END_OK:
  POP HL
  LD A,H
  OR L
  RET Z

  LD A,H
  OR A
  JR Z,CMD_WAIT_RANGE_OK
  LD HL,0x00FF
CMD_WAIT_RANGE_OK:

CMD_WAIT_OUTER:
  ; 仕様準拠: WAIT 64 で約1秒になるよう遅延係数を調整する。
  ; (PC-G815想定クロック 4MHz 換算で WAIT 1 ≒ 約1/64秒相当)
  LD BC,0x0900
CMD_WAIT_INNER:
  DEC BC
  LD A,B
  OR C
  JR NZ,CMD_WAIT_INNER
  DEC HL
  LD A,H
  OR L
  JR NZ,CMD_WAIT_OUTER
  RET

CMD_WAIT_NO_ARG:
  RET

; ----------------------------------------------------------------------------
; ルーチン: CMD_BEEP_HANDLER
; 役割: BEEP 命令の互換スタブ。現段階では時間消費のみ行う。
; ----------------------------------------------------------------------------
CMD_BEEP_HANDLER:
  CALL LOAD_AFTER_CMD_HL
  CALL SKIP_SPACES
  LD A,(HL)
  OR A
  JR Z,CMD_BEEP_DELAY
  CALL EXPR_SET_PTR_HL
  CALL EVAL_EXPRESSION
  LD C,1
CMD_BEEP_MORE_ARGS:
  CALL EXPR_SKIP_SPACES
  CALL EXPR_GET_PTR_HL
  LD A,(HL)
  OR A
  JR Z,CMD_BEEP_DELAY
  CP ','
  JP NZ,SET_SYNTAX_ERROR
  INC HL
  INC C
  LD A,C
  CP 4
  JP NC,SET_SYNTAX_ERROR
  CALL EXPR_SET_PTR_HL
  CALL EVAL_EXPRESSION
  JR CMD_BEEP_MORE_ARGS
CMD_BEEP_DELAY:
  LD B,0x20
CMD_BEEP_LOOP:
  DJNZ CMD_BEEP_LOOP
  RET

; ----------------------------------------------------------------------------
; ルーチン: OUT_PORT_LITERAL_A
; 役割:
;   - B=ポート番号, A=出力値 を受け取り、
;     対応する即値 OUT 命令へ分岐する。
; ----------------------------------------------------------------------------
OUT_PORT_LITERAL_A:
  LD D,A
  LD A,B
  CP 0x10
  JR Z,OUT_PORT_10
  CP 0x11
  JR Z,OUT_PORT_11
  CP 0x12
  JR Z,OUT_PORT_12
  CP 0x13
  JR Z,OUT_PORT_13
  CP 0x14
  JR Z,OUT_PORT_14
  CP 0x15
  JR Z,OUT_PORT_15
  CP 0x16
  JR Z,OUT_PORT_16
  CP 0x17
  JR Z,OUT_PORT_17
  CP 0x18
  JR Z,OUT_PORT_18
  CP 0x19
  JR Z,OUT_PORT_19
  CP 0x1A
  JR Z,OUT_PORT_1A
  CP 0x1B
  JR Z,OUT_PORT_1B
  CP 0x1C
  JR Z,OUT_PORT_1C
  CP 0x1D
  JR Z,OUT_PORT_1D
  CP 0x1E
  JR Z,OUT_PORT_1E
  CP 0x1F
  JR Z,OUT_PORT_1F
  CP 0x50
  JR Z,OUT_PORT_50
  CP 0x52
  JR Z,OUT_PORT_52
  CP 0x54
  JR Z,OUT_PORT_54
  CP 0x56
  JR Z,OUT_PORT_56
  CP 0x58
  JR Z,OUT_PORT_58
  CP 0x5A
  JR Z,OUT_PORT_5A
  RET

OUT_PORT_10: LD A,D
  OUT (0x10),A
  RET
OUT_PORT_11: LD A,D
  OUT (0x11),A
  RET
OUT_PORT_12: LD A,D
  OUT (0x12),A
  RET
OUT_PORT_13: LD A,D
  OUT (0x13),A
  RET
OUT_PORT_14: LD A,D
  OUT (0x14),A
  RET
OUT_PORT_15: LD A,D
  OUT (0x15),A
  RET
OUT_PORT_16: LD A,D
  OUT (0x16),A
  RET
OUT_PORT_17: LD A,D
  ; BASICサンプル資産互換:
  ; OUT 17,mask をキーマトリクスのストローブ設定としても扱うため、
  ; 0x17(割り込みマスク)と同時に 0x11(キーストローブ下位)へも反映する。
  OUT (0x17),A
  OUT (0x11),A
  RET
OUT_PORT_18: LD A,D
  OUT (0x18),A
  RET
OUT_PORT_19: LD A,D
  OUT (0x19),A
  RET
OUT_PORT_1A: LD A,D
  OUT (0x1A),A
  RET
OUT_PORT_1B: LD A,D
  OUT (0x1B),A
  RET
OUT_PORT_1C: LD A,D
  OUT (0x1C),A
  RET
OUT_PORT_1D: LD A,D
  OUT (0x1D),A
  RET
OUT_PORT_1E: LD A,D
  OUT (0x1E),A
  RET
OUT_PORT_1F: LD A,D
  OUT (0x1F),A
  RET
OUT_PORT_50: LD A,D
  OUT (0x50),A
  RET
OUT_PORT_52: LD A,D
  OUT (0x52),A
  RET
OUT_PORT_54: LD A,D
  OUT (0x54),A
  RET
OUT_PORT_56: LD A,D
  OUT (0x56),A
  RET
OUT_PORT_58: LD A,D
  OUT (0x58),A
  RET
OUT_PORT_5A: LD A,D
  OUT (0x5A),A
  RET
