import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'correct-horse-battery';

/** Reads the newest email for an address from the SMTP sink and returns its link. */
export async function mailLink(to: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`http://127.0.0.1:2526/?to=${encodeURIComponent(to)}`);
    const mail = (await res.json()) as { body: string } | null;
    const match = mail?.body.match(/http:\/\/localhost:\d+\/(?:ar|en)\/[a-z/-]+\?token=[A-Za-z0-9_-]+/);
    if (match) return match[0];
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no email with a link arrived for ${to}`);
}

export async function register(page: Page, email: string, name: string) {
  await page.goto('/ar/register');
  await page.getByLabel('الاسم').fill(name);
  await page.getByLabel('البريد الإلكتروني').fill(email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'إنشاء الحساب' }).click();
  await expect(page.getByRole('status')).toContainText('رابط التأكيد');
  await page.goto(await mailLink(email));
  await page.getByRole('button', { name: 'تأكيد البريد' }).click();
  await expect(page.getByRole('status')).toContainText('تم تأكيد بريدك');
}

export async function login(page: Page, email: string) {
  await page.goto('/ar/login');
  await page.getByLabel('البريد الإلكتروني').fill(email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await expect(page).toHaveURL(/\/ar\/dashboard$/);
}
