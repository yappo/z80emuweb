import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { assemble } from '@z80emu/assembler-z80';
import { PCG815Machine } from '@z80emu/machine-pcg815';

const LCD_WIDTH = 144;
const LCD_HEIGHT = 32;
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
    machine.tick(64);
  }
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

function createEmptyFrame(): Uint8Array {
  return new Uint8Array(LCD_WIDTH * LCD_HEIGHT);
}

function setExpectedPixel(frame: Uint8Array, x: number, y: number): void {
  if (x < 0 || x >= LCD_WIDTH || y < 0 || y >= LCD_HEIGHT) {
    return;
  }
  frame[y * LCD_WIDTH + x] = 1;
}

function drawExpectedLine(frame: Uint8Array, x0: number, y0: number, x1: number, y1: number): void {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x1 >= x0 ? 1 : -1;
  const sy = y1 >= y0 ? 1 : -1;

  if (dy > dx) {
    let err = Math.floor(dy / 2);
    while (true) {
      setExpectedPixel(frame, x, y);
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
    setExpectedPixel(frame, x, y);
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

function drawExpectedVertical(frame: Uint8Array, x: number, top: number, bottom: number): void {
  drawExpectedLine(frame, x, top, x, bottom);
}

function drawExpectedSeam(frame: Uint8Array, side: 'left' | 'right', rect: (typeof RECTS)[number]): void {
  const x = side === 'left' ? rect.left : rect.right;
  const joinX = side === 'left' ? x - 1 : x + 1;
  setExpectedPixel(frame, joinX, rect.top);
  setExpectedPixel(frame, joinX, rect.bottom);
  drawExpectedVertical(frame, x, rect.top, rect.bottom);
}

function drawExpectedHoriz(frame: Uint8Array, left: number, right: number, y: number): void {
  drawExpectedLine(frame, left, y, right, y);
}

function drawExpectedSideWall(
  frame: Uint8Array,
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
    drawExpectedLine(frame, nearX, near.top, farX, far.top);
    drawExpectedLine(frame, nearX, near.bottom, farX, far.bottom);
  }
  for (let depth = 1; depth <= limitDepth; depth += 1) {
    const rect = RECTS[depth]!;
    drawExpectedSeam(frame, side, rect);
  }
}

function drawExpectedBranch(frame: Uint8Array, side: 'left' | 'right', depth: number): void {
  const rect = RECTS[depth]!;
  const x = side === 'left' ? rect.left : rect.right;
  drawExpectedVertical(frame, x, rect.top, rect.bottom);
}

function drawExpectedBranchCorridor(
  frame: Uint8Array,
  side: 'left' | 'right',
  depth: number,
  branchLen: number
): void {
  if (branchLen <= 0) {
    return;
  }
  const outerIndex = Math.max(0, depth - branchLen);
  const outer = RECTS[outerIndex]!;

  if (outerIndex > 0) {
    drawExpectedSeam(frame, side, outer);
  } else {
    const outerX = side === 'left' ? outer.left : outer.right;
    drawExpectedVertical(frame, outerX, outer.top, outer.bottom);
  }
}

function drawExpectedFrontWall(frame: Uint8Array, scene: SceneSpec): void {
  if (!scene.frontHit) {
    return;
  }
  const rect = RECTS[scene.frontDepth]!;
  const leftClipDepth = scene.leftOpens.findIndex((value, index) => value && index + 1 < scene.frontDepth);
  const rightClipDepth = scene.rightOpens.findIndex((value, index) => value && index + 1 < scene.frontDepth);
  const clipLeft = leftClipDepth >= 0 ? RECTS[leftClipDepth + 1]!.left : rect.left;
  const clipRight = rightClipDepth >= 0 ? RECTS[rightClipDepth + 1]!.right : rect.right;

  drawExpectedHoriz(frame, clipLeft, clipRight, rect.top);
  drawExpectedHoriz(frame, clipLeft, clipRight, rect.bottom);

  if (clipLeft === rect.left) {
    drawExpectedVertical(frame, rect.left, rect.top, rect.bottom);
  }
  if (clipRight === rect.right) {
    drawExpectedVertical(frame, rect.right, rect.top, rect.bottom);
  }

  const x1 = TILE_X[scene.frontDepth]!;
  const x2 = TILE_X2[scene.frontDepth]!;
  if (x1 > clipLeft && x1 < clipRight) {
    drawExpectedVertical(frame, x1, rect.top, rect.bottom);
  }
  if (x2 > clipLeft && x2 < clipRight) {
    drawExpectedVertical(frame, x2, rect.top, rect.bottom);
  }
}

function renderExpectedScene(scene: SceneSpec): Uint8Array {
  const frame = createEmptyFrame();
  const visibleDepth = scene.frontHit ? scene.frontDepth : 4;

  drawExpectedSideWall(frame, 'left', visibleDepth, scene.leftOpens);
  drawExpectedSideWall(frame, 'right', visibleDepth, scene.rightOpens);

  for (let depth = 1; depth <= visibleDepth; depth += 1) {
    if (scene.leftOpens[depth - 1]) {
      drawExpectedBranch(frame, 'left', depth);
      drawExpectedBranchCorridor(frame, 'left', depth, scene.leftBranchLens[depth - 1] ?? 0);
    }
    if (scene.rightOpens[depth - 1]) {
      drawExpectedBranch(frame, 'right', depth);
      drawExpectedBranchCorridor(frame, 'right', depth, scene.rightBranchLens[depth - 1] ?? 0);
    }
  }

  drawExpectedFrontWall(frame, scene);
  return frame;
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

      runFor(machine, 24_000);
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

      runFor(machine, 24_000);
      const frame = Uint8Array.from(machine.getFrameBuffer());
      const rect = RECTS[scenario.rectIndex]!;

      if (scenario.side === 'left') {
        expect(isLit(frame, Math.max(0, rect.left - 8), rect.top)).toBe(false);
        expect(isLit(frame, Math.max(0, rect.left - 8), rect.bottom)).toBe(false);
        expect(countLitOnVertical(frame, 0, rect.top, rect.bottom)).toBeLessThanOrEqual(2);
        expect(isLit(frame, rect.left + 4, rect.top)).toBe(false);
        expect(isLit(frame, rect.left + 4, rect.bottom)).toBe(false);
        expect(verticalLineLooksConnected(frame, rect.left, rect.top, rect.bottom)).toBe(true);
      } else {
        expect(isLit(frame, Math.min(143, rect.right + 8), rect.top)).toBe(false);
        expect(isLit(frame, Math.min(143, rect.right + 8), rect.bottom)).toBe(false);
        expect(countLitOnVertical(frame, 143, rect.top, rect.bottom)).toBeLessThanOrEqual(2);
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

      runFor(machine, 24_000);
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

      runFor(machine, 24_000);
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

    runFor(machine, 24_000);
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

    runFor(machine, 24_000);
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

    runFor(machine, 24_000);
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
    const cases: Array<{
      start: { x: number; y: number; dir: 'north' | 'east' | 'south' | 'west' };
      scene: SceneSpec;
      name: string;
    }> = [
      {
        name: 'left-branch',
        start: { x: 4, y: 1, dir: 'west' },
        scene: makeSceneSpec({ frontHit: true, frontDepth: 4, leftOpenDepth: 3, leftBranchLen: 1 })
      },
      {
        name: 'right-branch',
        start: { x: 5, y: 1, dir: 'east' },
        scene: makeSceneSpec({ frontHit: true, frontDepth: 4, rightOpenDepth: 3, rightBranchLen: 1 })
      },
      {
        name: 'straight-dead-end',
        start: { x: 6, y: 1, dir: 'east' },
        scene: makeSceneSpec({ frontHit: true, frontDepth: 3, rightOpenDepth: 2, rightBranchLen: 1 })
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

      runFor(machine, 24_000);
      const actual = Uint8Array.from(machine.getFrameBuffer());
      const expected = renderExpectedScene(scenario.scene);
      expect(diffFrames(actual, expected), scenario.name).toEqual([]);
    }
  });

  it('keeps the right wall visible one block beyond a right branch opening in full VRAM', { timeout: 40_000 }, () => {
    const mainTs = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const asm = extractAsmSample(mainTs, 'ASM_SAMPLE_3D');
    const start = { x: 5, y: 1, dir: 'east' as const };
    const expected = renderExpectedScene(makeSceneSpec({ frontHit: true, frontDepth: 4, rightOpenDepth: 3, rightBranchLen: 1 }));

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

    runFor(machine, 24_000);
    const actual = Uint8Array.from(machine.getFrameBuffer());
    const diffs = diffFrames(actual, expected);

    expect(diffs).toEqual([]);
  });

  it('renders the right branch next-block wall in full VRAM', { timeout: 40_000 }, () => {
    const mainTs = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const asm = extractAsmSample(mainTs, 'ASM_SAMPLE_3D');
    const start = { x: 5, y: 1, dir: 'east' as const };
    const expected = renderExpectedScene(makeSceneSpec({ frontHit: true, frontDepth: 4, rightOpenDepth: 3, rightBranchLen: 1 }));

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

    runFor(machine, 24_000);
    const actual = Uint8Array.from(machine.getFrameBuffer());
    expect(diffFrames(actual, expected)).toEqual([]);
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

    runFor(machine, 24_000);
    const frame = Uint8Array.from(machine.getFrameBuffer());
    const opening = RECTS[3]!;

    expect(interiorRegionIsDark(frame, RECTS[4]!.right + 1, opening.right - 1, opening.top, opening.top + 1)).toBe(true);
    expect(interiorRegionIsDark(frame, RECTS[4]!.right + 1, opening.right - 1, opening.bottom - 1, opening.bottom)).toBe(true);
  });

  it('keeps the main corridor ceiling and floor lines immediately before a right branch', { timeout: 40_000 }, () => {
    const mainTs = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const asm = extractAsmSample(mainTs, 'ASM_SAMPLE_3D');
    const start = { x: 5, y: 1, dir: 'east' as const };
    const expected = renderExpectedScene(makeSceneSpec({ frontHit: true, frontDepth: 4, rightOpenDepth: 3, rightBranchLen: 1 }));

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

    runFor(machine, 24_000);
    const actual = Uint8Array.from(machine.getFrameBuffer());
    expect(diffFrames(actual, expected)).toEqual([]);
    expect(diagonalBandLooksContinuous(actual, [
      [109, 8],
      [95, 11]
    ])).toBe(true);
    expect(diagonalBandLooksContinuous(actual, [
      [109, 23],
      [95, 20]
    ])).toBe(true);
  });
});
