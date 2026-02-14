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

import './styles.css';

type BootState = 'BOOTING' | 'READY' | 'FAILED' | 'STALLED';
type ProgramRunStatus = 'idle' | 'running' | 'ok' | 'failed';

interface RunBasicProgramOptions {
  resetProgram?: boolean;
}

interface RunBasicProgramResult {
  ok: boolean;
  errorLine?: string;
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
const basicEditor = document.querySelector<HTMLTextAreaElement>('#basic-editor');
const basicEditorLines = document.querySelector<HTMLElement>('#basic-editor-lines');
const basicRunStatus = document.querySelector<HTMLElement>('#basic-run-status');
const basicRunButton = document.querySelector<HTMLButtonElement>('#basic-run');
const basicStopButton = document.querySelector<HTMLButtonElement>('#basic-stop');
const basicNewButton = document.querySelector<HTMLButtonElement>('#basic-new');
const basicLoadSampleButton = document.querySelector<HTMLButtonElement>('#basic-load-sample');
const basicLoadGameButton = document.querySelector<HTMLButtonElement>('#basic-load-game');
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
  !basicEditor ||
  !basicEditorLines ||
  !basicRunStatus ||
  !basicRunButton ||
  !basicStopButton ||
  !basicNewButton ||
  !basicLoadSampleButton ||
  !basicLoadGameButton ||
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
const BASIC_SAMPLE_GAME = `90 REM SAMPLE_GAME_V2
100 CLS
110 PRINT "MAZE 4X4 KEY+GOAL"
120 LET SE=INP(18)+INP(17)+PEEK(0)
130 IF SE<>0 THEN 150
140 LET SE=37
150 GOSUB 2000
160 LET X=1
170 LET Y=1
180 LET K=0
190 LET T=0
200 GOSUB 3000
210 WAIT 16
220 LET DX=0
230 LET DY=0
240 GOSUB 900
250 IF M=1 THEN 300
260 IF M=2 THEN 320
270 IF M=3 THEN 340
280 IF M=4 THEN 360
290 GOTO 200
300 LET DX=-1
310 GOTO 380
320 LET DX=1
330 GOTO 380
340 LET DY=-1
350 GOTO 380
360 LET DY=1
380 LET NX=X+DX
390 LET NY=Y+DY
400 IF NX<1 THEN 200
410 IF NX>4 THEN 200
420 IF NY<1 THEN 200
430 IF NY>4 THEN 200
440 IF NX<>W1X THEN 460
450 IF NY=W1Y THEN 200
460 IF NX<>W2X THEN 480
470 IF NY=W2Y THEN 200
480 IF NX<>W3X THEN 500
490 IF NY=W3Y THEN 200
500 LET X=NX
510 LET Y=NY
520 LET T=T+1
530 IF X<>KX THEN 550
540 IF Y=KY THEN 560
550 GOTO 580
560 LET K=1
580 IF K=0 THEN 200
590 IF X<>GX THEN 200
600 IF Y<>GY THEN 200
610 GOTO 5000
900 LET M=0
910 LET C=INP(18)
920 IF C=65 THEN 1260
930 IF C=97 THEN 1260
940 IF C=68 THEN 1280
950 IF C=100 THEN 1280
960 IF C=87 THEN 1300
970 IF C=119 THEN 1300
980 IF C=83 THEN 1320
990 IF C=115 THEN 1320
1000 OUT 16,0
1010 LET R=INP(17)
1020 IF R=254 THEN 1260
1030 IF R=247 THEN 1280
1040 OUT 16,2
1050 LET R=INP(17)
1060 IF R=191 THEN 1300
1070 IF R=251 THEN 1320
1080 OUT 16,7
1090 LET R=INP(17)
1100 IF R=127 THEN 1260
1110 IF R=223 THEN 1300
1120 IF R=191 THEN 1320
1130 OUT 16,6
1140 LET R=INP(17)
1150 IF R=254 THEN 1280
1160 RETURN
1260 LET M=1
1270 RETURN
1280 LET M=2
1290 RETURN
1300 LET M=3
1310 RETURN
1320 LET M=4
1330 RETURN
2000 GOSUB 2600
2010 LET P=R
2020 IF P=1 THEN 2100
2030 IF P=2 THEN 2230
2040 GOTO 2360
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
2600 LET SE=SE*17+29
2610 IF SE<997 THEN 2640
2620 LET SE=SE-997
2630 GOTO 2610
2640 LET R=SE
2650 IF R<4 THEN 2680
2660 LET R=R-3
2670 GOTO 2650
2680 RETURN
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
3410 IF AY=GY THEN 3510
3430 IF K<>0 THEN 3460
3440 IF AX<>KX THEN 3460
3450 IF AY=KY THEN 3520
3460 IF AX<>X THEN 3490
3470 IF AY=Y THEN 3530
3490 GOTO 3540
3500 LET CH=35
3505 GOTO 3540
3510 LET CH=71
3515 GOTO 3540
3520 LET CH=75
3525 GOTO 3540
3530 LET CH=64
3540 LET CX=AX-1
3550 LET CY=AY-1
3560 LOCATE CX,CY
3570 OUT 90,CH
3580 RETURN
5000 CLS
5010 PRINT "CLEAR!"
5020 PRINT "STEP",T
5030 END`;
let programRunInFlight = false;
let programRunToken = 0;

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

function updateEditorLineNumbers(): void {
  const lineCount = basicEditor.value.split('\n').length;
  const lines = Array.from({ length: Math.max(1, lineCount) }, (_, idx) => String(idx + 1));
  basicEditorLines.textContent = lines.join('\n');
}

function syncEditorScroll(): void {
  basicEditorLines.scrollTop = basicEditor.scrollTop;
}

function setProgramRunStatus(state: ProgramRunStatus, detail: string): void {
  basicRunStatus.dataset.state = state;
  basicRunStatus.textContent = detail;
}

function setProgramRunInFlight(inFlight: boolean): void {
  programRunInFlight = inFlight;
  basicRunButton.disabled = inFlight;
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
  if (programRunInFlight) {
    return { ok: false, errorLine: 'RUN ALREADY IN PROGRESS' };
  }

  setProgramRunInFlight(true);
  const runToken = ++programRunToken;
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
      if (programRunToken !== runToken) {
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
    setProgramRunInFlight(false);
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

basicRunButton.addEventListener('click', async () => {
  if (programRunInFlight) {
    return;
  }
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  await runBasicProgram(basicEditor.value, { resetProgram: true });
});

basicStopButton.addEventListener('click', () => {
  programRunToken += 1;
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
  updateEditorLineNumbers();
  syncEditorScroll();
  setProgramRunStatus('idle', 'Sample loaded');
});

basicLoadGameButton.addEventListener('click', () => {
  basicEditor.value = BASIC_SAMPLE_GAME;
  updateEditorLineNumbers();
  syncEditorScroll();
  setProgramRunStatus('idle', 'Sample game loaded (v2)');
});

basicEditor.addEventListener('input', () => {
  updateEditorLineNumbers();
});

basicEditor.addEventListener('scroll', () => {
  syncEditorScroll();
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
basicEditor.value = BASIC_SAMPLE;
updateEditorLineNumbers();
syncEditorScroll();

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
  }
};
