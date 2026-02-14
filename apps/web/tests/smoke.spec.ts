import { expect, test } from '@playwright/test';

test('app boots and renders lit LCD pixels without runtime errors', async ({ page }) => {
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

  await expect(page.locator('#boot-status')).toContainText(/READY/i, { timeout: 5_000 });
  await expect(page.locator('#boot-status')).toContainText(/strict=0/i);

  await expect(page.locator('#font-debug-panel')).toBeHidden();
  await page.getByRole('button', { name: 'Fonts' }).click();
  await expect(page.locator('#font-debug-panel')).toBeVisible();
  await expect(page.locator('#font-debug-meta')).toContainText(/0x41/i);
  await expect(page.locator('#font-kana-canvas')).toBeVisible();

  // Stop CPU loop so ASCII FIFO is not consumed by runtime while testing input mapping.
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('button', { name: 'Run' })).toBeVisible();

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
  await page.locator('#font-kana-canvas').click({ position: { x: 30, y: 8 } });
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

  await page.evaluate(() => {
    (window as { __pcg815?: { injectBasicLine: (line: string) => void } }).__pcg815?.injectBasicLine(
      'PRINT 321'
    );
  });

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const api = window as { __pcg815?: { getTextLines: () => string[] } };
          const lines = api.__pcg815?.getTextLines() ?? [];
          return lines.join('\n');
        }),
      {
        timeout: 5_000,
        intervals: [100, 250, 500]
      }
    )
    .toContain('321');

  const speedText = await page.locator('#speed-indicator').innerText();
  expect(speedText.toLowerCase()).toContain('x');

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('strict URL parameter enables strict boot mode diagnostics', async ({ page }) => {
  await page.goto('/?strict=1&debug=1');
  await expect(page.locator('#boot-status')).toContainText(/READY/i, { timeout: 5_000 });
  await expect(page.locator('#boot-status')).toContainText(/strict=1/i);
});
