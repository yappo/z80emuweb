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

declare global {
  interface Window {
    __pcg815?: {
      injectBasicLine: (line: string) => void;
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

  if (litPixels <= 0 && lastLitPixels <= 0) {
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

function toggleRunState(): void {
  if (currentState === 'FAILED') {
    appendLog('RUN ignored: failed state');
    return;
  }

  running = !running;
  runToggleButton.textContent = running ? 'Stop' : 'Run';

  if (running && currentState !== 'READY') {
    setBootStatus('READY', `strict=${strictMode ? 1 : 0}`);
  }
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
  if (!KEY_MAP_BY_CODE.has(event.code)) {
    return;
  }

  event.preventDefault();
  if (event.repeat) {
    return;
  }

  machine.setKeyState(event.code, true);
  pressedCodes.add(event.code);
  appendLog(`DOWN ${event.code}`);
});

window.addEventListener('keyup', (event) => {
  if (!KEY_MAP_BY_CODE.has(event.code)) {
    return;
  }

  event.preventDefault();
  machine.setKeyState(event.code, false);
  pressedCodes.delete(event.code);
  appendLog(`UP   ${event.code}`);
});

window.addEventListener('blur', () => {
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

window.__pcg815 = {
  injectBasicLine: (line: string) => {
    for (const ch of line) {
      machine.out8(0x1c, ch.charCodeAt(0) & 0xff);
    }
    machine.out8(0x1c, 0x0d);
    machine.tick(40_000);
    renderLcd();
  },
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
