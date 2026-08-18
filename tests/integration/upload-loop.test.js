import { expect, test } from '@playwright/test';

test('L03/L04/L06: explicit rejection adapts once and redispatches without a business click', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.js' });
  await page.evaluate(() => {
    globalThis.__uploadfit_debug_bundle__.cleanupSession();
    const api = globalThis.__uploadfit_debug_bundle__;
    const controller = api.createTaskController({ documentRef: document, globalRef: window });
    const wrapper = document.createElement('section');
    const label = document.createElement('label');
    label.textContent = '上传图片';
    const input = document.createElement('input');
    input.type = 'file';
    label.append(input);
    const error = document.createElement('div');
    error.className = 'upload-error';
    wrapper.append(label, error);
    document.body.append(wrapper);
    globalThis.__s3Controller = controller;
    globalThis.__s3Input = input;
    globalThis.__s3Error = error;
    globalThis.__s3Changes = 0;
    globalThis.__s3Clicks = 0;
    input.addEventListener('change', () => { globalThis.__s3Changes += 1; });
    document.addEventListener('click', () => { globalThis.__s3Clicks += 1; }, { once: false });
    controller.start();
  });
  await page.evaluate(async () => {
    const response = await window.fetch('/tests/fixtures/generated/png-1170x1701.png');
    const file = new File([await response.arrayBuffer()], 'source.png', { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    globalThis.__s3Input.files = transfer.files;
    globalThis.__s3Input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  });
  await expect.poll(
    () => page.evaluate(() => globalThis.__s3Controller.getSnapshot().activeTask?.status),
    { timeout: 10_000 }
  ).toBe('WAITING_REJECTION');
  await page.evaluate(() => {
    globalThis.__s3Error.textContent = '仅支持 JPG 格式，尺寸必须为390×567像素，最大120KB';
  });
  await expect.poll(
    () => page.evaluate(() => {
      const task = globalThis.__s3Controller.getSnapshot().activeTask;
      return task?.status === 'SUCCESS' && task.retryCount === 1;
    }),
    { timeout: 30_000 }
  ).toBe(true);
  await page.evaluate(() => {
    globalThis.__s3Error.textContent = '图片尺寸必须为100×200像素';
  });
  await expect.poll(
    () => page.evaluate(() => globalThis.__s3Controller.getSnapshot().activeTask?.status),
    { timeout: 10_000 }
  ).toBe('STOPPED');

  const result = await page.evaluate(() => ({
    snapshot: globalThis.__s3Controller.getSnapshot(),
    changes: globalThis.__s3Changes,
    clicks: globalThis.__s3Clicks,
    currentType: globalThis.__s3Input.files[0].type
  }));
  expect(result.snapshot.activeTask.errorCode).toBe('PROCESSING_FAILED');
  expect(result.snapshot.activeTask.retryCount).toBe(1);
  expect(result.snapshot.activeTask.status).toBe('STOPPED');
  expect(result.currentType).toBe('image/jpeg');
  expect(result.changes).toBe(3);
  expect(result.clicks).toBe(0);
  await page.evaluate(() => globalThis.__s3Controller.dispose());
});

test('L07: two uploaders keep tasks and rejection nodes isolated', async ({ page }) => {
  await page.goto('/test-pages/probe.html');
  await page.addScriptTag({ url: '/dist/uploadfit.js' });
  await page.evaluate(() => {
    const api = globalThis.__uploadfit_debug_bundle__;
    api.cleanupSession();
    const makeScope = (id) => {
      const wrapper = document.createElement('section');
      const label = document.createElement('label');
      label.textContent = '上传图片 ' + id;
      const input = document.createElement('input');
      input.type = 'file';
      const error = document.createElement('div');
      error.className = 'error';
      error.id = 's3-error-' + id;
      input.setAttribute('aria-describedby', error.id);
      label.append(input);
      wrapper.append(label, error);
      document.body.append(wrapper);
      return { input, error };
    };
    const first = makeScope('一');
    const second = makeScope('二');
    globalThis.__s3First = first;
    globalThis.__s3Second = second;
    globalThis.__s3Controller = api.createTaskController({
      documentRef: document,
      globalRef: window
    });
    globalThis.__s3Controller.start();
  });
  await page.evaluate(() => {
    const select = (input, name) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['local'], name, { type: 'image/jpeg' }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    };
    select(globalThis.__s3First.input, 'first.jpg');
    select(globalThis.__s3Second.input, 'second.jpg');
  });
  await expect.poll(
    () => page.evaluate(() => [...globalThis.__s3Controller.tasks.values()].length),
    { timeout: 10_000 }
  ).toBe(2);
  await page.evaluate(() => {
    globalThis.__s3First.error.textContent = '图片尺寸必须为390×567像素';
  });
  await expect.poll(
    () => page.evaluate(() => {
      const tasks = [...globalThis.__s3Controller.tasks.values()];
      return tasks.some((task) => task.inputElement === globalThis.__s3First.input
        && task.status === 'STOPPED');
    }),
    { timeout: 10_000 }
  ).toBe(true);
  const result = await page.evaluate(() => [...globalThis.__s3Controller.tasks.values()].map((task) => ({
    input: task.inputElement === globalThis.__s3First.input ? 'first' : 'second',
    status: task.status,
    errorCode: task.errorCode ?? null
  })));
  expect(result).toEqual([
    { input: 'first', status: 'STOPPED', errorCode: 'DECODE_FAILED' },
    { input: 'second', status: 'WAITING_REJECTION', errorCode: null }
  ]);
  await page.evaluate(() => globalThis.__s3Controller.dispose());
});
