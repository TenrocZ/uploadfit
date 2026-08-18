import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const rootDir = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const outputDir = path.join(rootDir, 'tests', 'fixtures', 'generated');

async function main() {
  await mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const generated = await page.evaluate(async () => {
      async function canvasFile(width, height, type, name, quality, transparent = false) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        const imageData = context.createImageData(width, height);
        for (let index = 0; index < imageData.data.length; index += 4) {
          const pixel = index / 4;
          imageData.data[index] = (pixel * 17 + width) % 256;
          imageData.data[index + 1] = (pixel * 31 + height) % 256;
          imageData.data[index + 2] = (pixel * 47 + width + height) % 256;
          imageData.data[index + 3] = transparent && pixel % 5 === 0 ? 0 : 255;
        }
        context.putImageData(imageData, 0, 0);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
        if (!blob || blob.type !== type) throw new Error(`ENCODER_UNAVAILABLE:${type}`);
        return { name, type, width, height, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) };
      }

      function addOrientation6(bytes) {
        const app1 = new Uint8Array([
          0xff, 0xe1, 0x00, 0x22,
          0x45, 0x78, 0x69, 0x66, 0, 0,
          0x49, 0x49, 0x2a, 0, 0x08, 0, 0, 0,
          0x01, 0,
          0x12, 0x01, 0x03, 0x00,
          0x01, 0x00, 0x00, 0x00,
          0x06, 0x00, 0x00, 0x00,
          0, 0, 0, 0
        ]);
        const output = new Uint8Array(bytes.length + app1.length);
        output.set(bytes.slice(0, 2), 0);
        output.set(app1, 2);
        output.set(bytes.slice(2), 2 + app1.length);
        return output;
      }

      const samples = [];
      const medium = await canvasFile(390, 567, 'image/jpeg', 'jpeg-390x567-medium.jpg', 0.82);
      const small = await canvasFile(390, 567, 'image/jpeg', 'jpeg-390x567-small.jpg', 0.45);
      const large = await canvasFile(4000, 3000, 'image/jpeg', 'jpeg-4000x3000.jpg', 0.92);
      const png = await canvasFile(1170, 1701, 'image/png', 'png-1170x1701.png');
      const transparent = await canvasFile(390, 567, 'image/png', 'transparent.png', undefined, true);
      const orientationSource = await canvasFile(100, 50, 'image/jpeg', 'orientation-source.jpg', 0.9);
      samples.push(medium, small, large, png, transparent, {
        name: 'jpeg-orientation-6.jpg', type: 'image/jpeg', width: 50, height: 100,
        bytes: Array.from(addOrientation6(new Uint8Array(orientationSource.bytes)))
      });
      samples.push({ name: 'corrupt.png', type: 'image/png', width: null, height: null, bytes: [0x89, 0x50, 0x4e, 0x47, 0, 0, 0] });
      try {
        samples.push(await canvasFile(390, 567, 'image/webp', 'sample.webp', 0.85));
      } catch {
        samples.push({ name: 'sample.webp', type: 'image/webp', width: null, height: null, bytes: [] });
      }
      return samples;
    });

    for (const fixture of generated) {
      const bytes = Buffer.from(fixture.bytes);
      await writeFile(path.join(outputDir, fixture.name), bytes);
      const digest = createHash('sha256').update(bytes).digest('hex').toUpperCase();
      console.log(JSON.stringify({
        name: fixture.name,
        mime: fixture.type,
        bytes: bytes.length,
        width: fixture.width,
        height: fixture.height,
        sha256: digest
      }));
    }
  } finally {
    await browser.close();
  }
}

await main();

