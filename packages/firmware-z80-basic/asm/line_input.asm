; ============================================================================
; 行入力処理
; ----------------------------------------------------------------------------
; 役割:
;   - IN 0x1D から文字を読み、RAM_LINEBUF に1行分を格納する。
;   - CR で行確定、EOT で入力終了フラグを立てる。
; ============================================================================

; ----------------------------------------------------------------------------
; ルーチン: READ_CHAR
; 役割: 入力キューから 1 文字取得する。0 は未入力扱いで待機。
; 入力: なし
; 出力: A=入力文字
; ----------------------------------------------------------------------------
READ_CHAR:
  IN A,(IN_PORT)
  OR A
  JR Z,READ_CHAR
  RET

; ----------------------------------------------------------------------------
; ルーチン: READ_LINE
; 役割: 1行を RAM_LINEBUF に読み込む。
; 入力: なし
; 出力: RAM_LINEBUF, RAM_LINE_LEN, RAM_FLAG_EOT を更新
; ----------------------------------------------------------------------------
READ_LINE:
  LD HL,RAM_LINEBUF
  LD B,0

READ_LINE_LOOP:
  CALL READ_CHAR
  CP CHAR_EOT
  JR Z,READ_LINE_EOT
  CP CHAR_CR
  JR Z,READ_LINE_DONE

  LD (HL),A
  INC HL
  INC B

  LD A,B
  CP MAX_LINE_LEN
  JR C,READ_LINE_LOOP

READ_LINE_FLUSH:
  CALL READ_CHAR
  CP CHAR_EOT
  JR Z,READ_LINE_EOT
  CP CHAR_CR
  JR NZ,READ_LINE_FLUSH

READ_LINE_DONE:
  XOR A
  LD (HL),A
  LD A,B
  LD (RAM_LINE_LEN),A
  XOR A
  LD (RAM_FLAG_EOT),A
  RET

READ_LINE_EOT:
  XOR A
  LD (RAM_LINE_LEN),A
  LD (RAM_LINEBUF),A
  LD A,1
  LD (RAM_FLAG_EOT),A
  RET
