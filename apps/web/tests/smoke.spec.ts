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

  await expect(page.locator('#boot-status')).toContainText(/READY/i, { timeout: 5_000 });
  await expect(page.locator('#boot-status')).toContainText(/strict=0/i);

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
