; ============================================================================
; 式評価VM / 変数管理
; ----------------------------------------------------------------------------
; 役割:
;   - 数値式(+, -, 括弧, 単項-, 変数, INP(), PEEK())を評価する。
;   - 可変長ではなく固定スロット式の変数表(最大24個)を管理する。
;   - 変数名は先頭3文字までをキーとして扱う。
; ============================================================================

; ----------------------------------------------------------------------------
; ルーチン: CLEAR_VARIABLE_TABLE
; 役割: 変数表と実行時スタック管理値を初期化する。
; ----------------------------------------------------------------------------
CLEAR_VARIABLE_TABLE:
  LD HL,RAM_VAR_TABLE
  LD BC,VAR_ENTRY_SIZE * VAR_MAX_ENTRIES
  XOR A
CLEAR_VARIABLE_TABLE_LOOP:
  LD (HL),A
  INC HL
  DEC BC
  LD A,B
  OR C
  JR Z,CLEAR_VARIABLE_TABLE_DONE
  XOR A
  JR CLEAR_VARIABLE_TABLE_LOOP

CLEAR_VARIABLE_TABLE_DONE:
  XOR A
  LD (RAM_GOSUB_SP),A
  LD (RAM_FOR_SP),A
  RET

; ----------------------------------------------------------------------------
; ルーチン: EXPR_SET_PTR_HL
; 役割: 式パーサが参照する現在位置ポインタを設定する。
; ----------------------------------------------------------------------------
EXPR_SET_PTR_HL:
  LD A,L
  LD (RAM_EXPR_PTR_LO),A
  LD A,H
  LD (RAM_EXPR_PTR_HI),A
  RET

; ----------------------------------------------------------------------------
; ルーチン: EXPR_GET_PTR_HL
; 役割: 式パーサの現在位置ポインタを HL へ取得する。
; ----------------------------------------------------------------------------
EXPR_GET_PTR_HL:
  LD A,(RAM_EXPR_PTR_LO)
  LD L,A
  LD A,(RAM_EXPR_PTR_HI)
  LD H,A
  RET

; ----------------------------------------------------------------------------
; ルーチン: EXPR_SKIP_SPACES
; 役割: 式パーサ位置の空白を読み飛ばす。
; ----------------------------------------------------------------------------
EXPR_SKIP_SPACES:
  CALL EXPR_GET_PTR_HL
EXPR_SKIP_SPACES_LOOP:
  LD A,(HL)
  CP CHAR_SPACE
  JR NZ,EXPR_SKIP_SPACES_DONE
  INC HL
  JR EXPR_SKIP_SPACES_LOOP
EXPR_SKIP_SPACES_DONE:
  CALL EXPR_SET_PTR_HL
  RET

; ----------------------------------------------------------------------------
; ルーチン: EVAL_EXPRESSION
; 役割: 現在位置から加減算式を評価する。
; 入力: RAM_EXPR_PTR_LO/HI
; 出力: HL=評価結果
; ----------------------------------------------------------------------------
EVAL_EXPRESSION:
  CALL PARSE_FACTOR

EVAL_EXPRESSION_LOOP:
  PUSH HL
  CALL EXPR_SKIP_SPACES
  CALL EXPR_GET_PTR_HL
  LD A,(HL)
  CP '+'
  JR Z,EVAL_EXPRESSION_PLUS
  CP '-'
  JR Z,EVAL_EXPRESSION_MINUS
  POP HL
  RET

EVAL_EXPRESSION_PLUS:
  INC HL
  CALL EXPR_SET_PTR_HL
  CALL PARSE_FACTOR
  POP DE
  ADD HL,DE
  JR EVAL_EXPRESSION_LOOP

EVAL_EXPRESSION_MINUS:
  INC HL
  CALL EXPR_SET_PTR_HL
  CALL PARSE_FACTOR
  POP DE
  EX DE,HL
  AND A
  SBC HL,DE
  JR EVAL_EXPRESSION_LOOP

; ----------------------------------------------------------------------------
; ルーチン: PARSE_FACTOR
; 役割: 単項要素(数値/変数/関数/括弧)を評価する。
; 出力: HL=評価結果
; ----------------------------------------------------------------------------
PARSE_FACTOR:
  CALL EXPR_SKIP_SPACES
  CALL EXPR_GET_PTR_HL
  LD A,(HL)
  CP '('
  JP Z,PARSE_FACTOR_PAREN
  CP '-'
  JP Z,PARSE_FACTOR_NEG
  CALL IS_DIGIT
  JP C,PARSE_FACTOR_NUMBER

  ; 関数 INP( ... ) 判定
  LD A,(HL)
  CALL TO_UPPER
  CP 'I'
  JP NZ,PARSE_FACTOR_PEEK_CHECK
  INC HL
  LD A,(HL)
  CALL TO_UPPER
  CP 'N'
  JP NZ,PARSE_FACTOR_VARIABLE
  INC HL
  LD A,(HL)
  CALL TO_UPPER
  CP 'P'
  JP NZ,PARSE_FACTOR_VARIABLE
  INC HL
  LD A,(HL)
  CP '('
  JP NZ,PARSE_FACTOR_VARIABLE
  INC HL
  CALL EXPR_SET_PTR_HL
  CALL EVAL_EXPRESSION
  ; EVAL結果(HL=ポート番号)は、閉じ括弧処理中に
  ; EXPR_GET_PTR_HL で上書きされるため一旦退避する。
  PUSH HL
  CALL EXPR_SKIP_SPACES
  CALL EXPR_GET_PTR_HL
  LD A,(HL)
  CP ')'
  JR NZ,PARSE_FACTOR_INP_DONE
  INC HL
  CALL EXPR_SET_PTR_HL
PARSE_FACTOR_INP_DONE:
  POP HL
  CALL READ_PORT_LITERAL_A
  LD L,A
  LD H,0
  RET

PARSE_FACTOR_PEEK_CHECK:
  LD A,(HL)
  CALL TO_UPPER
  CP 'P'
  JP NZ,PARSE_FACTOR_VARIABLE
  INC HL
  LD A,(HL)
  CALL TO_UPPER
  CP 'E'
  JP NZ,PARSE_FACTOR_VARIABLE
  INC HL
  LD A,(HL)
  CALL TO_UPPER
  CP 'E'
  JP NZ,PARSE_FACTOR_VARIABLE
  INC HL
  LD A,(HL)
  CALL TO_UPPER
  CP 'K'
  JP NZ,PARSE_FACTOR_VARIABLE
  INC HL
  LD A,(HL)
  CP '('
  JP NZ,PARSE_FACTOR_VARIABLE
  INC HL
  CALL EXPR_SET_PTR_HL
  CALL EVAL_EXPRESSION
  ; EVAL結果(HL=PEEK先アドレス)を括弧処理前に退避する。
  PUSH HL
  CALL EXPR_SKIP_SPACES
  CALL EXPR_GET_PTR_HL
  LD A,(HL)
  CP ')'
  JR NZ,PARSE_FACTOR_PEEK_DONE
  INC HL
  CALL EXPR_SET_PTR_HL
PARSE_FACTOR_PEEK_DONE:
  POP HL
  LD A,(HL)
  LD L,A
  LD H,0
  RET

PARSE_FACTOR_PAREN:
  INC HL
  CALL EXPR_SET_PTR_HL
  CALL EVAL_EXPRESSION
  CALL EXPR_SKIP_SPACES
  CALL EXPR_GET_PTR_HL
  LD A,(HL)
  CP ')'
  JR NZ,PARSE_FACTOR_PAREN_DONE
  INC HL
  CALL EXPR_SET_PTR_HL
PARSE_FACTOR_PAREN_DONE:
  RET

PARSE_FACTOR_NEG:
  INC HL
  CALL EXPR_SET_PTR_HL
  CALL PARSE_FACTOR
  LD A,H
  CPL
  LD H,A
  LD A,L
  CPL
  LD L,A
  INC HL
  RET

PARSE_FACTOR_NUMBER:
  CALL PARSE_NUMBER_HL
  RET

PARSE_FACTOR_VARIABLE:
  CALL PARSE_VARIABLE_KEY_FROM_EXPR
  JR C,PARSE_FACTOR_VARIABLE_OK
  LD HL,0
  RET
PARSE_FACTOR_VARIABLE_OK:
  CALL GET_VARIABLE_HL
  RET

; ----------------------------------------------------------------------------
; ルーチン: PARSE_NUMBER_HL
; 役割: 現在位置から10進整数を読み取る。
; 出力: HL=値
; ----------------------------------------------------------------------------
PARSE_NUMBER_HL:
  CALL EXPR_GET_PTR_HL
  LD DE,0

PARSE_NUMBER_LOOP:
  LD A,(HL)
  CALL IS_DIGIT
  JR NC,PARSE_NUMBER_DONE

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
  JR NC,PARSE_NUMBER_NO_CARRY
  INC D
PARSE_NUMBER_NO_CARRY:
  INC HL
  JR PARSE_NUMBER_LOOP

PARSE_NUMBER_DONE:
  CALL EXPR_SET_PTR_HL
  LD H,D
  LD L,E
  RET

; ----------------------------------------------------------------------------
; ルーチン: PARSE_VARIABLE_KEY_FROM_EXPR
; 役割: 現在位置から変数名キー(先頭3文字)を抽出する。
; 出力: Carry=1 成功, Carry=0 失敗
; ----------------------------------------------------------------------------
PARSE_VARIABLE_KEY_FROM_EXPR:
  CALL EXPR_SKIP_SPACES
  CALL EXPR_GET_PTR_HL
  CALL PARSE_VARIABLE_KEY_FROM_HL
  RET

; ----------------------------------------------------------------------------
; ルーチン: PARSE_VARIABLE_KEY_FROM_HL
; 役割: HL位置から変数名キー(先頭3文字)を抽出し、HLを次位置へ進める。
; 入力: HL=解析開始位置
; 出力: Carry=1 成功, Carry=0 失敗
;       RAM_TMP_KEY1..3 にキー保存
; ----------------------------------------------------------------------------
PARSE_VARIABLE_KEY_FROM_HL:
  XOR A
  LD (RAM_TMP_KEY1),A
  LD (RAM_TMP_KEY2),A
  LD (RAM_TMP_KEY3),A

  LD A,(HL)
  CALL TO_UPPER
  CALL IS_ALPHA
  JR NC,PARSE_VARIABLE_KEY_FAIL

  LD B,0
PARSE_VARIABLE_KEY_LOOP:
  LD A,(HL)
  CALL TO_UPPER
  CALL IS_ALNUM
  JR C,PARSE_VARIABLE_KEY_ACCEPT
  CP '$'
  JR Z,PARSE_VARIABLE_KEY_ACCEPT
  JR PARSE_VARIABLE_KEY_DONE

PARSE_VARIABLE_KEY_ACCEPT:
  LD A,B
  CP 0
  JR NZ,PARSE_VARIABLE_KEY_SECOND
  LD A,(HL)
  CALL TO_UPPER
  LD (RAM_TMP_KEY1),A
  JR PARSE_VARIABLE_KEY_NEXT

PARSE_VARIABLE_KEY_SECOND:
  CP 1
  JR NZ,PARSE_VARIABLE_KEY_THIRD
  LD A,(HL)
  CALL TO_UPPER
  LD (RAM_TMP_KEY2),A
  JR PARSE_VARIABLE_KEY_NEXT

PARSE_VARIABLE_KEY_THIRD:
  CP 2
  JR NZ,PARSE_VARIABLE_KEY_NEXT
  LD A,(HL)
  CALL TO_UPPER
  LD (RAM_TMP_KEY3),A

PARSE_VARIABLE_KEY_NEXT:
  INC HL
  INC B
  JR PARSE_VARIABLE_KEY_LOOP

PARSE_VARIABLE_KEY_DONE:
  CALL EXPR_SET_PTR_HL
  LD A,B
  OR A
  JR Z,PARSE_VARIABLE_KEY_FAIL
  SCF
  RET

PARSE_VARIABLE_KEY_FAIL:
  AND A
  RET

; ----------------------------------------------------------------------------
; ルーチン: GET_VARIABLE_HL
; 役割: RAM_TMP_KEY1..3 で指定された変数値を取得する。
; 出力: HL=値(未定義なら0)
; ----------------------------------------------------------------------------
GET_VARIABLE_HL:
  CALL FIND_VARIABLE_ENTRY
  JR C,GET_VARIABLE_FOUND
  LD HL,0
  RET

GET_VARIABLE_FOUND:
  INC HL
  INC HL
  INC HL
  LD E,(HL)
  INC HL
  LD D,(HL)
  LD H,D
  LD L,E
  RET

; ----------------------------------------------------------------------------
; ルーチン: SET_VARIABLE_FROM_DE
; 役割: RAM_TMP_KEY1..3 の変数へ DE の値を設定する。
; ----------------------------------------------------------------------------
SET_VARIABLE_FROM_DE:
  PUSH DE
  CALL FIND_VARIABLE_ENTRY
  JR C,SET_VARIABLE_WRITE
  LD A,H
  OR L
  JR Z,SET_VARIABLE_DONE

  LD A,(RAM_TMP_KEY1)
  LD (HL),A
  INC HL
  LD A,(RAM_TMP_KEY2)
  LD (HL),A
  INC HL
  LD A,(RAM_TMP_KEY3)
  LD (HL),A
  INC HL
  JR SET_VARIABLE_STORE_VALUE

SET_VARIABLE_WRITE:
  INC HL
  INC HL
  INC HL

SET_VARIABLE_STORE_VALUE:
  POP DE
  LD A,E
  LD (HL),A
  INC HL
  LD A,D
  LD (HL),A
  RET

SET_VARIABLE_DONE:
  POP DE
  RET

; ----------------------------------------------------------------------------
; ルーチン: READ_PORT_LITERAL_A
; 役割:
;   - L=ポート番号を受け取り、対応する即値 IN 命令で読み込む。
;   - 未対応ポートは 0 を返す。
; ----------------------------------------------------------------------------
READ_PORT_LITERAL_A:
  LD A,L
  CP 0x10
  JR Z,READ_PORT_10
  CP 0x11
  JR Z,READ_PORT_11
  CP 0x12
  JR Z,READ_PORT_12
  CP 0x13
  JR Z,READ_PORT_13
  CP 0x14
  JR Z,READ_PORT_14
  CP 0x15
  JR Z,READ_PORT_15
  CP 0x16
  JR Z,READ_PORT_16
  CP 0x17
  JR Z,READ_PORT_17
  CP 0x18
  JR Z,READ_PORT_18
  CP 0x19
  JR Z,READ_PORT_19
  CP 0x1A
  JR Z,READ_PORT_1A
  CP 0x1B
  JR Z,READ_PORT_1B
  CP 0x1C
  JR Z,READ_PORT_1C
  CP 0x1D
  JR Z,READ_PORT_1D
  CP 0x1E
  JR Z,READ_PORT_1E
  CP 0x1F
  JR Z,READ_PORT_1F
  CP 0x57
  JR Z,READ_PORT_57
  CP 0x5B
  JR Z,READ_PORT_5B
  XOR A
  RET

READ_PORT_10: IN A,(0x10)
  RET
READ_PORT_11: IN A,(0x11)
  RET
READ_PORT_12: IN A,(0x12)
  RET
READ_PORT_13: IN A,(0x13)
  RET
READ_PORT_14: IN A,(0x14)
  RET
READ_PORT_15: IN A,(0x15)
  RET
READ_PORT_16:
  ; BASICサンプル資産互換:
  ; INP(16) はキーマトリクス読取りとして扱う。
  IN A,(0x10)
  RET
READ_PORT_17:
  ; BASICサンプル資産互換:
  ; INP(17) はキーストローブの現在値参照として扱う。
  IN A,(0x11)
  RET
READ_PORT_18: IN A,(0x18)
  RET
READ_PORT_19: IN A,(0x19)
  RET
READ_PORT_1A: IN A,(0x1A)
  RET
READ_PORT_1B: IN A,(0x1B)
  RET
READ_PORT_1C: IN A,(0x1C)
  RET
READ_PORT_1D: IN A,(0x1D)
  RET
READ_PORT_1E: IN A,(0x1E)
  RET
READ_PORT_1F: IN A,(0x1F)
  RET
READ_PORT_57: IN A,(0x57)
  RET
READ_PORT_5B: IN A,(0x5B)
  RET

; ----------------------------------------------------------------------------
; ルーチン: FIND_VARIABLE_ENTRY
; 役割: 変数表から一致キーを検索し、見つからなければ空き枠を返す。
; 出力:
;   - Carry=1: HL=一致エントリ先頭
;   - Carry=0: HL=空きエントリ先頭(無ければ0)
; ----------------------------------------------------------------------------
FIND_VARIABLE_ENTRY:
  LD HL,RAM_VAR_TABLE
  LD B,VAR_MAX_ENTRIES

FIND_VARIABLE_ENTRY_LOOP:
  LD A,(HL)
  OR A
  JR Z,FIND_VARIABLE_FREE

  LD A,(RAM_TMP_KEY1)
  CP (HL)
  JR NZ,FIND_VARIABLE_NEXT
  INC HL
  LD A,(RAM_TMP_KEY2)
  CP (HL)
  JR NZ,FIND_VARIABLE_BACK1
  INC HL
  LD A,(RAM_TMP_KEY3)
  CP (HL)
  JR NZ,FIND_VARIABLE_BACK2
  DEC HL
  DEC HL
  SCF
  RET

FIND_VARIABLE_BACK2:
  DEC HL
FIND_VARIABLE_BACK1:
  DEC HL
  JR FIND_VARIABLE_NEXT

FIND_VARIABLE_FREE:
  ; 変数エントリは削除しないため、先頭の空き枠がそのまま割当先になる。
  AND A
  RET

FIND_VARIABLE_NEXT:
  INC HL
  INC HL
  INC HL
  INC HL
  INC HL
  INC HL
  DJNZ FIND_VARIABLE_ENTRY_LOOP

  LD HL,0
  AND A
  RET

; ----------------------------------------------------------------------------
; ルーチン: IS_ALPHA
; 役割: A が英字(A-Z)なら Carry=1 を返す。
; ----------------------------------------------------------------------------
IS_ALPHA:
  CP 'A'
  JR C,IS_ALPHA_NO
  CP 'Z' + 1
  JR NC,IS_ALPHA_NO
  SCF
  RET
IS_ALPHA_NO:
  AND A
  RET

; ----------------------------------------------------------------------------
; ルーチン: IS_ALNUM
; 役割: A が英数字(A-Z,0-9)なら Carry=1 を返す。
; ----------------------------------------------------------------------------
IS_ALNUM:
  PUSH AF
  CALL IS_ALPHA
  JR C,IS_ALNUM_OK_POP
  POP AF
  CP '0'
  JR C,IS_ALNUM_NO
  CP '9' + 1
  JR NC,IS_ALNUM_NO
  SCF
  RET
IS_ALNUM_OK_POP:
  POP AF
  SCF
  RET
IS_ALNUM_NO:
  AND A
  RET
