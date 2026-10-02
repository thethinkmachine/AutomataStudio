// The recorder's encoder (scripts/media/webp.mjs) writes the animated WebP
// container by hand, one changed rectangle per frame. A container slightly
// wrong is a clip that plays in one browser and not another, so these decode
// what it writes with libwebp (through sharp) and compare pixels.
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import { AnimatedWebP, changedRect } from '../scripts/media/webp.mjs';

const W = 64, H = 40;
const frame = async (x, colour = '#ff0000') => sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: { create: { width: 10, height: 10, channels: 4, background: colour } }, left: x, top: 15 }])
  .png().toBuffer();
const pixel = async (file, page, x, y) => {
  const { data } = await sharp(file, { page }).raw().toBuffer({ resolveWithObject: true });
  return [...data.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)];
};

test('changedRect finds the even-aligned box around what changed, and null for nothing', async () => {
  const a = await sharp(await frame(5)).raw().toBuffer();
  const b = await sharp(await frame(21)).raw().toBuffer();
  assert.equal(changedRect(a, a, W, H), null);
  const r = changedRect(a, b, W, H);
  assert.deepEqual(r, { left: 4, top: 14, width: 27, height: 11 });
  assert.equal(r.left % 2, 0, 'ANMF stores offsets halved');
});

test('the animation decodes frame by frame to what was drawn, rectangles and all', async () => {
  const enc = new AnimatedWebP({ lossless: true });
  await enc.add(await frame(5), 100);
  await enc.add(await frame(21), 200);
  await enc.add(await frame(21), 50); // identical: lengthens the frame before
  await enc.add(await frame(41, '#00ff00'), 300);
  enc.hold(1000);
  const file = enc.finish();
  const meta = await sharp(file, { pages: -1 }).metadata();
  assert.equal(meta.pages, 3);
  assert.equal(meta.width, W);
  assert.equal(meta.pageHeight, H);
  assert.deepEqual(meta.delay, [100, 250, 1300]);
  assert.equal(meta.loop, 0, 'loops forever');
  // A rectangle replaces rather than blends: the square that moved away leaves
  // transparency behind, not a ghost.
  assert.deepEqual(await pixel(file, 1, 7, 18), [0, 0, 0, 0]);
  assert.deepEqual(await pixel(file, 1, 25, 18), [255, 0, 0, 255]);
  assert.deepEqual(await pixel(file, 2, 45, 18), [0, 255, 0, 255]);
  assert.deepEqual(await pixel(file, 2, 25, 18), [0, 0, 0, 0]);
});

test('a frame of another size is refused rather than written', async () => {
  const enc = new AnimatedWebP();
  await enc.add(await frame(5), 100);
  const other = await sharp({ create: { width: 32, height: 32, channels: 4, background: '#000' } }).png().toBuffer();
  await assert.rejects(enc.add(other, 100), /frame is 32×32/);
});
