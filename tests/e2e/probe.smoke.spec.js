import { expect, test } from '@playwright/test';

test('serves the S0 probe page', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await expect(page).toHaveTitle('UploadFit S0 File 回填探针');
  await expect(page.getByRole('heading', { name: /File.*DataTransfer.*input\.files.*change/ })).toBeVisible();
});

