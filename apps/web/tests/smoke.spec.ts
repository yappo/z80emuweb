import { expect, test } from '@playwright/test';

function stop3dSampleAtFrame(source: string, frameCount: number): string {
  const patched = source.replace(
    /(^\s*LD A,\(FRAME_TICK\)\r?\n^\s*INC A\r?\n^\s*LD \(FRAME_TICK\),A\r?\n^\s*JP MAIN_LOOP)/m,
    `  LD A,(FRAME_TICK)\n  INC A\n  LD (FRAME_TICK),A\n  CP ${frameCount}\n  JR Z,AUTOPLAY_TEST_HALT\n  JP MAIN_LOOP\nAUTOPLAY_TEST_HALT:\n  HALT`
  );
  if (patched === source) {
    throw new Error('failed to patch 3D sample autoplay halt');
  }
  return patched;
}

function pin3dSampleScene(
  source: string,
  start: { x: number; y: number; dir: 'north' | 'east' | 'south' | 'west' }
): string {
  return source
    .replace('MOVE_INTERVAL EQU 3', 'MOVE_INTERVAL EQU 255')
    .replace('  JP MAIN_LOOP', '  HALT')
    .replace(
      /LD A,\d+\n  LD \(POS_X\),A\n  LD A,\d+\n  LD \(POS_Y\),A\n  LD A,DIR_(NORTH|EAST|SOUTH|WEST)\n  LD \(DIR\),A/,
      `LD A,${start.x}\n  LD (POS_X),A\n  LD A,${start.y}\n  LD (POS_Y),A\n  LD A,DIR_${start.dir.toUpperCase()}\n  LD (DIR),A`
    );
}

test('app boots and renders lit LCD pixels without runtime errors', async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: /PC-G815 Compatible Z80 Emulator/i })).toBeVisible();
  await expect(page.locator('#lcd')).toBeVisible();
  await expect(page.locator('#run-toggle')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Step' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset' })).toBeVisible();
  await expect(page.getByRole('button', { name: /かな OFF/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fonts' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'BASIC' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'ASSEMBLER' })).toBeVisible();
  await expect(page.locator('#basic-editor')).toBeVisible();
  await expect(page.locator('#asm-editor-panel')).toBeHidden();
  await expect(page.getByRole('button', { name: 'RUN Program' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'STOP CPU' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'NEW' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load Sample' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sample Game' })).toBeVisible();
  await expect(page.locator('#basic-editor-panel .basic-editor-hint')).toContainText(/Editor focus:/i);
  await page.locator('#basic-editor').click();
  await page.keyboard.type('30 PRINT 654');
  await expect(page.locator('#basic-editor')).toHaveValue(/30 PRINT 654/);

  await expect(page.locator('#boot-status')).toContainText(/READY/i, { timeout: 5_000 });
  await expect(page.locator('#boot-status')).toContainText(/strict=0/i);
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          return (api.__pcg815?.readDisplayText() ?? []).join('\n');
        }),
      { timeout: 5_000, intervals: [100, 250, 500] }
    )
    .toContain('PC-G815 COMPAT');
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          return (api.__pcg815?.readDisplayText() ?? []).join('\n');
        }),
      { timeout: 5_000, intervals: [100, 250, 500] }
    )
    .toContain('BASIC READY');

  await expect(page.locator('#font-debug-panel')).toBeHidden();
  await page.getByRole('button', { name: 'Fonts' }).click();
  await expect(page.locator('#font-debug-panel')).toBeVisible();
  await expect(page.locator('#font-debug-meta')).toContainText(/0x41/i);
  await expect(page.locator('#font-kana-canvas')).toBeVisible();

  // Stop CPU loop so ASCII FIFO is not consumed by runtime while testing input mapping.
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible();

  const kanaToggle = page.getByRole('button', { name: /かな OFF/i });
  await kanaToggle.click();
  await expect(page.getByRole('button', { name: /かな ON/i })).toBeVisible();

  await page.evaluate(() => {
    (window as { __pcg815?: { drainAsciiFifo: () => number[] } }).__pcg815?.drainAsciiFifo();
  });

  await page.evaluate(() => {
    const api = window as { __pcg815?: { tapKey: (code: string) => void } };
    api.__pcg815?.tapKey('KeyK');
    api.__pcg815?.tapKey('KeyA');
  });

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { drainAsciiFifo: () => number[] } };
          return api.__pcg815?.drainAsciiFifo() ?? [];
        }),
      { timeout: 3_000, intervals: [100, 250, 500] }
    )
    .toEqual([0xb6]);

  await page.getByRole('button', { name: /かな ON/i }).click();
  await expect(page.getByRole('button', { name: /かな OFF/i })).toBeVisible();

  await page.evaluate(() => {
    const api = window as { __pcg815?: { tapKey: (code: string) => void } };
    api.__pcg815?.tapKey('KeyA');
  });

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { drainAsciiFifo: () => number[] } };
          return api.__pcg815?.drainAsciiFifo() ?? [];
        }),
      { timeout: 3_000, intervals: [100, 250, 500] }
    )
    .toEqual([0x41]);

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const atlas = document.querySelector<HTMLCanvasElement>('#font-debug-canvas');
          if (!atlas) {
            return false;
          }
          const ctx = atlas.getContext('2d');
          if (!ctx) {
            return false;
          }

          const data = ctx.getImageData(0, 0, atlas.width, atlas.height).data;
          const r0 = data[0];
          const g0 = data[1];
          const b0 = data[2];
          for (let i = 4; i < data.length; i += 4) {
            if (data[i] !== r0 || data[i + 1] !== g0 || data[i + 2] !== b0) {
              return true;
            }
          }
          return false;
        }),
      {
        timeout: 5_000,
        intervals: [100, 250, 500]
      }
    )
    .toBe(true);

  await page.locator('#font-debug-canvas').click({ position: { x: 6, y: 6 } });
  await expect(page.locator('#font-debug-meta')).toContainText(/0x00/i);
  await page.locator('#font-kana-canvas').click({ position: { x: 64, y: 8 } });
  await expect(page.locator('#font-debug-meta')).toContainText(/0xA1/i);

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const lcd = document.querySelector<HTMLCanvasElement>('#lcd');
          if (!lcd) {
            return 0;
          }

          const ctx = lcd.getContext('2d');
          if (!ctx) {
            return 0;
          }

          const data = ctx.getImageData(0, 0, lcd.width, lcd.height).data;
          let litPixels = 0;

          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            if (r !== 185 || g !== 210 || b !== 160) {
              litPixels += 1;
            }
          }

          return litPixels;
        }),
      {
        timeout: 5_000,
        intervals: [100, 250, 500]
      }
    )
    .toBeGreaterThan(0);

  await page.locator('#basic-editor').fill('10 PRINT 321\n20 END');
  await page.getByRole('button', { name: 'RUN Program' }).click();
  await expect(page.locator('#basic-run-status')).toContainText(/Run OK/i, { timeout: 5_000 });

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as {
            __pcg815?: { readDisplayText: () => string[] };
          };
          const lines = api.__pcg815?.readDisplayText() ?? [];
          return lines.join('\n');
        }),
      {
        timeout: 5_000,
        intervals: [100, 250, 500]
      }
    )
    .toContain('321');

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as {
            __pcg815?: {
              getCompatRouteStats: () => { executeLineCalls: number; runProgramCalls: number; rejectedCalls: number };
            };
          };
          return api.__pcg815?.getCompatRouteStats() ?? { executeLineCalls: -1, runProgramCalls: -1, rejectedCalls: -1 };
        }),
      { timeout: 3_000, intervals: [100, 250, 500] }
    )
    .toEqual({ executeLineCalls: 0, runProgramCalls: 0, rejectedCalls: 0 });

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as {
            __pcg815?: {
              getFirmwareRouteStats: () => {
                bridgeRuns: number;
                bridgeBytes: number;
                bridgeErrors: number;
                z80InterpreterRuns: number;
                consumedBytes: number;
              };
            };
          };
          const stats = api.__pcg815?.getFirmwareRouteStats();
          if (!stats) {
            return false;
          }
            return (
              stats.bridgeRuns > 0 &&
              stats.bridgeBytes > 0 &&
              stats.bridgeErrors === 0 &&
              stats.z80InterpreterRuns > 0 &&
              stats.consumedBytes > 0
            );
        }),
      { timeout: 3_000, intervals: [100, 250, 500] }
    )
    .toBe(true);

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as {
            __pcg815?: {
              getBasicEngineStatus: () => {
                entry: number;
                romBank: number;
                activeRomBank: number;
                basicRamStart: number;
                basicRamEnd: number;
              };
            };
          };
          return api.__pcg815?.getBasicEngineStatus();
        }),
      { timeout: 3_000, intervals: [100, 250, 500] }
    )
    .toMatchObject({
      entry: 0xc000,
      romBank: 0x0f,
      activeRomBank: 0x0f,
      basicRamStart: 0x4000,
      basicRamEnd: 0x6fff
    });

  const speedText = await page.locator('#speed-indicator').innerText();
  expect(speedText.toLowerCase()).toContain('x');

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('assembler tab can assemble and run a simple ORG/ENTRY program', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#boot-status')).toContainText(/READY/i, { timeout: 5_000 });

  await page.getByRole('tab', { name: 'ASSEMBLER' }).click();
  await expect(page.locator('#asm-editor')).toBeVisible();

  await page.locator('#asm-editor').fill('ORG 0x0200\nENTRY START\nSTART: LD A,1\nHALT');
  await page.locator('#asm-assemble').click();
  await expect(page.locator('#asm-run-status')).toContainText(/Assemble OK/i, { timeout: 5_000 });
  await expect(page.locator('#asm-dump-view')).toContainText(/0300:/i);

  await page.locator('#asm-run').click();
  await expect(page.locator('#asm-run-status')).toContainText(/Run OK/i, { timeout: 5_000 });

  await page.getByRole('tab', { name: 'BASIC' }).click();
  await expect(page.locator('#basic-editor')).toBeVisible();
});

test('assembler sample reverses typed input', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await expect(page.locator('#boot-status')).toContainText(/READY/i, { timeout: 5_000 });

  await page.getByRole('tab', { name: 'ASSEMBLER' }).click();
  await expect(page.locator('#asm-editor')).toBeVisible();

  await page.locator('#asm-new').click();
  await page.locator('#asm-load-sample').click();
  await expect(page.locator('#asm-run-status')).toContainText(/Sample loaded/i);
  await expect(page.locator('#asm-editor')).toHaveValue(/Input Word: /);

  await page.evaluate(() => {
    const api = window as {
      __pcg815?: {
        runAsm: (source: string) => Promise<{ ok: boolean; errorLine?: string }>;
      };
    };
    const editor = document.querySelector<HTMLTextAreaElement>('#asm-editor');
    if (!api.__pcg815 || !editor) {
      throw new Error('assembler api unavailable');
    }
    void api.__pcg815.runAsm(editor.value);
  });

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          return (api.__pcg815?.readDisplayText() ?? []).join('\n');
        }),
      { timeout: 5_000, intervals: [100, 250, 500] }
    )
    .toContain('Input Word:');
  await page.waitForTimeout(250);

  await page.evaluate(() => {
    const api = window as { __pcg815?: { tapKey: (code: string) => void } };
    api.__pcg815?.tapKey('KeyH');
    api.__pcg815?.tapKey('KeyE');
    api.__pcg815?.tapKey('KeyL');
    api.__pcg815?.tapKey('KeyL');
    api.__pcg815?.tapKey('KeyO');
  });
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          return (api.__pcg815?.readDisplayText() ?? []).join('\n');
        }),
      { timeout: 5_000, intervals: [100, 250, 500] }
    )
    .toContain('HELLO');
  await page.evaluate(() => {
    const api = window as { __pcg815?: { tapKey: (code: string) => void } };
    api.__pcg815?.tapKey('Enter');
  });
  await expect(page.locator('#asm-run-status')).toContainText(/Run OK/i, { timeout: 15_000 });
});

test('assembler sample keeps SP stable when keys are pressed after returning to monitor', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await expect(page.locator('#boot-status')).toContainText(/READY/i, { timeout: 5_000 });

  await page.getByRole('tab', { name: 'ASSEMBLER' }).click();
  await page.locator('#asm-new').click();
  await page.locator('#asm-load-sample').click();
  await page.locator('#asm-run').click();

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          return (api.__pcg815?.readDisplayText() ?? []).join('\n');
        }),
      { timeout: 5_000, intervals: [100, 250, 500] }
    )
    .toContain('Input Word:');

  await page.evaluate(() => {
    const api = window as { __pcg815?: { tapKey: (code: string) => void } };
    api.__pcg815?.tapKey('KeyO');
    api.__pcg815?.tapKey('KeyK');
    api.__pcg815?.tapKey('Enter');
  });
  await expect(page.locator('#asm-run-status')).toContainText(/Run OK/i, { timeout: 15_000 });

  await page.locator('#lcd').click();
  const readSp = async (): Promise<string> =>
    page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('#monitor-register-main .register-item'));
      for (const item of items) {
        const name = item.querySelector('.register-name')?.textContent?.trim();
        if (name === 'SP') {
          return item.querySelector('.register-value')?.textContent?.trim() ?? '';
        }
      }
      return '';
    });

  const before = await readSp();
  await page.keyboard.press('a');
  await page.keyboard.press('b');
  await page.keyboard.press('c');
  await page.waitForTimeout(200);
  const after = await readSp();

  expect(before).toBe('0x7FFF');
  expect(after).toBe(before);
});

test('assembler sample returns to monitor ROM prompt without boot banner redraw', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await expect(page.locator('#boot-status')).toContainText(/READY/i, { timeout: 5_000 });

  await page.getByRole('tab', { name: 'ASSEMBLER' }).click();
  await page.locator('#asm-new').click();
  await page.locator('#asm-load-sample').click();
  await page.locator('#asm-run').click();

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          return (api.__pcg815?.readDisplayText() ?? []).join('\n');
        }),
      { timeout: 5_000, intervals: [100, 250, 500] }
    )
    .toContain('Input Word:');

  await page.evaluate(() => {
    const api = window as { __pcg815?: { tapKey: (code: string) => void } };
    api.__pcg815?.tapKey('KeyO');
    api.__pcg815?.tapKey('KeyK');
    api.__pcg815?.tapKey('Enter');
  });
  await expect(page.locator('#asm-run-status')).toContainText(/Run OK/i, { timeout: 15_000 });

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          return (api.__pcg815?.readDisplayText() ?? []).join('\n');
        }),
      { timeout: 5_000, intervals: [100, 250, 500] }
    )
    .toContain('> ');
  await page.locator('#lcd').click();
  await page.keyboard.press('a');
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          return (api.__pcg815?.readDisplayText() ?? []).join('\n');
        }),
      { timeout: 5_000, intervals: [100, 250, 500] }
    )
    .toContain('> A');
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const items = Array.from(document.querySelectorAll('#monitor-register-main .register-item'));
          for (const item of items) {
            const name = item.querySelector('.register-name')?.textContent?.trim();
            if (name === 'PC') {
              return item.querySelector('.register-value')?.textContent?.trim() ?? '';
            }
          }
          return '';
        }),
      { timeout: 5_000, intervals: [100, 250, 500] }
    )
    .toMatch(/^0x80F[ABCDEF]$/i);
});

test('assembler tab 3D sample keeps running and leaves animated frames', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await expect(page.locator('#boot-status')).toContainText(/READY/i, { timeout: 5_000 });

  await page.getByRole('tab', { name: 'ASSEMBLER' }).click();
  await expect(page.locator('#asm-editor')).toBeVisible();

  await page.locator('#asm-new').click();
  await page.locator('#asm-load-3d-sample').click();
  await expect(page.locator('#asm-run-status')).toContainText(/3D sample loaded/i);
  await expect(page.locator('#asm-editor')).toHaveValue(/ORG 0x0100/i);
  await expect(page.locator('#asm-editor')).toHaveValue(/RAY_COUNT/i);
  await expect(page.locator('#asm-editor')).toHaveValue(/ROUTE_TABLE:/i);

  await page.locator('#asm-run').click();
  await expect(page.locator('#asm-run-status')).toContainText(/Running/i, { timeout: 10_000 });
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const lcd = document.querySelector<HTMLCanvasElement>('#lcd');
          if (!lcd) {
            return 0;
          }
          const ctx = lcd.getContext('2d');
          if (!ctx) {
            return 0;
          }
          const data = ctx.getImageData(0, 0, lcd.width, lcd.height).data;
          let litPixels = 0;
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            if (r !== 185 || g !== 210 || b !== 160) {
              litPixels += 1;
            }
          }
          return litPixels;
        }),
      { timeout: 5_000, intervals: [100, 250, 500] }
    )
    .toBeGreaterThan(200);
  await page.waitForTimeout(1500);
  await expect(page.locator('#asm-run-status')).toContainText(/Running/i);
  await page.locator('#asm-stop').click();
  await expect(page.locator('#asm-run-status')).toContainText(/Stopped/i);
});

test('3D sample autoplay frame 2 still shows the right branch wall in browser output', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await expect(page.locator('#boot-status')).toContainText(/READY/i, { timeout: 5_000 });

  await page.getByRole('tab', { name: 'ASSEMBLER' }).click();
  await page.locator('#asm-new').click();
  await page.locator('#asm-load-3d-sample').click();

  const haltedSource = await page.locator('#asm-editor').inputValue().then((source) => stop3dSampleAtFrame(source, 2));
  await page.locator('#asm-editor').fill(haltedSource);
  await expect(page.locator('#asm-editor')).toHaveValue(/AUTOPLAY_TEST_HALT:/);
  await page.locator('#asm-run').click();
  await expect(page.locator('#asm-run-status')).toContainText(/Running|Run OK/i, { timeout: 10_000 });
  await expect(page.locator('#asm-run-status')).toContainText(/Stopped/i, { timeout: 10_000 });
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as {
            __pcg815?: {
              getFrameBuffer: () => number[];
            };
          };
          const frame = api.__pcg815?.getFrameBuffer() ?? [];
          let lit = 0;
          for (const value of frame) {
            lit += value ? 1 : 0;
          }
          return lit;
        }),
      { timeout: 10_000, intervals: [100, 250, 500] }
    )
    .toBeGreaterThan(80);

  const branchPixels = await page.evaluate(() => {
    const api = window as {
      __pcg815?: {
        getFrameBuffer: () => number[];
      };
    };
    const frame = api.__pcg815?.getFrameBuffer() ?? [];
    const width = 144;
    const isLit = (x: number, y: number): boolean => frame[y * width + x] !== 0;
    let verticalLit = 0;
    for (let y = 4; y <= 27; y += 1) {
      verticalLit += isLit(125, y) ? 1 : 0;
    }
    let bestX = -1;
    let bestCount = -1;
    for (let x = 90; x < 144; x += 1) {
      let count = 0;
      for (let y = 0; y < 32; y += 1) {
        count += isLit(x, y) ? 1 : 0;
      }
      if (count > bestCount) {
        bestCount = count;
        bestX = x;
      }
    }

    return {
      verticalLit,
      bestX,
      bestCount,
      topJoin: [isLit(125, 4), isLit(124, 4), isLit(126, 4)],
      bottomJoin: [isLit(125, 27), isLit(124, 27), isLit(126, 27)]
    };
  });

  expect(branchPixels.verticalLit, JSON.stringify(branchPixels)).toBeGreaterThanOrEqual(12);
  expect(branchPixels.bestX, JSON.stringify(branchPixels)).toBe(125);
  expect(branchPixels.topJoin.some(Boolean)).toBe(true);
  expect(branchPixels.bottomJoin.some(Boolean)).toBe(true);
  await page.locator('#lcd').screenshot({ path: '/tmp/z80emu-verified-frame-2.png' });
});

test('3D sample pinned right-branch scene matches the agreed far-side wall shape in browser output', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await expect(page.locator('#boot-status')).toContainText(/READY/i, { timeout: 5_000 });

  await page.getByRole('tab', { name: 'ASSEMBLER' }).click();
  await page.locator('#asm-new').click();
  await page.locator('#asm-load-3d-sample').click();

  const source = await page.locator('#asm-editor').inputValue();
  const pinnedSource = pin3dSampleScene(source, { x: 5, y: 1, dir: 'east' });

  await page.evaluate((asmSource) => {
    const api = window as {
      __pcg815?: {
        runAsm: (source: string) => Promise<{ ok: boolean; errorLine?: string }>;
      };
    };
    void api.__pcg815?.runAsm(asmSource);
  }, pinnedSource);

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as {
            __pcg815?: {
              getFrameBuffer: () => number[];
            };
          };
          const frame = api.__pcg815?.getFrameBuffer() ?? [];
          const width = 144;
          const isLit = (x: number, y: number): boolean => frame[y * width + x] !== 0;
          return {
            upper: [isLit(83, 13), isLit(87, 13), isLit(89, 14), isLit(93, 14)],
            lower: [isLit(83, 18), isLit(87, 18), isLit(89, 17), isLit(93, 17)],
            gapUpper: [isLit(94, 13), isLit(94, 14)],
            gapLower: [isLit(94, 17), isLit(94, 18)],
            wallUpper: isLit(95, 13),
            wallLower: isLit(95, 18)
          };
        }),
      { timeout: 10_000, intervals: [100, 250, 500] }
    )
    .toEqual({
      upper: [true, true, true, true],
      lower: [true, true, true, true],
      gapUpper: [true, false],
      gapLower: [false, true],
      wallUpper: true,
      wallLower: true
    });

  await page.locator('#lcd').screenshot({ path: '/tmp/z80emu-pinned-right-branch-agreed-shape.png' });
});

async function captureHalted3dFrame(page: import('@playwright/test').Page, frame: number): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#boot-status')).toContainText(/READY/i, { timeout: 5_000 });
  await page.getByRole('tab', { name: 'ASSEMBLER' }).click();
  await page.locator('#asm-new').click();
  await page.locator('#asm-load-3d-sample').click();
  const haltedSource = await page.locator('#asm-editor').inputValue().then((source) => stop3dSampleAtFrame(source, frame));
  await page.locator('#asm-editor').fill(haltedSource);
  await expect(page.locator('#asm-editor')).toHaveValue(/AUTOPLAY_TEST_HALT:/);
  await page.locator('#asm-run').click();
  await expect(page.locator('#asm-run-status')).toContainText(/Running|Run OK/i, { timeout: 10_000 });
  await expect(page.locator('#asm-run-status')).toContainText(/Stopped/i, { timeout: 10_000 });
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as {
            __pcg815?: {
              getFrameBuffer: () => number[];
            };
          };
          const frame = api.__pcg815?.getFrameBuffer() ?? [];
          let lit = 0;
          for (const value of frame) {
            lit += value ? 1 : 0;
          }
          return lit;
        }),
      { timeout: 10_000, intervals: [100, 250, 500] }
    )
    .toBeGreaterThan(80);
  await page.locator('#lcd').screenshot({ path: `/tmp/z80emu-right-branch-diag-frame-${frame}.png` });
}

test('diagnostic right-branch frame 1', async ({ page }) => {
  test.setTimeout(60_000);
  await captureHalted3dFrame(page, 1);
});

test('diagnostic right-branch frame 2', async ({ page }) => {
  test.setTimeout(60_000);
  await captureHalted3dFrame(page, 2);
});

test('diagnostic right-branch frame 3', async ({ page }) => {
  test.setTimeout(60_000);
  await captureHalted3dFrame(page, 3);
});

test('diagnostic right-branch frame 4', async ({ page }) => {
  test.setTimeout(60_000);
  await captureHalted3dFrame(page, 4);
});

test('basic load sample runs on fresh boot', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await expect(page.locator('#boot-status')).toContainText(/READY/i, { timeout: 5_000 });

  await page.getByRole('button', { name: 'Load Sample' }).click();
  await page.getByRole('button', { name: 'RUN Program' }).click();
  await expect(page.locator('#basic-run-status')).toContainText(/Run OK/i, { timeout: 15_000 });

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          return (api.__pcg815?.readDisplayText() ?? []).join('\n');
        }),
      { timeout: 45_000, intervals: [100, 250, 500, 1_000] }
    )
    .toContain('owari');
});

test('ts-compat backend uses compatibility direct route', async ({ page }) => {
  await page.goto('/?backend=ts-compat');
  await expect(page.locator('#boot-status')).toContainText(/READY/i, { timeout: 5_000 });
  await expect(page.locator('#boot-status')).toContainText(/backend=ts-compat/i);

  await page.locator('#basic-editor').fill('10 PRINT 77\n20 END');
  await page.getByRole('button', { name: 'RUN Program' }).click();
  await expect(page.locator('#basic-run-status')).toContainText(/Run OK/i, { timeout: 5_000 });

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as {
            __pcg815?: {
              getCompatRouteStats: () => { executeLineCalls: number; runProgramCalls: number; rejectedCalls: number };
            };
          };
          return api.__pcg815?.getCompatRouteStats() ?? { executeLineCalls: 0, runProgramCalls: 0, rejectedCalls: 0 };
        }),
      { timeout: 3_000, intervals: [100, 250, 500] }
    )
    .toEqual({ executeLineCalls: 3, runProgramCalls: 1, rejectedCalls: 0 });

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as {
            __pcg815?: {
              getFirmwareRouteStats: () => { bridgeRuns: number; bridgeBytes: number };
            };
          };
          const stats = api.__pcg815?.getFirmwareRouteStats();
          if (!stats) {
            return false;
          }
          return stats.bridgeRuns === 0 && stats.bridgeBytes === 0;
        }),
      { timeout: 3_000, intervals: [100, 250, 500] }
    )
    .toBe(true);
});

test('z80-firmware injectBasicLine LIST route uses firmware bridge', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#boot-status')).toContainText(/READY/i, { timeout: 5_000 });

  await page.evaluate(() => {
    const api = window as {
      __pcg815?: {
        injectBasicLine: (line: string) => void;
      };
    };
    api.__pcg815?.injectBasicLine('10 PRINT 555');
    api.__pcg815?.injectBasicLine('LIST');
  });

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          return (api.__pcg815?.readDisplayText() ?? []).join('\n');
        }),
      { timeout: 5_000, intervals: [100, 250, 500] }
    )
    .toContain('10 PRINT 555');

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as {
            __pcg815?: {
              getFirmwareRouteStats: () => {
                bridgeRuns: number;
                z80InterpreterRuns: number;
                consumedBytes: number;
              };
            };
          };
          const stats = api.__pcg815?.getFirmwareRouteStats();
          if (!stats) {
            return false;
          }
          return stats.bridgeRuns >= 2 && stats.z80InterpreterRuns >= 2 && stats.consumedBytes > 0;
        }),
      { timeout: 5_000, intervals: [100, 250, 500] }
    )
    .toBe(true);
});

test('basic editor handles syntax error and reset rerun flow', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#boot-status')).toContainText(/READY/i, { timeout: 5_000 });

  await page.locator('#basic-editor').fill('10 GOTO 9999\n20 END');
  await page.getByRole('button', { name: 'RUN Program' }).click();
  await expect(page.locator('#basic-run-status')).toContainText(/Failed:/i, { timeout: 5_000 });

  await page.locator('#basic-editor').fill('10 PRINT 999\n20 END');
  await page.getByRole('button', { name: 'RUN Program' }).click();
  await expect(page.locator('#basic-run-status')).toContainText(/Run OK/i, { timeout: 5_000 });

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          return (api.__pcg815?.readDisplayText() ?? []).join('\n');
        }),
      { timeout: 5_000, intervals: [100, 250, 500] }
    )
    .toContain('999');

  await page.getByRole('button', { name: 'STOP CPU' }).click();
  await expect(page.locator('#basic-run-status')).toContainText(/Stopped/i);
});

test('sample game button loads maze code and starts running', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#boot-status')).toContainText(/READY/i, { timeout: 5_000 });

  await page.getByRole('button', { name: 'Sample Game' }).click();
  await expect(page.locator('#basic-run-status')).toContainText(/Sample game loaded/i, { timeout: 5_000 });
  await expect(page.locator('#basic-editor')).toHaveValue(/Stage:/);
  await expect(page.locator('#basic-editor')).toHaveValue(/Score:/);
  await expect(page.locator('#basic-editor')).toHaveValue(/PRINT "PUSH SPACE KEY !";/);
  await expect(page.locator('#basic-editor')).toHaveValue(/OUT 17,128/);
  await expect(page.locator('#basic-editor')).toHaveValue(/OUT 17,64/);
  await expect(page.locator('#basic-editor')).toHaveValue(/ALL STAGE CLEAR!/);

  await page.getByRole('button', { name: 'RUN Program' }).click();
  await expect(page.locator('#basic-run-status')).toContainText(/Running/i, { timeout: 5_000 });
  await page.waitForTimeout(3_000);
  await expect(page.locator('#basic-run-status')).toContainText(/Running/i);
  await expect(page.locator('#basic-run-status')).not.toContainText(/Failed:/i);
});

test('sample game accepts Space input on PUSH SPACE KEY screen', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await expect(page.locator('#boot-status')).toContainText(/READY/i, { timeout: 5_000 });

  await page.getByRole('button', { name: 'Sample Game' }).click();
  await page.getByRole('button', { name: 'RUN Program' }).click();
  await expect(page.locator('#basic-run-status')).toContainText(/Running/i, { timeout: 5_000 });

  const samples: Array<{ line0: string; line1: string; line2: string; line3: string; status: string; domain: string; speed: string }> = [];
  for (let i = 0; i < 24; i += 1) {
    await page.waitForTimeout(150);
    const snapshot = await page.evaluate(() => {
      const api = window as {
        __pcg815?: {
          readDisplayText: () => string[];
          getBasicEngineStatus?: () => { executionDomain?: string };
        };
      };
      const lines = api.__pcg815?.readDisplayText() ?? [];
      const status = document.querySelector('#basic-run-status')?.textContent ?? '';
      const domain = api.__pcg815?.getBasicEngineStatus?.().executionDomain ?? '';
      const speed = document.querySelector('#speed-indicator')?.textContent ?? '';
      return {
        line0: lines[0] ?? '',
        line1: lines[1] ?? '',
        line2: lines[2] ?? '',
        line3: lines[3] ?? '',
        status,
        domain,
        speed
      };
    });
    samples.push(snapshot);
  }
  const sawTitle = samples.some(
    (entry) => entry.line0.includes('MASE 4X4 GAME !') && entry.line2.includes('USE: WASD OR ARROWS')
  );
  const sawStageMap = samples.some(
    (entry) => entry.line0.includes('@..K') && entry.line1.includes('.##.') && entry.line3.includes('.#.G')
  );
  expect(sawTitle || sawStageMap, JSON.stringify(samples.slice(0, 8))).toBe(true);
  expect(samples.every((entry) => /Running/i.test(entry.status))).toBe(true);
  expect(samples.every((entry) => entry.domain === 'user-program')).toBe(true);

  await page.locator('#lcd').click();
  await page.keyboard.press('KeyA');
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          return (api.__pcg815?.readDisplayText() ?? []).join('\n');
        }),
      { timeout: 3_000, intervals: [100, 250, 500] }
    )
    .not.toContain('> A');

  await page.locator('#lcd').click();
  await page.keyboard.press('Space');

  await expect(page.locator('#basic-run-status')).not.toContainText(/Failed:/i);
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          return (api.__pcg815?.readDisplayText() ?? []).join('\n');
        }),
      { timeout: 8_000, intervals: [100, 250, 500] }
    )
    .toMatch(/Stage:|@\.\.K/);

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          return (api.__pcg815?.readDisplayText() ?? []).join('\n');
        }),
      { timeout: 8_000, intervals: [100, 250, 500] }
    )
    .toContain('@');
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          return (api.__pcg815?.readDisplayText() ?? []).join('\n');
        }),
      { timeout: 5_000, intervals: [100, 250, 500] }
    )
    .not.toContain('PUSH SPACE KEY !');
});

test('sample game stays on PUSH SPACE KEY screen until Space is pressed', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await expect(page.locator('#boot-status')).toContainText(/READY/i, { timeout: 5_000 });

  await page.getByRole('button', { name: 'Sample Game' }).click();
  await page.getByRole('button', { name: 'RUN Program' }).click();
  await expect(page.locator('#basic-run-status')).toContainText(/Running/i, { timeout: 5_000 });
  await page.locator('#lcd').click();

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          return (api.__pcg815?.readDisplayText() ?? []).join('\n');
        }),
      { timeout: 8_000, intervals: [100, 250, 500] }
    )
    .toContain('PUSH SPACE KEY !');

  await page.waitForTimeout(4_000);

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          return (api.__pcg815?.readDisplayText() ?? []).join('\n');
        }),
      { timeout: 3_000, intervals: [100, 250, 500] }
    )
    .toContain('PUSH SPACE KEY !');
});

test('sample game keeps player visible after ArrowRight input', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await expect(page.locator('#boot-status')).toContainText(/READY/i, { timeout: 5_000 });

  await page.getByRole('button', { name: 'Sample Game' }).click();
  await page.getByRole('button', { name: 'RUN Program' }).click();
  await expect(page.locator('#basic-run-status')).toContainText(/Running/i, { timeout: 5_000 });

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          return (api.__pcg815?.readDisplayText() ?? []).join('\n');
        }),
      { timeout: 5_000, intervals: [100, 250, 500] }
    )
    .toContain('PUSH SPACE KEY !');

  await page.keyboard.press('Space');

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          return (api.__pcg815?.readDisplayText() ?? []).join('\n');
        }),
      { timeout: 8_000, intervals: [100, 250, 500] }
    )
    .toContain('PUSH SPACE KEY !');

  await page.keyboard.press('Space');

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          return (api.__pcg815?.readDisplayText() ?? []).join('\n');
        }),
      { timeout: 8_000, intervals: [100, 250, 500] }
    )
    .toMatch(/Stage:|@\.\.K/);

  await page.keyboard.press('ArrowRight');

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          return (api.__pcg815?.readDisplayText() ?? []).join('\n');
        }),
      { timeout: 5_000, intervals: [100, 250, 500] }
    )
    .toContain('@');
});

test('sample game keeps player visible after each arrow key input', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await expect(page.locator('#boot-status')).toContainText(/READY/i, { timeout: 5_000 });

  await page.getByRole('button', { name: 'Sample Game' }).click();
  await page.getByRole('button', { name: 'RUN Program' }).click();
  await expect(page.locator('#basic-run-status')).toContainText(/Running/i, { timeout: 5_000 });
  await page.locator('#lcd').click();

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          return (api.__pcg815?.readDisplayText() ?? []).join('\n');
        }),
      { timeout: 5_000, intervals: [100, 250, 500] }
    )
    .toContain('PUSH SPACE KEY !');

  await page.keyboard.press('Space');

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          return (api.__pcg815?.readDisplayText() ?? []).join('\n');
        }),
      { timeout: 8_000, intervals: [100, 250, 500] }
    )
    .toContain('PUSH SPACE KEY !');

  await page.keyboard.press('Space');

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          return (api.__pcg815?.readDisplayText() ?? []).join('\n');
        }),
      { timeout: 8_000, intervals: [100, 250, 500] }
    )
    .toMatch(/Stage:|@\.\.K/);

  for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) {
    await page.keyboard.press(key);
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const api = window as { __pcg815?: { readDisplayText: () => string[] } };
            return (api.__pcg815?.readDisplayText() ?? []).join('\n');
          }),
        { timeout: 5_000, intervals: [100, 250, 500] }
      )
      .toContain('@');
  }
});

test('basic editor can rerun after STOP CPU with WAIT program', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#boot-status')).toContainText(/READY/i, { timeout: 5_000 });

  await page.locator('#basic-editor').fill('10 PRINT 1\n20 WAIT 255\n30 PRINT 2\n40 END');
  await page.getByRole('button', { name: 'RUN Program' }).click();
  await page.getByRole('button', { name: 'STOP CPU' }).click();
  await expect(page.locator('#basic-run-status')).toContainText(/Stopped/i, { timeout: 5_000 });

  await page.getByRole('button', { name: 'RUN Program' }).click();
  await expect(page.locator('#basic-run-status')).toContainText(/Run OK/i, { timeout: 20_000 });

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          return (api.__pcg815?.readDisplayText() ?? []).join('\n');
        }),
      { timeout: 20_000, intervals: [100, 250, 500, 1_000] }
    )
    .toContain('2');
});

test('z80-firmware RUN Program shows WAIT-loop progress before completion', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#boot-status')).toContainText(/READY/i, { timeout: 5_000 });

  await page.locator('#basic-editor').fill('10 PRINT 1\n20 WAIT 64\n30 PRINT 2\n40 END');
  await page.getByRole('button', { name: 'RUN Program' }).click();

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          const lines = api.__pcg815?.readDisplayText() ?? [];
          const status = document.querySelector('#basic-run-status')?.textContent ?? '';
          return { screen: lines.join('\n'), status };
        }),
      { timeout: 5_000, intervals: [100, 250, 500] }
    )
    .toEqual(expect.objectContaining({ screen: expect.stringContaining('1'), status: 'Running' }));

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          return (api.__pcg815?.readDisplayText() ?? []).join('\n');
        }),
      { timeout: 15_000, intervals: [100, 250, 500, 1_000] }
    )
    .toContain('2');

  await expect(page.locator('#basic-run-status')).toContainText(/Run OK/i, { timeout: 20_000 });
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          return (api.__pcg815?.readDisplayText() ?? []).join('\n');
        }),
      { timeout: 5_000, intervals: [100, 250, 500] }
    )
    .toContain('2');
});

test('strict URL parameter enables strict boot mode diagnostics', async ({ page }) => {
  await page.goto('/?strict=1&debug=1');
  await expect(page.locator('#boot-status')).toContainText(/READY/i, { timeout: 5_000 });
  await expect(page.locator('#boot-status')).toContainText(/strict=1/i);
});

test('machine monitor renders shadow registers and pin/bus visualization without debug flag', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#boot-status')).toContainText(/READY/i, { timeout: 5_000 });
  await expect(page.locator('#machine-monitor')).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const lcd = document.querySelector('#lcd') as HTMLCanvasElement | null;
          const monitor = document.querySelector('#machine-monitor') as HTMLElement | null;
          if (!lcd || !monitor) {
            return false;
          }
          const lcdRect = lcd.getBoundingClientRect();
          const monitorRect = monitor.getBoundingClientRect();
          return monitorRect.top >= lcdRect.bottom;
        }),
      { timeout: 2_000, intervals: [100, 250] }
    )
    .toBe(true);
  await expect(page.locator('#machine-monitor')).toContainText(/Machine Monitor/i);
  await expect(page.locator('#machine-monitor')).toContainText(/Shadow Registers/i);
  await expect(page.locator('#monitor-register-shadow')).toContainText(/AF'/i);
  await expect(page.locator('#monitor-register-shadow')).toContainText(/(N\/A|0x[0-9A-F]{4})/);
  await expect(page.locator('#monitor-address-hex')).toContainText(/^0x[0-9A-F]{4}$/);
  await expect(page.locator('#monitor-data-hex')).toContainText(/^0x[0-9A-F]{2}$/);
  await expect(page.locator('#monitor-flags-hex')).toContainText(/^0x[0-9A-F]{2}$/);
  await expect(page.locator('#monitor-flags-bits')).toContainText(/S/i);
  await expect(page.locator('#monitor-flags-bits')).toContainText(/Z/i);
  await expect(page.locator('#monitor-flags-bits')).toContainText(/PV/i);
  await expect(page.locator('#monitor-flags-bits')).toContainText(/N/i);
  await expect(page.locator('#monitor-flags-bits')).toContainText(/C/i);
  await expect(page.locator('#monitor-flags-bits')).toContainText(/X/i);
  await expect(page.locator('#monitor-flags-bits')).toContainText(/Y/i);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const main = document.querySelector('#monitor-register-main')?.closest('.monitor-card') as HTMLElement | null;
          const shadow = document.querySelector('#monitor-register-shadow')?.closest('.monitor-card') as HTMLElement | null;
          if (!main || !shadow) {
            return false;
          }
          const mainRect = main.getBoundingClientRect();
          const shadowRect = shadow.getBoundingClientRect();
          return shadowRect.left >= mainRect.right - 4 && Math.abs(shadowRect.top - mainRect.top) < 4;
        }),
      { timeout: 2_000, intervals: [100, 250] }
    )
    .toBe(true);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const address = document.querySelector('#monitor-address-hex')?.closest('.monitor-card') as HTMLElement | null;
          const data = document.querySelector('#monitor-data-hex')?.closest('.monitor-card') as HTMLElement | null;
          if (!address || !data) {
            return false;
          }
          const addressRect = address.getBoundingClientRect();
          const dataRect = data.getBoundingClientRect();
          return dataRect.left >= addressRect.right - 4 && Math.abs(dataRect.top - addressRect.top) < 4;
        }),
      { timeout: 2_000, intervals: [100, 250] }
    )
    .toBe(true);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const shadow = document.querySelector('#monitor-register-shadow')?.closest('.monitor-card') as HTMLElement | null;
          const flags = document.querySelector('#monitor-flags-hex')?.closest('.monitor-card') as HTMLElement | null;
          if (!shadow || !flags) {
            return false;
          }
          const shadowRect = shadow.getBoundingClientRect();
          const flagsRect = flags.getBoundingClientRect();
          const verticalGap = flagsRect.top - shadowRect.bottom;
          return verticalGap >= -1 && verticalGap <= 24;
        }),
      { timeout: 2_000, intervals: [100, 250] }
    )
    .toBe(true);
  await expect(page.locator('#monitor-pin-grid')).toContainText(/MREQ/i);
  await expect(page.locator('#log-view')).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const log = document.querySelector('#log-view');
          return log?.closest('#machine-monitor')?.id ?? '';
        }),
      { timeout: 2_000, intervals: [100, 250] }
    )
    .toBe('machine-monitor');
});

test('accepts keyboard input on boot prompt without editor focus', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#boot-status')).toContainText(/READY/i, { timeout: 5_000 });
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          const lines = api.__pcg815?.readDisplayText() ?? [];
          return lines.some((line) => line.trimStart().startsWith('>'));
        }),
      { timeout: 5_000, intervals: [100, 250, 500] }
    )
    .toBe(true);

  await page.locator('#lcd').click();
  await page.keyboard.press('KeyA');

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          return (api.__pcg815?.readDisplayText() ?? []).join('\n');
        }),
      { timeout: 5_000, intervals: [100, 250, 500] }
    )
    .toContain('> A');
});

test('boot prompt does not duplicate prompt after RUN or syntax error', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#boot-status')).toContainText(/READY/i, { timeout: 5_000 });

  await page.locator('#lcd').click();
  await page.keyboard.type('RUN');
  await page.keyboard.press('Enter');

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          return api.__pcg815?.readDisplayText() ?? [];
        }),
      { timeout: 5_000, intervals: [100, 250, 500] }
    )
    .toEqual(expect.arrayContaining([expect.stringContaining('> RUN')]));

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          return (api.__pcg815?.readDisplayText() ?? []).join('\n');
        }),
      { timeout: 5_000, intervals: [100, 250, 500] }
    )
    .not.toContain('> >');

  await page.keyboard.type('XXX');
  await page.keyboard.press('Enter');

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          return (api.__pcg815?.readDisplayText() ?? []).join('\n');
        }),
      { timeout: 5_000, intervals: [100, 250, 500] }
    )
    .toContain('ERR SYNTAX (E01)');

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          return (api.__pcg815?.readDisplayText() ?? []).join('\n');
        }),
      { timeout: 5_000, intervals: [100, 250, 500] }
    )
    .not.toContain('> R SYNTAX');
});

test('kana mode renders half-width katakana on LCD', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#boot-status')).toContainText(/READY/i, { timeout: 5_000 });

  await page.getByRole('button', { name: /かな OFF/i }).click();
  await expect(page.getByRole('button', { name: /かな ON/i })).toBeVisible();

  await page.keyboard.press('KeyS');
  await page.keyboard.press('KeyA');

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { readDisplayText: () => string[] } };
          const lines = api.__pcg815?.readDisplayText() ?? [];
          return lines.some((line) => [...line].some((ch) => ch.charCodeAt(0) === 0xbb));
        }),
      { timeout: 5_000, intervals: [100, 250, 500] }
    )
    .toBe(true);
});
