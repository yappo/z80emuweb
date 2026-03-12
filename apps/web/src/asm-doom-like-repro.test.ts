import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { assemble } from '@z80emu/assembler-z80';
import { PCG815Machine } from '@z80emu/machine-pcg815';

const LCD_WIDTH = 144;
const LCD_HEIGHT = 32;
const LCD_HALF_WIDTH = LCD_WIDTH / 2;
const LCD_RAW_BYTES = 8 * 0x80;
const TEST_TICK_QUANTUM = 64;
const RECTS = [
  { left: 0, right: 143, top: 0, bottom: 31 },
  { left: 18, right: 125, top: 4, bottom: 27 },
  { left: 34, right: 109, top: 8, bottom: 23 },
  { left: 48, right: 95, top: 11, bottom: 20 },
  { left: 60, right: 83, top: 13, bottom: 18 }
] as const;
const TILE_X = [48, 54, 59, 64, 68] as const;
const TILE_X2 = [95, 89, 84, 79, 75] as const;

function runFor(machine: PCG815Machine, iterations: number): void {
  for (let i = 0; i < iterations; i += 1) {
    machine.tick(TEST_TICK_QUANTUM);
  }
}

function runUntilUserHalt(machine: PCG815Machine, options?: { maxSteps?: number; quantum?: number }): void {
  const maxSteps = options?.maxSteps ?? 200_000;
  const quantum = options?.quantum ?? TEST_TICK_QUANTUM;
  for (let i = 0; i < maxSteps; i += 1) {
    machine.tick(quantum);
    const cpu = machine.getCpuState();
    if (cpu.halted && machine.getExecutionDomain() === 'user-program') {
      return;
    }
  }
  throw new Error('ASM sample did not halt in user-program domain');
}

function litPixelCount(machine: PCG815Machine): number {
  const frame = machine.getFrameBuffer();
  let lit = 0;
  for (let i = 0; i < frame.length; i += 1) {
    lit += frame[i] ? 1 : 0;
  }
  return lit;
}

function extractAsmSample(source: string, name: string): string {
  const marker = `const ${name} = \``;
  const start = source.indexOf(marker);
  if (start < 0) {
    throw new Error(`${name} not found`);
  }
  const from = start + marker.length;
  const end = source.indexOf('`;', from);
  if (end < 0) {
    throw new Error(`${name} end not found`);
  }
  return source.slice(from, end);
}

function extractDbBlock(source: string, label: string): number[][] {
  const match = source.match(new RegExp(`${label}:\\n((?:\\s+DB [^\\n]+\\n)+)`));
  if (!match) {
    throw new Error(`${label} block not found`);
  }
  return match[1]!
    .trim()
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*DB\s+/, '')
        .split(',')
        .map((value) => Number.parseInt(value.trim(), 10))
    );
}

function extractStartState(source: string): { x: number; y: number; dir: 'north' | 'east' | 'south' | 'west' } {
  const match = source.match(
    /START:\n(?:.*\n)*?\s+LD A,(\d+)\n\s+LD \(POS_X\),A\n\s+LD A,(\d+)\n\s+LD \(POS_Y\),A\n\s+LD A,DIR_(NORTH|EAST|SOUTH|WEST)\n\s+LD \(DIR\),A/
  );
  if (!match) {
    throw new Error('start state not found');
  }
  const x = match[1]!;
  const y = match[2]!;
  const dir = match[3]!;
  return {
    x: Number.parseInt(x, 10),
    y: Number.parseInt(y, 10),
    dir: dir.toLowerCase() as 'north' | 'east' | 'south' | 'west'
  };
}

function isLit(frame: Uint8Array, x: number, y: number): boolean {
  if (x < 0 || x >= LCD_WIDTH || y < 0) {
    return false;
  }
  const index = y * LCD_WIDTH + x;
  if (index < 0 || index >= frame.length) {
    return false;
  }
  return frame[index] !== 0;
}

function hasLitNeighbor(frame: Uint8Array, x: number, y: number, offsets: ReadonlyArray<readonly [number, number]>): boolean {
  return offsets.some(([dx, dy]) => isLit(frame, x + dx, y + dy));
}

function countLitOnVertical(frame: Uint8Array, x: number, top: number, bottom: number): number {
  let lit = 0;
  for (let y = top; y <= bottom; y += 1) {
    lit += isLit(frame, x, y) ? 1 : 0;
  }
  return lit;
}

function seamEndpointsAreConnected(frame: Uint8Array, rectIndex: number, side: 'left' | 'right'): boolean {
  const rect = RECTS[rectIndex]!;
  const x = side === 'left' ? rect.left : rect.right;
  const topIncoming = sideIncomingOffsets(side, 'top');
  const bottomIncoming = sideIncomingOffsets(side, 'bottom');

  return (
    isLit(frame, x, rect.top) &&
    hasLitNeighbor(frame, x, rect.top, [[0, 1], [0, 2]]) &&
    hasLitNeighbor(frame, x, rect.top, topIncoming) &&
    isLit(frame, x, rect.bottom) &&
    hasLitNeighbor(frame, x, rect.bottom, [[0, -1], [0, -2]]) &&
    hasLitNeighbor(frame, x, rect.bottom, bottomIncoming)
  );
}

function verticalLineLooksConnected(frame: Uint8Array, x: number, top: number, bottom: number): boolean {
  return (
    countLitOnVertical(frame, x, top, bottom) >= bottom - top &&
    isLit(frame, x, top) &&
    isLit(frame, x, bottom) &&
    hasLitNeighbor(frame, x, top, [[-1, -1], [-1, 0], [1, -1], [1, 0], [0, 1]]) &&
    hasLitNeighbor(frame, x, bottom, [[-1, 1], [-1, 0], [1, 1], [1, 0], [0, -1]])
  );
}

function diagonalBandLooksContinuous(
  frame: Uint8Array,
  points: ReadonlyArray<readonly [number, number]>
): boolean {
  let litCount = 0;
  for (const [x, y] of points) {
    if (isLit(frame, x, y)) {
      litCount += 1;
    }
  }
  return litCount >= points.length - 1;
}

function sideIncomingOffsets(
  side: 'left' | 'right',
  end: 'top' | 'bottom'
): ReadonlyArray<readonly [number, number]> {
  if (side === 'left') {
    return end === 'top'
      ? ([[-1, -1], [-1, 0], [0, -1]] as const)
      : ([[-1, 1], [-1, 0], [0, 1]] as const);
  }
  return end === 'top'
    ? ([[1, -1], [1, 0], [0, -1]] as const)
    : ([[1, 1], [1, 0], [0, 1]] as const);
}

function looksLikeOuterSeam(frame: Uint8Array, rectIndex: number, side: 'left' | 'right'): boolean {
  const rect = RECTS[rectIndex]!;
  const x = side === 'left' ? rect.left : rect.right;
  const height = rect.bottom - rect.top + 1;
  const verticalLit = countLitOnVertical(frame, x, rect.top, rect.bottom);
  if (verticalLit < height - 1) {
    return false;
  }
  return (
    hasLitNeighbor(frame, x, rect.top, sideIncomingOffsets(side, 'top')) ||
    hasLitNeighbor(frame, x, rect.bottom, sideIncomingOffsets(side, 'bottom'))
  );
}

function sampleNeighborhood(frame: Uint8Array, x: number, y: number): string {
  const rows: string[] = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    let row = '';
    for (let dx = -1; dx <= 1; dx += 1) {
      row += isLit(frame, x + dx, y + dy) ? '#' : '.';
    }
    rows.push(row);
  }
  return rows.join('/');
}

function collectFrames(machine: PCG815Machine, samples: number, ticksPerSample: number): Uint8Array[] {
  const frames: Uint8Array[] = [];
  for (let i = 0; i < samples; i += 1) {
    runFor(machine, ticksPerSample);
    frames.push(Uint8Array.from(machine.getFrameBuffer()));
  }
  return frames;
}

function interiorRegionIsDark(frame: Uint8Array, xStart: number, xEnd: number, yStart: number, yEnd: number): boolean {
  for (let y = yStart; y <= yEnd; y += 1) {
    for (let x = xStart; x <= xEnd; x += 1) {
      if (isLit(frame, x, y)) {
        return false;
      }
    }
  }
  return true;
}

function withPinnedStart(asm: string, start: { x: number; y: number; dir: 'north' | 'east' | 'south' | 'west' }): string {
  return asm
    .replace('MOVE_INTERVAL EQU 3', 'MOVE_INTERVAL EQU 255')
    .replace('  JP MAIN_LOOP', '  HALT')
    .replace(
      /LD A,\d+\n  LD \(POS_X\),A\n  LD A,\d+\n  LD \(POS_Y\),A\n  LD A,DIR_(NORTH|EAST|SOUTH|WEST)\n  LD \(DIR\),A/,
      `LD A,${start.x}\n  LD (POS_X),A\n  LD A,${start.y}\n  LD (POS_Y),A\n  LD A,DIR_${start.dir.toUpperCase()}\n  LD (DIR),A`
    );
}

function withFrozenAutoplay(asm: string): string {
  return asm
    .replace('MOVE_INTERVAL EQU 3', 'MOVE_INTERVAL EQU 255')
    .replace('  JP MAIN_LOOP', '  HALT');
}

function withAutoplayFrameStop(asm: string, frameCount: number): string {
  return asm.replace(
    '  LD A,(FRAME_TICK)\n  INC A\n  LD (FRAME_TICK),A\n  JP MAIN_LOOP',
    `  LD A,(FRAME_TICK)\n  INC A\n  LD (FRAME_TICK),A\n  CP ${frameCount}\n  JR Z,AUTOPLAY_TEST_HALT\n  JP MAIN_LOOP\nAUTOPLAY_TEST_HALT:\n  HALT`
  );
}

function symbolAddress(assembled: ReturnType<typeof assemble>, name: string): number {
  const symbol = assembled.symbols.find((entry) => entry.name === name);
  if (!symbol) {
    throw new Error(`symbol not found: ${name}`);
  }
  return symbol.value & 0xffff;
}

function withForcedScene(asm: string, scene: SceneSpec): string {
  const body = [
    'FORCE_TEST_SCENE:',
    `  LD A,${scene.frontHit ? 1 : 0}`,
    '  LD (SCENE_FRONT_HIT),A',
    `  LD A,${scene.frontDepth}`,
    '  LD (SCENE_FRONT_DEPTH),A',
    ...scene.leftOpens.flatMap((value, index) => [`  LD A,${value}`, `  LD (SCENE_LEFT_OPEN+${index}),A`]),
    ...scene.rightOpens.flatMap((value, index) => [`  LD A,${value}`, `  LD (SCENE_RIGHT_OPEN+${index}),A`]),
    ...scene.leftBranchLens.flatMap((value, index) => [`  LD A,${value}`, `  LD (SCENE_LEFT_LEN+${index}),A`]),
    ...scene.rightBranchLens.flatMap((value, index) => [`  LD A,${value}`, `  LD (SCENE_RIGHT_LEN+${index}),A`]),
    '  RET'
  ].join('\n');

  return asm
    .replace('MOVE_INTERVAL EQU 3', 'MOVE_INTERVAL EQU 255')
    .replace('  CALL BUILD_SCENE', '  CALL FORCE_TEST_SCENE')
    .replace('  JP MAIN_LOOP', '  HALT')
    .concat(`\n${body}\n`);
}

type SceneSpec = {
  frontHit: boolean;
  frontDepth: number;
  leftOpens: readonly number[];
  rightOpens: readonly number[];
  leftBranchLens: readonly number[];
  rightBranchLens: readonly number[];
};

function makeSceneSpec(input: {
  frontHit: boolean;
  frontDepth: number;
  leftOpenDepth?: number | null;
  rightOpenDepth?: number | null;
  leftBranchLen?: number;
  rightBranchLen?: number;
}): SceneSpec {
  const leftOpens = [0, 0, 0, 0];
  const rightOpens = [0, 0, 0, 0];
  const leftBranchLens = [0, 0, 0, 0];
  const rightBranchLens = [0, 0, 0, 0];

  if (input.leftOpenDepth !== undefined && input.leftOpenDepth !== null) {
    leftOpens[input.leftOpenDepth - 1] = 1;
    leftBranchLens[input.leftOpenDepth - 1] = input.leftBranchLen ?? 1;
  }
  if (input.rightOpenDepth !== undefined && input.rightOpenDepth !== null) {
    rightOpens[input.rightOpenDepth - 1] = 1;
    rightBranchLens[input.rightOpenDepth - 1] = input.rightBranchLen ?? 1;
  }

  return {
    frontHit: input.frontHit,
    frontDepth: input.frontDepth,
    leftOpens,
    rightOpens,
    leftBranchLens,
    rightBranchLens
  };
}

const MOVE_INTERVAL = 3;
const MAX_DEPTH = 4;
const FWD = {
  north: [0, -1],
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0]
} as const;
const LEFT_OF = {
  north: 'west',
  west: 'south',
  south: 'east',
  east: 'north'
} as const;
const RIGHT_OF = {
  north: 'east',
  east: 'south',
  south: 'west',
  west: 'north'
} as const;
const BACK_OF = {
  north: 'south',
  east: 'west',
  south: 'north',
  west: 'east'
} as const;

function isWall(maze: number[][], x: number, y: number): boolean {
  return maze[y]?.[x] !== 0;
}

function measureSideLen(
  maze: number[][],
  x: number,
  y: number,
  dir: 'north' | 'east' | 'south' | 'west'
): number {
  const [dx, dy] = FWD[dir];
  let len = 0;
  let cx = x;
  let cy = y;
  while (len < MAX_DEPTH) {
    cx += dx;
    cy += dy;
    if (isWall(maze, cx, cy)) {
      break;
    }
    len += 1;
  }
  return len;
}

function computeSceneFromMaze(
  maze: number[][],
  start: { x: number; y: number; dir: 'north' | 'east' | 'south' | 'west' }
): SceneSpec {
  const leftOpens = [0, 0, 0, 0];
  const rightOpens = [0, 0, 0, 0];
  const leftBranchLens = [0, 0, 0, 0];
  const rightBranchLens = [0, 0, 0, 0];
  let tempX = start.x;
  let tempY = start.y;

  for (let depth = 1; depth <= MAX_DEPTH; depth += 1) {
    const [fx, fy] = FWD[start.dir];
    tempX += fx;
    tempY += fy;
    if (isWall(maze, tempX, tempY)) {
      return {
        frontHit: true,
        frontDepth: depth,
        leftOpens,
        rightOpens,
        leftBranchLens,
        rightBranchLens
      };
    }

    const leftDir = LEFT_OF[start.dir];
    const [lx, ly] = FWD[leftDir];
    if (!isWall(maze, tempX + lx, tempY + ly)) {
      leftOpens[depth - 1] = 1;
      leftBranchLens[depth - 1] = measureSideLen(maze, tempX, tempY, leftDir);
    }

    const rightDir = RIGHT_OF[start.dir];
    const [rx, ry] = FWD[rightDir];
    if (!isWall(maze, tempX + rx, tempY + ry)) {
      rightOpens[depth - 1] = 1;
      rightBranchLens[depth - 1] = measureSideLen(maze, tempX, tempY, rightDir);
    }
  }

  return {
    frontHit: false,
    frontDepth: MAX_DEPTH,
    leftOpens,
    rightOpens,
    leftBranchLens,
    rightBranchLens
  };
}

function simulateAutoplaySteps(
  maze: number[][],
  start: { x: number; y: number; dir: 'north' | 'east' | 'south' | 'west' },
  moveCount: number
): { x: number; y: number; dir: 'north' | 'east' | 'south' | 'west' } {
  let x = start.x;
  let y = start.y;
  let dir = start.dir;

  const canMove = (nextDir: 'north' | 'east' | 'south' | 'west'): boolean => {
    const [dx, dy] = FWD[nextDir];
    return !isWall(maze, x + dx, y + dy);
  };

  const moveForward = (): void => {
    const [dx, dy] = FWD[dir];
    if (!isWall(maze, x + dx, y + dy)) {
      x += dx;
      y += dy;
    }
  };

  for (let i = 0; i < moveCount; i += 1) {
    const leftDir = LEFT_OF[dir];
    if (canMove(leftDir)) {
      dir = leftDir;
      moveForward();
      continue;
    }
    if (canMove(dir)) {
      moveForward();
      continue;
    }
    const rightDir = RIGHT_OF[dir];
    if (canMove(rightDir)) {
      dir = rightDir;
      moveForward();
      continue;
    }
    dir = BACK_OF[dir];
    moveForward();
  }

  return { x, y, dir };
}

function mapScreenPixelToRaw(x: number, y: number): { rawX: number; rawPage: number; bit: number } | null {
  if (x < 0 || x >= LCD_WIDTH || y < 0 || y >= LCD_HEIGHT) {
    return null;
  }
  const rawPage = y >> 3;
  const bit = y & 0x07;
  if (x < LCD_HALF_WIDTH) {
    return { rawX: x & 0x7f, rawPage, bit };
  }
  return {
    rawX: (LCD_HALF_WIDTH - 1 - (x - LCD_HALF_WIDTH)) & 0x7f,
    rawPage: (rawPage + 4) & 0x07,
    bit
  };
}

function renderFrameFromRawVram(rawVram: Uint8Array, displayStartLine = 0): Uint8Array {
  const frame = new Uint8Array(LCD_WIDTH * LCD_HEIGHT);
  const verticalScroll = displayStartLine & 0x1f;
  for (let rawPage = 0; rawPage < 8; rawPage += 1) {
    const visibleBaseX = rawPage < 4 ? 0 : LCD_HALF_WIDTH;
    for (let rawX = 0; rawX < LCD_HALF_WIDTH; rawX += 1) {
      const visibleX = rawPage < 4 ? rawX : visibleBaseX + (LCD_HALF_WIDTH - 1 - rawX);
      const value = rawVram[rawPage * 0x80 + rawX] ?? 0;
      const sourceBaseY = (rawPage & 0x03) * 8;
      for (let bit = 0; bit < 8; bit += 1) {
        const sourceY = sourceBaseY + bit;
        const visibleY = (sourceY - verticalScroll + LCD_HEIGHT) % LCD_HEIGHT;
        frame[visibleY * LCD_WIDTH + visibleX] = (value >> bit) & 0x01;
      }
    }
  }
  return frame;
}

function getMachineRawVram(machine: PCG815Machine): Uint8Array {
  return Uint8Array.from(machine.createSnapshot().vram.text);
}

function setExpectedPixel(rawVram: Uint8Array, x: number, y: number): void {
  const mapped = mapScreenPixelToRaw(x, y);
  if (!mapped) {
    return;
  }
  const offset = mapped.rawPage * 0x80 + mapped.rawX;
  rawVram[offset] = (rawVram[offset] ?? 0) | (1 << mapped.bit);
}

function drawExpectedLine(rawVram: Uint8Array, x0: number, y0: number, x1: number, y1: number): void {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x1 >= x0 ? 1 : -1;
  const sy = y1 >= y0 ? 1 : -1;

  if (dy > dx) {
    let err = Math.floor(dy / 2);
    while (true) {
      setExpectedPixel(rawVram, x, y);
      if (y === y1) {
        return;
      }
      err -= dx;
      if (err < 0) {
        x += sx;
        err += dy;
      }
      y += sy;
    }
  }

  let err = Math.floor(dx / 2);
  while (true) {
    setExpectedPixel(rawVram, x, y);
    if (x === x1) {
      return;
    }
    err -= dy;
    if (err < 0) {
      y += sy;
      err += dx;
    }
    x += sx;
  }
}

function drawExpectedVertical(rawVram: Uint8Array, x: number, top: number, bottom: number): void {
  drawExpectedLine(rawVram, x, top, x, bottom);
}

function drawExpectedSeam(rawVram: Uint8Array, side: 'left' | 'right', rect: (typeof RECTS)[number]): void {
  const x = side === 'left' ? rect.left : rect.right;
  const joinX = side === 'left' ? x - 1 : x + 1;
  setExpectedPixel(rawVram, joinX, rect.top);
  setExpectedPixel(rawVram, joinX, rect.bottom);
  drawExpectedVertical(rawVram, x, rect.top, rect.bottom);
}

function drawExpectedHoriz(rawVram: Uint8Array, left: number, right: number, y: number): void {
  drawExpectedLine(rawVram, left, y, right, y);
}

function drawExpectedSideWall(
  rawVram: Uint8Array,
  side: 'left' | 'right',
  limitDepth: number,
  openDepths: readonly number[]
): void {
  for (let depth = 1; depth <= limitDepth; depth += 1) {
    if (depth > 1 && openDepths[depth - 2]) {
      continue;
    }
    const near = RECTS[depth - 1]!;
    const far = RECTS[depth]!;
    const nearX = side === 'left' ? near.left : near.right;
    const farX = side === 'left' ? far.left : far.right;
    drawExpectedLine(rawVram, nearX, near.top, farX, far.top);
    drawExpectedLine(rawVram, nearX, near.bottom, farX, far.bottom);
  }
  for (let depth = 1; depth <= limitDepth; depth += 1) {
    const rect = RECTS[depth]!;
    drawExpectedSeam(rawVram, side, rect);
  }
}

function drawExpectedBranch(rawVram: Uint8Array, side: 'left' | 'right', depth: number): void {
  const rect = RECTS[depth]!;
  const x = side === 'left' ? rect.left : rect.right;
  drawExpectedVertical(rawVram, x, rect.top, rect.bottom);
}

function drawExpectedBranchCorridor(
  rawVram: Uint8Array,
  side: 'left' | 'right',
  depth: number,
  branchLen: number
): void {
  if (branchLen <= 0) {
    return;
  }
  const outerIndex = Math.max(0, depth - branchLen);
  const inner = RECTS[depth]!;
  const outer = RECTS[outerIndex]!;
  const innerX = side === 'left' ? inner.left : inner.right;
  const outerX = side === 'left' ? outer.left : outer.right;
  drawExpectedLine(rawVram, innerX, inner.top, outerX, outer.top);
  drawExpectedLine(rawVram, innerX, inner.bottom, outerX, outer.bottom);
  if (outerIndex === 0) {
    return;
  }
  drawExpectedSeam(rawVram, side, outer);
}

function drawExpectedFrontWall(rawVram: Uint8Array, scene: SceneSpec): void {
  if (!scene.frontHit) {
    return;
  }
  const rect = RECTS[scene.frontDepth]!;
  const leftClipDepth = scene.leftOpens.findIndex((value, index) => value && index + 1 < scene.frontDepth);
  const rightClipDepth = scene.rightOpens.findIndex((value, index) => value && index + 1 < scene.frontDepth);
  const clipLeft = leftClipDepth >= 0 ? RECTS[leftClipDepth + 1]!.left : rect.left;
  const clipRight = rightClipDepth >= 0 ? RECTS[rightClipDepth + 1]!.right : rect.right;

  drawExpectedHoriz(rawVram, clipLeft, clipRight, rect.top);
  drawExpectedHoriz(rawVram, clipLeft, clipRight, rect.bottom);

  if (clipLeft === rect.left) {
    drawExpectedVertical(rawVram, rect.left, rect.top, rect.bottom);
  }
  if (clipRight === rect.right) {
    drawExpectedVertical(rawVram, rect.right, rect.top, rect.bottom);
  }

  const x1 = TILE_X[scene.frontDepth]!;
  const x2 = TILE_X2[scene.frontDepth]!;
  if (x1 > clipLeft && x1 < clipRight) {
    drawExpectedVertical(rawVram, x1, rect.top, rect.bottom);
  }
  if (x2 > clipLeft && x2 < clipRight) {
    drawExpectedVertical(rawVram, x2, rect.top, rect.bottom);
  }
}

function renderExpectedRawVram(scene: SceneSpec): Uint8Array {
  const rawVram = new Uint8Array(LCD_RAW_BYTES);
  const visibleDepth = scene.frontHit ? scene.frontDepth : 4;

  drawExpectedSideWall(rawVram, 'left', visibleDepth, scene.leftOpens);
  drawExpectedSideWall(rawVram, 'right', visibleDepth, scene.rightOpens);

  for (let depth = 1; depth <= visibleDepth; depth += 1) {
    if (scene.leftOpens[depth - 1]) {
      drawExpectedBranch(rawVram, 'left', depth);
      drawExpectedBranchCorridor(rawVram, 'left', depth, scene.leftBranchLens[depth - 1] ?? 0);
    }
    if (scene.rightOpens[depth - 1]) {
      drawExpectedBranch(rawVram, 'right', depth);
      drawExpectedBranchCorridor(rawVram, 'right', depth, scene.rightBranchLens[depth - 1] ?? 0);
    }
  }

  drawExpectedFrontWall(rawVram, scene);
  return rawVram;
}

function renderExpectedScene(scene: SceneSpec): Uint8Array {
  return renderFrameFromRawVram(renderExpectedRawVram(scene));
}

function diffFrames(actual: Uint8Array, expected: Uint8Array): string[] {
  const diffs: string[] = [];
  for (let y = 0; y < LCD_HEIGHT; y += 1) {
    for (let x = 0; x < LCD_WIDTH; x += 1) {
      const index = y * LCD_WIDTH + x;
      if (actual[index] !== expected[index]) {
        diffs.push(`(${x},${y}) actual=${actual[index]} expected=${expected[index]}`);
        if (diffs.length >= 20) {
          return diffs;
        }
      }
    }
  }
  return diffs;
}

function diffRawVram(actual: Uint8Array, expected: Uint8Array): string[] {
  const diffs: string[] = [];
  for (let offset = 0; offset < LCD_RAW_BYTES; offset += 1) {
    if (actual[offset] !== expected[offset]) {
      const page = Math.trunc(offset / 0x80);
      const rawX = offset % 0x80;
      diffs.push(`(page=${page},x=${rawX}) actual=0x${actual[offset]!.toString(16).padStart(2, '0')} expected=0x${expected[offset]!.toString(16).padStart(2, '0')}`);
      if (diffs.length >= 20) {
        return diffs;
      }
    }
  }
  return diffs;
}

describe('doom-like asm sample', () => {
  it('uses a 10x10 maze without cul-de-sacs and starts facing a traversable cell', () => {
    const mainTs = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const asm = extractAsmSample(mainTs, 'ASM_SAMPLE_3D');
    const maze = extractDbBlock(asm, 'MAZE_DATA');
    const start = extractStartState(asm);

    expect(maze).toHaveLength(10);
    for (const row of maze) {
      expect(row).toHaveLength(10);
    }

    const deltas = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ] as const;

    for (let y = 0; y < maze.length; y += 1) {
      for (let x = 0; x < maze[y]!.length; x += 1) {
        if (maze[y]![x] !== 0) {
          continue;
        }
        const degree = deltas.reduce((sum, [dx, dy]) => {
          const row = maze[y + dy];
          return sum + (row && row[x + dx] === 0 ? 1 : 0);
        }, 0);
        expect(degree).toBeGreaterThanOrEqual(2);
      }
    }

    expect(maze[start.y]![start.x]).toBe(0);

    const forward = {
      north: [0, -1],
      east: [1, 0],
      south: [0, 1],
      west: [-1, 0]
    } as const;
    const [dx, dy] = forward[start.dir];
    expect(maze[start.y + dy]![start.x + dx]).toBe(0);
  });

  it('assembles and animates the LCD frame buffer', { timeout: 40_000 }, () => {
    const mainTs = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const asm = extractAsmSample(mainTs, 'ASM_SAMPLE_3D');
    const assembled = assemble(asm, { filename: 'doom-like-demo.asm' });

    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;

    const machine = new PCG815Machine({ strictCpuOpcodes: true });
    machine.reset(true);
    machine.loadProgram(assembled.binary, assembled.origin);
    machine.setStackPointer(0x7ffc);
    machine.setProgramCounter(assembled.entry);
    machine.setExecutionDomain('user-program');

    runFor(machine, 24_000);
    const firstLit = litPixelCount(machine);
    const firstFrame = Uint8Array.from(machine.getFrameBuffer());

    runFor(machine, 440_000);
    const secondLit = litPixelCount(machine);

    expect(firstLit).toBeGreaterThan(40);
    expect(secondLit).toBeGreaterThan(40);
  });

  it('keeps visible wall seams connected in the virtual VRAM', { timeout: 40_000 }, () => {
    const mainTs = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const asm = extractAsmSample(mainTs, 'ASM_SAMPLE_3D');
    const assembled = assemble(asm, { filename: 'doom-like-demo.asm' });

    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;

    const machine = new PCG815Machine({ strictCpuOpcodes: true });
    machine.reset(true);
    machine.loadProgram(assembled.binary, assembled.origin);
    machine.setStackPointer(0x7ffc);
    machine.setProgramCounter(assembled.entry);
    machine.setExecutionDomain('user-program');

    const frames = collectFrames(machine, 8, 12_000);
    let visibleSeamCount = 0;
    const failures: string[] = [];

    for (const [frameIndex, frame] of frames.entries()) {
      for (let rectIndex = 2; rectIndex < RECTS.length; rectIndex += 1) {
        const rect = RECTS[rectIndex]!;
        for (const side of ['left', 'right'] as const) {
          const x = side === 'left' ? rect.left : rect.right;
          const verticalLit = countLitOnVertical(frame, x, rect.top, rect.bottom);
          if (!looksLikeOuterSeam(frame, rectIndex, side)) {
            continue;
          }
          visibleSeamCount += 1;
          if (!seamEndpointsAreConnected(frame, rectIndex, side)) {
            failures.push(
              `frame=${frameIndex} rect=${rectIndex} side=${side} vertical=${verticalLit} top=${sampleNeighborhood(frame, x, rect.top)} bottom=${sampleNeighborhood(frame, x, rect.bottom)}`
            );
          }
        }
      }
    }

    expect(visibleSeamCount).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  });

  it('does not draw front-wall pixels inside side-occluded regions', { timeout: 40_000 }, () => {
    const mainTs = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const asm = extractAsmSample(mainTs, 'ASM_SAMPLE_3D');
    const cases = [
      { x: 4, y: 1, dir: 'west' as const, hiddenLeft: [49, 59] as const },
      { x: 5, y: 1, dir: 'east' as const, hiddenRight: [84, 94] as const }
    ];

    for (const scenario of cases) {
      const pinnedAsm = withPinnedStart(asm, scenario);
      const assembled = assemble(pinnedAsm, { filename: `doom-like-occlusion-${scenario.dir}.asm` });
      expect(assembled.ok).toBe(true);
      if (!assembled.ok) {
        continue;
      }

      const machine = new PCG815Machine({ strictCpuOpcodes: true });
      machine.reset(true);
      machine.loadProgram(assembled.binary, assembled.origin);
      machine.setStackPointer(0x7ffc);
      machine.setProgramCounter(assembled.entry);
      machine.setExecutionDomain('user-program');

      runUntilUserHalt(machine);
      const frame = Uint8Array.from(machine.getFrameBuffer());
      const farRect = RECTS[4]!;

      if ('hiddenLeft' in scenario) {
        const hiddenLeft = scenario.hiddenLeft!;
        expect(interiorRegionIsDark(frame, hiddenLeft[0], hiddenLeft[1], farRect.top + 1, farRect.bottom - 1)).toBe(true);
      }
      if ('hiddenRight' in scenario) {
        const hiddenRight = scenario.hiddenRight!;
        expect(interiorRegionIsDark(frame, hiddenRight[0], hiddenRight[1], farRect.top + 1, farRect.bottom - 1)).toBe(true);
      }
    }
  });

  it('renders only the branch opening jamb, not hidden branch ceiling/floor lines', { timeout: 40_000 }, () => {
    const mainTs = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const asm = extractAsmSample(mainTs, 'ASM_SAMPLE_3D');
    const cases = [
      { x: 4, y: 1, dir: 'west' as const, side: 'left' as const, rectIndex: 3 },
      { x: 5, y: 1, dir: 'east' as const, side: 'right' as const, rectIndex: 3 }
    ];

    for (const scenario of cases) {
      const pinnedAsm = withPinnedStart(asm, scenario);
      const assembled = assemble(pinnedAsm, { filename: `doom-like-branch-${scenario.dir}.asm` });
      expect(assembled.ok).toBe(true);
      if (!assembled.ok) {
        continue;
      }

      const machine = new PCG815Machine({ strictCpuOpcodes: true });
      machine.reset(true);
      machine.loadProgram(assembled.binary, assembled.origin);
      machine.setStackPointer(0x7ffc);
      machine.setProgramCounter(assembled.entry);
      machine.setExecutionDomain('user-program');

      runUntilUserHalt(machine);
      const frame = Uint8Array.from(machine.getFrameBuffer());
      const rect = RECTS[scenario.rectIndex]!;

      if (scenario.side === 'left') {
        expect(isLit(frame, Math.max(0, rect.left - 8), rect.top)).toBe(false);
        expect(isLit(frame, Math.max(0, rect.left - 8), rect.bottom)).toBe(false);
        expect(isLit(frame, rect.left + 4, rect.top)).toBe(false);
        expect(isLit(frame, rect.left + 4, rect.bottom)).toBe(false);
        expect(verticalLineLooksConnected(frame, rect.left, rect.top, rect.bottom)).toBe(true);
      } else {
        expect(isLit(frame, Math.min(143, rect.right + 8), rect.top)).toBe(false);
        expect(isLit(frame, Math.min(143, rect.right + 8), rect.bottom)).toBe(false);
        expect(isLit(frame, rect.right - 4, rect.top)).toBe(false);
        expect(isLit(frame, rect.right - 4, rect.bottom)).toBe(false);
        expect(verticalLineLooksConnected(frame, rect.right, rect.top, rect.bottom)).toBe(true);
      }
    }
  });

  it('does not draw a branch back wall on the side with no opening', { timeout: 40_000 }, () => {
    const mainTs = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const asm = extractAsmSample(mainTs, 'ASM_SAMPLE_3D');
    const cases = [
      { x: 4, y: 1, dir: 'west' as const, blockedSideX: 143, rectIndex: 3 },
      { x: 5, y: 1, dir: 'east' as const, blockedSideX: 0, rectIndex: 3 }
    ];

    for (const scenario of cases) {
      const pinnedAsm = withPinnedStart(asm, scenario);
      const assembled = assemble(pinnedAsm, { filename: `doom-like-no-branch-${scenario.dir}.asm` });
      expect(assembled.ok).toBe(true);
      if (!assembled.ok) {
        continue;
      }

      const machine = new PCG815Machine({ strictCpuOpcodes: true });
      machine.reset(true);
      machine.loadProgram(assembled.binary, assembled.origin);
      machine.setStackPointer(0x7ffc);
      machine.setProgramCounter(assembled.entry);
      machine.setExecutionDomain('user-program');

      runUntilUserHalt(machine);
      const frame = Uint8Array.from(machine.getFrameBuffer());
      const rect = RECTS[scenario.rectIndex]!;

      expect(countLitOnVertical(frame, scenario.blockedSideX, rect.top, rect.bottom)).toBe(0);
    }
  });

  it('draws the branch opening jamb as a connected vertical line', { timeout: 40_000 }, () => {
    const mainTs = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const asm = extractAsmSample(mainTs, 'ASM_SAMPLE_3D');
    const cases = [
      { x: 4, y: 1, dir: 'west' as const, jambX: RECTS[3]!.left, rectIndex: 3 },
      { x: 5, y: 1, dir: 'east' as const, jambX: RECTS[3]!.right, rectIndex: 3 }
    ];

    for (const scenario of cases) {
      const pinnedAsm = withPinnedStart(asm, scenario);
      const assembled = assemble(pinnedAsm, { filename: `doom-like-jamb-${scenario.dir}.asm` });
      expect(assembled.ok).toBe(true);
      if (!assembled.ok) {
        continue;
      }

      const machine = new PCG815Machine({ strictCpuOpcodes: true });
      machine.reset(true);
      machine.loadProgram(assembled.binary, assembled.origin);
      machine.setStackPointer(0x7ffc);
      machine.setProgramCounter(assembled.entry);
      machine.setExecutionDomain('user-program');

      runUntilUserHalt(machine);
      const frame = Uint8Array.from(machine.getFrameBuffer());
      const rect = RECTS[scenario.rectIndex]!;

      expect(verticalLineLooksConnected(frame, scenario.jambX, rect.top, rect.bottom)).toBe(true);
    }
  });

  it('draws the first visible left-wall seam as a connected vertical line', { timeout: 40_000 }, () => {
    const mainTs = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const asm = extractAsmSample(mainTs, 'ASM_SAMPLE_3D');
    const pinnedAsm = withPinnedStart(asm, { x: 4, y: 1, dir: 'west' });
    const assembled = assemble(pinnedAsm, { filename: 'doom-like-left-seam.asm' });

    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;

    const machine = new PCG815Machine({ strictCpuOpcodes: true });
    machine.reset(true);
    machine.loadProgram(assembled.binary, assembled.origin);
    machine.setStackPointer(0x7ffc);
    machine.setProgramCounter(assembled.entry);
    machine.setExecutionDomain('user-program');

    runUntilUserHalt(machine);
    const frame = Uint8Array.from(machine.getFrameBuffer());
    const rect = RECTS[1]!;

    expect(verticalLineLooksConnected(frame, rect.left, rect.top, rect.bottom)).toBe(true);
  });

  it('keeps the far wall right edge connected when it is visible', { timeout: 40_000 }, () => {
    const mainTs = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const asm = extractAsmSample(mainTs, 'ASM_SAMPLE_3D');
    const pinnedAsm = withPinnedStart(asm, { x: 4, y: 1, dir: 'west' });
    const assembled = assemble(pinnedAsm, { filename: 'doom-like-far-right-edge.asm' });

    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;

    const machine = new PCG815Machine({ strictCpuOpcodes: true });
    machine.reset(true);
    machine.loadProgram(assembled.binary, assembled.origin);
    machine.setStackPointer(0x7ffc);
    machine.setProgramCounter(assembled.entry);
    machine.setExecutionDomain('user-program');

    runUntilUserHalt(machine);
    const frame = Uint8Array.from(machine.getFrameBuffer());
    const farRect = RECTS[4]!;

    expect(verticalLineLooksConnected(frame, farRect.right, farRect.top, farRect.bottom)).toBe(true);
  });

  it('keeps the corridor side walls continuous from near to far', { timeout: 40_000 }, () => {
    const mainTs = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const asm = extractAsmSample(mainTs, 'ASM_SAMPLE_3D');
    const pinnedAsm = withPinnedStart(asm, { x: 4, y: 1, dir: 'west' });
    const assembled = assemble(pinnedAsm, { filename: 'doom-like-side-walls.asm' });

    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;

    const machine = new PCG815Machine({ strictCpuOpcodes: true });
    machine.reset(true);
    machine.loadProgram(assembled.binary, assembled.origin);
    machine.setStackPointer(0x7ffc);
    machine.setProgramCounter(assembled.entry);
    machine.setExecutionDomain('user-program');

    runUntilUserHalt(machine);
    const frame = Uint8Array.from(machine.getFrameBuffer());
    const leftTop = [
      [0, 0],
      [18, 4],
      [34, 8],
      [48, 11],
      [60, 13]
    ] as const;
    const leftBottom = [
      [0, 31],
      [18, 27],
      [34, 23],
      [48, 20],
      [60, 18]
    ] as const;
    const rightTop = [
      [143, 0],
      [125, 4],
      [109, 8],
      [95, 11],
      [83, 13]
    ] as const;
    const rightBottom = [
      [143, 31],
      [125, 27],
      [109, 23],
      [95, 20],
      [83, 18]
    ] as const;

    expect(diagonalBandLooksContinuous(frame, leftTop)).toBe(true);
    expect(diagonalBandLooksContinuous(frame, leftBottom)).toBe(true);
    expect(diagonalBandLooksContinuous(frame, rightTop)).toBe(true);
    expect(diagonalBandLooksContinuous(frame, rightBottom)).toBe(true);
  });

  it('matches the full 144x32 VRAM for pinned corridor scenes', { timeout: 40_000 }, () => {
    const mainTs = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const asm = extractAsmSample(mainTs, 'ASM_SAMPLE_3D');
    const maze = extractDbBlock(asm, 'MAZE_DATA');
    const cases: Array<{
      start: { x: number; y: number; dir: 'north' | 'east' | 'south' | 'west' };
      name: string;
    }> = [
      {
        name: 'start-right-branch',
        start: { x: 2, y: 1, dir: 'east' }
      },
      {
        name: 'near-right-branch',
        start: { x: 3, y: 1, dir: 'east' }
      },
      {
        name: 'left-branch',
        start: { x: 4, y: 1, dir: 'west' }
      },
      {
        name: 'right-branch',
        start: { x: 5, y: 1, dir: 'east' }
      },
      {
        name: 'straight-dead-end',
        start: { x: 6, y: 1, dir: 'east' }
      }
    ];

    for (const scenario of cases) {
      const pinnedAsm = withPinnedStart(asm, scenario.start);
      const assembled = assemble(pinnedAsm, { filename: `${scenario.name}.asm` });
      expect(assembled.ok).toBe(true);
      if (!assembled.ok) {
        continue;
      }

      const machine = new PCG815Machine({ strictCpuOpcodes: true });
      machine.reset(true);
      machine.loadProgram(assembled.binary, assembled.origin);
      machine.setStackPointer(0x7ffc);
      machine.setProgramCounter(assembled.entry);
      machine.setExecutionDomain('user-program');

      runUntilUserHalt(machine);
      const actual = getMachineRawVram(machine);
      const expected = renderExpectedRawVram(computeSceneFromMaze(maze, scenario.start));
      expect(diffRawVram(actual, expected), scenario.name).toEqual([]);
    }
  });

  it('keeps the right wall visible one block beyond a right branch opening in full VRAM', { timeout: 40_000 }, () => {
    const mainTs = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const asm = extractAsmSample(mainTs, 'ASM_SAMPLE_3D');
    const start = { x: 5, y: 1, dir: 'east' as const };
    const expected = renderExpectedRawVram(computeSceneFromMaze(extractDbBlock(asm, 'MAZE_DATA'), start));

    const pinnedAsm = withPinnedStart(asm, start);
    const assembled = assemble(pinnedAsm, { filename: 'doom-like-right-branch-resume.asm' });

    expect(assembled.ok).toBe(true);
    if (!assembled.ok) {
      return;
    }

    const machine = new PCG815Machine({ strictCpuOpcodes: true });
    machine.reset(true);
    machine.loadProgram(assembled.binary, assembled.origin);
    machine.setStackPointer(0x7ffc);
    machine.setProgramCounter(assembled.entry);
    machine.setExecutionDomain('user-program');

    runUntilUserHalt(machine);
    const actual = getMachineRawVram(machine);
    const diffs = diffRawVram(actual, expected);

    expect(diffs).toEqual([]);
  });

  it('renders the start-near right branch as a visible branch corridor in full VRAM', { timeout: 40_000 }, () => {
    const mainTs = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const asm = extractAsmSample(mainTs, 'ASM_SAMPLE_3D');
    const start = { x: 2, y: 1, dir: 'east' as const };
    const expected = renderExpectedRawVram(computeSceneFromMaze(extractDbBlock(asm, 'MAZE_DATA'), start));

    const pinnedAsm = withPinnedStart(asm, start);
    const assembled = assemble(pinnedAsm, { filename: 'doom-like-start-right-branch.asm' });

    expect(assembled.ok).toBe(true);
    if (!assembled.ok) {
      return;
    }

    const machine = new PCG815Machine({ strictCpuOpcodes: true });
    machine.reset(true);
    machine.loadProgram(assembled.binary, assembled.origin);
    machine.setStackPointer(0x7ffc);
    machine.setProgramCounter(assembled.entry);
    machine.setExecutionDomain('user-program');

    runUntilUserHalt(machine);
    const actual = getMachineRawVram(machine);
    expect(diffRawVram(actual, expected)).toEqual([]);
  });

  it('renders the route-near right branch when the opening is one block ahead in full VRAM', { timeout: 40_000 }, () => {
    const mainTs = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const asm = extractAsmSample(mainTs, 'ASM_SAMPLE_3D');
    const start = { x: 3, y: 1, dir: 'east' as const };
    const expected = renderExpectedRawVram(computeSceneFromMaze(extractDbBlock(asm, 'MAZE_DATA'), start));

    const pinnedAsm = withPinnedStart(asm, start);
    const assembled = assemble(pinnedAsm, { filename: 'doom-like-near-right-branch.asm' });

    expect(assembled.ok).toBe(true);
    if (!assembled.ok) {
      return;
    }

    const machine = new PCG815Machine({ strictCpuOpcodes: true });
    machine.reset(true);
    machine.loadProgram(assembled.binary, assembled.origin);
    machine.setStackPointer(0x7ffc);
    machine.setProgramCounter(assembled.entry);
    machine.setExecutionDomain('user-program');

    runUntilUserHalt(machine);
    const actual = getMachineRawVram(machine);
    expect(diffRawVram(actual, expected)).toEqual([]);
  });

  it('matches the first three autoplay frames around the early right branch in full VRAM', { timeout: 40_000 }, () => {
    const mainTs = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const asm = extractAsmSample(mainTs, 'ASM_SAMPLE_3D');
    const maze = extractDbBlock(asm, 'MAZE_DATA');
    const start = extractStartState(asm);

    const expectedScenes = [0, 0, 1].map((moveCount) =>
      computeSceneFromMaze(maze, simulateAutoplaySteps(maze, start, moveCount))
    );

    expectedScenes.forEach((scene, index) => {
      const autoplayAsm = withAutoplayFrameStop(asm, index + 1);
      const assembled = assemble(autoplayAsm, { filename: `doom-like-autoplay-frame-${index + 1}.asm` });
      expect(assembled.ok).toBe(true);
      if (!assembled.ok) {
        return;
      }

      const machine = new PCG815Machine({ strictCpuOpcodes: true });
      machine.reset(true);
      machine.loadProgram(assembled.binary, assembled.origin);
      machine.setStackPointer(0x7ffc);
      machine.setProgramCounter(assembled.entry);
      machine.setExecutionDomain('user-program');

      runUntilUserHalt(machine);
      const actual = getMachineRawVram(machine);
      const expected = renderExpectedRawVram(scene);
      expect(diffRawVram(actual, expected), `autoplay-frame-${index + 1}`).toEqual([]);
    });
  });

  it('builds the maze-derived right-branch scene values in RAM', { timeout: 40_000 }, () => {
    const mainTs = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const asm = extractAsmSample(mainTs, 'ASM_SAMPLE_3D');
    const maze = extractDbBlock(asm, 'MAZE_DATA');
    const start = { x: 2, y: 1, dir: 'east' as const };
    const expected = computeSceneFromMaze(maze, start);

    const pinnedAsm = withPinnedStart(asm, start);
    const assembled = assemble(pinnedAsm, { filename: 'doom-like-scene-ram.asm' });
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) {
      return;
    }

    const machine = new PCG815Machine({ strictCpuOpcodes: true });
    machine.reset(true);
    machine.loadProgram(assembled.binary, assembled.origin);
    machine.setStackPointer(0x7ffc);
    machine.setProgramCounter(assembled.entry);
    machine.setExecutionDomain('user-program');
    runUntilUserHalt(machine);

    const rightOpenAddr = symbolAddress(assembled, 'SCENE_RIGHT_OPEN');
    const rightLenAddr = symbolAddress(assembled, 'SCENE_RIGHT_LEN');
    const actualOpens = [0, 1, 2, 3].map((offset) => machine.read8((rightOpenAddr + offset) & 0xffff) & 0xff);
    const actualLens = [0, 1, 2, 3].map((offset) => machine.read8((rightLenAddr + offset) & 0xffff) & 0xff);

    expect(actualOpens).toEqual([...expected.rightOpens]);
    expect(actualLens).toEqual([...expected.rightBranchLens]);
  });

  it('renders the start-near right branch back wall when the scene is forced explicitly', { timeout: 40_000 }, () => {
    const mainTs = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const asm = extractAsmSample(mainTs, 'ASM_SAMPLE_3D');
    const scene = makeSceneSpec({ frontHit: false, frontDepth: 4, rightOpenDepth: 2, rightBranchLen: 1 });
    const expected = renderExpectedRawVram(scene);

    const forcedAsm = withForcedScene(asm, scene);
    const assembled = assemble(forcedAsm, { filename: 'doom-like-forced-start-right-branch.asm' });

    expect(assembled.ok).toBe(true);
    if (!assembled.ok) {
      return;
    }

    const machine = new PCG815Machine({ strictCpuOpcodes: true });
    machine.reset(true);
    machine.loadProgram(assembled.binary, assembled.origin);
    machine.setStackPointer(0x7ffc);
    machine.setProgramCounter(assembled.entry);
    machine.setExecutionDomain('user-program');

    runFor(machine, 24_000);
    const actual = getMachineRawVram(machine);
    expect(diffRawVram(actual, expected)).toEqual([]);
  });

  it('matches the full 144x32 VRAM for forced T-junction and crossroad scenes', { timeout: 40_000 }, () => {
    const mainTs = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const asm = extractAsmSample(mainTs, 'ASM_SAMPLE_3D');
    const cases: Array<{ name: string; scene: SceneSpec }> = [
      {
        name: 'forced-left-t-junction',
        scene: makeSceneSpec({ frontHit: true, frontDepth: 4, leftOpenDepth: 2, leftBranchLen: 1 })
      },
      {
        name: 'forced-right-t-junction',
        scene: makeSceneSpec({ frontHit: true, frontDepth: 4, rightOpenDepth: 2, rightBranchLen: 1 })
      },
      {
        name: 'forced-crossroad',
        scene: {
          frontHit: false,
          frontDepth: 4,
          leftOpens: [0, 1, 0, 0],
          rightOpens: [0, 1, 0, 0],
          leftBranchLens: [0, 1, 0, 0],
          rightBranchLens: [0, 1, 0, 0]
        }
      }
    ];

    for (const scenario of cases) {
      const expected = renderExpectedRawVram(scenario.scene);
      const forcedAsm = withForcedScene(asm, scenario.scene);
      const assembled = assemble(forcedAsm, { filename: `${scenario.name}.asm` });

      expect(assembled.ok).toBe(true);
      if (!assembled.ok) {
        continue;
      }

      const machine = new PCG815Machine({ strictCpuOpcodes: true });
      machine.reset(true);
      machine.loadProgram(assembled.binary, assembled.origin);
      machine.setStackPointer(0x7ffc);
      machine.setProgramCounter(assembled.entry);
      machine.setExecutionDomain('user-program');

      runUntilUserHalt(machine);
      const actual = getMachineRawVram(machine);
      expect(diffRawVram(actual, expected), scenario.name).toEqual([]);
    }
  });

  it('renders the right branch next-block wall in full VRAM', { timeout: 40_000 }, () => {
    const mainTs = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const asm = extractAsmSample(mainTs, 'ASM_SAMPLE_3D');
    const start = { x: 5, y: 1, dir: 'east' as const };
    const expected = renderExpectedRawVram(computeSceneFromMaze(extractDbBlock(asm, 'MAZE_DATA'), start));

    const pinnedAsm = withPinnedStart(asm, start);
    const assembled = assemble(pinnedAsm, { filename: 'doom-like-right-branch-back-wall.asm' });

    expect(assembled.ok).toBe(true);
    if (!assembled.ok) {
      return;
    }

    const machine = new PCG815Machine({ strictCpuOpcodes: true });
    machine.reset(true);
    machine.loadProgram(assembled.binary, assembled.origin);
    machine.setStackPointer(0x7ffc);
    machine.setProgramCounter(assembled.entry);
    machine.setExecutionDomain('user-program');

    runUntilUserHalt(machine);
    const actual = getMachineRawVram(machine);
    expect(diffRawVram(actual, expected)).toEqual([]);
  });

  it('does not draw right-branch ceiling or floor lines inside the opening interior', { timeout: 40_000 }, () => {
    const mainTs = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const asm = extractAsmSample(mainTs, 'ASM_SAMPLE_3D');
    const start = { x: 5, y: 1, dir: 'east' as const };

    const pinnedAsm = withPinnedStart(asm, start);
    const assembled = assemble(pinnedAsm, { filename: 'doom-like-right-branch-no-inner-lines.asm' });

    expect(assembled.ok).toBe(true);
    if (!assembled.ok) {
      return;
    }

    const machine = new PCG815Machine({ strictCpuOpcodes: true });
    machine.reset(true);
    machine.loadProgram(assembled.binary, assembled.origin);
    machine.setStackPointer(0x7ffc);
    machine.setProgramCounter(assembled.entry);
    machine.setExecutionDomain('user-program');

    runUntilUserHalt(machine);
    const frame = Uint8Array.from(machine.getFrameBuffer());
    const opening = RECTS[3]!;

    expect(interiorRegionIsDark(frame, RECTS[4]!.right + 1, opening.right - 1, opening.top, opening.top + 1)).toBe(true);
    expect(interiorRegionIsDark(frame, RECTS[4]!.right + 1, opening.right - 1, opening.bottom - 1, opening.bottom)).toBe(true);
  });

  it('keeps the main corridor ceiling and floor lines immediately before a right branch', { timeout: 40_000 }, () => {
    const mainTs = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const asm = extractAsmSample(mainTs, 'ASM_SAMPLE_3D');
    const start = { x: 5, y: 1, dir: 'east' as const };
    const expected = renderExpectedRawVram(computeSceneFromMaze(extractDbBlock(asm, 'MAZE_DATA'), start));

    const pinnedAsm = withPinnedStart(asm, start);
    const assembled = assemble(pinnedAsm, { filename: 'doom-like-right-branch-main-corridor-lines.asm' });

    expect(assembled.ok).toBe(true);
    if (!assembled.ok) {
      return;
    }

    const machine = new PCG815Machine({ strictCpuOpcodes: true });
    machine.reset(true);
    machine.loadProgram(assembled.binary, assembled.origin);
    machine.setStackPointer(0x7ffc);
    machine.setProgramCounter(assembled.entry);
    machine.setExecutionDomain('user-program');

    runUntilUserHalt(machine);
    const actualRaw = getMachineRawVram(machine);
    expect(diffRawVram(actualRaw, expected)).toEqual([]);
    const actualFrame = renderFrameFromRawVram(actualRaw);
    expect(diagonalBandLooksContinuous(actualFrame, [
      [109, 8],
      [95, 11]
    ])).toBe(true);
    expect(diagonalBandLooksContinuous(actualFrame, [
      [109, 23],
      [95, 20]
    ])).toBe(true);
  });
});
