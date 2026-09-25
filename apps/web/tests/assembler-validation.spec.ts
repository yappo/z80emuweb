import { expect, test } from '@playwright/test';

for (const source of ['ORG', 'DB 256', 'DS 1,256', 'LD IXH,(IX+1)', 'ORG 0x7fff\nDW 1']) {
  test(`assembler shows a located diagnostic and recovers after ${JSON.stringify(source)}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await expect(page.locator('#boot-status')).toContainText(/READY/i);
    await page.getByRole('tab', { name: 'ASSEMBLER' }).click();
    await page.locator('#asm-editor').fill(source);
    await page.locator('#asm-assemble').click();
    await expect(page.locator('#asm-run-status')).toHaveText('Assemble failed');
    await expect(page.locator('#asm-dump-view')).toContainText(/web-editor\.asm:\d+:\d+:/);

    await page.locator('#asm-editor').fill("BASE EQU 0x200\nORG BASE\nSTART: EX AF,AF' ; swap\nSIZE EQU $-START\nDB SIZE\nHALT");
    await page.locator('#asm-assemble').click();
    await expect(page.locator('#asm-run-status')).toHaveText('Assemble OK');
    await expect(page.locator('#asm-dump-view')).toContainText('0200: 080176');
    expect(errors).toEqual([]);
  });
}
