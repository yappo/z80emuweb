import { KEY_MAP, KEY_MAP_BY_CODE, LCD_HEIGHT, LCD_WIDTH, PCG815Machine } from '@z80emu/machine-pcg815';

import './styles.css';

type BootState = 'BOOTING' | 'READY' | 'FAILED' | 'STALLED';

declare global {
  interface Window {
    __pcg815?: {
      injectBasicLine: (line: string) => void;
      getTextLines: () => string[];
      getBootState: () => BootState;
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
const speedIndicator = document.querySelector<HTMLElement>('#speed-indicator');
const bootStatus = document.querySelector<HTMLElement>('#boot-status');
const debugView = document.querySelector<HTMLElement>('#debug-view');
const logView = document.querySelector<HTMLElement>('#log-view');
const keyMapList = document.querySelector<HTMLElement>('#keymap-list');

if (
  !canvas ||
  !runToggleButton ||
  !stepButton ||
  !resetButton ||
  !speedIndicator ||
  !bootStatus ||
  !debugView ||
  !logView ||
  !keyMapList
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

canvas.width = LCD_WIDTH * SCALE;
canvas.height = LCD_HEIGHT * SCALE;
context.imageSmoothingEnabled = false;

let running = false;
let animationStarted = false;
let currentState: BootState = 'BOOTING';

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
  getBootState: () => currentState
};
