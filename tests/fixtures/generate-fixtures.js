import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { detectImageSignature } from '../../src/utils/mime.js';

const rootDir = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const outputDir = path.join(rootDir, 'tests', 'fixtures', 'generated');

const SIZE_FIXTURES = Object.freeze([
  {
    name: 'png-1170x1701.png', mime: 'image/png', width: 1170, height: 1701,
    targetBytes: 2_000_000, toleranceRatio: 0.25,
    purpose: 'medium PNG byte-range and decode input', kind: 'png'
  },
  {
    name: 'jpeg-390x567-medium.jpg', mime: 'image/jpeg', width: 390, height: 567,
    targetBytes: 500_000, toleranceRatio: 0.25,
    purpose: 'medium JPEG compression input', kind: 'jpeg-noise'
  },
  {
    name: 'jpeg-390x567-small.jpg', mime: 'image/jpeg', width: 390, height: 567,
    targetBytes: 20_000, toleranceRatio: 0.25,
    purpose: 'small JPEG minimum-byte boundary input', kind: 'jpeg-smooth'
  },
  {
    name: 'jpeg-4000x3000.jpg', mime: 'image/jpeg', width: 4000, height: 3000,
    targetBytes: 5_000_000, toleranceRatio: 0.25,
    purpose: 'large local photo performance and resize input', kind: 'jpeg-noise'
  }
]);

function assertWithinTarget(spec, bytes) {
  const minimum = Math.round(spec.targetBytes * (1 - spec.toleranceRatio));
  const maximum = Math.round(spec.targetBytes * (1 + spec.toleranceRatio));
  if (bytes < minimum || bytes > maximum) {
    throw new Error(`FIXTURE_TARGET_UNREACHABLE:${spec.name}:${bytes}:${minimum}-${maximum}`);
  }
}

function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

async function main() {
  if (process.env.UPLOADFIT_FIXTURE_FORCE_FAILURE === '1') {
    throw new Error('FIXTURE_TARGET_UNREACHABLE:forced-test-failure');
  }
  await mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const generated = await page.evaluate(async (sizeFixtures) => {
      function pixelValue(x, y, channel, seed = 1) {
        let value = (Math.imul(x + seed, 374761393) ^ Math.imul(y + seed * 17, 668265263)) >>> 0;
        value = Math.imul(value ^ (value >>> 13), 1274126177) >>> 0;
        return (value ^ (value >>> 16) ^ channel * 53) & 0xff;
      }

      function drawNoise(context, width, height, blockSize = 1, seed = 1, alpha = false) {
        const imageData = context.createImageData(width, height);
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const blockX = Math.floor(x / blockSize);
            const blockY = Math.floor(y / blockSize);
            const offset = (y * width + x) * 4;
            imageData.data[offset] = pixelValue(blockX, blockY, 0, seed);
            imageData.data[offset + 1] = pixelValue(blockX, blockY, 1, seed + 11);
            imageData.data[offset + 2] = pixelValue(blockX, blockY, 2, seed + 23);
            imageData.data[offset + 3] = alpha && ((x + y) % 7 === 0) ? 0 : 255;
          }
        }
        context.putImageData(imageData, 0, 0);
      }

      function drawSmooth(context, width, height) {
        const gradient = context.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, '#13294b');
        gradient.addColorStop(0.35, '#d9a441');
        gradient.addColorStop(0.7, '#3478b9');
        gradient.addColorStop(1, '#f4e5c2');
        context.fillStyle = gradient;
        context.fillRect(0, 0, width, height);
        for (let index = 0; index < 18; index += 1) {
          context.fillStyle = `rgba(${(index * 47) % 256},${(index * 71) % 256},${(index * 97) % 256},0.45)`;
          context.fillRect(
            (index * width) / 19,
            (index * height) / 23,
            Math.max(2, width / 13),
            Math.max(2, height / 17)
          );
        }
      }

      async function canvasBytes(spec, candidate) {
        const canvas = document.createElement('canvas');
        canvas.width = spec.width;
        canvas.height = spec.height;
        const context = canvas.getContext('2d', { willReadFrequently: false });
        if (!context) throw new Error(`FIXTURE_CANVAS_UNAVAILABLE:${spec.name}`);
        if (candidate.kind === 'smooth') drawSmooth(context, spec.width, spec.height);
        else drawNoise(
          context,
          spec.width,
          spec.height,
          candidate.blockSize ?? 1,
          candidate.seed ?? 1,
          candidate.alpha === true
        );
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, spec.mime, candidate.quality));
        if (!blob || blob.type !== spec.mime || blob.size <= 0) {
          throw new Error(`FIXTURE_ENCODER_UNAVAILABLE:${spec.name}:${spec.mime}`);
        }
        const bitmap = await createImageBitmap(blob, { imageOrientation: 'none' });
        if (bitmap.width !== spec.width || bitmap.height !== spec.height) {
          bitmap.close();
          throw new Error(`FIXTURE_DIMENSION_MISMATCH:${spec.name}`);
        }
        bitmap.close();
        return { bytes: Array.from(new Uint8Array(await blob.arrayBuffer())), candidate };
      }

      async function nearestTarget(spec, candidates) {
        const results = [];
        for (const candidate of candidates) results.push(await canvasBytes(spec, candidate));
        return results.map((result) => ({
          ...result,
          bytes: spec.mime === 'image/jpeg'
            ? padJpegMetadata(result.bytes, spec.targetBytes)
            : result.bytes
        })).sort((first, second) => (
          Math.abs(first.bytes.length - spec.targetBytes) - Math.abs(second.bytes.length - spec.targetBytes)
        ))[0];
      }

      function padJpegMetadata(bytes, targetBytes) {
        if (!targetBytes || bytes.length >= targetBytes) return bytes;
        const padding = [];
        let remaining = targetBytes - bytes.length;
        while (remaining >= 6) {
          const dataLength = Math.min(remaining - 4, 65_531);
          const segment = new Uint8Array(dataLength + 4);
          segment[0] = 0xff;
          segment[1] = 0xe1;
          segment[2] = (dataLength + 2) >>> 8;
          segment[3] = (dataLength + 2) & 0xff;
          padding.push(segment);
          remaining -= segment.length;
        }
        const output = new Uint8Array(bytes.length + padding.reduce((sum, item) => sum + item.length, 0));
        output.set(bytes.slice(0, 2), 0);
        let offset = 2;
        for (const segment of padding) {
          output.set(segment, offset);
          offset += segment.length;
        }
        output.set(bytes.slice(2), offset);
        return Array.from(output);
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

      const generated = [];
      for (const spec of sizeFixtures) {
        const candidates = spec.kind === 'png'
          ? [1, 2, 3, 4, 6, 8, 12, 16].map((blockSize) => ({ blockSize, seed: 31 }))
          : spec.kind === 'jpeg-smooth'
            ? [0.45, 0.55, 0.65, 0.75, 0.85, 0.95].map((quality) => ({ kind: 'smooth', quality }))
            : [0.45, 0.55, 0.65, 0.75, 0.85, 0.92, 0.95].map((quality, index) => ({
              quality, seed: index + (spec.width > 1000 ? 101 : 7)
            }));
        const selected = await nearestTarget(spec, candidates);
        generated.push({
          ...spec,
          bytes: selected.bytes,
          selectedCandidate: selected.candidate
        });
      }

      const orientationSource = await canvasBytes(
        { name: 'orientation-source.jpg', mime: 'image/jpeg', width: 100, height: 50 },
        { quality: 0.9, seed: 19 }
      );
      const orientationBytes = addOrientation6(new Uint8Array(orientationSource.bytes));
      const transparent = await canvasBytes(
        { name: 'transparent.png', mime: 'image/png', width: 390, height: 567 },
        { blockSize: 7, seed: 47, alpha: true }
      );
      generated.push({
        name: 'transparent.png', mime: 'image/png', width: 390, height: 567,
        purpose: 'alpha-preserving JPEG flatten confirmation input', hasAlpha: true,
        bytes: transparent.bytes
      });
      generated.push({
        name: 'jpeg-orientation-6.jpg', mime: 'image/jpeg', width: 50, height: 100,
        encodedWidth: 100, encodedHeight: 50, orientation: 6,
        purpose: 'EXIF orientation normalization input', bytes: Array.from(orientationBytes)
      });
      generated.push({
        name: 'corrupt.png', mime: 'image/png', width: null, height: null,
        purpose: 'corrupt input primary DECODE_FAILED path', decodable: false,
        bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]
      });
      const webpSpec = { name: 'sample.webp', mime: 'image/webp', width: 390, height: 567 };
      let webp;
      try {
        webp = await canvasBytes(webpSpec, { quality: 0.85, seed: 73 });
      } catch (error) {
        throw new Error(`FIXTURE_CAPABILITY_UNAVAILABLE:${error.message}`);
      }
      generated.push({
        ...webpSpec,
        purpose: 'WebP support and MIME/signature input',
        bytes: webp.bytes
      });
      return generated;
    }, SIZE_FIXTURES);

    const manifestSamples = [];
    for (const fixture of generated) {
      const bytes = Buffer.from(fixture.bytes);
      const signatureMime = detectImageSignature(new Uint8Array(bytes));
      if (signatureMime !== fixture.mime) {
        throw new Error(`FIXTURE_SIGNATURE_MISMATCH:${fixture.name}:${signatureMime}:${fixture.mime}`);
      }
      if (fixture.targetBytes) assertWithinTarget(fixture, bytes.length);
      await writeFile(path.join(outputDir, fixture.name), bytes);
      const record = {
        name: fixture.name,
        mime: fixture.mime,
        width: fixture.width,
        height: fixture.height,
        targetBytes: fixture.targetBytes ?? null,
        toleranceRatio: fixture.toleranceRatio ?? null,
        actualBytes: bytes.length,
        purpose: fixture.purpose,
        decodable: fixture.decodable !== false,
        ...(fixture.orientation ? { orientation: fixture.orientation } : {}),
        ...(fixture.encodedWidth ? { encodedWidth: fixture.encodedWidth } : {}),
        ...(fixture.encodedHeight ? { encodedHeight: fixture.encodedHeight } : {}),
        sha256: hashBytes(bytes)
      };
      manifestSamples.push(record);
      console.log(JSON.stringify(record));
    }
    const manifest = {
      generatedBy: 'tests/fixtures/generate-fixtures.js',
      command: 'npm run fixtures:generate',
      privacy: 'deterministic canvas-only; no user files or network',
      samples: manifestSamples
    };
    await writeFile(
      path.join(outputDir, '..', 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8'
    );
  } finally {
    await browser.close();
  }
}

await main();
