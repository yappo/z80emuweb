; ============================================================================
; BASIC コマンドトークン定義と判定処理
; ----------------------------------------------------------------------------
; 役割:
;   - 対象命令のキーワード一覧を ROM 上に保持する。
;   - 行先頭トークンを走査し、対応するコマンドIDを返す。
; 入力:
;   - RAM_CMDPTR_LO/HI に比較開始位置が入っていること。
; 出力:
;   - A=コマンドID (0 は未検出)
; 破壊レジスタ:
;   - A,B,C,D,E,H,L
; ============================================================================

; コマンドID定義
CMD_NONE      EQU 0
CMD_NEW       EQU 1
CMD_LIST      EQU 2
CMD_RUN       EQU 3
CMD_PRINT     EQU 4
CMD_LET       EQU 5
CMD_INPUT     EQU 6
CMD_GOTO      EQU 7
CMD_GOSUB     EQU 8
CMD_RETURN    EQU 9
CMD_END       EQU 10
CMD_STOP      EQU 11
CMD_CONT      EQU 12
CMD_IF        EQU 13
CMD_CLS       EQU 14
CMD_REM       EQU 15
CMD_FOR       EQU 16
CMD_NEXT      EQU 17
CMD_DIM       EQU 18
CMD_DATA      EQU 19
CMD_READ      EQU 20
CMD_RESTORE   EQU 21
CMD_POKE      EQU 22
CMD_OUT       EQU 23
CMD_BEEP      EQU 24
CMD_WAIT      EQU 25
CMD_LOCATE    EQU 26
CMD_AUTO      EQU 27
CMD_BLOAD     EQU 28
CMD_BSAVE     EQU 29
CMD_FILES     EQU 30
CMD_HDCOPY    EQU 31
CMD_PAINT     EQU 32
CMD_CIRCLE    EQU 33
CMD_PASS      EQU 34
CMD_PIOSET    EQU 35
CMD_PIOPUT    EQU 36
CMD_SPOUT     EQU 37
CMD_SPINP     EQU 38
CMD_REPEAT    EQU 39
CMD_UNTIL     EQU 40
CMD_WHILE     EQU 41
CMD_WEND      EQU 42
CMD_LNINPUT   EQU 43
CMD_CLEAR     EQU 44
CMD_DELETE    EQU 45
CMD_ERASE     EQU 46
CMD_ON        EQU 47
CMD_RANDOMIZE EQU 48
CMD_RENUM     EQU 49
CMD_USING     EQU 50
CMD_MON       EQU 51
CMD_OPEN      EQU 52
CMD_CLOSE     EQU 53
CMD_LOAD      EQU 54
CMD_SAVE      EQU 55
CMD_LFILES    EQU 56
CMD_LCOPY     EQU 57
CMD_KILL      EQU 58
CMD_CALL      EQU 59
CMD_GCURSOR   EQU 60
CMD_GPRINT    EQU 61
CMD_LINE      EQU 62
CMD_PSET      EQU 63
CMD_PRESET    EQU 64
CMD_LLIST     EQU 65
CMD_LPRINT    EQU 66
CMD_DEGREE    EQU 67
CMD_RADIAN    EQU 68
CMD_GRAD      EQU 69
CMD_TRON      EQU 70
CMD_TROFF     EQU 71
CMD_ELSE      EQU 72
CMD_EMPTY     EQU 73

; コマンドテーブル
; 形式: [ID][ASCIIキーワード][0x00]
COMMAND_TABLE:
  DB CMD_NEW,      "NEW",0
  DB CMD_LIST,     "LIST",0
  DB CMD_RUN,      "RUN",0
  DB CMD_PRINT,    "PRINT",0
  DB CMD_LET,      "LET",0
  DB CMD_INPUT,    "INPUT",0
  DB CMD_GOTO,     "GOTO",0
  DB CMD_GOSUB,    "GOSUB",0
  DB CMD_RETURN,   "RETURN",0
  DB CMD_END,      "END",0
  DB CMD_STOP,     "STOP",0
  DB CMD_CONT,     "CONT",0
  DB CMD_IF,       "IF",0
  DB CMD_CLS,      "CLS",0
  DB CMD_REM,      "REM",0
  DB CMD_FOR,      "FOR",0
  DB CMD_NEXT,     "NEXT",0
  DB CMD_DIM,      "DIM",0
  DB CMD_DATA,     "DATA",0
  DB CMD_READ,     "READ",0
  DB CMD_RESTORE,  "RESTORE",0
  DB CMD_POKE,     "POKE",0
  DB CMD_OUT,      "OUT",0
  DB CMD_BEEP,     "BEEP",0
  DB CMD_WAIT,     "WAIT",0
  DB CMD_LOCATE,   "LOCATE",0
  DB CMD_AUTO,     "AUTO",0
  DB CMD_BLOAD,    "BLOAD",0
  DB CMD_BSAVE,    "BSAVE",0
  DB CMD_FILES,    "FILES",0
  DB CMD_HDCOPY,   "HDCOPY",0
  DB CMD_PAINT,    "PAINT",0
  DB CMD_CIRCLE,   "CIRCLE",0
  DB CMD_PASS,     "PASS",0
  DB CMD_PIOSET,   "PIOSET",0
  DB CMD_PIOPUT,   "PIOPUT",0
  DB CMD_SPOUT,    "SPOUT",0
  DB CMD_SPINP,    "SPINP",0
  DB CMD_REPEAT,   "REPEAT",0
  DB CMD_UNTIL,    "UNTIL",0
  DB CMD_WHILE,    "WHILE",0
  DB CMD_WEND,     "WEND",0
  DB CMD_LNINPUT,  "LNINPUT",0
  DB CMD_CLEAR,    "CLEAR",0
  DB CMD_DELETE,   "DELETE",0
  DB CMD_ERASE,    "ERASE",0
  DB CMD_ON,       "ON",0
  DB CMD_RANDOMIZE,"RANDOMIZE",0
  DB CMD_RENUM,    "RENUM",0
  DB CMD_USING,    "USING",0
  DB CMD_MON,      "MON",0
  DB CMD_OPEN,     "OPEN",0
  DB CMD_CLOSE,    "CLOSE",0
  DB CMD_LOAD,     "LOAD",0
  DB CMD_SAVE,     "SAVE",0
  DB CMD_LFILES,   "LFILES",0
  DB CMD_LCOPY,    "LCOPY",0
  DB CMD_KILL,     "KILL",0
  DB CMD_CALL,     "CALL",0
  DB CMD_GCURSOR,  "GCURSOR",0
  DB CMD_GPRINT,   "GPRINT",0
  DB CMD_LINE,     "LINE",0
  DB CMD_PSET,     "PSET",0
  DB CMD_PRESET,   "PRESET",0
  DB CMD_LLIST,    "LLIST",0
  DB CMD_LPRINT,   "LPRINT",0
  DB CMD_DEGREE,   "DEGREE",0
  DB CMD_RADIAN,   "RADIAN",0
  DB CMD_GRAD,     "GRAD",0
  DB CMD_TRON,     "TRON",0
  DB CMD_TROFF,    "TROFF",0
  DB CMD_ELSE,     "ELSE",0
  DB CMD_EMPTY,    "EMPTY",0
  DB 0

TOKEN_NEW:
  DB "NEW",0
TOKEN_RUN:
  DB "RUN",0

; ----------------------------------------------------------------------------
; ルーチン: CLASSIFY_COMMAND
; 役割: 行先頭のキーワードを COMMAND_TABLE と照合してIDを返す。
; 入力: RAM_CMDPTR_LO/HI
; 出力: A=コマンドID (未一致時 0)
; ----------------------------------------------------------------------------
CLASSIFY_COMMAND:
  LD DE,COMMAND_TABLE
CLASSIFY_NEXT:
  LD A,(DE)
  OR A
  JR Z,CLASSIFY_NONE
  LD (RAM_MATCH_ID),A
  INC DE

  PUSH DE
  LD A,(RAM_CMDPTR_LO)
  LD L,A
  LD A,(RAM_CMDPTR_HI)
  LD H,A
  POP DE

  PUSH DE
  CALL MATCH_TOKEN
  POP DE
  JR C,CLASSIFY_FOUND

CLASSIFY_SKIP_TOKEN:
  LD A,(DE)
  INC DE
  OR A
  JR NZ,CLASSIFY_SKIP_TOKEN
  JR CLASSIFY_NEXT

CLASSIFY_FOUND:
  LD A,H
  LD (RAM_AFTER_CMD_HI),A
  LD A,L
  LD (RAM_AFTER_CMD_LO),A
  LD A,(RAM_MATCH_ID)
  RET

CLASSIFY_NONE:
  XOR A
  RET

; ----------------------------------------------------------------------------
; ルーチン: MATCH_TOKEN
; 役割: HL(入力文字列) と DE(トークン文字列) の先頭一致を判定する。
; 入力: HL=入力文字列, DE=トークン文字列
; 出力: Carry=1 一致, Carry=0 不一致
; 備考: 大文字小文字を吸収し、トークン終端後は空白/終端/コロンのみ許容。
; ----------------------------------------------------------------------------
MATCH_TOKEN:
MATCH_TOKEN_LOOP:
  LD A,(DE)
  OR A
  JR Z,MATCH_TOKEN_DONE
  LD C,A
  LD A,(HL)
  CALL TO_UPPER
  CP C
  JR NZ,MATCH_TOKEN_FAIL
  INC HL
  INC DE
  JR MATCH_TOKEN_LOOP

MATCH_TOKEN_DONE:
  LD A,(HL)
  CP CHAR_SPACE
  JR Z,MATCH_TOKEN_OK
  CP CHAR_COLON
  JR Z,MATCH_TOKEN_OK
  OR A
  JR Z,MATCH_TOKEN_OK

MATCH_TOKEN_FAIL:
  AND A
  RET

MATCH_TOKEN_OK:
  SCF
  RET

; ----------------------------------------------------------------------------
; ルーチン: TO_UPPER
; 役割: a-z を A-Z へ変換する。
; 入力: A=文字コード
; 出力: A=変換後文字コード
; ----------------------------------------------------------------------------
TO_UPPER:
  CP 0x61
  RET C
  CP 0x7B
  RET NC
  SUB 0x20
  RET

; ----------------------------------------------------------------------------
; ルーチン: SKIP_SPACES
; 役割: HL が指す文字列先頭の空白を読み飛ばす。
; 入力: HL=文字列先頭
; 出力: HL=最初の非空白位置
; ----------------------------------------------------------------------------
SKIP_SPACES:
  LD A,(HL)
  CP CHAR_SPACE
  RET NZ
  INC HL
  JR SKIP_SPACES

; ----------------------------------------------------------------------------
; ルーチン: IS_DIGIT
; 役割: A が数字文字か判定する。
; 入力: A=文字コード
; 出力: Carry=1 数字, Carry=0 数字以外
; ----------------------------------------------------------------------------
IS_DIGIT:
  CP CHAR_0
  JR C,IS_DIGIT_NO
  CP CHAR_9 + 1
  JR NC,IS_DIGIT_NO
  SCF
  RET
IS_DIGIT_NO:
  AND A
  RET
