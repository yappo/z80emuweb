import {
  getGlyphForCode,
  hasGlyphForCode,
  KEY_MAP,
  KEY_MAP_BY_CODE,
  LCD_GLYPH_HEIGHT,
  LCD_GLYPH_WIDTH,
  LCD_HEIGHT,
  LCD_WIDTH,
  PCG815Machine
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

declare global {
  interface Window {
    __pcg815?: {
      injectBasicLine: (line: string) => void;
      runBasicProgram: (source: string, options?: RunBasicProgramOptions) => Promise<RunBasicProgramResult>;
      getTextLines: () => string[];
      getBootState: () => BootState;
      setKanaMode: (enabled: boolean) => void;
      getKanaMode: () => boolean;
      drainAsciiFifo: () => number[];
      tapKey: (code: string) => void;
      assembleAsm: (source: string) => { ok: boolean; errorLine?: string; dump: string };
      runAsm: (source: string) => Promise<RunAsmProgramResult>;
      getAsmDump: () => string;
    };
  }
}

const SCALE = 4;
const query = new URLSearchParams(window.location.search);
const debugMode = query.get('debug') === '1';
const strictMode = query.get('strict') === '1';

const machine = new PCG815Machine({ strictCpuOpcodes: strictMode });

const canvas = document.querySelector<HTMLCanvasElement>('#lcd');
const runToggleButton = document.querySelector<HTMLButtonElement>('#run-toggle');
const stepButton = document.querySelector<HTMLButtonElement>('#step');
const resetButton = document.querySelector<HTMLButtonElement>('#reset');
const kanaToggleButton = document.querySelector<HTMLButtonElement>('#kana-toggle');
const fontDebugToggleButton = document.querySelector<HTMLButtonElement>('#font-debug-toggle');
const speedIndicator = document.querySelector<HTMLElement>('#speed-indicator');
const bootStatus = document.querySelector<HTMLElement>('#boot-status');
const debugView = document.querySelector<HTMLElement>('#debug-view');
const logView = document.querySelector<HTMLElement>('#log-view');
const keyMapList = document.querySelector<HTMLElement>('#keymap-list');
const editorTabBasic = document.querySelector<HTMLButtonElement>('#editor-tab-basic');
const editorTabAsm = document.querySelector<HTMLButtonElement>('#editor-tab-asm');
const basicEditorPanel = document.querySelector<HTMLElement>('#basic-editor-panel');
const asmEditorPanel = document.querySelector<HTMLElement>('#asm-editor-panel');
const basicEditor = document.querySelector<HTMLTextAreaElement>('#basic-editor');
const basicEditorLines = document.querySelector<HTMLElement>('#basic-editor-lines');
const basicRunStatus = document.querySelector<HTMLElement>('#basic-run-status');
const basicRunButton = document.querySelector<HTMLButtonElement>('#basic-run');
const basicStopButton = document.querySelector<HTMLButtonElement>('#basic-stop');
const basicNewButton = document.querySelector<HTMLButtonElement>('#basic-new');
const basicLoadSampleButton = document.querySelector<HTMLButtonElement>('#basic-load-sample');
const basicLoadGameButton = document.querySelector<HTMLButtonElement>('#basic-load-game');
const asmEditor = document.querySelector<HTMLTextAreaElement>('#asm-editor');
const asmEditorLines = document.querySelector<HTMLElement>('#asm-editor-lines');
const asmRunStatus = document.querySelector<HTMLElement>('#asm-run-status');
const asmAssembleButton = document.querySelector<HTMLButtonElement>('#asm-assemble');
const asmRunButton = document.querySelector<HTMLButtonElement>('#asm-run');
const asmStopButton = document.querySelector<HTMLButtonElement>('#asm-stop');
const asmNewButton = document.querySelector<HTMLButtonElement>('#asm-new');
const asmLoadSampleButton = document.querySelector<HTMLButtonElement>('#asm-load-sample');
const asmDumpView = document.querySelector<HTMLElement>('#asm-dump-view');
const fontDebugPanel = document.querySelector<HTMLElement>('#font-debug-panel');
const fontDebugMeta = document.querySelector<HTMLElement>('#font-debug-meta');
const fontDebugCanvas = document.querySelector<HTMLCanvasElement>('#font-debug-canvas');
const fontKanaCanvas = document.querySelector<HTMLCanvasElement>('#font-kana-canvas');

if (
  !canvas ||
  !runToggleButton ||
  !stepButton ||
  !resetButton ||
  !kanaToggleButton ||
  !fontDebugToggleButton ||
  !speedIndicator ||
  !bootStatus ||
  !debugView ||
  !logView ||
  !keyMapList ||
  !editorTabBasic ||
  !editorTabAsm ||
  !basicEditorPanel ||
  !asmEditorPanel ||
  !basicEditor ||
  !basicEditorLines ||
  !basicRunStatus ||
  !basicRunButton ||
  !basicStopButton ||
  !basicNewButton ||
  !basicLoadSampleButton ||
  !basicLoadGameButton ||
  !asmEditor ||
  !asmEditorLines ||
  !asmRunStatus ||
  !asmAssembleButton ||
  !asmRunButton ||
  !asmStopButton ||
  !asmNewButton ||
  !asmLoadSampleButton ||
  !asmDumpView ||
  !fontDebugPanel ||
  !fontDebugMeta ||
  !fontDebugCanvas ||
  !fontKanaCanvas
) {
  throw new Error('UI initialization failed: missing required element');
}

const context = canvas.getContext('2d');
if (!context) {
  throw new Error('Canvas2D is not available');
}

const offscreen = document.createElement('canvas');
offscreen.width = LCD_WIDTH;
offscreen.height = LCD_HEIGHT;
const offCtx = offscreen.getContext('2d');
if (!offCtx) {
  throw new Error('Offscreen canvas creation failed');
}
const lcdImage = offCtx.createImageData(LCD_WIDTH, LCD_HEIGHT);

const fontCtx = fontDebugCanvas.getContext('2d');
if (!fontCtx) {
  throw new Error('Font debug canvas creation failed');
}
const fontKanaCtx = fontKanaCanvas.getContext('2d');
if (!fontKanaCtx) {
  throw new Error('Kana zoom canvas creation failed');
}

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

const inputLog: string[] = [];
const pressedCodes = new Set<string>();
const pendingKeyRelease = new Map<string, number>();
const KEY_RELEASE_LATCH_MS = 280;
const BASIC_SAMPLE = `10 A = 1
20 PRINT A
30 A = A + 1
40 WAIT 64
50 IF A > 10 THEN 70
60 GOTO 20
70 PRINT "owari"
80 END`;
const BASIC_SAMPLE_GAME = `90 REM SAMPLE_GAME_V3
100 LET S=0
110 LET N=1
115 GOSUB 9500
120 IF N>5 THEN 9000
130 GOSUB 7000
140 LET SE=INP(18)+INP(17)+PEEK(0)+N
150 IF SE<>0 THEN 170
160 LET SE=37+N
170 GOSUB 2000
180 LET X=1
190 LET Y=1
200 LET K=0
210 LET T=0
215 LET PH=0
216 LET PC=0
220 GOSUB 3000
230 WAIT 3
240 LET DX=0
250 LET DY=0
260 GOSUB 900
270 IF M=1 THEN 320
280 IF M=2 THEN 340
290 IF M=3 THEN 360
300 IF M=4 THEN 380
310 GOTO 220
320 LET DX=-1
330 GOTO 400
340 LET DX=1
350 GOTO 400
360 LET DY=-1
370 GOTO 400
380 LET DY=1
400 LET NX=X+DX
410 LET NY=Y+DY
420 IF NX<1 THEN 220
430 IF NX>4 THEN 220
440 IF NY<1 THEN 220
450 IF NY>4 THEN 220
460 IF NX<>W1X THEN 480
470 IF NY=W1Y THEN 220
480 IF NX<>W2X THEN 500
490 IF NY=W2Y THEN 220
500 IF NX<>W3X THEN 520
510 IF NY=W3Y THEN 220
520 LET X=NX
530 LET Y=NY
540 LET T=T+1
550 IF X<>KX THEN 570
560 IF Y=KY THEN 580
570 GOTO 600
580 LET K=1
600 IF K=0 THEN 220
610 IF X<>GX THEN 220
620 IF Y<>GY THEN 220
630 LET ADD=100-T
640 IF ADD<10 THEN 660
650 GOTO 670
660 LET ADD=10
670 LET S=S+ADD
680 LET N=N+1
690 GOTO 120
900 LET M=0
910 GOSUB 1600
920 IF D=0 THEN 1010
930 IF PH=0 THEN 950
940 RETURN
950 LET PH=1
960 LET PC=D
970 RETURN
1010 IF PH=0 THEN 1070
1020 LET PH=0
1030 IF PC=0 THEN 1070
1040 LET M=PC
1050 LET PC=0
1060 RETURN
1070 RETURN
1600 LET D=0
1610 OUT 16,0
1620 LET R=INP(17)
1630 IF R=254 THEN 1810
1640 IF R=247 THEN 1830
1650 OUT 16,2
1660 LET R=INP(17)
1670 IF R=191 THEN 1850
1680 IF R=251 THEN 1870
1690 OUT 16,7
1700 LET R=INP(17)
1710 IF R=127 THEN 1810
1720 IF R=223 THEN 1850
1730 IF R=191 THEN 1870
1740 OUT 16,6
1750 LET R=INP(17)
1760 IF R=254 THEN 1830
1770 RETURN
1810 LET D=1
1820 RETURN
1830 LET D=2
1840 RETURN
1850 LET D=3
1860 RETURN
1870 LET D=4
1880 RETURN
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
3000 CLS
3010 FOR J=1 TO 4
3020 FOR I=1 TO 4
3030 LET AX=I
3040 LET AY=J
3050 GOSUB 3300
3060 NEXT I
3070 NEXT J
3080 RETURN
3300 LET CH=46
3310 IF AX<>W1X THEN 3340
3320 IF AY=W1Y THEN 3500
3340 IF AX<>W2X THEN 3370
3350 IF AY=W2Y THEN 3500
3370 IF AX<>W3X THEN 3400
3380 IF AY=W3Y THEN 3500
3400 IF AX<>GX THEN 3430
3410 IF AY=GY THEN 3520
3430 IF K<>0 THEN 3460
3440 IF AX<>KX THEN 3460
3450 IF AY=KY THEN 3540
3460 IF AX<>X THEN 3490
3470 IF AY=Y THEN 3560
3490 GOTO 3590
3500 LET CH=35
3510 GOTO 3590
3520 LET CH=71
3530 GOTO 3590
3540 LET CH=75
3550 GOTO 3590
3560 LET CH=64
3590 LET CX=AX-1
3600 LET CY=AY-1
3610 LOCATE CX,CY
3620 OUT 90,CH
3630 RETURN
7000 CLS
7010 LOCATE 0,0
7020 PRINT "    Stage:";N;"/5"
7030 LOCATE 0,1
7040 PRINT "Score:";S
7050 LOCATE 0,2
7060 PRINT " "
7070 LET SPH=0
7080 LET SPC=0
7090 LET BL=1
7100 LET CT=0
7110 GOSUB 7600
7120 GOSUB 7400
7130 IF SP=1 THEN 7310
7140 LET CT=CT+1
7150 IF CT<16 THEN 7270
7160 LET CT=0
7170 IF BL=0 THEN 7210
7180 LET BL=0
7190 GOSUB 7800
7200 GOTO 7270
7210 LET BL=1
7220 GOSUB 7600
7270 WAIT 3
7280 GOTO 7120
7310 RETURN
7400 LET SP=0
7410 LET Q=0
7420 OUT 16,7
7430 LET R=INP(17)
7440 IF R=239 THEN 7460
7450 GOTO 7480
7460 LET Q=1
7480 IF Q=0 THEN 7540
7490 IF SPH=0 THEN 7510
7500 RETURN
7510 LET SPH=1
7520 LET SPC=1
7530 RETURN
7540 IF SPH=0 THEN 7590
7550 LET SPH=0
7560 IF SPC=0 THEN 7590
7570 LET SP=1
7580 LET SPC=0
7590 RETURN
7600 LOCATE 4,3
7610 OUT 90,80
7620 OUT 90,85
7630 OUT 90,83
7640 OUT 90,72
7650 OUT 90,32
7660 OUT 90,83
7670 OUT 90,80
7680 OUT 90,65
7690 OUT 90,67
7700 OUT 90,69
7710 OUT 90,32
7720 OUT 90,75
7730 OUT 90,69
7740 OUT 90,89
7750 OUT 90,32
7760 OUT 90,33
7770 RETURN
7800 LOCATE 4,3
7810 OUT 90,32
7820 OUT 90,32
7830 OUT 90,32
7840 OUT 90,32
7850 OUT 90,32
7860 OUT 90,32
7870 OUT 90,32
7880 OUT 90,32
7890 OUT 90,32
7900 OUT 90,32
7910 OUT 90,32
7920 OUT 90,32
7930 OUT 90,32
7940 OUT 90,32
7950 OUT 90,32
7960 OUT 90,32
7970 RETURN
9500 CLS
9510 LOCATE 0,0
9520 PRINT "     MASE 4X4 GAME !"
9530 LOCATE 0,1
9540 PRINT "&=YOU #=WALL Key Goal"
9550 LOCATE 0,2
9560 PRINT "USE: WASD OR ARROWS"
9570 LET SPH=0
9580 LET SPC=0
9590 LET BL=1
9600 LET CT=0
9610 GOSUB 7600
9620 GOSUB 7400
9630 IF SP=1 THEN 9810
9640 LET CT=CT+1
9650 IF CT<16 THEN 9760
9660 LET CT=0
9670 IF BL=0 THEN 9730
9680 LET BL=0
9690 GOSUB 7800
9700 GOTO 9760
9730 LET BL=1
9740 GOSUB 7600
9760 WAIT 3
9770 GOTO 9620
9810 RETURN
9000 CLS
9010 LOCATE 0,0
9020 PRINT "ALL STAGE CLEAR!"
9030 LOCATE 0,1
9040 PRINT "FINAL SCORE:";S
9050 LOCATE 0,2
9060 PRINT " "
9070 LET SPH=0
9080 LET SPC=0
9090 LET BL=1
9100 LET CT=0
9110 GOSUB 7600
9120 GOSUB 7400
9130 IF SP=1 THEN 9210
9140 LET CT=CT+1
9150 IF CT<16 THEN 9190
9160 LET CT=0
9170 IF BL=0 THEN 9240
9180 LET BL=0
9185 GOSUB 7800
9190 WAIT 3
9200 GOTO 9120
9210 END
9240 LET BL=1
9250 GOSUB 7600
9260 GOTO 9190`;
const ASM_SAMPLE = `ORG 0x0200
ENTRY START

START:
  LD HL,BUFFER
  LD B,16
  XOR A

SUM_LOOP:
  ADD A,(HL)
  INC HL
  DJNZ SUM_LOOP

  LD C,A
  LD A,'S'
  OUT (0x1C),A
  LD A,'U'
  OUT (0x1C),A
  LD A,'M'
  OUT (0x1C),A
  LD A,':'
  OUT (0x1C),A
  LD A,' '
  OUT (0x1C),A
  LD A,C
  OUT (0x1C),A
  HALT

BUFFER:
  DB 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16`;
let basicRunInFlight = false;
let basicRunToken = 0;
let asmRunInFlight = false;
let asmRunToken = 0;
let asmBuildCache: AsmBuildCache | undefined;
let currentEditorMode: EditorMode = 'basic';

function waitForAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

if (debugMode) {
  debugView.hidden = false;
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
  if (key === 'ArrowUp') {
    return 'ArrowUp';
  }
  if (key === 'ArrowDown') {
    return 'ArrowDown';
  }
  if (key === 'ArrowLeft') {
    return 'ArrowLeft';
  }
  if (key === 'ArrowRight') {
    return 'ArrowRight';
  }
  return undefined;
}

function injectBasicLine(line: string): void {
  for (const ch of line) {
    machine.out8(0x1c, ch.charCodeAt(0) & 0xff);
  }
  machine.out8(0x1c, 0x0d);
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
  setProgramRunStatus('running', 'Running');
  appendLog('BASIC RUN start');

  try {
    if (!running) {
      setRunningState(true);
    }

    const resetProgram = options.resetProgram !== false;
    const lines = normalizeProgramSource(source);

    if (resetProgram) {
      injectBasicLine('NEW');
    }
    for (const line of lines) {
      injectBasicLine(line);
    }
    injectBasicLine('RUN');

    const timeoutMs = 20_000;
    const start = performance.now();
    while (machine.isRuntimeProgramRunning()) {
      if (basicRunToken !== runToken) {
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

    const text = machine.getTextLines();
    const errorLine = text.find((line) => line.includes('ERR '));
    if (errorLine) {
      setProgramRunStatus('failed', `Failed: ${errorLine}`);
      appendLog(`BASIC RUN failed ${errorLine}`);
      return { ok: false, errorLine };
    }

    setProgramRunStatus('ok', 'Run OK');
    appendLog('BASIC RUN ok');
    return { ok: true };
  } catch (error) {
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
  const runToken = ++asmRunToken;
  setAsmRunStatus('running', 'Running');
  appendLog('ASM RUN start');

  try {
    const build = !asmBuildCache || asmBuildCache.source !== source ? assembleAsmSource(source) : { ok: true };
    if (!build.ok || !asmBuildCache) {
      return {
        ok: false,
        errorLine: build.errorLine ?? 'ASSEMBLE FAILED'
      };
    }

    machine.reset(true);
    machine.loadProgram(asmBuildCache.binary, asmBuildCache.origin);
    machine.setProgramCounter(asmBuildCache.entry);
    renderLcd();

    if (!running) {
      setRunningState(true);
    }

    const timeoutMs = 20_000;
    const start = performance.now();
    while (true) {
      if (asmRunToken !== runToken) {
        setAsmRunStatus('idle', 'Stopped');
        appendLog('ASM RUN stopped');
        return { ok: false, errorLine: 'STOPPED' };
      }
      const cpu = machine.getCpuState();
      if (cpu.halted) {
        break;
      }
      if (performance.now() - start > timeoutMs) {
        setAsmRunStatus('failed', 'Failed: RUN TIMEOUT');
        appendLog('ASM RUN timeout');
        return { ok: false, errorLine: 'RUN TIMEOUT' };
      }
      await waitForAnimationFrame();
    }

    setAsmRunStatus('ok', 'Run OK');
    appendLog('ASM RUN ok');
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    setAsmRunStatus('failed', `Failed: ${message}`);
    appendLog(`ASM RUN exception ${message}`);
    return { ok: false, errorLine: message };
  } finally {
    setAsmRunInFlight(false);
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
  const pc = `0x${state.registers.pc.toString(16).padStart(4, '0')}`;
  return `pc=${pc} t=${state.tstates}`;
}

function setBootStatus(state: BootState, detail?: string): void {
  currentState = state;
  bootStatus.dataset.state = state.toLowerCase();
  bootStatus.textContent = detail ? `${state}: ${detail}` : state;
}

function renderLcd(): number {
  const frame = machine.getFrameBuffer();
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

  return litPixels;
}

function updateDebugView(): void {
  if (!debugMode && currentState === 'READY') {
    return;
  }

  const state = machine.getCpuState();
  debugView.hidden = false;
  debugView.textContent = JSON.stringify(
    {
      bootState: currentState,
      strict: strictMode,
      pc: `0x${state.registers.pc.toString(16).padStart(4, '0')}`,
      sp: `0x${state.registers.sp.toString(16).padStart(4, '0')}`,
      a: `0x${state.registers.a.toString(16).padStart(2, '0')}`,
      f: `0x${state.registers.f.toString(16).padStart(2, '0')}`,
      tstates: state.tstates,
      halted: state.halted,
      queueDepth: state.queueDepth,
      kanaMode: machine.getKanaMode(),
      speed: speedIndicator.textContent
    },
    null,
    2
  );
}

function fail(state: 'FAILED' | 'STALLED', message: string, error?: unknown): void {
  running = false;
  runToggleButton.textContent = 'Run';

  const reason = error instanceof Error ? `${error.name}: ${error.message}` : message;
  setBootStatus(state, `${reason} (${getCpuSummary()})`);
  appendLog(`${state} ${reason}`);

  debugView.hidden = false;
  const cpu = machine.getCpuState();
  debugView.textContent = JSON.stringify(
    {
      state,
      message,
      reason,
      pc: `0x${cpu.registers.pc.toString(16).padStart(4, '0')}`,
      tstates: cpu.tstates,
      queueDepth: cpu.queueDepth,
      kanaMode: machine.getKanaMode(),
      strict: strictMode
    },
    null,
    2
  );
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
  setBootStatus('BOOTING', `strict=${strictMode ? 1 : 0}`);

  try {
    if (coldReset) {
      machine.reset(true);
      appendLog('RESET (cold)');
    }

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
    setBootStatus('READY', `strict=${strictMode ? 1 : 0}, lit=${litPixels}`);
    appendLog(`BOOT READY strict=${strictMode ? 1 : 0}`);
    updateDebugView();
    return true;
  } catch (error) {
    fail('FAILED', 'Boot exception', error);
    renderLcd();
    updateDebugView();
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

  if (deltaTStates <= 0) {
    fail('STALLED', 'CPU t-state delta is zero');
    return;
  }

  // BASIC実行中は CLS と描画更新の間で一時的に無点灯になり得るため、
  // 「無点灯=フリーズ」判定は外す。
  if (!machine.isRuntimeProgramRunning() && litPixels <= 0 && lastLitPixels <= 0) {
    fail('STALLED', 'LCD has no lit pixels');
    return;
  }

  if (currentState !== 'READY') {
    setBootStatus('READY', `strict=${strictMode ? 1 : 0}, lit=${litPixels}`);
  }

  lastLitPixels = litPixels;
}

function frame(now: number): void {
  const elapsedMs = Math.max(0, now - lastTimestamp);
  lastTimestamp = now;

  try {
    if (running) {
      const target = (elapsedMs / 1000) * PCG815Machine.CLOCK_HZ;
      const bounded = Math.min(target, PCG815Machine.CLOCK_HZ / 8);
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
    setBootStatus('READY', `strict=${strictMode ? 1 : 0}`);
  }
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
  setRunningState(false);
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
  pressedCodes.add(resolvedCode);
  appendLog(`DOWN ${resolvedCode}`);
});

window.addEventListener('keyup', (event) => {
  const resolvedCode = resolveKeyboardCode(event);
  if (!resolvedCode) {
    return;
  }
  if (isTextInputTarget(event.target)) {
    return;
  }

  event.preventDefault();
  const pendingTimer = pendingKeyRelease.get(resolvedCode);
  if (pendingTimer !== undefined) {
    window.clearTimeout(pendingTimer);
  }
  const timerId = window.setTimeout(() => {
    machine.setKeyState(resolvedCode, false);
    pressedCodes.delete(resolvedCode);
    pendingKeyRelease.delete(resolvedCode);
    appendLog(`UP   ${resolvedCode}`);
  }, KEY_RELEASE_LATCH_MS);
  pendingKeyRelease.set(resolvedCode, timerId);
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
  getTextLines: () => machine.getTextLines(),
  getBootState: () => currentState,
  setKanaMode: (enabled: boolean) => {
    setKanaMode(Boolean(enabled), 'api');
  },
  getKanaMode: () => machine.getKanaMode(),
  drainAsciiFifo: () => {
    const out: number[] = [];
    for (let i = 0; i < 64; i += 1) {
      const code = machine.in8(0x12);
      if (code === 0) {
        break;
      }
      out.push(code);
    }
    return out;
  },
  tapKey: (code: string) => {
    machine.setKeyState(code, true);
    machine.setKeyState(code, false);
  },
  assembleAsm: (source: string) => {
    return assembleAsmSource(source);
  },
  runAsm: async (source: string) => {
    return runAsmProgram(source);
  },
  getAsmDump: () => asmDumpView.textContent ?? ''
};
