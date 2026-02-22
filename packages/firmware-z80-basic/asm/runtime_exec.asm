; ============================================================================
; 実行ループ / 命令ディスパッチ
; ----------------------------------------------------------------------------
; 役割:
;   - 入力行を保存または即時実行へ振り分ける。
;   - RUN 時は ProgramArea から各行を取り出して Z80 上で解釈実行する。
; ============================================================================

TOKEN_THEN:
  DB "THEN",0
TOKEN_TO:
  DB "TO",0
TOKEN_STEP:
  DB "STEP",0

; ----------------------------------------------------------------------------
; ルーチン: BASIC_MAIN_ENTRY
; 役割: インタープリターのエントリーポイント。
; ----------------------------------------------------------------------------
BASIC_MAIN_ENTRY:
  CALL INIT_INTERPRETER

BASIC_MAIN_LOOP:
  CALL READ_LINE
  LD A,(RAM_FLAG_EOT)
  OR A
  RET NZ

  CALL PROCESS_LINE
  JR BASIC_MAIN_LOOP

; ----------------------------------------------------------------------------
; ルーチン: INIT_INTERPRETER
; 役割: 起動時初期化。
; ----------------------------------------------------------------------------
INIT_INTERPRETER:
  CALL CLEAR_PROGRAM
  CALL CLEAR_VARIABLE_TABLE
  XOR A
  LD (RAM_LINE_LEN),A
  LD (RAM_FLAG_EOT),A
  LD (RAM_EXEC_STOP),A
  LD (RAM_JUMP_FLAG),A
  LD (RAM_PTR_OVERRIDE),A
  RET

; ----------------------------------------------------------------------------
; ルーチン: PROCESS_LINE
; 役割: 入力済み行を保存または実行へ振り分ける。
; ----------------------------------------------------------------------------
PROCESS_LINE:
  LD A,(RAM_LINE_LEN)
  OR A
  RET Z

  LD HL,RAM_LINEBUF
  CALL SKIP_SPACES
  CALL SET_CMDPTR_FROM_HL

  LD A,(HL)
  OR A
  RET Z

  CALL IS_DIGIT
  JR C,PROCESS_PROGRAM_LINE

  CALL EXECUTE_IMMEDIATE
  RET

PROCESS_PROGRAM_LINE:
  CALL APPEND_PROGRAM_LINE
  RET

; ----------------------------------------------------------------------------
; ルーチン: EXECUTE_IMMEDIATE
; 役割: 即時入力行を1文として実行する。
; ----------------------------------------------------------------------------
EXECUTE_IMMEDIATE:
  CALL EXECUTE_COMMAND_AT_CMDPTR
  RET

; ----------------------------------------------------------------------------
; ルーチン: RUN_STORED_PROGRAM
; 役割: ProgramArea を先頭から順次実行する。
; ----------------------------------------------------------------------------
RUN_STORED_PROGRAM:
  XOR A
  LD (RAM_EXEC_STOP),A
  LD (RAM_JUMP_FLAG),A
  LD (RAM_PTR_OVERRIDE),A
  LD (RAM_LAST_ERROR),A

  LD A,0x00
  LD (RAM_RUN_PTR_LO),A
  LD A,0x40
  LD (RAM_RUN_PTR_HI),A

RUN_PROGRAM_MAIN_LOOP:
  CALL IS_RUN_PTR_AT_END
  RET Z

  CALL LOAD_CURRENT_RECORD
  CALL EXECUTE_COMMAND_AT_CMDPTR

  LD A,(RAM_EXEC_STOP)
  OR A
  RET NZ

  LD A,(RAM_PTR_OVERRIDE)
  OR A
  JR Z,RUN_PROGRAM_CHECK_JUMP
  XOR A
  LD (RAM_PTR_OVERRIDE),A
  LD A,(RAM_OVERRIDE_LO)
  LD (RAM_RUN_PTR_LO),A
  LD A,(RAM_OVERRIDE_HI)
  LD (RAM_RUN_PTR_HI),A
  JR RUN_PROGRAM_MAIN_LOOP

RUN_PROGRAM_CHECK_JUMP:
  LD A,(RAM_JUMP_FLAG)
  OR A
  JR Z,RUN_PROGRAM_NEXT_LINEAR
  XOR A
  LD (RAM_JUMP_FLAG),A
  LD A,(RAM_JUMP_LINE_LO)
  LD E,A
  LD A,(RAM_JUMP_LINE_HI)
  LD D,A
  CALL FIND_LINE_BY_NUMBER
  JR C,RUN_PROGRAM_MAIN_LOOP
  LD A,2
  LD (RAM_LAST_ERROR),A
  RET

RUN_PROGRAM_NEXT_LINEAR:
  LD A,(RAM_NEXT_PTR_LO)
  LD (RAM_RUN_PTR_LO),A
  LD A,(RAM_NEXT_PTR_HI)
  LD (RAM_RUN_PTR_HI),A
  JR RUN_PROGRAM_MAIN_LOOP

; ----------------------------------------------------------------------------
; ルーチン: IS_RUN_PTR_AT_END
; 役割: 現在実行ポインタが末尾に到達したか判定する。
; 出力: Z=1 到達済み, Z=0 継続
; ----------------------------------------------------------------------------
IS_RUN_PTR_AT_END:
  LD A,(RAM_RUN_PTR_LO)
  LD E,A
  LD A,(RAM_RUN_PTR_HI)
  LD D,A
  LD A,(RAM_PROG_PTR_LO)
  CP E
  JR NZ,IS_RUN_PTR_AT_END_NO
  LD A,(RAM_PROG_PTR_HI)
  CP D
  JR NZ,IS_RUN_PTR_AT_END_NO
  XOR A
  RET
IS_RUN_PTR_AT_END_NO:
  LD A,1
  OR A
  RET

; ----------------------------------------------------------------------------
; ルーチン: LOAD_CURRENT_RECORD
; 役割:
;   - RAM_RUN_PTR が指すレコードを RAM_LINEBUF へコピーする。
;   - RAM_NEXT_PTR に次レコード先頭を保存する。
;   - RAM_CMDPTR を「行番号の後ろ(文頭)」へ設定する。
; ----------------------------------------------------------------------------
LOAD_CURRENT_RECORD:
  LD A,(RAM_RUN_PTR_LO)
  LD E,A
  LD A,(RAM_RUN_PTR_HI)
  LD D,A

  LD A,(DE)
  LD B,A
  INC DE

  LD HL,RAM_LINEBUF
LOAD_CURRENT_RECORD_COPY:
  LD A,B
  OR A
  JR Z,LOAD_CURRENT_RECORD_COPY_DONE
  LD A,(DE)
  LD (HL),A
  INC DE
  INC HL
  DEC B
  JR LOAD_CURRENT_RECORD_COPY

LOAD_CURRENT_RECORD_COPY_DONE:
  XOR A
  LD (HL),A

  LD A,E
  LD (RAM_NEXT_PTR_LO),A
  LD A,D
  LD (RAM_NEXT_PTR_HI),A

  LD HL,RAM_LINEBUF
  CALL SKIP_SPACES
  CALL PARSE_LINE_NUMBER_FROM_HL
  JR NC,LOAD_CURRENT_RECORD_NO_LINE
  CALL SKIP_SPACES
LOAD_CURRENT_RECORD_NO_LINE:
  CALL SET_CMDPTR_FROM_HL
  RET

; ----------------------------------------------------------------------------
; ルーチン: FIND_LINE_BY_NUMBER
; 役割: ProgramArea から行番号 DE に一致するレコードを探索する。
; 出力: Carry=1 発見, RAM_RUN_PTR を更新
;       Carry=0 未発見
; ----------------------------------------------------------------------------
FIND_LINE_BY_NUMBER:
  LD A,E
  LD (RAM_TMP_VAL_LO),A
  LD A,D
  LD (RAM_TMP_VAL_HI),A

  LD BC,RAM_PROG_START
FIND_LINE_LOOP:
  LD A,(RAM_PROG_PTR_LO)
  CP C
  JR NZ,FIND_LINE_HAS_RECORD
  LD A,(RAM_PROG_PTR_HI)
  CP B
  JR Z,FIND_LINE_NOT_FOUND

FIND_LINE_HAS_RECORD:
  LD A,(BC)
  LD E,A
  INC BC
  PUSH BC
  PUSH DE
  LD H,B
  LD L,C
  CALL PARSE_LINE_NUMBER_FROM_HL
  JR NC,FIND_LINE_SKIP_COMPARE

  LD A,(RAM_TMP_VAL_LO)
  CP E
  JR NZ,FIND_LINE_SKIP_COMPARE
  LD A,(RAM_TMP_VAL_HI)
  CP D
  JR NZ,FIND_LINE_SKIP_COMPARE

  POP DE
  POP BC
  DEC BC
  LD A,C
  LD (RAM_RUN_PTR_LO),A
  LD A,B
  LD (RAM_RUN_PTR_HI),A
  SCF
  RET

FIND_LINE_SKIP_COMPARE:
  POP DE
  POP BC
  DEC BC

  ; BC = BC + 1 + length
  LD HL,1
  ADD HL,BC
  LD A,E
  LD E,A
  LD D,0
  ADD HL,DE
  LD B,H
  LD C,L
  JR FIND_LINE_LOOP

FIND_LINE_NOT_FOUND:
  AND A
  RET

; ----------------------------------------------------------------------------
; ルーチン: EXECUTE_COMMAND_AT_CMDPTR
; 役割: RAM_CMDPTR の1文を分類し、対応ハンドラを呼ぶ。
; ----------------------------------------------------------------------------
EXECUTE_COMMAND_AT_CMDPTR:
  CALL GET_CMDPTR_HL
  CALL SKIP_SPACES
  CALL SET_CMDPTR_FROM_HL
  LD A,(HL)
  OR A
  RET Z

  CALL CLASSIFY_COMMAND
  OR A
  JR NZ,EXECUTE_DISPATCH

  ; キーワードで始まらない場合は暗黙 LET を試みる。
  CALL TRY_IMPLICIT_ASSIGNMENT
  RET

EXECUTE_DISPATCH:
  CP CMD_NEW
  JP Z,EXEC_CMD_NEW
  CP CMD_LIST
  JP Z,EXEC_CMD_LIST
  CP CMD_RUN
  JP Z,EXEC_CMD_RUN
  CP CMD_PRINT
  JP Z,EXEC_CMD_PRINT
  CP CMD_LET
  JP Z,EXEC_CMD_LET
  CP CMD_INPUT
  JP Z,EXEC_CMD_INPUT
  CP CMD_GOTO
  JP Z,EXEC_CMD_GOTO
  CP CMD_GOSUB
  JP Z,EXEC_CMD_GOSUB
  CP CMD_RETURN
  JP Z,EXEC_CMD_RETURN
  CP CMD_END
  JP Z,EXEC_CMD_END
  CP CMD_STOP
  JP Z,EXEC_CMD_STOP
  CP CMD_CONT
  JP Z,EXEC_CMD_CONT
  CP CMD_IF
  JP Z,EXEC_CMD_IF
  CP CMD_CLS
  JP Z,CMD_CLS_HANDLER
  CP CMD_REM
  RET Z
  CP CMD_FOR
  JP Z,EXEC_CMD_FOR
  CP CMD_NEXT
  JP Z,EXEC_CMD_NEXT
  CP CMD_DIM
  RET Z
  CP CMD_DATA
  RET Z
  CP CMD_READ
  RET Z
  CP CMD_RESTORE
  RET Z
  CP CMD_POKE
  JP Z,CMD_POKE_HANDLER
  CP CMD_OUT
  JP Z,CMD_OUT_HANDLER
  CP CMD_BEEP
  JP Z,CMD_BEEP_HANDLER
  CP CMD_WAIT
  JP Z,CMD_WAIT_HANDLER
  CP CMD_LOCATE
  JP Z,CMD_LOCATE_HANDLER
  CP CMD_AUTO
  JP Z,CMD_AUTO_HANDLER
  CP CMD_BLOAD
  JP Z,CMD_BLOAD_HANDLER
  CP CMD_BSAVE
  JP Z,CMD_BSAVE_HANDLER
  CP CMD_FILES
  JP Z,CMD_FILES_HANDLER
  CP CMD_HDCOPY
  JP Z,CMD_HDCOPY_HANDLER
  CP CMD_PAINT
  JP Z,CMD_PAINT_HANDLER
  CP CMD_CIRCLE
  JP Z,CMD_CIRCLE_HANDLER
  CP CMD_PASS
  RET Z
  CP CMD_PIOSET
  RET Z
  CP CMD_PIOPUT
  RET Z
  CP CMD_SPOUT
  RET Z
  CP CMD_SPINP
  RET Z
  CP CMD_REPEAT
  RET Z
  CP CMD_UNTIL
  RET Z
  CP CMD_WHILE
  RET Z
  CP CMD_WEND
  RET Z
  CP CMD_LNINPUT
  JP Z,EXEC_CMD_LNINPUT
  CP CMD_CLEAR
  JP Z,EXEC_CMD_CLEAR
  CP CMD_DELETE
  RET Z
  CP CMD_ERASE
  RET Z
  CP CMD_ON
  RET Z
  CP CMD_RANDOMIZE
  RET Z
  CP CMD_RENUM
  RET Z
  CP CMD_USING
  RET Z
  CP CMD_MON
  RET Z
  CP CMD_OPEN
  JP Z,CMD_OPEN_HANDLER
  CP CMD_CLOSE
  JP Z,CMD_CLOSE_HANDLER
  CP CMD_LOAD
  JP Z,CMD_LOAD_HANDLER
  CP CMD_SAVE
  JP Z,CMD_SAVE_HANDLER
  CP CMD_LFILES
  JP Z,CMD_LFILES_HANDLER
  CP CMD_LCOPY
  JP Z,CMD_LCOPY_HANDLER
  CP CMD_KILL
  JP Z,CMD_KILL_HANDLER
  CP CMD_CALL
  RET Z
  CP CMD_GCURSOR
  JP Z,CMD_GCURSOR_HANDLER
  CP CMD_GPRINT
  JP Z,CMD_GPRINT_HANDLER
  CP CMD_LINE
  JP Z,CMD_LINE_HANDLER
  CP CMD_PSET
  JP Z,CMD_PSET_HANDLER
  CP CMD_PRESET
  JP Z,CMD_PRESET_HANDLER
  CP CMD_ELSE
  RET Z
  CP CMD_EMPTY
  RET Z
  RET

; ----------------------------------------------------------------------------
; ルーチン: TRY_IMPLICIT_ASSIGNMENT
; 役割: キーワード不一致時に "A=1" 形式の代入を試行する。
; ----------------------------------------------------------------------------
TRY_IMPLICIT_ASSIGNMENT:
  CALL GET_CMDPTR_HL
  CALL EXPR_SET_PTR_HL
  JP EXEC_ASSIGNMENT_FROM_EXPRPTR

; ----------------------------------------------------------------------------
; 命令: NEW
; ----------------------------------------------------------------------------
EXEC_CMD_NEW:
  CALL CLEAR_PROGRAM
  CALL CLEAR_VARIABLE_TABLE
  RET

; ----------------------------------------------------------------------------
; 命令: LIST
; ----------------------------------------------------------------------------
EXEC_CMD_LIST:
  CALL LIST_PROGRAM
  RET

; ----------------------------------------------------------------------------
; 命令: RUN
; ----------------------------------------------------------------------------
EXEC_CMD_RUN:
  CALL RUN_STORED_PROGRAM
  RET

; ----------------------------------------------------------------------------
; 命令: PRINT
; ----------------------------------------------------------------------------
EXEC_CMD_PRINT:
  CALL LOAD_AFTER_CMD_HL
  CALL EXPR_SET_PTR_HL

  CALL EXPR_SKIP_SPACES
  CALL EXPR_GET_PTR_HL
  LD A,(HL)
  OR A
  JP Z,PRINT_CRLF

PRINT_ITEM_LOOP:
  CALL EXPR_SKIP_SPACES
  CALL EXPR_GET_PTR_HL
  LD A,(HL)
  CP '"'
  JR Z,PRINT_QUOTED

  CALL EVAL_EXPRESSION
  CALL PRINT_NUMBER_HL
  JR PRINT_DELIM

PRINT_QUOTED:
  INC HL
PRINT_QUOTED_LOOP:
  LD A,(HL)
  OR A
  JR Z,PRINT_DELIM_END
  CP '"'
  JR Z,PRINT_QUOTED_DONE
  CALL OUT_LCD_CHAR
  INC HL
  JR PRINT_QUOTED_LOOP

PRINT_QUOTED_DONE:
  INC HL
PRINT_DELIM_END:
  CALL EXPR_SET_PTR_HL

PRINT_DELIM:
  CALL EXPR_SKIP_SPACES
  CALL EXPR_GET_PTR_HL
  LD A,(HL)
  OR A
  JP Z,PRINT_CRLF
  CP ';'
  JR Z,PRINT_DELIM_SEMI
  CP ','
  JR Z,PRINT_DELIM_COMMA
  JP PRINT_CRLF

PRINT_DELIM_SEMI:
  INC HL
  CALL EXPR_SET_PTR_HL
  JR PRINT_ITEM_LOOP

PRINT_DELIM_COMMA:
  CALL PRINT_SPACE
  INC HL
  CALL EXPR_SET_PTR_HL
  JR PRINT_ITEM_LOOP

; ----------------------------------------------------------------------------
; 命令: LET / 暗黙 LET
; ----------------------------------------------------------------------------
EXEC_CMD_LET:
  CALL LOAD_AFTER_CMD_HL
  CALL EXPR_SET_PTR_HL
  JP EXEC_ASSIGNMENT_FROM_EXPRPTR

EXEC_ASSIGNMENT_FROM_EXPRPTR:
  CALL PARSE_VARIABLE_KEY_FROM_EXPR
  RET NC
  CALL EXPR_SKIP_SPACES
  CALL EXPR_GET_PTR_HL
  LD A,(HL)
  CP '='
  RET NZ
  INC HL
  CALL EXPR_SET_PTR_HL
  CALL EVAL_EXPRESSION
  LD D,H
  LD E,L
  CALL SET_VARIABLE_FROM_DE
  RET

; ----------------------------------------------------------------------------
; 命令: INPUT / LNINPUT
; 役割: 簡易実装として対象変数へ 0 を格納する。
; ----------------------------------------------------------------------------
EXEC_CMD_INPUT:
  CALL LOAD_AFTER_CMD_HL
  CALL EXPR_SET_PTR_HL
  CALL PARSE_VARIABLE_KEY_FROM_EXPR
  RET NC
  LD DE,0
  CALL SET_VARIABLE_FROM_DE
  RET

EXEC_CMD_LNINPUT:
  JP EXEC_CMD_INPUT

; ----------------------------------------------------------------------------
; 命令: GOTO
; ----------------------------------------------------------------------------
EXEC_CMD_GOTO:
  CALL LOAD_AFTER_CMD_HL
  CALL EXPR_SET_PTR_HL
  CALL EVAL_EXPRESSION
  LD A,L
  LD (RAM_JUMP_LINE_LO),A
  LD A,H
  LD (RAM_JUMP_LINE_HI),A
  LD A,1
  LD (RAM_JUMP_FLAG),A
  RET

; ----------------------------------------------------------------------------
; 命令: GOSUB
; ----------------------------------------------------------------------------
EXEC_CMD_GOSUB:
  LD A,(RAM_GOSUB_SP)
  CP GOSUB_MAX_DEPTH
  RET NC

  ; 返り先(次レコード)をスタックへ積む
  LD E,A
  ADD A,A
  LD E,A
  LD D,0
  LD HL,RAM_GOSUB_STACK
  ADD HL,DE
  LD A,(RAM_NEXT_PTR_LO)
  LD (HL),A
  INC HL
  LD A,(RAM_NEXT_PTR_HI)
  LD (HL),A

  LD A,(RAM_GOSUB_SP)
  INC A
  LD (RAM_GOSUB_SP),A

  JP EXEC_CMD_GOTO

; ----------------------------------------------------------------------------
; 命令: RETURN
; ----------------------------------------------------------------------------
EXEC_CMD_RETURN:
  LD A,(RAM_GOSUB_SP)
  OR A
  RET Z
  DEC A
  LD (RAM_GOSUB_SP),A

  LD E,A
  ADD A,A
  LD E,A
  LD D,0
  LD HL,RAM_GOSUB_STACK
  ADD HL,DE
  LD A,(HL)
  LD (RAM_OVERRIDE_LO),A
  INC HL
  LD A,(HL)
  LD (RAM_OVERRIDE_HI),A
  LD A,1
  LD (RAM_PTR_OVERRIDE),A
  RET

; ----------------------------------------------------------------------------
; 命令: END / STOP
; ----------------------------------------------------------------------------
EXEC_CMD_END:
  LD A,1
  LD (RAM_EXEC_STOP),A
  RET

EXEC_CMD_STOP:
  JP EXEC_CMD_END

EXEC_CMD_CONT:
  RET

; ----------------------------------------------------------------------------
; 命令: IF
; 形式: IF <expr><cmp><expr> THEN <line|statement>
; ----------------------------------------------------------------------------
EXEC_CMD_IF:
  CALL LOAD_AFTER_CMD_HL
  CALL EXPR_SET_PTR_HL
  CALL EVAL_EXPRESSION
  PUSH HL

  CALL PARSE_COMPARATOR_FROM_EXPRPTR
  JR C,EXEC_CMD_IF_HAVE_CMP
  POP HL
  RET

EXEC_CMD_IF_HAVE_CMP:
  LD (RAM_CMP_OP),A
  CALL EVAL_EXPRESSION
  POP DE
  LD B,D
  LD C,E
  LD D,H
  LD E,L
  CALL CMP_BC_DE_UNSIGNED
  LD (RAM_TMP_VAL_LO),A

  LD A,(RAM_CMP_OP)
  CP CMP_EQ
  JR Z,IF_CHECK_EQ
  CP CMP_NE
  JR Z,IF_CHECK_NE
  CP CMP_LT
  JR Z,IF_CHECK_LT
  CP CMP_GT
  JR Z,IF_CHECK_GT
  CP CMP_LE
  JR Z,IF_CHECK_LE
  CP CMP_GE
  JR Z,IF_CHECK_GE
  RET

IF_CHECK_EQ:
  LD A,(RAM_TMP_VAL_LO)
  OR A
  JR Z,IF_THEN_EXEC
  RET
IF_CHECK_NE:
  LD A,(RAM_TMP_VAL_LO)
  OR A
  JR NZ,IF_THEN_EXEC
  RET
IF_CHECK_LT:
  LD A,(RAM_TMP_VAL_LO)
  CP 1
  JR Z,IF_THEN_EXEC
  RET
IF_CHECK_GT:
  LD A,(RAM_TMP_VAL_LO)
  CP 2
  JR Z,IF_THEN_EXEC
  RET
IF_CHECK_LE:
  LD A,(RAM_TMP_VAL_LO)
  CP 2
  JR NZ,IF_THEN_EXEC
  RET
IF_CHECK_GE:
  LD A,(RAM_TMP_VAL_LO)
  CP 1
  JR NZ,IF_THEN_EXEC
  RET

; ----------------------------------------------------------------------------
; ルーチン: CMP_BC_DE_UNSIGNED
; 役割: BC(lhs) と DE(rhs) を符号なし比較する。
; 出力: A=0(lhs==rhs), A=1(lhs<rhs), A=2(lhs>rhs)
; ----------------------------------------------------------------------------
CMP_BC_DE_UNSIGNED:
  LD A,B
  CP D
  JR C,CMP_BC_DE_LT
  JR NZ,CMP_BC_DE_GT
  LD A,C
  CP E
  JR C,CMP_BC_DE_LT
  JR NZ,CMP_BC_DE_GT
  XOR A
  RET
CMP_BC_DE_LT:
  LD A,1
  RET
CMP_BC_DE_GT:
  LD A,2
  RET

IF_THEN_EXEC:
  CALL EXPR_SKIP_SPACES
  CALL EXPR_GET_PTR_HL
  LD DE,TOKEN_THEN
  CALL MATCH_TOKEN
  RET NC
  CALL EXPR_SET_PTR_HL
  CALL EXPR_SKIP_SPACES
  CALL EXPR_GET_PTR_HL
  LD A,(HL)
  CALL IS_DIGIT
  JR NC,IF_THEN_STATEMENT

  CALL PARSE_LINE_NUMBER_FROM_HL
  RET NC
  LD A,E
  LD (RAM_JUMP_LINE_LO),A
  LD A,D
  LD (RAM_JUMP_LINE_HI),A
  LD A,1
  LD (RAM_JUMP_FLAG),A
  RET

IF_THEN_STATEMENT:
  CALL SET_CMDPTR_FROM_HL
  CALL EXECUTE_COMMAND_AT_CMDPTR
  RET

; ----------------------------------------------------------------------------
; 命令: FOR
; 形式: FOR <var>=<expr> TO <expr> [STEP <expr>]
; ----------------------------------------------------------------------------
EXEC_CMD_FOR:
  LD A,(RAM_FOR_SP)
  CP FOR_MAX_DEPTH
  RET NC

  CALL LOAD_AFTER_CMD_HL
  CALL EXPR_SET_PTR_HL
  CALL PARSE_VARIABLE_KEY_FROM_EXPR
  RET NC

  CALL EXPR_SKIP_SPACES
  CALL EXPR_GET_PTR_HL
  LD A,(HL)
  CP '='
  RET NZ
  INC HL
  CALL EXPR_SET_PTR_HL
  CALL EVAL_EXPRESSION
  LD D,H
  LD E,L
  CALL SET_VARIABLE_FROM_DE

  CALL EXPR_SKIP_SPACES
  CALL EXPR_GET_PTR_HL
  LD DE,TOKEN_TO
  CALL MATCH_TOKEN
  RET NC
  CALL EXPR_SET_PTR_HL
  CALL EVAL_EXPRESSION
  LD A,L
  LD (RAM_TMP_VAL_LO),A
  LD A,H
  LD (RAM_TMP_VAL_HI),A

  LD DE,1
  CALL EXPR_SKIP_SPACES
  CALL EXPR_GET_PTR_HL
  LD A,(HL)
  OR A
  JR Z,FOR_HAVE_STEP
  LD DE,TOKEN_STEP
  CALL MATCH_TOKEN
  JR NC,FOR_HAVE_STEP
  CALL EXPR_SET_PTR_HL
  CALL EVAL_EXPRESSION
  LD D,H
  LD E,L

FOR_HAVE_STEP:
  ; フレーム先頭を HL に求める
  LD A,(RAM_FOR_SP)
  LD B,A
  LD HL,RAM_FOR_STACK
FOR_FRAME_ADDR_LOOP:
  LD A,B
  OR A
  JR Z,FOR_FRAME_ADDR_DONE
  LD DE,FOR_FRAME_SIZE
  ADD HL,DE
  DEC B
  JR FOR_FRAME_ADDR_LOOP
FOR_FRAME_ADDR_DONE:
  LD A,(RAM_TMP_KEY1)
  LD (HL),A
  INC HL
  LD A,(RAM_TMP_KEY2)
  LD (HL),A
  INC HL
  LD A,(RAM_TMP_KEY3)
  LD (HL),A
  INC HL
  LD A,(RAM_TMP_VAL_LO)
  LD (HL),A
  INC HL
  LD A,(RAM_TMP_VAL_HI)
  LD (HL),A
  INC HL
  LD A,E
  LD (HL),A
  INC HL
  LD A,D
  LD (HL),A
  INC HL
  LD A,(RAM_NEXT_PTR_LO)
  LD (HL),A
  INC HL
  LD A,(RAM_NEXT_PTR_HI)
  LD (HL),A

  LD A,(RAM_FOR_SP)
  INC A
  LD (RAM_FOR_SP),A
  RET

; ----------------------------------------------------------------------------
; 命令: NEXT
; 役割: 最上位 FOR フレームを更新して継続判定する。
; ----------------------------------------------------------------------------
EXEC_CMD_NEXT:
  LD A,(RAM_FOR_SP)
  OR A
  RET Z
  DEC A
  LD B,A

  LD HL,RAM_FOR_STACK
NEXT_FRAME_ADDR_LOOP:
  LD A,B
  OR A
  JR Z,NEXT_FRAME_ADDR_DONE
  LD DE,FOR_FRAME_SIZE
  ADD HL,DE
  DEC B
  JR NEXT_FRAME_ADDR_LOOP
NEXT_FRAME_ADDR_DONE:
  ; key を RAM_TMP_KEY* へ
  LD A,(HL)
  LD (RAM_TMP_KEY1),A
  INC HL
  LD A,(HL)
  LD (RAM_TMP_KEY2),A
  INC HL
  LD A,(HL)
  LD (RAM_TMP_KEY3),A
  INC HL
  LD C,(HL)   ; end lo
  INC HL
  LD B,(HL)   ; end hi
  INC HL
  LD E,(HL)   ; step lo
  INC HL
  LD D,(HL)   ; step hi
  INC HL
  LD A,(HL)   ; loop ptr lo
  LD (RAM_OVERRIDE_LO),A
  INC HL
  LD A,(HL)   ; loop ptr hi
  LD (RAM_OVERRIDE_HI),A

  CALL GET_VARIABLE_HL
  ADD HL,DE
  PUSH BC
  LD D,H
  LD E,L
  CALL SET_VARIABLE_FROM_DE
  POP BC

  ; HL=var, BC=end
  CALL GET_VARIABLE_HL
  LD D,B
  LD E,C

  ; step の符号で比較方向を切替
  LD A,(RAM_FOR_SP)
  DEC A
  LD B,A
  LD HL,RAM_FOR_STACK
NEXT_STEP_ADDR_LOOP:
  LD A,B
  OR A
  JR Z,NEXT_STEP_ADDR_DONE
  LD DE,FOR_FRAME_SIZE
  ADD HL,DE
  DEC B
  JR NEXT_STEP_ADDR_LOOP
NEXT_STEP_ADDR_DONE:
  INC HL
  INC HL
  INC HL
  INC HL
  INC HL
  LD A,(HL)        ; step lo
  INC HL
  LD H,(HL)        ; step hi
  LD L,A
  LD A,H
  AND 0x80
  JR NZ,NEXT_NEG_STEP

  ; 正方向: var <= end なら継続
  AND A
  SBC HL,HL
  CALL GET_VARIABLE_HL
  AND A
  SBC HL,DE
  JR C,NEXT_CONTINUE
  JR Z,NEXT_CONTINUE
  JR NEXT_POP_FRAME

NEXT_NEG_STEP:
  ; 負方向: var >= end なら継続
  CALL GET_VARIABLE_HL
  AND A
  SBC HL,DE
  JR NC,NEXT_CONTINUE
  JR NEXT_POP_FRAME

NEXT_CONTINUE:
  LD A,1
  LD (RAM_PTR_OVERRIDE),A
  RET

NEXT_POP_FRAME:
  LD A,(RAM_FOR_SP)
  DEC A
  LD (RAM_FOR_SP),A
  RET

; ----------------------------------------------------------------------------
; 命令: CLEAR
; ----------------------------------------------------------------------------
EXEC_CMD_CLEAR:
  CALL CLEAR_VARIABLE_TABLE
  RET
