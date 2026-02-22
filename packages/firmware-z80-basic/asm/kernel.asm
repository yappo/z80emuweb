; ============================================================================
; PC-G815 BASIC Z80インタープリター本体 (ROM 0xC000-0xFFFF)
; --------------------------------------------------------------------------
; 役割:
;   - Web/UI から投入された BASIC テキストを Z80 命令で受け取り、
;     行保存・コマンド判定・実行ループを行う。
;   - コアコードは banked ROM 窓 0xC000-0xFFFF で実行する。
; 入力:
;   - IN 0x1D から文字入力。0x04(EOT) で入力終了。
; 出力:
;   - OUT 0x5A でLCD表示、必要に応じて I/O ポート制御。
; 副作用:
;   - RAM 0x4000-0x6FFF のみをBASIC作業領域として利用。
; 異常時:
;   - メモリ不足時は RAM_LAST_ERROR に 1 を設定し、行保存を中断。
; ============================================================================

ORG 0xC000
ENTRY BASIC_ENTRY

; ----------------------------------------------------------------------------
; ルーチン: BASIC_ENTRY
; 役割:
;   - バンク切替直後に必ず 0xC000 から開始できるよう固定入口にする。
;   - 実本体は BASIC_MAIN_ENTRY へジャンプして実行する。
; ----------------------------------------------------------------------------
BASIC_ENTRY:
  JP BASIC_MAIN_ENTRY

; -------------------------------
; I/O ポート定義
; -------------------------------
IN_PORT      EQU 0x1D
LCD_PORT     EQU 0x5A
LCD_CMD_PORT EQU 0x58

; -------------------------------
; 文字コード
; -------------------------------
CHAR_CR    EQU 0x0D
CHAR_LF    EQU 0x0A
CHAR_SPACE EQU 0x20
CHAR_COLON EQU 0x3A
CHAR_0     EQU 0x30
CHAR_9     EQU 0x39
CHAR_EOT   EQU 0x04

; -------------------------------
; RAM 利用範囲
; -------------------------------
RAM_BASIC_START EQU 0x4000
RAM_BASIC_END   EQU 0x6FFF

; 可変領域の管理方針:
; ProgramArea は 0x4000 から上方向へ伸長する。
; 0x6C00 以降は管理変数・バッファ用に固定確保し、
; ProgramArea の上限を 0x6BFF とする。
RAM_PROG_START     EQU 0x4000
RAM_PROG_LIMIT     EQU 0x6BFF
RAM_PROG_LIMIT_NEXT EQU 0x6C00

; 管理変数・バッファ
RAM_LINEBUF      EQU 0x6E00
MAX_LINE_LEN     EQU 200

RAM_LINE_LEN     EQU 0x6EF0
RAM_FLAG_EOT     EQU 0x6EF1
RAM_PROG_PTR_LO  EQU 0x6EF2
RAM_PROG_PTR_HI  EQU 0x6EF3
RAM_CMDPTR_LO    EQU 0x6EF4
RAM_CMDPTR_HI    EQU 0x6EF5
RAM_MATCH_ID     EQU 0x6EF6
RAM_LAST_ERROR   EQU 0x6EF7
RAM_RUN_PTR_LO      EQU 0x6EF8
RAM_RUN_PTR_HI      EQU 0x6EF9
RAM_NEXT_PTR_LO     EQU 0x6EFA
RAM_NEXT_PTR_HI     EQU 0x6EFB
RAM_EXEC_STOP       EQU 0x6EFC
RAM_JUMP_FLAG       EQU 0x6EFD
RAM_JUMP_LINE_LO    EQU 0x6EFE
RAM_JUMP_LINE_HI    EQU 0x6EFF

RAM_AFTER_CMD_LO    EQU 0x6F00
RAM_AFTER_CMD_HI    EQU 0x6F01
RAM_PTR_OVERRIDE    EQU 0x6F02
RAM_OVERRIDE_LO     EQU 0x6F03
RAM_OVERRIDE_HI     EQU 0x6F04
RAM_GOSUB_SP        EQU 0x6F05
RAM_FOR_SP          EQU 0x6F06
RAM_EXPR_PTR_LO     EQU 0x6F07
RAM_EXPR_PTR_HI     EQU 0x6F08
RAM_TMP_KEY1        EQU 0x6F09
RAM_TMP_KEY2        EQU 0x6F0A
RAM_TMP_KEY3        EQU 0x6F0B
RAM_TMP_VAL_LO      EQU 0x6F0C
RAM_TMP_VAL_HI      EQU 0x6F0D
RAM_CMP_OP          EQU 0x6F0E

RAM_GOSUB_STACK     EQU 0x6F10
GOSUB_MAX_DEPTH     EQU 16
RAM_FOR_STACK       EQU 0x6F30
FOR_MAX_DEPTH       EQU 4
FOR_FRAME_SIZE      EQU 9

RAM_PRINT_DIGITS    EQU 0x6F60
RAM_VAR_TABLE       EQU 0x6C00
VAR_ENTRY_SIZE      EQU 6
VAR_MAX_ENTRIES     EQU 64

INCLUDE "command_tokens.asm"
INCLUDE "line_input.asm"
INCLUDE "runtime_io.asm"
INCLUDE "program_store.asm"
INCLUDE "runtime_exec.asm"
INCLUDE "tokenizer.asm"
INCLUDE "parser.asm"
INCLUDE "expr_vm.asm"
INCLUDE "runtime_file.asm"
INCLUDE "runtime_graphics.asm"
INCLUDE "runtime_machine.asm"

END
