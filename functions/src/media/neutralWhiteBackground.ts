import sharp from 'sharp';
/** Correct only neutral near-white pixels connected to the perimeter, leaving a
 * two-pixel band around all foreground/edge pixels untouched. Transparent and
 * light-coloured products are excluded by the approved task, before this stage.
 * Final fidelity is reviewed AFTER this operation and JPEG encoding. */
export async function neutralWhiteBackground(bytes: Buffer) {
  const { data, info } = await sharp(bytes, { failOn: 'warning', limitInputPixels: 40_000_000 }).rotate().toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height; const eligible = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4; const min = Math.min(data[i], data[i + 1], data[i + 2]); const max = Math.max(data[i], data[i + 1], data[i + 2]);
    if (data[i + 3] !== 255) return { bytes, correctedPixels: 0 }; // preserve actual transparency
    eligible[p] = min >= 250 && max - min <= 3 ? 1 : 0;
  }
  const mask = new Uint8Array(n); const queue = new Uint32Array(n); let end = 0;
  const add = (p: number) => { if (eligible[p] && !mask[p]) { mask[p] = 1; queue[end++] = p; } };
  for (let x = 0; x < info.width; x++) { add(x); add(n - info.width + x); }
  for (let y = 0; y < info.height; y++) { add(y * info.width); add((y + 1) * info.width - 1); }
  for (let start = 0; start < end; start++) {
    const p = queue[start]; const x = p % info.width;
    if (x) add(p - 1); if (x < info.width - 1) add(p + 1);
    if (p >= info.width) add(p - info.width); if (p < n - info.width) add(p + info.width);
  }
  if (end < n * .1 || end > n * .9) return { bytes, correctedPixels: 0 }; // ambiguous segmentation
  let interior = mask;
  for (let step = 0; step < 2; step++) {
    const next = new Uint8Array(interior);
    for (let p = 0; p < n; p++) if (interior[p]) {
      const x = p % info.width;
      if (x > 0 && !interior[p - 1] || x < info.width - 1 && !interior[p + 1] || p >= info.width && !interior[p - info.width] || p < n - info.width && !interior[p + info.width]) next[p] = 0;
    }
    interior = next;
  }
  let correctedPixels = 0;
  for (let p = 0; p < n; p++) if (interior[p]) { const i = p * 4; if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) correctedPixels++; data[i] = data[i + 1] = data[i + 2] = 255; }
  if (!correctedPixels) return { bytes, correctedPixels };
  return { bytes: await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer(), correctedPixels };
}
