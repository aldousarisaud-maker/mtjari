import { expect, test } from '@playwright/test';

for (const path of ['/ar', '/en', '/ar/login', '/ar/register']) {
  test(`no horizontal overflow on ${path}`, async ({ page }) => {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
