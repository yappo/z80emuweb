import {
  getGlyphForCode,
  hasGlyphForCode,
  KEY_MAP,
  KEY_MAP_BY_CODE,
  LCD_GLYPH_HEIGHT,
  LCD_GLYPH_WIDTH,
  LCD_HEIGHT,
  LCD_WIDTH,
  PCG815Machine,
  MONITOR_PROMPT_RESUME_ADDR,
  decodeMachineText
} from '@z80emu/machine-pcg815';
import { assemble } from '@z80emu/assembler-z80';

import './styles.css';

type BootState = 'BOOTING' | 'READY' | 'FAILED' | 'STALLED';
type ProgramRunStatus = 'idle' | 'running' | 'ok' | 'failed';
type EditorMode = 'basic' | 'asm';

interface RunBasicProgramOptions {
  resetProgram?: boolean;
}

interface RunBasicProgramResult {
  ok: boolean;
  errorLine?: string;
}

interface RunAsmProgramResult {
  ok: boolean;
  errorLine?: string;
}

interface AsmBuildCache {
  source: string;
  binary: Uint8Array;
  origin: number;
  entry: number;
  dump: string;
}

interface CompatRouteStats {
  executeLineCalls: number;
  runProgramCalls: number;
  rejectedCalls: number;
}

interface FirmwareRouteStats {
  bridgeRuns: number;
  bridgeBytes: number;
  bridgeErrors: number;
  runtimeBridgeRuns: number;
  z80InterpreterRuns: number;
}

declare global {
  interface Window {
    __pcg815?: {
      injectBasicLine: (line: string) => void;
      runBasicProgram: (source: string, options?: RunBasicProgramOptions) => Promise<RunBasicProgramResult>;
      readDisplayText: () => string[];
      getBootState: () => BootState;
      getExecutionBackend: () => 'z80-firmware' | 'ts-compat';
      setKanaMode: (enabled: boolean) => void;
      getKanaMode: () => boolean;
      drainAsciiFifo: () => number[];
      getCompatRouteStats: () => CompatRouteStats;
      getFirmwareRouteStats: () => FirmwareRouteStats & ReturnType<PCG815Machine['getFirmwareIoStats']>;
      getBasicEngineStatus: () => ReturnType<PCG815Machine['getBasicEngineStatus']>;
      getCpuPinsOut: () => ReturnType<PCG815Machine['getCpuPinsOut']>;
      getCpuPinsIn: () => ReturnType<PCG815Machine['getCpuPinsIn']>;
      tapKey: (code: string) => void;
      assembleAsm: (source: string) => { ok: boolean; errorLine?: string; dump: string };
      runAsm: (source: string) => Promise<RunAsmProgramResult>;
      getAsmDump: () => string;
    };
  }
}

const SCALE = 4;
const query = new URLSearchParams(window.location.search);
const strictMode = query.get('strict') === '1';
const executionBackend = query.get('backend') === 'ts-compat' ? 'ts-compat' : 'z80-firmware';
const FIRMWARE_LINE_END = 0x0d;
const PROGRAM_LINE_NUMBER = /^\s*(\d+)\b/;
const PROGRAM_LINE_WITH_BODY = /^\s*(\d+)(?:\s+(.*))?$/;
const LABEL_DECL_LINE = /^\s*\*[A-Za-z0-9_]+:/;

function mustQuery<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) {
    throw new Error(`UI initialization failed: missing required element ${selector}`);
  }
  return el;
}

function mustContext2D(canvas: HTMLCanvasElement, name: string): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error(`${name} canvas creation failed`);
  }
  return ctx;
}

const machine = new PCG815Machine({
  strictCpuOpcodes: strictMode,
  executionBackend,
  firmwareReturnAddress: MONITOR_PROMPT_RESUME_ADDR
});

const canvas = mustQuery<HTMLCanvasElement>('#lcd');
const runToggleButton = mustQuery<HTMLButtonElement>('#run-toggle');
const stepButton = mustQuery<HTMLButtonElement>('#step');
const resetButton = mustQuery<HTMLButtonElement>('#reset');
const kanaToggleButton = mustQuery<HTMLButtonElement>('#kana-toggle');
const fontDebugToggleButton = mustQuery<HTMLButtonElement>('#font-debug-toggle');
const speedIndicator = mustQuery<HTMLElement>('#speed-indicator');
const bootStatus = mustQuery<HTMLElement>('#boot-status');
const monitorSummary = mustQuery<HTMLElement>('#monitor-summary');
const monitorRegisterMain = mustQuery<HTMLElement>('#monitor-register-main');
const monitorRegisterShadow = mustQuery<HTMLElement>('#monitor-register-shadow');
const monitorAddressHex = mustQuery<HTMLElement>('#monitor-address-hex');
const monitorAddressBits = mustQuery<HTMLElement>('#monitor-address-bits');
const monitorDataHex = mustQuery<HTMLElement>('#monitor-data-hex');
const monitorDataBits = mustQuery<HTMLElement>('#monitor-data-bits');
const monitorFlagsHex = mustQuery<HTMLElement>('#monitor-flags-hex');
const monitorFlagsBits = mustQuery<HTMLElement>('#monitor-flags-bits');
const monitorPinGrid = mustQuery<HTMLElement>('#monitor-pin-grid');
const logView = mustQuery<HTMLElement>('#log-view');
const keyMapList = mustQuery<HTMLElement>('#keymap-list');
const editorTabBasic = mustQuery<HTMLButtonElement>('#editor-tab-basic');
const editorTabAsm = mustQuery<HTMLButtonElement>('#editor-tab-asm');
const basicEditorPanel = mustQuery<HTMLElement>('#basic-editor-panel');
const asmEditorPanel = mustQuery<HTMLElement>('#asm-editor-panel');
const basicEditor = mustQuery<HTMLTextAreaElement>('#basic-editor');
const basicEditorLines = mustQuery<HTMLElement>('#basic-editor-lines');
const basicRunStatus = mustQuery<HTMLElement>('#basic-run-status');
const basicRunButton = mustQuery<HTMLButtonElement>('#basic-run');
const basicStopButton = mustQuery<HTMLButtonElement>('#basic-stop');
const basicNewButton = mustQuery<HTMLButtonElement>('#basic-new');
const basicLoadSampleButton = mustQuery<HTMLButtonElement>('#basic-load-sample');
const basicLoadGameButton = mustQuery<HTMLButtonElement>('#basic-load-game');
const asmEditor = mustQuery<HTMLTextAreaElement>('#asm-editor');
const asmEditorLines = mustQuery<HTMLElement>('#asm-editor-lines');
const asmRunStatus = mustQuery<HTMLElement>('#asm-run-status');
const asmAssembleButton = mustQuery<HTMLButtonElement>('#asm-assemble');
const asmRunButton = mustQuery<HTMLButtonElement>('#asm-run');
const asmStopButton = mustQuery<HTMLButtonElement>('#asm-stop');
const asmNewButton = mustQuery<HTMLButtonElement>('#asm-new');
const asmLoadSampleButton = mustQuery<HTMLButtonElement>('#asm-load-sample');
const asmLoad3dSampleButton = mustQuery<HTMLButtonElement>('#asm-load-3d-sample');
const asmDumpView = mustQuery<HTMLElement>('#asm-dump-view');
const fontDebugPanel = mustQuery<HTMLElement>('#font-debug-panel');
const fontDebugMeta = mustQuery<HTMLElement>('#font-debug-meta');
const fontDebugCanvas = mustQuery<HTMLCanvasElement>('#font-debug-canvas');
const fontKanaCanvas = mustQuery<HTMLCanvasElement>('#font-kana-canvas');

const context = mustContext2D(canvas, 'Main');

const offscreen = document.createElement('canvas');
offscreen.width = LCD_WIDTH;
offscreen.height = LCD_HEIGHT;
const offCtx = mustContext2D(offscreen, 'Offscreen');
const lcdImage = offCtx.createImageData(LCD_WIDTH, LCD_HEIGHT);

const fontCtx = mustContext2D(fontDebugCanvas, 'Font debug');
const fontKanaCtx = mustContext2D(fontKanaCanvas, 'Kana zoom');

canvas.width = LCD_WIDTH * SCALE;
canvas.height = LCD_HEIGHT * SCALE;
context.imageSmoothingEnabled = false;

const FONT_GRID_COLS = 16;
const FONT_GRID_ROWS = 16;
const FONT_GLYPH_SCALE = 2;
const FONT_CELL_WIDTH = LCD_GLYPH_WIDTH * FONT_GLYPH_SCALE + 8;
const FONT_CELL_HEIGHT = LCD_GLYPH_HEIGHT * FONT_GLYPH_SCALE + 8;
const FONT_ATLAS_WIDTH = FONT_GRID_COLS * FONT_CELL_WIDTH;
const FONT_ATLAS_HEIGHT = FONT_GRID_ROWS * FONT_CELL_HEIGHT;

fontDebugCanvas.width = FONT_ATLAS_WIDTH;
fontDebugCanvas.height = FONT_ATLAS_HEIGHT;
fontCtx.imageSmoothingEnabled = false;

const KANA_GRID_COLS = 16;
const KANA_GRID_ROWS = 4;
const KANA_START_CODE = 0xa0;
const KANA_END_CODE = 0xdf;
const KANA_GLYPH_SCALE = 3;
const KANA_CELL_WIDTH = 26;
const KANA_CELL_HEIGHT = 30;
fontKanaCanvas.width = KANA_GRID_COLS * KANA_CELL_WIDTH;
fontKanaCanvas.height = KANA_GRID_ROWS * KANA_CELL_HEIGHT;
fontKanaCtx.imageSmoothingEnabled = false;

let running = false;
let animationStarted = false;
let currentState: BootState = 'BOOTING';
let fontDebugVisible = false;
let selectedGlyphCode = 0x41;

let lastTimestamp = performance.now();
let carryTStates = 0;

let speedWindowElapsed = 0;
let speedWindowExecuted = 0;

let healthWindowElapsed = 0;
let lastHealthTStates = 0;
let lastLitPixels = 0;
let lastFrameRevision = -1;
let cachedLitPixels = 0;

const inputLog: string[] = [];
const pressedCodes = new Set<string>();
const pendingKeyRelease = new Map<string, number>();
const KEYDOWN_POLL_BOOST_TSTATES = 512;
const SPACE_KEYDOWN_POLL_BOOST_TSTATES = 12_000_000;
// サンプルゲーム系のポーリング入力で短押しが取りこぼされないよう、
// 解放反映を遅らせて押下パルス幅を確保する。
const KEY_RELEASE_LATCH_MS = 220;
const BASIC_SAMPLE = `10 A = 1
20 PRINT A
30 A = A + 1
40 WAIT 64
50 IF A > 10 THEN 70
60 GOTO 20
70 PRINT "owari"
80 END`;
const BASIC_SAMPLE_GAME = `90 REM SAMPLE_GAME_V6
95 REM 初期化: スコアとステージ番号
100 LET S=0
110 LET N=1
120 GOSUB 5000
125 REM 全5ステージを順番に進める
130 IF N>5 THEN 9000
140 GOSUB 7000
150 GOSUB 2000
160 LET X=1
170 LET Y=1
180 LET K=0
190 LET T=0
195 REM メインループ: 入力→移動判定→描画→クリア判定
200 REM ステージ開始時のみ全体描画
205 GOSUB 3000
210 GOSUB 1600
220 IF D=1 THEN 260
230 IF D=2 THEN 280
240 IF D=3 THEN 300
250 IF D=4 THEN 320
255 GOTO 350
260 LET DX=-1
270 GOTO 340
280 LET DX=1
290 GOTO 340
300 LET DY=-1
310 GOTO 340
320 LET DY=1
330 GOTO 340
340 LET NX=X+DX
345 LET NY=Y+DY
350 LET DX=0
355 LET DY=0
360 IF NX<1 THEN 210
370 IF NX>4 THEN 210
380 IF NY<1 THEN 210
390 IF NY>4 THEN 210
400 IF NX<>W1X THEN 420
410 IF NY=W1Y THEN 210
420 IF NX<>W2X THEN 440
430 IF NY=W2Y THEN 210
440 IF NX<>W3X THEN 460
450 IF NY=W3Y THEN 210
460 LET OX=X
465 LET OY=Y
470 LET X=NX
480 LET Y=NY
482 LET AX=OX
483 LET AY=OY
484 GOSUB 4000
486 LET AX=X
487 LET AY=Y
488 GOSUB 4000
489 LET T=T+1
490 IF X<>KX THEN 510
500 IF Y=KY THEN 520
510 GOTO 540
520 LET K=1
530 GOTO 540
540 REM 移動時は差分2マスのみ再描画済み
550 IF K=0 THEN 580
560 IF X=GX THEN 590
570 GOTO 580
580 WAIT 2
585 GOTO 210
590 IF Y<>GY THEN 580
600 LET ADD=100-T
610 IF ADD<10 THEN 630
620 GOTO 640
630 LET ADD=10
640 LET S=S+ADD
650 LET N=N+1
660 GOTO 130
1590 REM 入力処理: WASD / 矢印キーを方向 D(1-4) に変換
1600 LET D=0
1610 OUT 17,1
1620 LET R=INP(16)
1630 IF R=254 THEN 1810
1640 IF R=247 THEN 1830
1650 OUT 17,4
1660 LET R=INP(16)
1670 IF R=191 THEN 1850
1680 IF R=251 THEN 1870
1690 OUT 17,128
1700 LET R=INP(16)
1710 IF R=127 THEN 1810
1720 IF R=223 THEN 1850
1730 IF R=191 THEN 1870
1740 OUT 17,64
1750 LET R=INP(16)
1760 IF R=254 THEN 1830
1770 WAIT 1
1780 GOTO 1610
1810 LET D=1
1820 RETURN
1830 LET D=2
1840 RETURN
1850 LET D=3
1860 RETURN
1870 LET D=4
1880 RETURN
1990 REM ステージ定義: N から 1..5 の配置を選択
2000 LET P=N
2010 IF P<6 THEN 2040
2020 LET P=P-5
2030 GOTO 2010
2040 IF P=1 THEN 2100
2050 IF P=2 THEN 2230
2060 IF P=3 THEN 2360
2070 IF P=4 THEN 2490
2080 GOTO 2620
2100 LET KX=4
2110 LET KY=1
2120 LET GX=4
2130 LET GY=4
2140 LET W1X=2
2150 LET W1Y=2
2160 LET W2X=3
2170 LET W2Y=2
2180 LET W3X=2
2190 LET W3Y=4
2200 RETURN
2230 LET KX=4
2240 LET KY=2
2250 LET GX=2
2260 LET GY=4
2270 LET W1X=2
2280 LET W1Y=1
2290 LET W2X=3
2300 LET W2Y=3
2310 LET W3X=1
2320 LET W3Y=4
2330 RETURN
2360 LET KX=1
2370 LET KY=4
2380 LET GX=4
2390 LET GY=2
2400 LET W1X=3
2410 LET W1Y=1
2420 LET W2X=2
2430 LET W2Y=3
2440 LET W3X=4
2450 LET W3Y=3
2460 RETURN
2490 LET KX=3
2500 LET KY=4
2510 LET GX=4
2520 LET GY=1
2530 LET W1X=2
2540 LET W1Y=2
2550 LET W2X=1
2560 LET W2Y=3
2570 LET W3X=4
2580 LET W3Y=3
2590 RETURN
2620 LET KX=2
2630 LET KY=4
2640 LET GX=4
2650 LET GY=2
2660 LET W1X=2
2670 LET W1Y=1
2680 LET W2X=3
2690 LET W2Y=2
2700 LET W3X=1
2710 LET W3Y=3
2720 RETURN
2990 REM 盤面描画: 4x4 全マスを順に描く
3000 CLS
3010 LET CY=0
3020 GOSUB 3350
3030 LET CY=1
3040 GOSUB 3350
3050 LET CY=2
3060 GOSUB 3350
3070 LET CY=3
3080 GOSUB 3350
3090 LET CX=W1X-1
3100 LET CY=W1Y-1
3110 LOCATE CX,CY
3120 PRINT "#";
3130 LET CX=W2X-1
3140 LET CY=W2Y-1
3150 LOCATE CX,CY
3160 PRINT "#";
3170 LET CX=W3X-1
3180 LET CY=W3Y-1
3190 LOCATE CX,CY
3200 PRINT "#";
3210 LET CX=GX-1
3220 LET CY=GY-1
3230 LOCATE CX,CY
3240 PRINT "G";
3250 IF K<>0 THEN 3300
3260 LET CX=KX-1
3270 LET CY=KY-1
3280 LOCATE CX,CY
3290 PRINT "K";
3300 LET CX=X-1
3310 LET CY=Y-1
3320 LOCATE CX,CY
3330 PRINT "@";
3340 RETURN
3350 LOCATE 0,CY
3360 PRINT "....";
3400 RETURN
4000 LET CH=46
4010 IF AX<>W1X THEN 4040
4020 IF AY=W1Y THEN 4200
4040 IF AX<>W2X THEN 4070
4050 IF AY=W2Y THEN 4200
4070 IF AX<>W3X THEN 4100
4080 IF AY=W3Y THEN 4200
4100 IF AX<>GX THEN 4130
4110 IF AY=GY THEN 4220
4130 IF AX<>X THEN 4160
4140 IF AY=Y THEN 4260
4160 IF K<>0 THEN 4190
4170 IF AX<>KX THEN 4190
4180 IF AY=KY THEN 4240
4190 GOTO 4290
4200 LET CH=35
4210 GOTO 4290
4220 LET CH=71
4230 GOTO 4290
4240 LET CH=75
4250 GOTO 4290
4260 LET CH=64
4290 LET CX=AX-1
4300 LET CY=AY-1
4310 LOCATE CX,CY
4320 IF CH=46 THEN PRINT ".";:RETURN
4330 IF CH=35 THEN PRINT "#";:RETURN
4340 IF CH=71 THEN PRINT "G";:RETURN
4350 IF CH=75 THEN PRINT "K";:RETURN
4360 IF CH=64 THEN PRINT "@";:RETURN
4370 PRINT " ";
4380 RETURN
4990 REM タイトル画面
5000 CLS
5010 LOCATE 0,0
5020 PRINT "     MASE 4X4 GAME !"
5030 LOCATE 0,1
5040 PRINT "&=YOU #=WALL K/G V6"
5050 LOCATE 0,2
5060 PRINT "USE: WASD OR ARROWS"
5070 GOSUB 7100
5080 RETURN
6990 REM ステージ開始画面
7000 CLS
7010 LOCATE 0,0
7020 PRINT "Stage:";N;"/5 Score:";S
7030 LOCATE 0,1
7040 PRINT "Reach @ to (4,4)"
7050 LOCATE 0,2
7060 PRINT "Use WASD/Arrows"
7070 GOSUB 7100
7080 RETURN
7090 REM SPACE 待ち + 点滅表示
7100 GOSUB 7350
7110 LET SPH=0
7120 LET BL=1
7130 IF BL=0 THEN 7170
7140 GOSUB 7600
7150 GOTO 7180
7170 GOSUB 7800
7180 GOSUB 7400
7190 IF SP=1 THEN 7330
7200 WAIT 3
7210 IF BL=0 THEN 7240
7220 LET BL=0
7230 GOTO 7130
7240 LET BL=1
7250 GOTO 7130
7330 RETURN
7350 OUT 17,128
7360 LET R=INP(16)
7370 IF R<>255 THEN 7380
7374 GOTO 7390
7380 WAIT 1
7385 GOTO 7350
7390 RETURN
7395 REM SPACE 押下検出(エッジ検出)
7400 LET SP=0
7410 OUT 17,128
7420 LET R=INP(16)
7430 IF R<>255 THEN 7480
7440 IF SPH=0 THEN 7490
7450 LET SP=1
7460 LET SPH=0
7470 RETURN
7480 LET SPH=1
7490 RETURN
7590 REM 点滅 ON 表示: PUSH SPACE KEY !
7600 LOCATE 4,3
7610 PRINT "PUSH SPACE KEY !";
7620 RETURN
7790 REM 点滅 OFF 表示
7800 LOCATE 4,3
7810 PRINT "                ";
7820 RETURN
8990 REM クリア画面
9000 CLS
9010 LOCATE 0,0
9020 PRINT "ALL STAGE CLEAR!"
9030 LOCATE 0,1
9040 PRINT "FINAL SCORE:";S
9050 LOCATE 0,2
9060 PRINT "Press SPACE to END"
9070 GOSUB 7100
9080 END`;
const ASM_SAMPLE = `ORG 0x0300
ENTRY START

LCD_CMD1      EQU 0x58
LCD_DATA1     EQU 0x5A
LCD_CMD2      EQU 0x54
LCD_DATA2     EQU 0x56
LCD_HALF_COLS EQU 12
LCD_PAGE_COLS EQU 72
MAX_LEN       EQU 12
LAST_COL      EQU 23
CHAR_BS       EQU 0x08
CHAR_CR       EQU 0x0D
PROMPT_IN_COL EQU 12
PROMPT_OUT_COL EQU 10

START:
  CALL LCD_CLEAR_SCREEN

  LD D,0
  LD E,0
  CALL LCD_SET_CURSOR
  LD HL,PROMPT_IN
  CALL PRINT_STR

  LD D,1
  LD E,0
  CALL LCD_SET_CURSOR
  LD HL,PROMPT_OUT
  CALL PRINT_STR

  LD D,0
  LD E,PROMPT_IN_COL
  CALL LCD_SET_CURSOR
  LD HL,BUFFER
  XOR A
  LD (LEN),A

READ_LOOP:
  PUSH HL
  CALL READ_KEY
  POP HL
  CP CHAR_CR
  JR Z,INPUT_DONE
  CP CHAR_BS
  JR Z,HANDLE_BACKSPACE
  CP 0x20
  JR C,READ_LOOP

  LD C,A
  LD A,(LEN)
  CP MAX_LEN
  JR NC,READ_LOOP
  LD A,C
  LD (HL),A
  INC HL
  LD A,(LEN)
  INC A
  LD (LEN),A
  LD A,C
  CALL PRINT_CHAR
  JR READ_LOOP

HANDLE_BACKSPACE:
  LD A,(LEN)
  OR A
  JR Z,READ_LOOP
  DEC HL
  DEC A
  LD (LEN),A
  CALL CURSOR_LEFT
  CALL CLEAR_CELL
  JR READ_LOOP

INPUT_DONE:
  LD D,1
  LD E,PROMPT_OUT_COL
  CALL LCD_SET_CURSOR

  LD A,(LEN)
  OR A
  JR Z,DONE
  LD B,A
  LD HL,BUFFER
  LD E,A
  LD D,0
  ADD HL,DE
  DEC HL

PRINT_REVERSED:
  LD A,(HL)
  CALL PRINT_CHAR
  DEC HL
  DJNZ PRINT_REVERSED

DONE:
  RET

PRINT_STR:
  LD A,(HL)
  OR A
  RET Z
  CALL PRINT_CHAR
  INC HL
  JR PRINT_STR

PRINT_CHAR:
  PUSH AF
  PUSH BC
  PUSH DE
  PUSH HL
  CALL GET_GLYPH_PTR
  LD B,0
PRINT_CHAR_LOOP:
  LD A,(HL)
  PUSH HL
  PUSH BC
  CALL WRITE_GLYPH_COLUMN
  POP BC
  POP HL
  INC HL
  INC B
  LD A,B
  CP 5
  JR C,PRINT_CHAR_LOOP
  XOR A
  CALL WRITE_GLYPH_COLUMN
  CALL CURSOR_RIGHT
  POP HL
  POP DE
  POP BC
  POP AF
  RET

CLEAR_CELL:
  LD B,0
CLEAR_CELL_LOOP:
  XOR A
  PUSH BC
  CALL WRITE_GLYPH_COLUMN
  POP BC
  INC B
  LD A,B
  CP 6
  JR C,CLEAR_CELL_LOOP
  RET

CURSOR_RIGHT:
  LD A,(CUR_COL)
  CP LAST_COL
  RET NC
  INC A
  LD (CUR_COL),A
  RET

CURSOR_LEFT:
  LD A,(CUR_COL)
  OR A
  RET Z
  DEC A
  LD (CUR_COL),A
  RET

LCD_SET_CURSOR:
  LD A,E
  LD (CUR_COL),A
  LD A,D
  LD (CUR_ROW),A
  RET

WRITE_GLYPH_COLUMN:
  PUSH AF
  LD D,B
  LD A,(CUR_COL)
  CP LCD_HALF_COLS
  JR C,WRITE_GLYPH_LEFT

  ADD A,A
  LD B,A
  ADD A,A
  ADD A,B
  LD B,A
  LD A,143
  SUB B
  SUB D
  LD B,A
  LD A,(CUR_ROW)
  ADD A,4
  LD C,A
  POP AF
  JP LCD_WRITE_RAW_BYTE

WRITE_GLYPH_LEFT:
  ADD A,A
  LD B,A
  ADD A,A
  ADD A,B
  ADD A,D
  LD B,A
  LD A,(CUR_ROW)
  LD C,A
  POP AF
  JP LCD_WRITE_RAW_BYTE

LCD_WRITE_RAW_BYTE:
  PUSH AF
  LD A,B
  CP 60
  JR C,LCD_WRITE_SECONDARY
  SUB 60
  OR 0x40
  OUT (LCD_CMD1),A
  LD A,C
  OR 0x80
  OUT (LCD_CMD1),A
  POP AF
  OUT (LCD_DATA1),A
  RET

LCD_WRITE_SECONDARY:
  OR 0x40
  OUT (LCD_CMD2),A
  LD A,C
  OR 0x80
  OUT (LCD_CMD2),A
  POP AF
  OUT (LCD_DATA2),A
  RET

LCD_CLEAR_SCREEN:
  LD C,0
LCD_CLEAR_PAGE:
  LD B,0
LCD_CLEAR_COL:
  XOR A
  PUSH BC
  CALL LCD_WRITE_RAW_BYTE
  POP BC
  INC B
  LD A,B
  CP LCD_PAGE_COLS
  JR C,LCD_CLEAR_COL
  INC C
  LD A,C
  CP 8
  JR C,LCD_CLEAR_PAGE
  RET

GET_GLYPH_PTR:
  CP 0x20
  JR C,GET_GLYPH_SPACE
  CP 0x7F
  JR NC,GET_GLYPH_SPACE
  SUB 0x20
  LD E,A
  LD D,0
  LD L,A
  LD H,0
  ADD HL,HL
  ADD HL,HL
  ADD HL,DE
  LD DE,FONT_ASCII
  ADD HL,DE
  RET

GET_GLYPH_SPACE:
  LD HL,FONT_ASCII
  RET

READ_KEY:
WAIT_CLEAR:
  CALL SCAN_KEY
  JR NZ,WAIT_CLEAR
WAIT_PRESS:
  CALL SCAN_KEY
  JR Z,WAIT_PRESS
  RET

SCAN_KEY:
  LD A,0x80
  OUT (0x11),A
  IN A,(0x10)
  LD B,0
  BIT 0,A
  JR Z,SHIFT_ON
  BIT 1,A
  JR NZ,SHIFT_DONE
SHIFT_ON:
  LD B,1
SHIFT_DONE:
  LD C,0x01
  LD D,0x00

SCAN_ROW:
  LD A,C
  OUT (0x11),A
  IN A,(0x10)
  CPL
  AND 0xFF
  JR NZ,ROW_HIT
  INC D
  SLA C
  JR NZ,SCAN_ROW
  XOR A
  RET

ROW_HIT:
  LD E,0
  BIT 0,A
  JR NZ,COL_FOUND
  INC E
  BIT 1,A
  JR NZ,COL_FOUND
  INC E
  BIT 2,A
  JR NZ,COL_FOUND
  INC E
  BIT 3,A
  JR NZ,COL_FOUND
  INC E
  BIT 4,A
  JR NZ,COL_FOUND
  INC E
  BIT 5,A
  JR NZ,COL_FOUND
  INC E
  BIT 6,A
  JR NZ,COL_FOUND
  INC E
  BIT 7,A
  JR NZ,COL_FOUND
  XOR A
  RET

COL_FOUND:
  LD A,D
  ADD A,A
  ADD A,A
  ADD A,A
  ADD A,E
  LD E,A
  LD D,0
  LD HL,NORMAL_TABLE
  LD A,B
  OR A
  JR Z,TABLE_OK
  LD HL,SHIFT_TABLE
TABLE_OK:
  ADD HL,DE
  LD A,(HL)
  OR A
  RET

PROMPT_IN:
  DB "Input Word: ",0
PROMPT_OUT:
  DB "Reversed: ",0
CUR_COL:
  DB 0
CUR_ROW:
  DB 0
LEN:
  DB 0
BUFFER:
  DS 12,0

FONT_ASCII:
  DB 0x00,0x00,0x00,0x00,0x00
  DB 0x00,0x00,0x5f,0x00,0x00
  DB 0x00,0x07,0x00,0x07,0x00
  DB 0x12,0x3f,0x12,0x3f,0x12
  DB 0x24,0x2a,0x7f,0x2a,0x12
  DB 0x13,0x0b,0x34,0x32,0x01
  DB 0x36,0x49,0x55,0x22,0x50
  DB 0x00,0x0b,0x07,0x00,0x00
  DB 0x00,0x1c,0x22,0x41,0x00
  DB 0x00,0x41,0x22,0x1c,0x00
  DB 0x08,0x2a,0x1c,0x2a,0x08
  DB 0x08,0x08,0x3e,0x08,0x08
  DB 0x00,0x00,0x50,0x30,0x00
  DB 0x08,0x08,0x08,0x08,0x08
  DB 0x00,0x00,0x60,0x60,0x00
  DB 0x10,0x08,0x04,0x02,0x01
  DB 0x3e,0x51,0x49,0x45,0x3e
  DB 0x00,0x42,0x7f,0x40,0x00
  DB 0x42,0x61,0x51,0x49,0x46
  DB 0x41,0x49,0x49,0x49,0x36
  DB 0x18,0x14,0x12,0x7f,0x10
  DB 0x4f,0x49,0x49,0x49,0x31
  DB 0x3e,0x49,0x49,0x49,0x30
  DB 0x01,0x71,0x09,0x05,0x03
  DB 0x36,0x49,0x49,0x49,0x36
  DB 0x06,0x49,0x49,0x49,0x3e
  DB 0x00,0x00,0x36,0x36,0x00
  DB 0x00,0x00,0x5b,0x3b,0x00
  DB 0x08,0x14,0x22,0x41,0x00
  DB 0x0a,0x0a,0x0a,0x0a,0x0a
  DB 0x00,0x41,0x22,0x14,0x08
  DB 0x02,0x01,0x51,0x09,0x06
  DB 0x32,0x49,0x79,0x41,0x3e
  DB 0x7e,0x09,0x09,0x09,0x7e
  DB 0x7f,0x49,0x49,0x49,0x36
  DB 0x3e,0x41,0x41,0x41,0x22
  DB 0x7f,0x41,0x41,0x22,0x1c
  DB 0x7f,0x49,0x49,0x49,0x41
  DB 0x7f,0x09,0x09,0x09,0x01
  DB 0x3e,0x41,0x49,0x49,0x3a
  DB 0x7f,0x08,0x08,0x08,0x7f
  DB 0x00,0x41,0x7f,0x41,0x00
  DB 0x30,0x40,0x40,0x40,0x3f
  DB 0x7f,0x08,0x14,0x22,0x41
  DB 0x7f,0x40,0x40,0x40,0x40
  DB 0x7f,0x02,0x0c,0x02,0x7f
  DB 0x7f,0x02,0x04,0x08,0x7f
  DB 0x3e,0x41,0x41,0x41,0x3e
  DB 0x7f,0x09,0x09,0x09,0x06
  DB 0x3e,0x41,0x51,0x21,0x5e
  DB 0x7f,0x09,0x19,0x29,0x46
  DB 0x26,0x49,0x49,0x49,0x32
  DB 0x01,0x01,0x7f,0x01,0x01
  DB 0x3f,0x40,0x40,0x40,0x3f
  DB 0x1f,0x20,0x40,0x20,0x1f
  DB 0x3f,0x40,0x38,0x40,0x3f
  DB 0x63,0x14,0x08,0x14,0x63
  DB 0x03,0x04,0x78,0x04,0x03
  DB 0x61,0x51,0x49,0x45,0x43
  DB 0x00,0x7f,0x41,0x41,0x00
  DB 0x01,0x02,0x04,0x08,0x10
  DB 0x00,0x41,0x41,0x7f,0x00
  DB 0x00,0x06,0x01,0x06,0x00
  DB 0x40,0x40,0x40,0x40,0x40
  DB 0x00,0x00,0x07,0x0b,0x00
  DB 0x30,0x4a,0x4a,0x2a,0x7c
  DB 0x7f,0x28,0x44,0x44,0x38
  DB 0x3c,0x42,0x42,0x42,0x24
  DB 0x38,0x44,0x44,0x28,0x7f
  DB 0x3c,0x4a,0x4a,0x4a,0x2c
  DB 0x08,0x7e,0x09,0x01,0x02
  DB 0x0c,0x52,0x52,0x4c,0x3e
  DB 0x7f,0x08,0x04,0x04,0x78
  DB 0x00,0x44,0x7d,0x40,0x00
  DB 0x20,0x40,0x44,0x3d,0x00
  DB 0x7f,0x10,0x28,0x44,0x00
  DB 0x00,0x41,0x7f,0x40,0x00
  DB 0x7e,0x02,0x7c,0x02,0x7c
  DB 0x7e,0x04,0x02,0x02,0x7c
  DB 0x3c,0x42,0x42,0x42,0x3c
  DB 0x7e,0x0c,0x12,0x12,0x0c
  DB 0x0c,0x12,0x12,0x0c,0x7e
  DB 0x7e,0x04,0x02,0x02,0x04
  DB 0x44,0x4a,0x4a,0x4a,0x32
  DB 0x04,0x3f,0x44,0x40,0x20
  DB 0x3e,0x40,0x20,0x10,0x7e
  DB 0x1e,0x20,0x40,0x20,0x1e
  DB 0x3e,0x40,0x38,0x40,0x3e
  DB 0x22,0x14,0x08,0x14,0x22
  DB 0x0e,0x50,0x50,0x48,0x3e
  DB 0x44,0x64,0x54,0x4c,0x44
  DB 0x00,0x08,0x77,0x41,0x00
  DB 0x00,0x00,0x7f,0x00,0x00
  DB 0x00,0x41,0x77,0x08,0x00
  DB 0x02,0x01,0x02,0x04,0x02

NORMAL_TABLE:
  DB 0x41,0x42,0x43,0x44,0x45,0x46,0x47,0x48
  DB 0x49,0x4A,0x4B,0x4C,0x4D,0x4E,0x4F,0x50
  DB 0x51,0x52,0x53,0x54,0x55,0x56,0x57,0x58
  DB 0x59,0x5A,0x00,0x00,0x00,0x00,0x00,0x00
  DB 0x00,0x00,0x08,0x00,0x00,0x00,0x00,0x00
  DB 0x37,0x38,0x39,0x00,0x00,0x00,0x00,0x00
  DB 0x00,0x30,0x31,0x32,0x33,0x34,0x35,0x36
  DB 0x00,0x00,0x0D,0x08,0x20,0x00,0x00,0x00

SHIFT_TABLE:
  DB 0x61,0x62,0x63,0x64,0x65,0x66,0x67,0x68
  DB 0x69,0x6A,0x6B,0x6C,0x6D,0x6E,0x6F,0x70
  DB 0x71,0x72,0x73,0x74,0x75,0x76,0x77,0x78
  DB 0x79,0x7A,0x3A,0x22,0x7B,0x7D,0x7C,0x7E
  DB 0x09,0x1B,0x08,0x00,0x00,0x00,0x00,0x00
  DB 0x26,0x2A,0x28,0x5F,0x2B,0x3C,0x3E,0x3F
  DB 0x00,0x29,0x21,0x40,0x23,0x24,0x25,0x5E
  DB 0x00,0x00,0x0D,0x08,0x20,0x00,0x00,0x00`;
const ASM_SAMPLE_3D = `ORG 0x0300
ENTRY START

LCD_CMD2    EQU 0x54
LCD_DATA2   EQU 0x56
LCD_CMD     EQU 0x58
LCD_DATA    EQU 0x5A

CMD_FWD     EQU 0x00
CMD_TURN_L  EQU 0x01
CMD_TURN_R  EQU 0x02
CMD_END     EQU 0xFF

DIR_NORTH   EQU 0x00
DIR_EAST    EQU 0x01
DIR_SOUTH   EQU 0x02
DIR_WEST    EQU 0x03

RAY_COUNT   EQU 24
DEPTH_LIMIT EQU 7
MOVE_INTERVAL EQU 1

START:
  LD A,0x01
  OUT (LCD_CMD),A

  LD A,1
  LD (POS_X),A
  LD A,1
  LD (POS_Y),A
  LD A,DIR_EAST
  LD (DIR),A
  XOR A
  LD (ROUTE_PTR),A
  LD (FRAME_TICK),A
  LD (MOVE_WAIT),A

MAIN_LOOP:
  CALL UPDATE_CAMERA
  CALL CAST_ALL_RAYS
  CALL RENDER_FRAME
  CALL BLIT_FRAME
  CALL FRAME_DELAY

  LD A,(FRAME_TICK)
  INC A
  LD (FRAME_TICK),A
  JR MAIN_LOOP

UPDATE_CAMERA:
  LD A,(MOVE_WAIT)
  INC A
  CP MOVE_INTERVAL
  JR C,WAIT_MORE
  XOR A
  LD (MOVE_WAIT),A
  JR UPDATE_ROUTE
WAIT_MORE:
  LD (MOVE_WAIT),A
  RET

UPDATE_ROUTE:
  LD A,(ROUTE_PTR)
  LD E,A
  LD D,0
  LD HL,ROUTE_TABLE
  ADD HL,DE
  LD A,(HL)
  CP CMD_END
  JR NZ,ROUTE_READY

  XOR A
  LD (ROUTE_PTR),A
  LD HL,ROUTE_TABLE
  LD A,(HL)

ROUTE_READY:
  CP CMD_FWD
  JR Z,ROUTE_FWD
  CP CMD_TURN_L
  JR Z,ROUTE_L
  CP CMD_TURN_R
  JR Z,ROUTE_R
  JR ROUTE_NEXT

ROUTE_FWD:
  CALL TRY_FORWARD
  JR ROUTE_NEXT

ROUTE_L:
  LD A,(DIR)
  DEC A
  AND 0x03
  LD (DIR),A
  JR ROUTE_NEXT

ROUTE_R:
  LD A,(DIR)
  INC A
  AND 0x03
  LD (DIR),A

ROUTE_NEXT:
  LD A,(ROUTE_PTR)
  INC A
  LD (ROUTE_PTR),A
  RET

TRY_FORWARD:
  LD A,(DIR)
  AND 0x03
  LD E,A
  LD D,0

  LD HL,FWD_DX
  ADD HL,DE
  LD A,(POS_X)
  ADD A,(HL)
  LD B,A

  LD HL,FWD_DY
  ADD HL,DE
  LD A,(POS_Y)
  ADD A,(HL)
  LD C,A

  CALL IS_WALL_BC
  OR A
  RET NZ

  LD A,B
  LD (POS_X),A
  LD A,C
  LD (POS_Y),A
  RET

CAST_ALL_RAYS:
  XOR A
  LD (RAY_INDEX),A

CAST_RAY_LOOP:
  LD A,(RAY_INDEX)
  CP RAY_COUNT
  RET NC

  CALL CAST_ONE_RAY

  LD A,(RAY_INDEX)
  INC A
  LD (RAY_INDEX),A
  JR CAST_RAY_LOOP

CAST_ONE_RAY:
  LD A,(RAY_INDEX)
  LD (CUR_RAY),A

  LD A,(CUR_RAY)
  LD B,A
  ADD A,A
  ADD A,A
  LD C,A
  LD A,B
  ADD A,A
  ADD A,C
  LD E,A
  LD D,0

  LD HL,RAY_OFS_X
  ADD HL,DE
  LD (PTR_X),HL

  LD HL,RAY_OFS_Y
  ADD HL,DE
  LD (PTR_Y),HL

  LD A,1
  LD (CUR_DEPTH),A

CAST_DEPTH_LOOP:
  LD HL,(PTR_X)
  LD D,(HL)
  INC HL
  LD (PTR_X),HL

  LD HL,(PTR_Y)
  LD E,(HL)
  INC HL
  LD (PTR_Y),HL

  CALL ROTATE_DE

  LD A,(POS_X)
  ADD A,D
  LD B,A
  LD (HIT_X),A

  LD A,(POS_Y)
  ADD A,E
  LD C,A
  LD (HIT_Y),A

  CALL IS_WALL_BC
  OR A
  JR NZ,CAST_HIT

  LD A,(CUR_DEPTH)
  INC A
  LD (CUR_DEPTH),A
  CP DEPTH_LIMIT
  JR C,CAST_DEPTH_LOOP

  LD A,DEPTH_LIMIT
  LD (DEPTH_WORK),A
  XOR A
  LD (OPEN_SIDE),A
  JR CAST_STORE

CAST_HIT:
  LD A,(CUR_DEPTH)
  LD (DEPTH_WORK),A

  CALL CHECK_SIDE_OPEN
  LD (OPEN_SIDE),A

CAST_STORE:
  LD A,(CUR_RAY)
  LD E,A
  LD D,0

  LD HL,RAY_DEPTH
  ADD HL,DE
  LD A,(DEPTH_WORK)
  LD (HL),A

  LD HL,RAY_OPEN
  ADD HL,DE
  LD A,(OPEN_SIDE)
  LD (HL),A
  RET

CHECK_SIDE_OPEN:
  LD A,(CUR_RAY)
  CP 12
  JR C,CHECK_LEFT
  CALL SIDE_VEC_RIGHT
  JR CHECK_SIDE_VEC

CHECK_LEFT:
  CALL SIDE_VEC_LEFT

CHECK_SIDE_VEC:
  LD A,(HIT_X)
  ADD A,D
  LD B,A
  LD A,(HIT_Y)
  ADD A,E
  LD C,A
  CALL IS_WALL_BC
  OR A
  JR Z,SIDE_OPEN_YES
  XOR A
  RET

SIDE_OPEN_YES:
  LD A,1
  RET

ROTATE_DE:
  LD A,(DIR)
  AND 0x03
  CP DIR_NORTH
  RET Z
  CP DIR_EAST
  JR Z,ROT_EAST
  CP DIR_SOUTH
  JR Z,ROT_SOUTH

ROT_WEST:
  LD A,D
  CPL
  INC A
  LD B,A
  LD A,E
  LD D,A
  LD E,B
  RET

ROT_EAST:
  LD A,E
  CPL
  INC A
  LD B,A
  LD A,D
  LD E,A
  LD D,B
  RET

ROT_SOUTH:
  LD A,D
  CPL
  INC A
  LD D,A
  LD A,E
  CPL
  INC A
  LD E,A
  RET

SIDE_VEC_LEFT:
  LD A,(DIR)
  AND 0x03
  CP DIR_NORTH
  JR Z,SIDE_L_N
  CP DIR_EAST
  JR Z,SIDE_L_E
  CP DIR_SOUTH
  JR Z,SIDE_L_S
  LD D,0x00
  LD E,0x01
  RET
SIDE_L_N:
  LD D,0xFF
  LD E,0x00
  RET
SIDE_L_E:
  LD D,0x00
  LD E,0xFF
  RET
SIDE_L_S:
  LD D,0x01
  LD E,0x00
  RET

SIDE_VEC_RIGHT:
  LD A,(DIR)
  AND 0x03
  CP DIR_NORTH
  JR Z,SIDE_R_N
  CP DIR_EAST
  JR Z,SIDE_R_E
  CP DIR_SOUTH
  JR Z,SIDE_R_S
  LD D,0x00
  LD E,0xFF
  RET
SIDE_R_N:
  LD D,0x01
  LD E,0x00
  RET
SIDE_R_E:
  LD D,0x00
  LD E,0x01
  RET
SIDE_R_S:
  LD D,0xFF
  LD E,0x00
  RET

IS_WALL_BC:
  LD A,B
  CP 8
  JR NC,IS_WALL_TRUE
  LD A,C
  CP 8
  JR NC,IS_WALL_TRUE

  LD A,C
  ADD A,A
  ADD A,A
  ADD A,A
  ADD A,B
  LD L,A
  LD H,0
  LD DE,MAZE_DATA
  ADD HL,DE
  LD A,(HL)
  OR A
  RET

IS_WALL_TRUE:
  LD A,1
  RET

RENDER_FRAME:
  CALL CLEAR_FRAME
  CALL DETECT_OPENINGS
  CALL DRAW_BASE_FRAME
  CALL DRAW_ROUTE_PATTERN
  RET

CLEAR_FRAME:
  LD HL,FRAME_BUF
  LD B,96
  LD A,0x20
CLEAR_LOOP:
  LD (HL),A
  INC HL
  DJNZ CLEAR_LOOP
  RET

DETECT_OPENINGS:
  LD A,(DIR)
  CALL CHECK_OPEN_DIR
  LD (OPEN_FRONT),A

  LD A,(DIR)
  ADD A,3
  AND 0x03
  CALL CHECK_OPEN_DIR
  LD (OPEN_LEFT),A

  LD A,(DIR)
  INC A
  AND 0x03
  CALL CHECK_OPEN_DIR
  LD (OPEN_RIGHT),A
  RET

CHECK_OPEN_DIR:
  LD E,A
  LD D,0

  LD HL,FWD_DX
  ADD HL,DE
  LD A,(POS_X)
  ADD A,(HL)
  LD B,A

  LD HL,FWD_DY
  ADD HL,DE
  LD A,(POS_Y)
  ADD A,(HL)
  LD C,A

  CALL IS_WALL_BC
  OR A
  JR Z,OPEN_YES
  XOR A
  RET
OPEN_YES:
  LD A,1
  RET

DRAW_BASE_FRAME:
  LD A,0x94
  LD B,0
  LD C,1
  LD D,22
  CALL DRAW_HLINE

  LD A,0x95
  LD B,3
  LD C,1
  LD D,22
  CALL DRAW_HLINE

  LD A,(OPEN_LEFT)
  OR A
  JR NZ,BASE_LEFT_OPEN
  LD A,0x88
  LD B,1
  LD C,1
  LD D,2
  CALL DRAW_VLINE
  LD A,0xEF
  LD B,0
  LD C,1
  CALL PUT_XY
  JR BASE_RIGHT
BASE_LEFT_OPEN:
  LD A,0xEF
  LD B,0
  LD C,4
  CALL PUT_XY
  LD A,0x88
  LD B,1
  LD C,4
  LD D,2
  CALL DRAW_VLINE

BASE_RIGHT:
  LD A,(OPEN_RIGHT)
  OR A
  JR NZ,BASE_RIGHT_OPEN
  LD A,0x97
  LD B,1
  LD C,22
  LD D,2
  CALL DRAW_VLINE
  LD A,0xEE
  LD B,0
  LD C,22
  CALL PUT_XY
  RET
BASE_RIGHT_OPEN:
  LD A,0xEE
  LD B,0
  LD C,19
  CALL PUT_XY
  LD A,0x97
  LD B,1
  LD C,19
  LD D,2
  CALL DRAW_VLINE
  RET

DRAW_ROUTE_PATTERN:
  LD A,(OPEN_FRONT)
  OR A
  JR Z,DRAW_FRONT_BLOCK
  CALL DRAW_FRONT_OPEN
  RET

DRAW_FRONT_BLOCK:
  LD A,0x94
  LD B,1
  LD C,9
  LD D,6
  CALL DRAW_HLINE
  LD A,0x95
  LD B,2
  LD C,9
  LD D,6
  CALL DRAW_HLINE
  LD A,0x7C
  LD B,1
  LD C,9
  LD D,2
  CALL DRAW_VLINE
  LD A,0x7C
  LD B,1
  LD C,14
  LD D,2
  CALL DRAW_VLINE
  RET

DRAW_FRONT_OPEN:
  LD A,0x94
  LD B,0
  LD C,8
  LD D,8
  CALL DRAW_HLINE
  LD A,0x95
  LD B,2
  LD C,9
  LD D,6
  CALL DRAW_HLINE

  LD A,(OPEN_LEFT)
  OR A
  JR NZ,FRONT_LEFT_OPEN
  LD A,0x88
  LD B,1
  LD C,8
  LD D,2
  CALL DRAW_VLINE
  JR FRONT_RIGHT
FRONT_LEFT_OPEN:
  LD A,0xEF
  LD B,0
  LD C,8
  CALL PUT_XY

FRONT_RIGHT:
  LD A,(OPEN_RIGHT)
  OR A
  JR NZ,FRONT_RIGHT_OPEN
  LD A,0x97
  LD B,1
  LD C,15
  LD D,2
  CALL DRAW_VLINE
  RET
FRONT_RIGHT_OPEN:
  LD A,0xEE
  LD B,0
  LD C,15
  CALL PUT_XY
  RET

DRAW_HLINE:
  LD E,A
DRAW_H_LOOP:
  LD A,D
  OR A
  RET Z
  PUSH DE
  LD A,E
  CALL PUT_XY
  POP DE
  INC C
  DEC D
  JR DRAW_H_LOOP

DRAW_VLINE:
  LD E,A
DRAW_V_LOOP:
  LD A,D
  OR A
  RET Z
  PUSH DE
  LD A,E
  CALL PUT_XY
  POP DE
  INC B
  DEC D
  JR DRAW_V_LOOP

PUT_XY:
  PUSH AF
  LD A,B
  LD E,A
  LD D,0
  LD HL,ROW_BASE
  ADD HL,DE
  LD A,(HL)
  ADD A,C
  LD L,A
  LD H,0
  LD DE,FRAME_BUF
  ADD HL,DE
  POP AF
  LD (HL),A
  RET

BLIT_FRAME:
  LD B,0
BLIT_ROW_LOOP:
  LD A,B
  CP 4
  RET NC
  LD C,0
BLIT_COL_LOOP:
  LD A,C
  CP 24
  JR NC,BLIT_NEXT_ROW
  PUSH BC
  CALL BLIT_CELL_BC
  POP BC
  INC C
  JR BLIT_COL_LOOP
BLIT_NEXT_ROW:
  INC B
  JR BLIT_ROW_LOOP

BLIT_CELL_BC:
  LD A,B
  LD (BLIT_ROW_TMP),A
  LD A,C
  LD (BLIT_COL_TMP),A

  LD A,B
  LD E,A
  LD D,0
  LD HL,ROW_BASE
  ADD HL,DE
  LD A,(HL)
  ADD A,C
  LD L,A
  LD H,0
  LD DE,FRAME_BUF
  ADD HL,DE
  LD A,(HL)
  CALL GET_BLIT_GLYPH_PTR
  LD (BLIT_GLYPH_PTR),HL

  LD E,0
BLIT_GLYPH_LOOP:
  LD A,E
  CP 5
  JR NC,BLIT_GLYPH_SPACER
  LD HL,(BLIT_GLYPH_PTR)
  LD D,0
  ADD HL,DE
  LD A,(HL)
  JR BLIT_GLYPH_WRITE
BLIT_GLYPH_SPACER:
  XOR A
BLIT_GLYPH_WRITE:
  PUSH AF
  LD A,(BLIT_COL_TMP)
  ADD A,A
  LD D,A
  ADD A,A
  ADD A,D
  ADD A,E
  CP 72
  JR C,BLIT_GLYPH_LEFT
  LD D,A
  LD A,143
  SUB D
  LD B,A
  LD A,(BLIT_ROW_TMP)
  ADD A,4
  LD C,A
  POP AF
  CALL LCD_WRITE_RAW_BYTE
  JR BLIT_GLYPH_NEXT
BLIT_GLYPH_LEFT:
  LD B,A
  LD A,(BLIT_ROW_TMP)
  LD C,A
  POP AF
  CALL LCD_WRITE_RAW_BYTE
BLIT_GLYPH_NEXT:
  INC E
  LD A,E
  CP 6
  JR C,BLIT_GLYPH_LOOP
  RET

GET_BLIT_GLYPH_PTR:
  CP 0x94
  JR Z,GET_GLYPH_TOP_LINE
  CP 0x95
  JR Z,GET_GLYPH_MID_LINE
  CP 0x88
  JR Z,GET_GLYPH_LEFT_WALL
  CP 0x97
  JR Z,GET_GLYPH_RIGHT_WALL
  CP 0x7C
  JR Z,GET_GLYPH_CENTER_WALL
  CP 0xEE
  JR Z,GET_GLYPH_DIAG_RIGHT
  CP 0xEF
  JR Z,GET_GLYPH_DIAG_LEFT
  LD HL,GLYPH_SPACE
  RET
GET_GLYPH_TOP_LINE:
  LD HL,GLYPH_TOP_LINE
  RET
GET_GLYPH_MID_LINE:
  LD HL,GLYPH_MID_LINE
  RET
GET_GLYPH_LEFT_WALL:
  LD HL,GLYPH_LEFT_WALL
  RET
GET_GLYPH_RIGHT_WALL:
  LD HL,GLYPH_RIGHT_WALL
  RET
GET_GLYPH_CENTER_WALL:
  LD HL,GLYPH_CENTER_WALL
  RET
GET_GLYPH_DIAG_RIGHT:
  LD HL,GLYPH_DIAG_RIGHT
  RET
GET_GLYPH_DIAG_LEFT:
  LD HL,GLYPH_DIAG_LEFT
  RET

LCD_WRITE_RAW_BYTE:
  PUSH AF
  LD A,B
  CP 60
  JR C,LCD_WRITE_RAW_BYTE_SECONDARY
  SUB 60
  OR 0x40
  OUT (LCD_CMD),A
  LD A,C
  OR 0x80
  OUT (LCD_CMD),A
  POP AF
  OUT (LCD_DATA),A
  RET
LCD_WRITE_RAW_BYTE_SECONDARY:
  OR 0x40
  OUT (LCD_CMD2),A
  LD A,C
  OR 0x80
  OUT (LCD_CMD2),A
  POP AF
  OUT (LCD_DATA2),A
  RET

FRAME_DELAY:
  LD BC,0x2200
DELAY_LOOP:
  DEC BC
  LD A,B
  OR C
  JR NZ,DELAY_LOOP
  RET

POS_X:
  DB 0
POS_Y:
  DB 0
DIR:
  DB 0
ROUTE_PTR:
  DB 0
FRAME_TICK:
  DB 0
MOVE_WAIT:
  DB 0

RAY_INDEX:
  DB 0
CUR_RAY:
  DB 0
CUR_DEPTH:
  DB 0
DEPTH_WORK:
  DB 0
OPEN_SIDE:
  DB 0
OPEN_FRONT:
  DB 0
OPEN_LEFT:
  DB 0
OPEN_RIGHT:
  DB 0
HIT_X:
  DB 0
HIT_Y:
  DB 0
PTR_X:
  DW 0
PTR_Y:
  DW 0

RAY_DEPTH:
  DS 24,0
RAY_OPEN:
  DS 24,0
FRAME_BUF:
  DS 96,0x20
ROW_BASE:
  DB 0,24,48,72
BLIT_ROW_TMP:
  DB 0
BLIT_COL_TMP:
  DB 0
BLIT_GLYPH_PTR:
  DW 0

GLYPH_SPACE:
  DB 0x00,0x00,0x00,0x00,0x00
GLYPH_LEFT_WALL:
  DB 0x7F,0x00,0x00,0x00,0x00
GLYPH_CENTER_WALL:
  DB 0x00,0x00,0x7F,0x00,0x00
GLYPH_RIGHT_WALL:
  DB 0x00,0x00,0x00,0x00,0x7F
GLYPH_TOP_LINE:
  DB 0x01,0x01,0x01,0x01,0x01
GLYPH_MID_LINE:
  DB 0x08,0x08,0x08,0x08,0x08
GLYPH_DIAG_RIGHT:
  DB 0x20,0x10,0x08,0x04,0x02
GLYPH_DIAG_LEFT:
  DB 0x02,0x04,0x08,0x10,0x20

FWD_DX:
  DB 0,1,0,0xFF
FWD_DY:
  DB 0xFF,0,1,0

RAY_OFS_X:
  DB 0xFF,0xFE,0xFD,0xFC,0xFB,0xFA
  DB 0xFF,0xFE,0xFD,0xFC,0xFB,0xFA
  DB 0xFF,0xFE,0xFD,0xFC,0xFB,0xFA
  DB 0xFF,0xFF,0xFE,0xFD,0xFC,0xFB
  DB 0xFF,0xFF,0xFE,0xFD,0xFC,0xFB
  DB 0xFF,0xFF,0xFE,0xFD,0xFC,0xFB
  DB 0x00,0xFF,0xFF,0xFE,0xFD,0xFC
  DB 0x00,0xFF,0xFF,0xFE,0xFD,0xFC
  DB 0x00,0xFF,0xFF,0xFE,0xFD,0xFC
  DB 0x00,0x00,0xFF,0xFF,0xFE,0xFD
  DB 0x00,0x00,0xFF,0xFF,0xFE,0xFD
  DB 0x00,0x00,0xFF,0xFF,0xFE,0xFD
  DB 0x00,0x00,0x01,0x01,0x02,0x03
  DB 0x00,0x00,0x01,0x01,0x02,0x03
  DB 0x00,0x00,0x01,0x01,0x02,0x03
  DB 0x00,0x01,0x01,0x02,0x03,0x04
  DB 0x00,0x01,0x01,0x02,0x03,0x04
  DB 0x00,0x01,0x01,0x02,0x03,0x04
  DB 0x01,0x01,0x02,0x03,0x04,0x05
  DB 0x01,0x01,0x02,0x03,0x04,0x05
  DB 0x01,0x01,0x02,0x03,0x04,0x05
  DB 0x01,0x02,0x03,0x04,0x05,0x06
  DB 0x01,0x02,0x03,0x04,0x05,0x06
  DB 0x01,0x02,0x03,0x04,0x05,0x06

RAY_OFS_Y:
  DB 0xFF,0xFE,0xFD,0xFC,0xFB,0xFA
  DB 0xFF,0xFE,0xFD,0xFC,0xFB,0xFA
  DB 0xFF,0xFE,0xFD,0xFC,0xFB,0xFA
  DB 0xFF,0xFE,0xFD,0xFC,0xFB,0xFA
  DB 0xFF,0xFE,0xFD,0xFC,0xFB,0xFA
  DB 0xFF,0xFE,0xFD,0xFC,0xFB,0xFA
  DB 0xFF,0xFE,0xFD,0xFC,0xFB,0xFA
  DB 0xFF,0xFE,0xFD,0xFC,0xFB,0xFA
  DB 0xFF,0xFE,0xFD,0xFC,0xFB,0xFA
  DB 0xFF,0xFE,0xFD,0xFC,0xFB,0xFA
  DB 0xFF,0xFE,0xFD,0xFC,0xFB,0xFA
  DB 0xFF,0xFE,0xFD,0xFC,0xFB,0xFA
  DB 0xFF,0xFE,0xFD,0xFC,0xFB,0xFA
  DB 0xFF,0xFE,0xFD,0xFC,0xFB,0xFA
  DB 0xFF,0xFE,0xFD,0xFC,0xFB,0xFA
  DB 0xFF,0xFE,0xFD,0xFC,0xFB,0xFA
  DB 0xFF,0xFE,0xFD,0xFC,0xFB,0xFA
  DB 0xFF,0xFE,0xFD,0xFC,0xFB,0xFA
  DB 0xFF,0xFE,0xFD,0xFC,0xFB,0xFA
  DB 0xFF,0xFE,0xFD,0xFC,0xFB,0xFA
  DB 0xFF,0xFE,0xFD,0xFC,0xFB,0xFA
  DB 0xFF,0xFE,0xFD,0xFC,0xFB,0xFA
  DB 0xFF,0xFE,0xFD,0xFC,0xFB,0xFA
  DB 0xFF,0xFE,0xFD,0xFC,0xFB,0xFA

MAZE_DATA:
  DB 1,1,1,1,1,1,1,1
  DB 1,0,0,0,1,0,0,1
  DB 1,0,1,0,1,0,1,1
  DB 1,0,1,0,0,0,0,1
  DB 1,0,1,1,1,1,0,1
  DB 1,0,0,0,0,1,0,1
  DB 1,1,1,0,0,0,0,1
  DB 1,1,1,1,1,1,1,1

ROUTE_TABLE:
  DB CMD_FWD,CMD_FWD,CMD_TURN_R
  DB CMD_FWD,CMD_FWD,CMD_TURN_L
  DB CMD_FWD,CMD_FWD,CMD_FWD,CMD_TURN_L
  DB CMD_FWD,CMD_FWD,CMD_TURN_R
  DB CMD_FWD,CMD_FWD,CMD_TURN_R
  DB CMD_FWD,CMD_FWD,CMD_TURN_L
  DB CMD_FWD,CMD_FWD,CMD_TURN_L
  DB CMD_FWD,CMD_FWD,CMD_TURN_R
  DB CMD_FWD,CMD_FWD,CMD_FWD,CMD_TURN_R
  DB CMD_FWD,CMD_FWD,CMD_TURN_L
  DB CMD_END
`;
let basicRunInFlight = false;
let basicRunToken = 0;
let z80RunAwaitingCompletion = false;
let z80RunHasEnteredUserProgram = false;
let z80RunPumpActive = false;
let z80RunPumpIterations = 0;
let z80RunPumpExecutedTstates = 0;
let asmRunInFlight = false;
let asmRunToken = 0;
let asmRunHasEnteredUserProgram = false;
let asmBuildCache: AsmBuildCache | undefined;
let currentEditorMode: EditorMode = 'basic';
let lastMonitorRenderMs = 0;
const compatRouteStats: CompatRouteStats = {
  executeLineCalls: 0,
  runProgramCalls: 0,
  rejectedCalls: 0
};
const firmwareRouteStats: FirmwareRouteStats = {
  bridgeRuns: 0,
  bridgeBytes: 0,
  bridgeErrors: 0,
  runtimeBridgeRuns: 0,
  z80InterpreterRuns: 0
};
const z80ProgramStore = new Map<number, string>();

function waitForAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function waitForUiTick(delayMs = 16): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

keyMapList.innerHTML = KEY_MAP.slice(0, 32)
  .map((entry) => {
    const normal = entry.normal !== undefined ? String.fromCharCode(entry.normal) : '-';
    return `<span><strong>${entry.code}</strong> -> R${entry.row}C${entry.col} (${normal})</span>`;
  })
  .join('');

function appendLog(line: string): void {
  inputLog.push(line);
  if (inputLog.length > 24) {
    inputLog.shift();
  }
  logView.textContent = inputLog.join('\n');
}

function updateEditorLineNumbers(editor: HTMLTextAreaElement, lineView: HTMLElement): void {
  const lineCount = editor.value.split('\n').length;
  const lines = Array.from({ length: Math.max(1, lineCount) }, (_, idx) => String(idx + 1));
  lineView.textContent = lines.join('\n');
}

function syncEditorScroll(editor: HTMLTextAreaElement, lineView: HTMLElement): void {
  lineView.scrollTop = editor.scrollTop;
}

function setProgramRunStatus(state: ProgramRunStatus, detail: string): void {
  basicRunStatus.dataset.state = state;
  basicRunStatus.textContent = detail;
}

function setAsmRunStatus(state: ProgramRunStatus, detail: string): void {
  asmRunStatus.dataset.state = state;
  asmRunStatus.textContent = detail;
}

function setBasicRunInFlight(inFlight: boolean): void {
  basicRunInFlight = inFlight;
  basicRunButton.disabled = inFlight;
}

function setAsmRunInFlight(inFlight: boolean): void {
  asmRunInFlight = inFlight;
  asmRunButton.disabled = inFlight;
  asmAssembleButton.disabled = inFlight;
}

function finishAsmRun(status: ProgramRunStatus, detail: string, logLine?: string): void {
  machine.setRuntimePumpEnabled(true);
  machine.setImmediateInputToRuntimeEnabled(true);
  setAsmRunInFlight(false);
  asmRunHasEnteredUserProgram = false;
  setAsmRunStatus(status, detail);
  if (logLine) {
    appendLog(logLine);
  }
}

function clearZ80RunTracking(): void {
  z80RunAwaitingCompletion = false;
  z80RunHasEnteredUserProgram = false;
  z80RunPumpActive = false;
  z80RunPumpIterations = 0;
  z80RunPumpExecutedTstates = 0;
  machine.setRuntimePumpEnabled(true);
  machine.setImmediateInputToRuntimeEnabled(true);
}

async function pumpZ80BasicRun(runToken: number): Promise<void> {
  if (z80RunPumpActive) {
    return;
  }

  z80RunPumpActive = true;
  let lastPumpAt = performance.now();

  try {
    while (basicRunToken === runToken && z80RunAwaitingCompletion) {
      z80RunPumpIterations += 1;
      if (!running) {
        setRunningState(true);
      }

      const now = performance.now();
      const elapsedMs = Math.max(0, now - lastPumpAt);
      lastPumpAt = now;
      const target = (elapsedMs / 1000) * PCG815Machine.CLOCK_HZ;
      const bounded = Math.min(target, PCG815Machine.CLOCK_HZ / 4);
      const executable = Math.max(4_096, Math.floor(bounded));

      machine.tick(executable);
      z80RunPumpExecutedTstates += executable;
      renderLcd();

      if (machine.getExecutionDomain() === 'user-program') {
        z80RunHasEnteredUserProgram = true;
      } else if (z80RunHasEnteredUserProgram) {
        clearZ80RunTracking();
        setProgramRunStatus('ok', 'Run OK');
        appendLog('BASIC RUN ok');
        return;
      }

      await waitForUiTick();
    }
  } finally {
    z80RunPumpActive = false;
  }
}

function normalizeProgramSource(source: string): string[] {
  return source
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    return true;
  }
  return target.isContentEditable;
}

function resolveKeyboardCode(event: KeyboardEvent): string | undefined {
  if (KEY_MAP_BY_CODE.has(event.code)) {
    return event.code;
  }
  const key = event.key;
  if (!key) {
    return undefined;
  }
  if (key === ' ' || key === 'Spacebar' || key.toLowerCase() === 'space') {
    return 'Space';
  }
  const lower = key.toLowerCase();
  if (lower === 'w') {
    return 'KeyW';
  }
  if (lower === 'a') {
    return 'KeyA';
  }
  if (lower === 's') {
    return 'KeyS';
  }
  if (lower === 'd') {
    return 'KeyD';
  }
  if (key === 'ArrowUp' || key === 'Up') {
    return 'ArrowUp';
  }
  if (key === 'ArrowDown' || key === 'Down') {
    return 'ArrowDown';
  }
  if (key === 'ArrowLeft' || key === 'Left') {
    return 'ArrowLeft';
  }
  if (key === 'ArrowRight' || key === 'Right') {
    return 'ArrowRight';
  }
  return undefined;
}

function drainRuntimeOutputQueue(): void {
  while (machine.runtime.popOutputChar() !== 0) {
    // Discard pending monitor output bytes.
  }
}

function assertCompatBackend(operation: string): void {
  if (machine.getExecutionBackend() === 'ts-compat') {
    return;
  }
  compatRouteStats.rejectedCalls += 1;
  throw new Error(`compat route blocked in backend=${machine.getExecutionBackend()}: ${operation}`);
}

function executeCompatImmediateLine(line: string): void {
  assertCompatBackend('executeLine');
  compatRouteStats.executeLineCalls += 1;
  machine.runtime.executeLine(line);
}

function runCompatStoredProgram(): void {
  assertCompatBackend('runProgram');
  compatRouteStats.runProgramCalls += 1;
  machine.runtime.runProgram(10_000, true, undefined, true);
}

function encodeFirmwareConsoleLine(line: string): number[] {
  const bytes: number[] = [];
  for (const ch of line) {
    const codePoint = ch.codePointAt(0) ?? 0x20;
    if (codePoint >= 0x20 && codePoint <= 0x7e) {
      bytes.push(codePoint & 0xff);
      continue;
    }
    if (codePoint >= 0xa1 && codePoint <= 0xdf) {
      bytes.push(codePoint & 0xff);
      continue;
    }
    // Z80 firmware path is byte-oriented; replace unsupported Unicode with spaces
    // so REM comments and pasted source cannot inject accidental control bytes.
    bytes.push(0x20);
  }
  bytes.push(FIRMWARE_LINE_END);
  return bytes;
}

function extractProgramLineNumber(line: string): number | undefined {
  const match = line.match(PROGRAM_LINE_NUMBER);
  if (!match) {
    return undefined;
  }
  const value = Number.parseInt(match[1] ?? '', 10);
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function parseProgramLine(line: string): { number: number; body: string } | undefined {
  const match = line.match(PROGRAM_LINE_WITH_BODY);
  if (!match) {
    return undefined;
  }
  const number = Number.parseInt(match[1] ?? '', 10);
  if (!Number.isFinite(number)) {
    return undefined;
  }
  const body = (match[2] ?? '').trim();
  return { number, body };
}

function getStoredZ80ProgramLines(): string[] {
  return [...z80ProgramStore.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, line]) => line);
}

const Z80_BASIC_INTERPRETER_DEFAULT_SLICE_TSTATES = 12_000_000;
const Z80_BASIC_INTERPRETER_RUN_SLICE_TSTATES = 3_000_000;

function runZ80BasicInterpreter(lines: readonly string[], options?: { maxTStates?: number }): void {
  const bytes: number[] = [];
  for (const line of lines) {
    bytes.push(...encodeFirmwareConsoleLine(line));
  }
  firmwareRouteStats.bridgeRuns += 1;
  firmwareRouteStats.z80InterpreterRuns += 1;
  firmwareRouteStats.bridgeBytes += bytes.length;
  machine.runBasicInterpreter(bytes, {
    appendEot: true,
    maxTStates: Math.max(4_096, Math.trunc(options?.maxTStates ?? Z80_BASIC_INTERPRETER_DEFAULT_SLICE_TSTATES))
  });
}

function prepareFreshZ80FirmwareSession(): void {
  const kanaMode = machine.getKanaMode();
  machine.reset(true);
  machine.setKanaMode(kanaMode);
  machine.setRuntimePumpEnabled(false);
  machine.setImmediateInputToRuntimeEnabled(false);
  machine.setExecutionDomain('firmware');
  machine.clearFirmwareInput();
  machine.tick(260_000);
}

function injectBasicLine(line: string, options?: { discardOutput?: boolean }): void {
  if (machine.getExecutionBackend() === 'ts-compat') {
    executeCompatImmediateLine(line);
  } else {
    try {
      prepareFreshZ80FirmwareSession();
      const trimmed = line.trim();
      const upper = trimmed.toUpperCase();
      const number = extractProgramLineNumber(trimmed);
      const parsed = parseProgramLine(trimmed);
      if (number !== undefined && parsed) {
        if (parsed.body.length === 0) {
          z80ProgramStore.delete(parsed.number);
        } else {
          z80ProgramStore.set(parsed.number, trimmed);
        }
        runZ80BasicInterpreter([trimmed]);
      } else if (upper === 'NEW') {
        z80ProgramStore.clear();
        runZ80BasicInterpreter(['NEW']);
      } else if (upper === 'LIST') {
        runZ80BasicInterpreter([...getStoredZ80ProgramLines(), 'LIST']);
      } else if (upper === 'RUN') {
        runZ80BasicInterpreter(['NEW', ...getStoredZ80ProgramLines(), 'RUN'], {
          maxTStates: Z80_BASIC_INTERPRETER_RUN_SLICE_TSTATES
        });
      } else {
        runZ80BasicInterpreter([trimmed]);
      }
    } catch (error) {
      firmwareRouteStats.bridgeErrors += 1;
      throw error;
    }
  }
  if (options?.discardOutput) {
    drainRuntimeOutputQueue();
  }
  machine.tick(40_000);
  renderLcd();
}

async function runBasicProgram(
  source: string,
  options: RunBasicProgramOptions = {}
): Promise<RunBasicProgramResult> {
  if (basicRunInFlight) {
    return { ok: false, errorLine: 'RUN ALREADY IN PROGRESS' };
  }

  setBasicRunInFlight(true);
  const runToken = ++basicRunToken;
  const isCancelled = (): boolean => basicRunToken !== runToken;
  clearZ80RunTracking();
  setProgramRunStatus('running', 'Running');
  appendLog('BASIC RUN start');

  try {
    if (!running) {
      setRunningState(true);
    }

    const resetProgram = options.resetProgram !== false;
    const lines = normalizeProgramSource(source);

    if (machine.getExecutionBackend() === 'ts-compat') {
      if (resetProgram) {
        injectBasicLine('NEW', { discardOutput: true });
      }
      for (const line of lines) {
        injectBasicLine(line, { discardOutput: true });
      }
      runCompatStoredProgram();
    } else {
      try {
        prepareFreshZ80FirmwareSession();

        if (resetProgram) {
          z80ProgramStore.clear();
        }
        const orderedScriptLines = lines.map((line) => line.trim()).filter((line) => line.length > 0);
        for (const line of lines) {
          const parsed = parseProgramLine(line);
          if (!parsed) {
            continue;
          }
          if (parsed.body.length === 0) {
            z80ProgramStore.delete(parsed.number);
          } else {
            z80ProgramStore.set(parsed.number, line.trim());
          }
        }
        const script = [...(resetProgram ? ['NEW'] : []), ...orderedScriptLines, 'RUN'];
        runZ80BasicInterpreter(script, {
          maxTStates: Z80_BASIC_INTERPRETER_RUN_SLICE_TSTATES
        });
        z80RunAwaitingCompletion = true;
        // user-program へ実際に遷移したことを frame 側で観測してから完了判定する。
        z80RunHasEnteredUserProgram = false;
      } catch (error) {
        clearZ80RunTracking();
        firmwareRouteStats.bridgeErrors += 1;
        throw error;
      }
    }
    if (isCancelled()) {
      clearZ80RunTracking();
      setProgramRunStatus('idle', 'Stopped');
      appendLog('BASIC RUN stopped');
      return { ok: false, errorLine: 'STOPPED' };
    }

    machine.tick(40_000);
    renderLcd();

    // Z80ファーム経路は frame ループ側で継続実行し、
    // 復帰判定も frame 側で行う。
    if (machine.getExecutionBackend() === 'z80-firmware') {
      // 短いプログラムは同一フレーム内で user-program -> firmware へ戻ることがあり、
      // frame 側が遷移を観測できない場合があるためここで即時完了を判定する。
      if (
        z80RunAwaitingCompletion &&
        machine.getExecutionDomain() !== 'user-program' &&
        machine.getFirmwareIoStats().pendingBytes === 0
      ) {
        clearZ80RunTracking();
        setProgramRunStatus('ok', 'Run OK');
        appendLog('BASIC RUN ok');
        return { ok: true };
      }
      setProgramRunStatus('running', 'Running');
      appendLog('BASIC RUN running');
      void pumpZ80BasicRun(runToken);
      return { ok: true };
    }

    clearZ80RunTracking();

    const timeoutMs = 20_000;
    const start = performance.now();
    while (machine.isRuntimeProgramRunning()) {
      if (isCancelled()) {
        clearZ80RunTracking();
        setProgramRunStatus('idle', 'Stopped');
        appendLog('BASIC RUN stopped');
        return { ok: false, errorLine: 'STOPPED' };
      }
      if (!running) {
        setRunningState(true);
      }
      if (performance.now() - start > timeoutMs) {
        const timeoutLine = 'RUN TIMEOUT';
        setProgramRunStatus('failed', `Failed: ${timeoutLine}`);
        appendLog(`BASIC RUN failed ${timeoutLine}`);
        return { ok: false, errorLine: timeoutLine };
      }
      await waitForAnimationFrame();
    }

    if (isCancelled()) {
      clearZ80RunTracking();
      setProgramRunStatus('idle', 'Stopped');
      appendLog('BASIC RUN stopped');
      return { ok: false, errorLine: 'STOPPED' };
    }

    const runtimeError = machine.runtime.getLastProgramError();
    if (runtimeError) {
      setProgramRunStatus('failed', `Failed: ${runtimeError}`);
      appendLog(`BASIC RUN failed ${runtimeError}`);
      return { ok: false, errorLine: runtimeError };
    }

    setProgramRunStatus('ok', 'Run OK');
    appendLog('BASIC RUN ok');
    return { ok: true };
  } catch (error) {
    clearZ80RunTracking();
    if (isCancelled()) {
      setProgramRunStatus('idle', 'Stopped');
      appendLog('BASIC RUN stopped');
      return { ok: false, errorLine: 'STOPPED' };
    }
    const message = error instanceof Error ? error.message : 'unknown error';
    setProgramRunStatus('failed', `Failed: ${message}`);
    appendLog(`BASIC RUN exception ${message}`);
    return { ok: false, errorLine: message };
  } finally {
    setBasicRunInFlight(false);
  }
}

function setEditorMode(mode: EditorMode): void {
  currentEditorMode = mode;
  const basicSelected = mode === 'basic';
  editorTabBasic.setAttribute('aria-selected', basicSelected ? 'true' : 'false');
  editorTabAsm.setAttribute('aria-selected', basicSelected ? 'false' : 'true');
  basicEditorPanel.hidden = !basicSelected;
  asmEditorPanel.hidden = basicSelected;
}

function setAsmDumpText(text: string): void {
  asmDumpView.textContent = text;
}

function assembleAsmSource(source: string): { ok: boolean; errorLine?: string; dump: string } {
  const result = assemble(source, {
    filename: 'web-editor.asm'
  });

  if (!result.ok) {
    const diagnostics = result.diagnostics
      .map((diag) => `${diag.file}:${diag.line}:${diag.column}: ${diag.message}`)
      .join('\n');
    setAsmDumpText(diagnostics);
    setAsmRunStatus('failed', 'Assemble failed');
    asmBuildCache = undefined;
    appendLog('ASM assemble failed');
    return {
      ok: false,
      errorLine: result.diagnostics[0]?.message ?? 'ASSEMBLE FAILED',
      dump: diagnostics
    };
  }

  asmBuildCache = {
    source,
    binary: result.binary,
    origin: result.origin,
    entry: result.entry,
    dump: result.dump
  };
  setAsmDumpText(result.dump);
  setAsmRunStatus('ok', 'Assemble OK');
  appendLog(`ASM assemble ok (${result.binary.length} bytes)`);
  return { ok: true, dump: result.dump };
}

async function runAsmProgram(source: string): Promise<RunAsmProgramResult> {
  if (asmRunInFlight) {
    return { ok: false, errorLine: 'RUN ALREADY IN PROGRESS' };
  }

  setAsmRunInFlight(true);
  asmRunHasEnteredUserProgram = false;
  const runToken = ++asmRunToken;
  setAsmRunStatus('running', 'Running');
  appendLog('ASM RUN start');

  try {
    const buildResult: { ok: boolean; errorLine?: string } =
      !asmBuildCache || asmBuildCache.source !== source ? assembleAsmSource(source) : { ok: true };
    if (!buildResult.ok || !asmBuildCache) {
      return {
        ok: false,
        errorLine: buildResult.errorLine ?? 'ASSEMBLE FAILED'
      };
    }
    const build = asmBuildCache;
    setAsmRunStatus('running', 'Running');

    machine.reset(true);
    machine.loadProgram(build.binary, build.origin);
    const firmwareReturnAddress = machine.getFirmwareReturnAddress() & 0xffff;
    const returnSp = 0x7ffc;
    machine.write8(returnSp, firmwareReturnAddress & 0xff);
    machine.write8((returnSp + 1) & 0xffff, (firmwareReturnAddress >> 8) & 0xff);
    machine.setStackPointer(returnSp);
    machine.setProgramCounter(build.entry);
    machine.setRuntimePumpEnabled(false);
    machine.setExecutionDomain('user-program');
    machine.setImmediateInputToRuntimeEnabled(false);
    renderLcd();

    if (!running) {
      setRunningState(true);
    }
    await waitForAnimationFrame();
    if (asmRunToken !== runToken) {
      finishAsmRun('idle', 'Stopped', 'ASM RUN stopped');
      return { ok: false, errorLine: 'STOPPED' };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    finishAsmRun('failed', `Failed: ${message}`, `ASM RUN exception ${message}`);
    return { ok: false, errorLine: message };
  } finally {
    if (!asmRunInFlight) {
      if (machine.getExecutionDomain() !== 'firmware') {
        machine.setExecutionDomain('firmware');
      }
      machine.setRuntimePumpEnabled(true);
      machine.setImmediateInputToRuntimeEnabled(true);
    }
  }
}

function updateKanaToggleUi(): void {
  const enabled = machine.getKanaMode();
  kanaToggleButton.dataset.active = enabled ? '1' : '0';
  kanaToggleButton.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  kanaToggleButton.textContent = enabled ? 'かな ON' : 'かな OFF';
}

function setKanaMode(enabled: boolean, source: 'ui' | 'api'): void {
  const next = Boolean(enabled);
  if (machine.getKanaMode() === next) {
    updateKanaToggleUi();
    return;
  }
  machine.setKanaMode(next);
  updateKanaToggleUi();
  appendLog(`KANA ${next ? 'ON' : 'OFF'} (${source})`);
  updateDebugView();
}

function codeToAsciiLabel(code: number): string {
  if (code < 0x20 || code > 0x7e) {
    return '';
  }
  return String.fromCharCode(code);
}

function codeToKanaLabel(code: number): string {
  if (code < 0xa1 || code > 0xdf) {
    return '';
  }
  return String.fromCharCode(0xff61 + (code - 0xa1));
}

function updateFontMeta(code: number): void {
  const hexCode = `0x${code.toString(16).toUpperCase().padStart(2, '0')}`;
  const kana = codeToKanaLabel(code);
  const ascii = codeToAsciiLabel(code);
  const mode = hasGlyphForCode(code) ? 'defined' : 'fallback';
  if (kana.length > 0) {
    fontDebugMeta.textContent = `${hexCode} "${kana}" (${mode})`;
    return;
  }
  fontDebugMeta.textContent = ascii.length > 0 ? `${hexCode} "${ascii}" (${mode})` : `${hexCode} (${mode})`;
}

function drawFontAtlas(): void {
  fontCtx.clearRect(0, 0, fontDebugCanvas.width, fontDebugCanvas.height);

  for (let code = 0; code <= 0xff; code += 1) {
    const row = Math.floor(code / FONT_GRID_COLS);
    const col = code % FONT_GRID_COLS;

    const cellX = col * FONT_CELL_WIDTH;
    const cellY = row * FONT_CELL_HEIGHT;
    const originX = cellX + 4;
    const originY = cellY + 4;
    const glyph = getGlyphForCode(code);
    const isNativeGlyph = hasGlyphForCode(code);

    fontCtx.fillStyle = isNativeGlyph ? '#d8e8ca' : '#edd7d7';
    fontCtx.fillRect(cellX, cellY, FONT_CELL_WIDTH - 1, FONT_CELL_HEIGHT - 1);

    fontCtx.strokeStyle = code === selectedGlyphCode ? '#3b5f30' : '#8ea485';
    fontCtx.lineWidth = code === selectedGlyphCode ? 2 : 1;
    fontCtx.strokeRect(cellX + 0.5, cellY + 0.5, FONT_CELL_WIDTH - 2, FONT_CELL_HEIGHT - 2);

    fontCtx.fillStyle = '#1f3b2a';
    for (let y = 0; y < LCD_GLYPH_HEIGHT; y += 1) {
      const bits = glyph[y] ?? 0;
      for (let x = 0; x < LCD_GLYPH_WIDTH; x += 1) {
        if (((bits >> (LCD_GLYPH_WIDTH - 1 - x)) & 0x01) === 0) {
          continue;
        }
        fontCtx.fillRect(
          originX + x * FONT_GLYPH_SCALE,
          originY + y * FONT_GLYPH_SCALE,
          FONT_GLYPH_SCALE,
          FONT_GLYPH_SCALE
        );
      }
    }
  }
}

function drawKanaZoom(): void {
  fontKanaCtx.clearRect(0, 0, fontKanaCanvas.width, fontKanaCanvas.height);
  fontKanaCtx.font = '8px "IBM Plex Mono", monospace';
  fontKanaCtx.textBaseline = 'top';

  for (let code = KANA_START_CODE; code <= KANA_END_CODE; code += 1) {
    const offset = code - KANA_START_CODE;
    const row = Math.floor(offset / KANA_GRID_COLS);
    const col = offset % KANA_GRID_COLS;
    const cellX = col * KANA_CELL_WIDTH;
    const cellY = row * KANA_CELL_HEIGHT;

    const glyph = getGlyphForCode(code);
    const isNativeGlyph = hasGlyphForCode(code);
    const kana = codeToKanaLabel(code);

    fontKanaCtx.fillStyle = isNativeGlyph ? '#d8e8ca' : '#edd7d7';
    fontKanaCtx.fillRect(cellX, cellY, KANA_CELL_WIDTH - 1, KANA_CELL_HEIGHT - 1);

    fontKanaCtx.strokeStyle = code === selectedGlyphCode ? '#3b5f30' : '#8ea485';
    fontKanaCtx.lineWidth = code === selectedGlyphCode ? 2 : 1;
    fontKanaCtx.strokeRect(cellX + 0.5, cellY + 0.5, KANA_CELL_WIDTH - 2, KANA_CELL_HEIGHT - 2);

    const codeText = code.toString(16).toUpperCase().padStart(2, '0');
    fontKanaCtx.fillStyle = '#355536';
    fontKanaCtx.fillText(codeText, cellX + 2, cellY + 1);

    const glyphOriginX = cellX + 4;
    const glyphOriginY = cellY + 10;
    fontKanaCtx.fillStyle = '#1f3b2a';
    for (let y = 0; y < LCD_GLYPH_HEIGHT; y += 1) {
      const bits = glyph[y] ?? 0;
      for (let x = 0; x < LCD_GLYPH_WIDTH; x += 1) {
        if (((bits >> (LCD_GLYPH_WIDTH - 1 - x)) & 0x01) === 0) {
          continue;
        }
        fontKanaCtx.fillRect(
          glyphOriginX + x * KANA_GLYPH_SCALE,
          glyphOriginY + y * KANA_GLYPH_SCALE,
          KANA_GLYPH_SCALE,
          KANA_GLYPH_SCALE
        );
      }
    }

    if (kana.length > 0) {
      fontKanaCtx.fillStyle = '#244020';
      fontKanaCtx.fillText(kana, cellX + KANA_CELL_WIDTH - 10, cellY + 1);
    }
  }
}

function redrawFontDebug(): void {
  drawFontAtlas();
  drawKanaZoom();
}

function getGlyphCodeFromPointer(event: MouseEvent): number | undefined {
  const rect = fontDebugCanvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return undefined;
  }

  const x = (event.clientX - rect.left) * (fontDebugCanvas.width / rect.width);
  const y = (event.clientY - rect.top) * (fontDebugCanvas.height / rect.height);
  const col = Math.floor(x / FONT_CELL_WIDTH);
  const row = Math.floor(y / FONT_CELL_HEIGHT);
  if (col < 0 || col >= FONT_GRID_COLS || row < 0 || row >= FONT_GRID_ROWS) {
    return undefined;
  }
  return row * FONT_GRID_COLS + col;
}

function getKanaCodeFromPointer(event: MouseEvent): number | undefined {
  const rect = fontKanaCanvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return undefined;
  }

  const x = (event.clientX - rect.left) * (fontKanaCanvas.width / rect.width);
  const y = (event.clientY - rect.top) * (fontKanaCanvas.height / rect.height);
  const col = Math.floor(x / KANA_CELL_WIDTH);
  const row = Math.floor(y / KANA_CELL_HEIGHT);
  if (col < 0 || col >= KANA_GRID_COLS || row < 0 || row >= KANA_GRID_ROWS) {
    return undefined;
  }
  return KANA_START_CODE + row * KANA_GRID_COLS + col;
}

function setFontDebugVisible(next: boolean): void {
  fontDebugVisible = next;
  fontDebugPanel.hidden = !next;
  fontDebugToggleButton.dataset.active = next ? '1' : '0';
  fontDebugToggleButton.setAttribute('aria-expanded', next ? 'true' : 'false');
  if (next) {
    redrawFontDebug();
  }
}

function getCpuSummary(): string {
  const state = machine.getCpuState();
  const pc = `0x${state.registers.pc.toString(16).padStart(4, '0').toUpperCase()}`;
  return `pc=${pc} t=${state.tstates}`;
}

function setBootStatus(state: BootState, detail?: string): void {
  currentState = state;
  bootStatus.dataset.state = state.toLowerCase();
  bootStatus.textContent = detail ? `${state}: ${detail}` : state;
}

function renderLcd(): number {
  const frame = machine.getFrameBuffer();
  const revision = machine.getFrameRevision();
  if (revision === lastFrameRevision) {
    return cachedLitPixels;
  }

  let litPixels = 0;

  for (let i = 0; i < frame.length; i += 1) {
    const pixel = frame[i] === 1;
    if (pixel) {
      litPixels += 1;
    }
    const base = i * 4;
    lcdImage.data[base + 0] = pixel ? 31 : 185;
    lcdImage.data[base + 1] = pixel ? 59 : 210;
    lcdImage.data[base + 2] = pixel ? 42 : 160;
    lcdImage.data[base + 3] = 255;
  }

  offCtx.putImageData(lcdImage, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(offscreen, 0, 0, canvas.width, canvas.height);

  lastFrameRevision = revision;
  cachedLitPixels = litPixels;
  return litPixels;
}

function toHex8(value: number): string {
  return `0x${(value & 0xff).toString(16).padStart(2, '0').toUpperCase()}`;
}

function toHex16(value: number): string {
  return `0x${(value & 0xffff).toString(16).padStart(4, '0').toUpperCase()}`;
}

function formatCompactTicks(value: number): string {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 2
  }).format(value);
}

function formatFullTicks(value: number): string {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }
  return new Intl.NumberFormat('en-US').format(value);
}

function renderRegisterGrid(
  target: HTMLElement,
  items: ReadonlyArray<{
    name: string;
    value: string;
    title?: string;
  }>
): void {
  target.innerHTML = items
    .map(
      (item) =>
        `<div class="register-item"><span class="register-name">${item.name}</span><span class="register-value"${
          item.title ? ` title="${item.title}"` : ''
        }>${item.value}</span></div>`
    )
    .join('');
}

function renderBitGrid(target: HTMLElement, value: number, width: 8 | 16, prefix: 'A' | 'D'): void {
  const labels: string[] = [];
  for (let bit = width - 1; bit >= 0; bit -= 1) {
    const on = ((value >> bit) & 0x01) !== 0;
    labels.push(
      `<span class="bit-chip" data-on="${on ? '1' : '0'}" title="${prefix}${bit}:${on ? '1' : '0'}">${prefix}${bit}</span>`
    );
  }
  target.innerHTML = labels.join('');
}

function renderFlagBitGrid(target: HTMLElement, f: number): void {
  const labels: ReadonlyArray<{ label: 'S' | 'Z' | 'Y' | 'H' | 'X' | 'PV' | 'N' | 'C'; bit: number }> = [
    { label: 'S', bit: 7 },
    { label: 'Z', bit: 6 },
    { label: 'Y', bit: 5 },
    { label: 'H', bit: 4 },
    { label: 'X', bit: 3 },
    { label: 'PV', bit: 2 },
    { label: 'N', bit: 1 },
    { label: 'C', bit: 0 }
  ];
  target.innerHTML = labels
    .map(({ label, bit }) => {
      const on = ((f >> bit) & 0x01) !== 0;
      return `<span class="bit-chip" data-on="${on ? '1' : '0'}" title="${label}:${on ? '1' : '0'}">${label}</span>`;
    })
    .join('');
}

function renderPinGrid(target: HTMLElement, items: ReadonlyArray<{ name: string; high: boolean }>): void {
  target.innerHTML = items
    .map(
      (item) =>
        `<div class="pin-item"><span class="pin-name">${item.name}</span><span class="pin-state" data-high="${item.high ? '1' : '0'}">${item.high ? 'H' : 'L'}</span></div>`
    )
    .join('');
}

function updateDebugView(nowMs?: number): void {
  if (nowMs !== undefined && nowMs - lastMonitorRenderMs < 500) {
    return;
  }
  lastMonitorRenderMs = nowMs ?? performance.now();

  const state = machine.getCpuState();
  const pinsOut = machine.getCpuPinsOut();
  const pinsIn = machine.getCpuPinsIn();
  const regs = state.registers;
  const shadow = state.shadowRegisters;
  const af = ((regs.a & 0xff) << 8) | (regs.f & 0xff);
  const bc = ((regs.b & 0xff) << 8) | (regs.c & 0xff);
  const de = ((regs.d & 0xff) << 8) | (regs.e & 0xff);
  const hl = ((regs.h & 0xff) << 8) | (regs.l & 0xff);

  renderRegisterGrid(monitorRegisterMain, [
    { name: 'AF', value: toHex16(af) },
    { name: 'BC', value: toHex16(bc) },
    { name: 'DE', value: toHex16(de) },
    { name: 'HL', value: toHex16(hl) },
    { name: 'IX', value: toHex16(regs.ix) },
    { name: 'IY', value: toHex16(regs.iy) },
    { name: 'SP', value: toHex16(regs.sp) },
    { name: 'PC', value: toHex16(regs.pc) },
    { name: 'I', value: toHex8(regs.i) },
    { name: 'R', value: toHex8(regs.r) },
    { name: 'IFF1', value: state.iff1 ? '1' : '0' },
    { name: 'IFF2', value: state.iff2 ? '1' : '0' },
    { name: 'IM', value: `${state.im}` },
    { name: 'HALT', value: state.halted ? '1' : '0' },
    { name: 'T', value: formatCompactTicks(state.tstates), title: formatFullTicks(state.tstates) },
    { name: 'Q', value: `${state.queueDepth}` }
  ]);

  if (shadow) {
    const afp = ((shadow.a & 0xff) << 8) | (shadow.f & 0xff);
    const bcp = ((shadow.b & 0xff) << 8) | (shadow.c & 0xff);
    const dep = ((shadow.d & 0xff) << 8) | (shadow.e & 0xff);
    const hlp = ((shadow.h & 0xff) << 8) | (shadow.l & 0xff);
    renderRegisterGrid(monitorRegisterShadow, [
      { name: "AF'", value: toHex16(afp) },
      { name: "BC'", value: toHex16(bcp) },
      { name: "DE'", value: toHex16(dep) },
      { name: "HL'", value: toHex16(hlp) }
    ]);
  } else {
    renderRegisterGrid(monitorRegisterShadow, [
      { name: "AF'", value: 'N/A' },
      { name: "BC'", value: 'N/A' },
      { name: "DE'", value: 'N/A' },
      { name: "HL'", value: 'N/A' }
    ]);
  }

  const addressBus = pinsOut.addr & 0xffff;
  const isWriteCycle = Boolean(pinsOut.wr && (pinsOut.mreq || pinsOut.iorq) && pinsOut.dataOut !== null);
  const dataBus = isWriteCycle ? pinsOut.dataOut ?? 0xff : pinsIn.data;
  monitorAddressHex.textContent = toHex16(addressBus);
  monitorDataHex.textContent = toHex8(dataBus);
  monitorFlagsHex.textContent = toHex8(regs.f);
  renderBitGrid(monitorAddressBits, addressBus, 16, 'A');
  renderBitGrid(monitorDataBits, dataBus, 8, 'D');
  renderFlagBitGrid(monitorFlagsBits, regs.f);

  renderPinGrid(monitorPinGrid, [
    { name: 'M1', high: pinsOut.m1 },
    { name: 'MREQ*', high: pinsOut.mreq },
    { name: 'IORQ*', high: pinsOut.iorq },
    { name: 'RD*', high: pinsOut.rd },
    { name: 'WR*', high: pinsOut.wr },
    { name: 'RFSH*', high: pinsOut.rfsh },
    { name: 'HALT', high: pinsOut.halt },
    { name: 'BUSAK', high: pinsOut.busak },
    { name: 'WAIT', high: pinsIn.wait },
    { name: 'INT', high: pinsIn.int },
    { name: 'NMI', high: pinsIn.nmi },
    { name: 'BUSRQ', high: pinsIn.busrq },
    { name: 'RESET', high: pinsIn.reset }
  ]);

  monitorSummary.textContent = `${currentState} ${toHex16(regs.pc)} ${toHex8(dataBus)} ${
    isWriteCycle ? 'WRITE' : 'READ'
  } ${speedIndicator.textContent ?? '0.00x'}`;
}

function fail(state: 'FAILED' | 'STALLED', message: string, error?: unknown): void {
  running = false;
  runToggleButton.textContent = 'Run';

  const reason = error instanceof Error ? `${error.name}: ${error.message}` : message;
  setBootStatus(state, `${reason} (${getCpuSummary()})`);
  appendLog(`${state} ${reason}`);

  updateDebugView();
}

function resetSpeedWindow(): void {
  speedWindowElapsed = 0;
  speedWindowExecuted = 0;
}

function resetHealthWindow(): void {
  healthWindowElapsed = 0;
  lastHealthTStates = machine.getCpuState().tstates;
}

function boot(coldReset: boolean): boolean {
  setBootStatus('BOOTING', `strict=${strictMode ? 1 : 0}, backend=${machine.getExecutionBackend()}`);

  try {
    if (coldReset) {
      machine.reset(true);
      appendLog('RESET (cold)');
    }

    machine.setRuntimePumpEnabled(true);
    machine.setImmediateInputToRuntimeEnabled(true);
    machine.tick(260_000);

    const litPixels = renderLcd();
    lastLitPixels = litPixels;

    carryTStates = 0;
    resetSpeedWindow();
    resetHealthWindow();

    if (litPixels <= 0) {
      fail('STALLED', 'No lit pixels after boot');
      return false;
    }

    running = true;
    runToggleButton.textContent = 'Stop';
    setBootStatus('READY', `strict=${strictMode ? 1 : 0}, backend=${machine.getExecutionBackend()}, lit=${litPixels}`);
    appendLog(`BOOT READY strict=${strictMode ? 1 : 0} backend=${machine.getExecutionBackend()}`);
    updateDebugView();
    return true;
  } catch (error) {
    fail('FAILED', 'Boot exception', error);
    renderLcd();
    updateDebugView(performance.now());
    return false;
  }
}

function startAnimationLoop(): void {
  if (animationStarted) {
    return;
  }

  animationStarted = true;
  lastTimestamp = performance.now();
  requestAnimationFrame(frame);
}

function verifyHealth(elapsedMs: number, litPixels: number): void {
  healthWindowElapsed += elapsedMs;
  if (healthWindowElapsed < 250) {
    return;
  }

  healthWindowElapsed = 0;
  const cpuState = machine.getCpuState();
  const deltaTStates = cpuState.tstates - lastHealthTStates;
  lastHealthTStates = cpuState.tstates;

  if (!running) {
    lastLitPixels = litPixels;
    return;
  }

  // ASM 実行中は入力待ち・表示更新待ちの局面があるため、
  // STALLED 判定で強制停止させない。
  if (asmRunInFlight) {
    lastLitPixels = litPixels;
    return;
  }

  if (deltaTStates <= 0) {
    fail('STALLED', 'CPU t-state delta is zero');
    return;
  }

  // BASIC実行中は CLS と描画更新の間で一時的に無点灯になり得るため、
  // 「無点灯=フリーズ」判定は外す。
  // z80-firmware 経路では runtime.isProgramRunning() が実行状態を表さないため、
  // executionDomain=user-program も実行中として扱う。
  const basicProgramRunning = machine.isRuntimeProgramRunning() || machine.getExecutionDomain() === 'user-program';
  if (!basicProgramRunning && litPixels <= 0 && lastLitPixels <= 0) {
    fail('STALLED', 'LCD has no lit pixels');
    return;
  }

  if (currentState !== 'READY') {
    setBootStatus('READY', `strict=${strictMode ? 1 : 0}, backend=${machine.getExecutionBackend()}, lit=${litPixels}`);
  }

  lastLitPixels = litPixels;
}

function frame(now: number): void {
  const elapsedMs = Math.max(0, now - lastTimestamp);
  lastTimestamp = now;

  try {
    if (running && !z80RunPumpActive) {
      const target = (elapsedMs / 1000) * PCG815Machine.CLOCK_HZ;
      // 点滅観測を維持しつつ、BASIC実行速度が過度に落ちないよう
      // 1フレームあたり上限を 1/4 秒分に調整する。
      const bounded = Math.min(target, PCG815Machine.CLOCK_HZ / 4);
      const executable = Math.floor(carryTStates + bounded);
      carryTStates = carryTStates + bounded - executable;

      machine.tick(executable);
      speedWindowExecuted += executable;
    }

    speedWindowElapsed += elapsedMs;
    if (speedWindowElapsed >= 250) {
      const effectiveSpeed = speedWindowExecuted / ((speedWindowElapsed / 1000) * PCG815Machine.CLOCK_HZ);
      speedIndicator.textContent = `${effectiveSpeed.toFixed(2)}x`;
      resetSpeedWindow();
    }

    const litPixels = renderLcd();
    verifyHealth(elapsedMs, litPixels);
    syncZ80BasicRunStatus();
    syncAsmRunStatus();
    updateDebugView();
  } catch (error) {
    fail('FAILED', 'Frame exception', error);
  }

  requestAnimationFrame(frame);
}

function setRunningState(next: boolean): void {
  if (currentState === 'FAILED') {
    appendLog('RUN ignored: failed state');
    return;
  }

  running = next;
  runToggleButton.textContent = running ? 'Stop' : 'Run';

  if (running && currentState !== 'READY') {
    setBootStatus('READY', `strict=${strictMode ? 1 : 0}, backend=${machine.getExecutionBackend()}`);
  }
}

function syncZ80BasicRunStatus(): void {
  if (machine.getExecutionBackend() !== 'z80-firmware') {
    clearZ80RunTracking();
    return;
  }
  if (basicRunInFlight) {
    return;
  }
  if (basicRunStatus.dataset.state !== 'running') {
    clearZ80RunTracking();
    return;
  }
  if (!z80RunAwaitingCompletion) {
    return;
  }
  if (machine.getExecutionDomain() === 'user-program') {
    z80RunHasEnteredUserProgram = true;
    return;
  }
  if (!z80RunHasEnteredUserProgram) {
    return;
  }
  clearZ80RunTracking();
  setProgramRunStatus('ok', 'Run OK');
  appendLog('BASIC RUN ok');
}

function syncAsmRunStatus(): void {
  if (!asmRunInFlight) {
    asmRunHasEnteredUserProgram = false;
    return;
  }

  const domain = machine.getExecutionDomain();
  if (domain === 'user-program') {
    asmRunHasEnteredUserProgram = true;
    const cpu = machine.getCpuState();
    if (cpu.halted) {
      machine.setProgramCounter(machine.getFirmwareReturnAddress() & 0xffff);
      machine.setExecutionDomain('firmware');
    }
    return;
  }

  if (!asmRunHasEnteredUserProgram || domain !== 'firmware') {
    return;
  }

  finishAsmRun('ok', 'Run OK', 'ASM RUN ok');
}

function toggleRunState(): void {
  setRunningState(!running);
}

fontDebugToggleButton.addEventListener('click', () => {
  setFontDebugVisible(!fontDebugVisible);
});

fontDebugCanvas.addEventListener('mousemove', (event) => {
  const code = getGlyphCodeFromPointer(event);
  if (code === undefined) {
    return;
  }
  updateFontMeta(code);
});

fontDebugCanvas.addEventListener('click', (event) => {
  const code = getGlyphCodeFromPointer(event);
  if (code === undefined) {
    return;
  }
  selectedGlyphCode = code;
  updateFontMeta(code);
  redrawFontDebug();
});

fontKanaCanvas.addEventListener('mousemove', (event) => {
  const code = getKanaCodeFromPointer(event);
  if (code === undefined) {
    return;
  }
  updateFontMeta(code);
});

fontKanaCanvas.addEventListener('click', (event) => {
  const code = getKanaCodeFromPointer(event);
  if (code === undefined) {
    return;
  }
  selectedGlyphCode = code;
  updateFontMeta(code);
  redrawFontDebug();
});

runToggleButton.addEventListener('click', () => {
  toggleRunState();
});

editorTabBasic.addEventListener('click', () => {
  setEditorMode('basic');
});

editorTabAsm.addEventListener('click', () => {
  setEditorMode('asm');
});

basicRunButton.addEventListener('click', async () => {
  if (basicRunInFlight) {
    return;
  }
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  await runBasicProgram(basicEditor.value, { resetProgram: true });
});

basicStopButton.addEventListener('click', () => {
  basicRunToken += 1;
  clearZ80RunTracking();
  setBasicRunInFlight(false);
  machine.setRuntimePumpEnabled(true);
  machine.setExecutionDomain('firmware');
  setRunningState(false);
  setProgramRunStatus('idle', 'Stopped');
  appendLog('CPU STOP by editor');
});

basicNewButton.addEventListener('click', () => {
  injectBasicLine('NEW');
  setProgramRunStatus('idle', 'Program cleared');
  appendLog('BASIC NEW');
});

basicLoadSampleButton.addEventListener('click', () => {
  basicEditor.value = BASIC_SAMPLE;
  updateEditorLineNumbers(basicEditor, basicEditorLines);
  syncEditorScroll(basicEditor, basicEditorLines);
  setProgramRunStatus('idle', 'Sample loaded');
});

basicLoadGameButton.addEventListener('click', () => {
  basicEditor.value = BASIC_SAMPLE_GAME;
  updateEditorLineNumbers(basicEditor, basicEditorLines);
  syncEditorScroll(basicEditor, basicEditorLines);
  setProgramRunStatus('idle', 'Sample game loaded (v3)');
});

basicEditor.addEventListener('input', () => {
  updateEditorLineNumbers(basicEditor, basicEditorLines);
});

basicEditor.addEventListener('scroll', () => {
  syncEditorScroll(basicEditor, basicEditorLines);
});

asmAssembleButton.addEventListener('click', () => {
  if (asmRunInFlight) {
    return;
  }
  appendLog('ASM assemble click');
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  try {
    assembleAsmSource(asmEditor.value);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    setAsmRunStatus('failed', `Failed: ${message}`);
    appendLog(`ASM assemble exception ${message}`);
  }
});

asmRunButton.addEventListener('click', async () => {
  if (asmRunInFlight) {
    return;
  }
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  await runAsmProgram(asmEditor.value);
});

asmStopButton.addEventListener('click', () => {
  asmRunToken += 1;
  machine.setRuntimePumpEnabled(true);
  machine.setImmediateInputToRuntimeEnabled(true);
  machine.setExecutionDomain('firmware');
  setRunningState(false);
  setAsmRunInFlight(false);
  asmRunHasEnteredUserProgram = false;
  setAsmRunStatus('idle', 'Stopped');
  appendLog('CPU STOP by asm editor');
});

asmNewButton.addEventListener('click', () => {
  asmEditor.value = '';
  updateEditorLineNumbers(asmEditor, asmEditorLines);
  syncEditorScroll(asmEditor, asmEditorLines);
  asmBuildCache = undefined;
  setAsmDumpText('');
  setAsmRunStatus('idle', 'Program cleared');
});

asmLoadSampleButton.addEventListener('click', () => {
  asmEditor.value = ASM_SAMPLE;
  updateEditorLineNumbers(asmEditor, asmEditorLines);
  syncEditorScroll(asmEditor, asmEditorLines);
  asmBuildCache = undefined;
  setAsmDumpText('');
  setAsmRunStatus('idle', 'Sample loaded');
});

asmLoad3dSampleButton.addEventListener('click', () => {
  asmEditor.value = ASM_SAMPLE_3D;
  updateEditorLineNumbers(asmEditor, asmEditorLines);
  syncEditorScroll(asmEditor, asmEditorLines);
  asmBuildCache = undefined;
  setAsmDumpText('');
  setAsmRunStatus('idle', '3D sample loaded');
});

asmEditor.addEventListener('input', () => {
  asmBuildCache = undefined;
  updateEditorLineNumbers(asmEditor, asmEditorLines);
});

asmEditor.addEventListener('scroll', () => {
  syncEditorScroll(asmEditor, asmEditorLines);
});

stepButton.addEventListener('click', () => {
  try {
    machine.tick(64);
    const litPixels = renderLcd();
    verifyHealth(250, litPixels);
    updateDebugView();
  } catch (error) {
    fail('FAILED', 'Step exception', error);
  }
});

resetButton.addEventListener('click', () => {
  const booted = boot(true);
  if (booted) {
    startAnimationLoop();
  }
});

kanaToggleButton.addEventListener('click', () => {
  setKanaMode(!machine.getKanaMode(), 'ui');
});

window.addEventListener('keydown', (event) => {
  const resolvedCode = resolveKeyboardCode(event);
  if (!resolvedCode) {
    return;
  }
  const runningUserProgram =
    machine.getExecutionBackend() === 'z80-firmware' && machine.getExecutionDomain() === 'user-program';
  const firmwareIdlePrompt =
    machine.getExecutionBackend() === 'z80-firmware' &&
    machine.getExecutionDomain() === 'firmware' &&
    !machine.isRuntimeProgramRunning();
  if (isTextInputTarget(event.target)) {
    return;
  }

  event.preventDefault();
  if (event.repeat) {
    return;
  }

  const pendingTimer = pendingKeyRelease.get(resolvedCode);
  if (pendingTimer !== undefined) {
    window.clearTimeout(pendingTimer);
    pendingKeyRelease.delete(resolvedCode);
  }

  machine.setKeyState(resolvedCode, true);
  if (runningUserProgram && resolvedCode === 'Space') {
    machine.out8(0x11, 0x80);
    machine.out8(0x17, 0x80);
  }
  // キーマトリクスを読むポーリング系(BASICゲーム)向けに、
  // 押下直後の最小ステップを進めて検出取りこぼしを抑える。
  const keydownBoost =
    runningUserProgram && resolvedCode === 'Space'
      ? SPACE_KEYDOWN_POLL_BOOST_TSTATES
      : firmwareIdlePrompt
        ? 0
        : KEYDOWN_POLL_BOOST_TSTATES;
  machine.tick(keydownBoost);
  pressedCodes.add(resolvedCode);
  appendLog(`DOWN ${resolvedCode}`);
});

window.addEventListener('keyup', (event) => {
  const resolvedCode = resolveKeyboardCode(event);
  if (!resolvedCode) {
    return;
  }
  const runningUserProgram =
    machine.getExecutionBackend() === 'z80-firmware' && machine.getExecutionDomain() === 'user-program';
  const firmwareIdlePrompt =
    machine.getExecutionBackend() === 'z80-firmware' &&
    machine.getExecutionDomain() === 'firmware' &&
    !machine.isRuntimeProgramRunning();
  if (isTextInputTarget(event.target)) {
    return;
  }

  event.preventDefault();
  const pendingTimer = pendingKeyRelease.get(resolvedCode);
  if (pendingTimer !== undefined) {
    window.clearTimeout(pendingTimer);
  }
  const applyRelease = (): void => {
    if (runningUserProgram && resolvedCode === 'Space') {
      machine.out8(0x11, 0x80);
      machine.out8(0x17, 0x80);
    }
    machine.setKeyState(resolvedCode, false);
    // 離上エッジ依存の判定を取りこぼさないよう解放側でも短く進める。
    machine.tick(runningUserProgram && resolvedCode === 'Space' ? 4_000_000 : firmwareIdlePrompt ? 0 : 256);
    pressedCodes.delete(resolvedCode);
    pendingKeyRelease.delete(resolvedCode);
    appendLog(`UP   ${resolvedCode}`);
  };

  if (runningUserProgram) {
    const timerId = window.setTimeout(applyRelease, KEY_RELEASE_LATCH_MS);
    pendingKeyRelease.set(resolvedCode, timerId);
    return;
  }

  applyRelease();
});

window.addEventListener('blur', () => {
  for (const timerId of pendingKeyRelease.values()) {
    window.clearTimeout(timerId);
  }
  pendingKeyRelease.clear();
  for (const code of pressedCodes) {
    machine.setKeyState(code, false);
  }
  pressedCodes.clear();
});

const booted = boot(false);
if (booted) {
  startAnimationLoop();
}

updateKanaToggleUi();
redrawFontDebug();
updateFontMeta(selectedGlyphCode);
setProgramRunStatus('idle', 'Idle');
setAsmRunStatus('idle', 'Idle');
basicEditor.value = BASIC_SAMPLE;
asmEditor.value = ASM_SAMPLE;
setAsmDumpText('');
updateEditorLineNumbers(basicEditor, basicEditorLines);
updateEditorLineNumbers(asmEditor, asmEditorLines);
syncEditorScroll(basicEditor, basicEditorLines);
syncEditorScroll(asmEditor, asmEditorLines);
setEditorMode('basic');

window.__pcg815 = {
  injectBasicLine,
  runBasicProgram,
  readDisplayText: () => decodeMachineText(machine),
  getBootState: () => currentState,
  getExecutionBackend: () => machine.getExecutionBackend(),
  setKanaMode: (enabled: boolean) => {
    setKanaMode(Boolean(enabled), 'api');
  },
  getKanaMode: () => machine.getKanaMode(),
  drainAsciiFifo: () => machine.drainAsciiQueue(),
  getCompatRouteStats: () => ({ ...compatRouteStats }),
  getFirmwareRouteStats: () => ({
    ...firmwareRouteStats,
    ...machine.getFirmwareIoStats()
  }),
  getBasicEngineStatus: () => machine.getBasicEngineStatus(),
  getCpuPinsOut: () => machine.getCpuPinsOut(),
  getCpuPinsIn: () => machine.getCpuPinsIn(),
  tapKey: (code: string) => {
    const pressTicks = code === 'Space' ? 220_000 : 3_000_000;
    const releaseTicks = code === 'Space' ? 260_000 : 600_000;
    machine.setImmediateInputToRuntimeEnabled(false);
    machine.setRuntimePumpEnabled(false);
    // Space のみ行7(0x80)を事前選択して短押しでも取りこぼしにくくする。
    if (code === 'Space') {
      machine.out8(0x11, 0x80);
      machine.out8(0x17, 0x80);
    }
    machine.setKeyState(code, true);
    machine.tick(pressTicks);
    machine.setKeyState(code, false);
    machine.tick(releaseTicks);
    machine.setRuntimePumpEnabled(true);
    machine.setImmediateInputToRuntimeEnabled(true);
  },
  assembleAsm: (source: string) => {
    return assembleAsmSource(source);
  },
  runAsm: async (source: string) => {
    return runAsmProgram(source);
  },
  getAsmDump: () => asmDumpView.textContent ?? ''
};
