; ============================================================================
; 解析補助ルーチン
; ----------------------------------------------------------------------------
; 役割:
;   - コマンドポインタ管理、行番号解析、比較演算子解析を提供する。
; ============================================================================

CMP_EQ  EQU 1
CMP_NE  EQU 2
CMP_LT  EQU 3
CMP_GT  EQU 4
CMP_LE  EQU 5
CMP_GE  EQU 6

; ----------------------------------------------------------------------------
; ルーチン: SET_CMDPTR_FROM_HL
; 役割: コマンド解析開始位置を RAM_CMDPTR_* に保存する。
; ----------------------------------------------------------------------------
SET_CMDPTR_FROM_HL:
  LD A,L
  LD (RAM_CMDPTR_LO),A
  LD A,H
  LD (RAM_CMDPTR_HI),A
  RET

; ----------------------------------------------------------------------------
; ルーチン: GET_CMDPTR_HL
; 役割: RAM_CMDPTR_* からコマンド解析位置を取得する。
; ----------------------------------------------------------------------------
GET_CMDPTR_HL:
  LD A,(RAM_CMDPTR_LO)
  LD L,A
  LD A,(RAM_CMDPTR_HI)
  LD H,A
  RET

; ----------------------------------------------------------------------------
; ルーチン: LOAD_AFTER_CMD_HL
; 役割: CLASSIFY_COMMAND が記録した「キーワード直後位置」を取得する。
; ----------------------------------------------------------------------------
LOAD_AFTER_CMD_HL:
  LD A,(RAM_AFTER_CMD_LO)
  LD L,A
  LD A,(RAM_AFTER_CMD_HI)
  LD H,A
  RET

; ----------------------------------------------------------------------------
; ルーチン: PARSE_LINE_NUMBER_FROM_HL
; 役割: HL位置から行番号を読み取る。
; 入力: HL=解析開始位置
; 出力:
;   - Carry=1 成功, DE=行番号, HL=次位置
;   - Carry=0 失敗
; ----------------------------------------------------------------------------
PARSE_LINE_NUMBER_FROM_HL:
  LD DE,0
  LD B,0

PARSE_LINE_NUMBER_LOOP:
  LD A,(HL)
  CALL IS_DIGIT
  JR NC,PARSE_LINE_NUMBER_DONE

  ; DE = DE * 10
  PUSH HL
  LD H,D
  LD L,E
  LD B,H
  LD C,L
  ADD HL,HL
  ADD HL,HL
  ADD HL,BC
  ADD HL,HL
  LD D,H
  LD E,L
  POP HL

  LD A,(HL)
  SUB CHAR_0
  LD C,A
  LD A,E
  ADD A,C
  LD E,A
  JR NC,PARSE_LINE_NUMBER_NO_CARRY
  INC D
PARSE_LINE_NUMBER_NO_CARRY:
  INC HL
  INC B
  JR PARSE_LINE_NUMBER_LOOP

PARSE_LINE_NUMBER_DONE:
  LD A,B
  OR A
  JR Z,PARSE_LINE_NUMBER_FAIL
  SCF
  RET

PARSE_LINE_NUMBER_FAIL:
  AND A
  RET

; ----------------------------------------------------------------------------
; ルーチン: PARSE_COMPARATOR_FROM_EXPRPTR
; 役割: 現在の式ポインタ位置から比較演算子を読み取る。
; 出力:
;   - Carry=1 成功, A=CMP_* 定数, ポインタは演算子末尾へ進む
;   - Carry=0 失敗
; ----------------------------------------------------------------------------
PARSE_COMPARATOR_FROM_EXPRPTR:
  CALL EXPR_SKIP_SPACES
  CALL EXPR_GET_PTR_HL
  LD A,(HL)
  CP '<'
  JR Z,PARSE_COMPARATOR_LT
  CP '>'
  JR Z,PARSE_COMPARATOR_GT
  CP '='
  JR Z,PARSE_COMPARATOR_EQ
  AND A
  RET

PARSE_COMPARATOR_EQ:
  INC HL
  CALL EXPR_SET_PTR_HL
  LD A,CMP_EQ
  SCF
  RET

PARSE_COMPARATOR_LT:
  INC HL
  LD A,(HL)
  CP '>'
  JR Z,PARSE_COMPARATOR_NE
  CP '='
  JR Z,PARSE_COMPARATOR_LE
  CALL EXPR_SET_PTR_HL
  LD A,CMP_LT
  SCF
  RET

PARSE_COMPARATOR_GT:
  INC HL
  LD A,(HL)
  CP '='
  JR Z,PARSE_COMPARATOR_GE
  CALL EXPR_SET_PTR_HL
  LD A,CMP_GT
  SCF
  RET

PARSE_COMPARATOR_NE:
  INC HL
  CALL EXPR_SET_PTR_HL
  LD A,CMP_NE
  SCF
  RET

PARSE_COMPARATOR_LE:
  INC HL
  CALL EXPR_SET_PTR_HL
  LD A,CMP_LE
  SCF
  RET

PARSE_COMPARATOR_GE:
  INC HL
  CALL EXPR_SET_PTR_HL
  LD A,CMP_GE
  SCF
  RET

