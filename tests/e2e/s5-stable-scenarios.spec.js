import { expect, test } from '@playwright/test';
import path from 'node:path';

const fixture = (name) => path.join(process.cwd(), 'tests', 'fixtures', 'generated', name);

async function openScenario(page, scenario, variant = null) {
  const suffix = variant ? `&variant=${variant}` : '';
  await page.goto(`/test-pages/index.html?scenario=${scenario}${suffix}`);
  await expect(page.locator('#scenario-file')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    globalThis.__uploadfit_session__?.controller?.getSnapshot?.().uploaderCount ?? 0
  ))).toBe(1);
}

async function snapshot(page) {
  return page.evaluate(() => globalThis.__uploadfit_session__?.controller?.getSnapshot?.() ?? null);
}

async function waitForTask(page, predicate, timeout = 15_000) {
  await expect.poll(async () => {
    const current = await snapshot(page);
    return predicate(current?.activeTask ?? null, current);
  }, { timeout }).toBe(true);
}

test('S5 E01-E05: 场景 A 通过真实 input 完成预检适配并记录元信息', async ({ page }) => {
  await openScenario(page, 'A');
  await page.locator('#scenario-file').setInputFiles(fixture('png-1170x1701.png'));

  await waitForTask(page, (task) => ['SUCCESS', 'PASSTHROUGH'].includes(task?.status));
  const result = await snapshot(page);
  const pageState = await page.evaluate(() => globalThis.uploadFitTestPage.getState());

  expect(result.activeTask.result.metadata).toMatchObject({
    mime: 'image/jpeg',
    width: 390,
    height: 567
  });
  expect(result.activeTask.result.metadata.size).toBeGreaterThanOrEqual(30_720);
  expect(result.activeTask.result.metadata.size).toBeLessThanOrEqual(108_000);
  expect(pageState.events.some((event) => event.type === 'change')).toBe(true);
  expect(pageState.events.every((event) => Object.hasOwn(event, 'isTrusted'))).toBe(true);
  expect(pageState.submitClickCount).toBe(0);
});

test('S5 E08-E09: 场景 B 只重试一次并让页面接受重试结果', async ({ page }) => {
  await openScenario(page, 'B');
  await page.locator('#scenario-file').setInputFiles(fixture('png-1170x1701.png'));

  await waitForTask(page, (task) => task?.status === 'SUCCESS' && task.retryCount === 1, 20_000);
  const result = await snapshot(page);
  const pageState = await page.evaluate(() => globalThis.uploadFitTestPage.getState());

  expect(result.activeTask.source).toBe('rejection');
  expect(result.activeTask.retryCount).toBe(1);
  expect(pageState.businessChangeCount).toBeGreaterThanOrEqual(2);
  expect(pageState.rejectionCount).toBe(1);
  expect(pageState.events.filter((event) => event.type === 'change').length).toBeGreaterThanOrEqual(2);
});

test('S5 E10: 场景 D 的模糊错误安全停止且不处理、不重试', async ({ page }) => {
  await openScenario(page, 'D');
  await page.locator('#scenario-file').setInputFiles(fixture('jpeg-390x567-medium.jpg'));

  await waitForTask(page, (task) => task?.status === 'STOPPED', 10_000);
  const result = await snapshot(page);
  const pageState = await page.evaluate(() => globalThis.uploadFitTestPage.getState());

  expect(result.activeTask.errorCode).toBe('PROCESSING_FAILED');
  expect(result.activeTask.retryCount).toBe(0);
  expect(pageState.businessChangeCount).toBe(1);
  expect(pageState.submitClickCount).toBe(0);
});

test('S5 E06: 场景 C 通过真实裁剪按钮确认并输出 exact 尺寸', async ({ page }) => {
  await page.goto('/test-pages/ui-harness.html?scenario=C&variant=confirm');
  await expect(page.locator('#scenario-file')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    globalThis.__uploadfit_s5_ui_harness__?.controller?.getSnapshot?.().uploaderCount ?? 0
  ))).toBe(1);
  await page.locator('#scenario-file').setInputFiles(fixture('jpeg-4000x3000.jpg'));
  await expect.poll(() => page.evaluate(() => (
    globalThis.__uploadfit_s5_ui_harness__?.controller?.getSnapshot?.().activeTask?.status ?? null
  ))).toBe('NEEDS_CONFIRMATION');
  await page.evaluate(() => globalThis.__uploadfit_s5_ui_harness__.ui.expand());

  const host = page.locator('[data-uploadfit-ui-host]');
  await expect(host.locator('[data-uf-action="confirm-crop"]')).toBeVisible();
  await host.locator('[data-uf-action="confirm-crop"]').click();
  await expect.poll(() => page.evaluate(() => (
    globalThis.__uploadfit_s5_ui_harness__?.controller?.getSnapshot?.().activeTask?.status ?? null
  ))).toBe('SUCCESS');
  const result = await page.evaluate(() => globalThis.__uploadfit_s5_ui_harness__.controller.getSnapshot());
  expect(result.activeTask.result.metadata).toMatchObject({ width: 390, height: 520 });
});

test('S5 E07: 场景 C 取消裁剪后原文件保持不变', async ({ page }) => {
  await page.goto('/test-pages/ui-harness.html?scenario=C&variant=cancel');
  await expect(page.locator('#scenario-file')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    globalThis.__uploadfit_s5_ui_harness__?.controller?.getSnapshot?.().uploaderCount ?? 0
  ))).toBe(1);
  await page.locator('#scenario-file').setInputFiles(fixture('jpeg-4000x3000.jpg'));
  await expect.poll(() => page.evaluate(() => (
    globalThis.__uploadfit_s5_ui_harness__?.controller?.getSnapshot?.().activeTask?.status ?? null
  ))).toBe('NEEDS_CONFIRMATION');
  const original = await page.locator('#scenario-file').evaluate((node) => ({
    type: node.files[0].type,
    size: node.files[0].size
  }));
  await page.evaluate(() => globalThis.__uploadfit_s5_ui_harness__.ui.expand());
  const host = page.locator('[data-uploadfit-ui-host]');
  await expect(host.locator('[data-uf-action="cancel-crop"]')).toBeVisible();
  await host.locator('[data-uf-action="cancel-crop"]').click();
  await expect.poll(() => page.evaluate(() => (
    globalThis.__uploadfit_s5_ui_harness__?.controller?.getSnapshot?.().activeTask?.status ?? null
  ))).toBe('STOPPED');
  const after = await page.locator('#scenario-file').evaluate((node) => ({
    type: node.files[0].type,
    size: node.files[0].size
  }));
  expect(after).toEqual(original);
});

test('S5 E11: 场景 E 处理后不自动点击业务提交按钮', async ({ page }) => {
  await openScenario(page, 'E');
  await page.locator('#scenario-file').setInputFiles(fixture('png-1170x1701.png'));

  await waitForTask(page, (task) => ['SUCCESS', 'PASSTHROUGH'].includes(task?.status));
  const pageState = await page.evaluate(() => globalThis.uploadFitTestPage.getState());
  expect(pageState.submitClickCount).toBe(0);
  expect(pageState.businessChangeCount).toBeGreaterThanOrEqual(1);
});

test('S5 场景 F：官方工具要求阻止本地处理', async ({ page }) => {
  await openScenario(page, 'F');
  await page.locator('#scenario-file').setInputFiles(fixture('jpeg-390x567-medium.jpg'));

  await waitForTask(page, (task) => task?.status === 'STOPPED', 10_000);
  const result = await snapshot(page);
  expect(result.activeTask.errorCode).toBe('OFFICIAL_TOOL_REQUIRED');
  expect(result.activeTask.result).toBeNull();
  expect(result.activeTask.retryCount).toBe(0);
});

test('S5 E15: 用户点击关闭后移除 UI、监听和任务会话', async ({ page }) => {
  await page.goto('/test-pages/ui-harness.html?scenario=A&variant=close');
  await expect(page.locator('#scenario-root')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    globalThis.__uploadfit_s5_ui_harness__?.controller?.getSnapshot?.().uploaderCount ?? 0
  ))).toBe(1);
  await page.evaluate(() => globalThis.__uploadfit_s5_ui_harness__.ui.expand());

  const host = page.locator('[data-uploadfit-ui-host]');
  await expect(host.locator('[aria-label="关闭 UploadFit"]')).toBeVisible();
  await host.locator('[aria-label="关闭 UploadFit"]').click();
  await expect(host).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (
    globalThis.__uploadfit_s5_ui_harness__.controller.disposed
  ))).toBe(true);
});

test('S5 X01/X03/X04: 动态 input、open Shadow 和 closed Shadow 均有诚实边界', async ({ page }) => {
  await openScenario(page, 'A');
  const before = await snapshot(page);
  await page.evaluate(() => globalThis.uploadFitTestPage.addDynamicInput());
  await expect.poll(() => page.evaluate(() => (
    globalThis.__uploadfit_session__?.controller?.getSnapshot?.().uploaderCount ?? 0
  ))).toBe(2);

  await page.evaluate(() => globalThis.uploadFitTestPage.addShadowInput('open'));
  await expect.poll(() => page.evaluate(() => (
    globalThis.__uploadfit_session__?.controller?.getSnapshot?.().uploaderCount ?? 0
  ))).toBe(3);

  await page.evaluate(() => globalThis.uploadFitTestPage.addShadowInput('closed'));
  await page.waitForTimeout(250);
  const after = await snapshot(page);
  expect(before.uploaderCount).toBe(1);
  expect(after.uploaderCount).toBe(3);
  expect(after.sessionState).not.toBe('STOPPED');
});

test('S5 X08: multiple 两张文件保持集合不变且不创建处理任务', async ({ page }) => {
  await openScenario(page, 'A');
  await page.locator('#scenario-file').evaluate((node) => { node.multiple = true; });
  await page.locator('#scenario-file').setInputFiles([
    fixture('png-1170x1701.png'),
    fixture('jpeg-390x567-medium.jpg')
  ]);
  await page.waitForTimeout(400);

  const state = await page.evaluate(() => ({
    files: [...document.querySelector('#scenario-file').files].map((file) => ({ type: file.type, size: file.size })),
    snapshot: globalThis.__uploadfit_session__?.controller?.getSnapshot?.()
  }));
  expect(state.files).toHaveLength(2);
  expect(state.snapshot.activeTask).toBeNull();
});

test('S5 X11: 快速连续选择时旧任务不会覆盖最后一次选择', async ({ page }) => {
  await openScenario(page, 'A');
  const input = page.locator('#scenario-file');
  await input.setInputFiles(fixture('png-1170x1701.png'));
  await input.setInputFiles(fixture('jpeg-390x567-medium.jpg'));

  await waitForTask(page, (task) => ['SUCCESS', 'PASSTHROUGH'].includes(task?.status), 20_000);
  const result = await snapshot(page);
  expect(result.activeTask.current.mime).toBe('image/jpeg');
  expect(result.activeTask.current.width).toBe(390);
  expect(result.activeTask.current.height).toBe(567);
});

test('S5 D1: 首页可一键进入六个稳定场景', async ({ page }) => {
  await page.goto('/test-pages/index.html');
  await expect(page.locator('[data-scenario-link]')).toHaveCount(6);
  for (const scenario of ['A', 'B', 'C', 'D', 'E', 'F']) {
    await expect(page.locator(`[data-scenario-link="${scenario}"]`)).toHaveAttribute('href', new RegExp(`scenario=${scenario}`));
  }
});
