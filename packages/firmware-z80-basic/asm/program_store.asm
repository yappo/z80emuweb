; ============================================================================
; プログラム保存領域管理
; ----------------------------------------------------------------------------
; 役割:
;   - 行番号付き入力を可変長レコードで保存する。
;   - RUN/LIST 時に保存済み行を走査する。
; 形式:
;   [1byte length][line bytes...]
; ============================================================================

; ----------------------------------------------------------------------------
; ルーチン: CLEAR_PROGRAM
; 役割: ProgramArea を空状態へ初期化する。
; ----------------------------------------------------------------------------
CLEAR_PROGRAM:
  CALL INVALIDATE_FIND_LINE_CACHE
  LD A,0x00
  LD (RAM_PROG_PTR_LO),A
  LD A,0x40
  LD (RAM_PROG_PTR_HI),A
  XOR A
  LD (RAM_LAST_ERROR),A
  RET

; ----------------------------------------------------------------------------
; ルーチン: LOAD_PROG_PTR_DE
; 役割: 現在の ProgramArea 書込位置を DE にロードする。
; ----------------------------------------------------------------------------
LOAD_PROG_PTR_DE:
  LD A,(RAM_PROG_PTR_LO)
  LD E,A
  LD A,(RAM_PROG_PTR_HI)
  LD D,A
  RET

; ----------------------------------------------------------------------------
; ルーチン: APPEND_PROGRAM_LINE
; 役割: RAM_LINEBUF を ProgramArea 末尾へ追加する。
; 出力:
;   - 正常時: ポインタ更新
;   - 異常時: RAM_LAST_ERROR=1
; ----------------------------------------------------------------------------
APPEND_PROGRAM_LINE:
  CALL LOAD_PROG_PTR_DE

  LD A,(RAM_LINE_LEN)
  LD B,A
  INC A
  LD C,A
  LD B,0

  ; 必要領域分を加算して上限を越えないか確認
  LD H,D
  LD L,E
  ADD HL,BC

  LD A,H
  ; ProgramArea 上限は 0x6BFF。HL < 0x6C00 を許容する。
  CP 0x6C
  JR C,APPEND_HAS_SPACE
  JR NZ,APPEND_OVERFLOW
  LD A,L
  OR A
  JR Z,APPEND_HAS_SPACE

APPEND_OVERFLOW:
  LD A,1
  LD (RAM_LAST_ERROR),A
  RET

APPEND_HAS_SPACE:
  ; length を保存
  LD A,(RAM_LINE_LEN)
  LD (DE),A
  INC DE

  LD B,A
  LD HL,RAM_LINEBUF
APPEND_COPY_LOOP:
  LD A,B
  OR A
  JR Z,APPEND_COPY_DONE
  LD A,(HL)
  LD (DE),A
  INC HL
  INC DE
  DEC B
  JR APPEND_COPY_LOOP

APPEND_COPY_DONE:
  LD A,E
  LD (RAM_PROG_PTR_LO),A
  LD A,D
  LD (RAM_PROG_PTR_HI),A
  CALL INVALIDATE_FIND_LINE_CACHE
  RET

INVALIDATE_FIND_LINE_CACHE:
  XOR A
  LD (RAM_FIND_CACHE_VALID),A
  RET

; ----------------------------------------------------------------------------
; ルーチン: RUN_PROGRAM
; 役割: 保存済み行をZ80インタープリターで実行する。
; ----------------------------------------------------------------------------
RUN_PROGRAM:
  JP RUN_STORED_PROGRAM

; ----------------------------------------------------------------------------
; ルーチン: LIST_PROGRAM
; 役割: 保存済み行を LCD へ出力する。
; ----------------------------------------------------------------------------
LIST_PROGRAM:
  LD DE,RAM_PROG_START
LIST_PROGRAM_LOOP:
  LD A,(RAM_PROG_PTR_LO)
  CP E
  JR NZ,LIST_PROGRAM_HAS_LINE
  LD A,(RAM_PROG_PTR_HI)
  CP D
  JR Z,LIST_PROGRAM_DONE

LIST_PROGRAM_HAS_LINE:
  LD A,(DE)
  LD B,A
  INC DE

  LD A,B
  OR A
  JR Z,LIST_PROGRAM_LOOP

LIST_PROGRAM_PRINT:
  LD A,B
  OR A
  JR Z,LIST_PROGRAM_EOL
  LD A,(DE)
  CALL OUT_LCD_CHAR
  INC DE
  DEC B
  JR LIST_PROGRAM_PRINT

LIST_PROGRAM_EOL:
  CALL PRINT_CRLF
  JR LIST_PROGRAM_LOOP

LIST_PROGRAM_DONE:
  RET
